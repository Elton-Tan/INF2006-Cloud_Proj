# glue_forecast_job.py  (Python Shell 3.10)
import os, sys, json, logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Dict

import numpy as np
import pandas as pd
import boto3, pymysql
from botocore.config import Config as BotoConfig

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

# ---------- Read args from Glue Default Arguments ----------
def _get_arg(name: str, default: str | None = None) -> str | None:
    for i, a in enumerate(sys.argv):
        if a == f"--{name}" and i+1 < len(sys.argv):
            return sys.argv[i+1]
    return default

AWS_REGION     = os.getenv("AWS_REGION") or os.getenv("REGION") or "ap-southeast-1"
DB_SECRET_ARN  = _get_arg("DB_SECRET_ARN")
GEO            = _get_arg("GEO", "SG")

KW_TABLE       = _get_arg("KW_TABLE", "trend_keywords")
DAILY_TABLE    = _get_arg("DAILY_TABLE", "google_trends_daily")
FORECAST_TABLE = _get_arg("FORECAST_TABLE", "google_trends_forecast")

HISTORY_DAYS   = int(_get_arg("HISTORY_DAYS", "420"))
FORECAST_DAYS  = int(_get_arg("FORECAST_DAYS", "7"))
MIN_TRAIN_DAYS = int(_get_arg("MIN_TRAIN_DAYS", "120"))

# Optional WebSocket broadcast
CONN_TABLE     = _get_arg("CONN_TABLE")
WS_ENDPOINT    = _get_arg("WS_ENDPOINT")

_bcfg  = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
_sm    = boto3.client("secretsmanager", region_name=AWS_REGION, config=_bcfg)
_ddb   = boto3.client("dynamodb", region_name=AWS_REGION, config=_bcfg) if CONN_TABLE else None
_wsapi = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT, config=_bcfg) if WS_ENDPOINT else None

# ---------- Model config (same as your notebook) ----------
VAL_DAYS      = 14
ALPHAS        = [0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30, 100]
LAGS          = [1,2,3,4,5,6,7,14,21,28,35]
USE_MA        = True
MA_WINDOW     = 7
USE_WD        = True
CLIP_MINMAX   = (0.0, 100.0)

EPS_ZERO      = 1e-9
HUBER_DELTA   = 5.0
HUBER_ITERS   = 6
DECAY         = 1.0

FOURIER_PERIOD = 7
FOURIER_K      = 2

TAU_NEIGHBOR_FACTORS = [0.7, 0.85, 1.0, 1.15, 1.3]
DYN_TAU_K = 0.30
SOFT_GATE = True

# ---------- DB helpers ----------
def _db_cfg() -> Dict:
    sec = _sm.get_secret_value(SecretId=DB_SECRET_ARN)["SecretString"]
    cfg = json.loads(sec)
    return dict(
        host=cfg["host"],
        user=cfg["username"],
        password=cfg["password"],
        db=cfg.get("dbname") or cfg.get("db") or os.getenv("DB_NAME", ""),
        port=int(cfg.get("port", 3306)),
        connect_timeout=10,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )

def _connect():
    return pymysql.connect(**_db_cfg())

def _today_sgt() -> date:
    return (datetime.utcnow() + timedelta(hours=8)).date()

# ---------- Data loading ----------
def load_active_slugs(conn, geo: str) -> List[str]:
    sql = f"""
      SELECT DISTINCT LOWER(TRIM(REPLACE(group_name,' ','_'))) AS gslug
      FROM `{KW_TABLE}`
      WHERE is_active=1 AND geo=%s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (geo,))
        rows = cur.fetchall()
    slugs = [r["gslug"].strip("_") for r in rows if r["gslug"]]
    return sorted(list({s for s in slugs if s}))

def load_daily_series(conn, geo: str, slug: str, end_day: date, history_days: int) -> pd.Series:
    start_day = end_day - timedelta(days=history_days)
    sql = f"""
      SELECT day, interest
      FROM `{DAILY_TABLE}`
      WHERE geo=%s AND keyword_slug=%s AND day BETWEEN %s AND %s
      ORDER BY day ASC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (geo, slug, start_day, end_day))
        rows = cur.fetchall()
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows)
    idx = pd.to_datetime(df["day"])
    s = pd.Series(df["interest"].astype(float).values, index=idx, name=slug)
    full = pd.date_range(idx.min(), idx.max(), freq="D")
    s = s.reindex(full).interpolate(limit_direction="both").ffill().bfill()
    return s

# ---------- Features / model utils ----------
def add_fourier_to_df(df, period=7, K=2):
    t = np.arange(len(df), dtype=float)
    for k in range(1, K+1):
        df[f"s{k}"] = np.sin(2*np.pi*k*t/period)
        df[f"c{k}"] = np.cos(2*np.pi*k*t/period)
    return df

def make_design_matrix(y: pd.Series, lags=LAGS, use_ma=True, ma_window=7, use_wd=True):
    df = pd.DataFrame({"y": y.values}, index=pd.to_datetime(y.index))
    for L in lags: df[f"lag_{L}"] = df["y"].shift(L)
    if use_ma: df[f"ma{ma_window}"] = df["y"].rolling(ma_window, min_periods=1).mean().shift(1)
    if use_wd:
        for wd in range(1,7):
            df[f"wd_{wd}"] = (df.index.weekday == wd).astype(float)
    z = (df["y"] < EPS_ZERO).astype(float)
    df["z_lag1"] = z.shift(1)
    df["z_run"]  = z.groupby((z != z.shift()).cumsum()).cumsum().shift(1).fillna(0.0).clip(0, 30)
    prev_nz = df["y"].replace(0.0, np.nan).ffill().shift(1).fillna(0.0)
    df["prev_nz"] = prev_nz
    df["max14"]   = df["y"].rolling(14, min_periods=1).max().shift(1).fillna(0.0)
    df["ema7"]    = df["y"].ewm(span=7, adjust=False).mean().shift(1).fillna(0.0)
    df = add_fourier_to_df(df, period=FOURIER_PERIOD, K=FOURIER_K)
    df = df.dropna()
    X = df.drop(columns=["y"]).astype(float)
    y_tgt = df["y"].astype(float)
    return X, y_tgt

def ridge_fit(X, y, alpha):
    XtX = X.T @ X
    A   = XtX + max(1e-6,float(alpha))*np.eye(XtX.shape[0])
    try: return np.linalg.solve(A, X.T @ y)
    except np.linalg.LinAlgError: return np.linalg.pinv(A) @ (X.T @ y)

def huber_weights(resid, delta=5.0):
    r=np.asarray(resid,float); w=np.ones_like(r); m=np.abs(r)>delta
    w[m]=delta/np.maximum(1e-12,np.abs(r[m])); return w

def ridge_fit_wls(X,y,alpha,w=None):
    if w is None: w=np.ones_like(y,float)
    sw=np.sqrt(np.asarray(w,float)).reshape(-1,1)
    Xw, yw = X*sw, y*sw[:,0]
    XtX = Xw.T @ Xw
    A   = XtX + max(1e-6,float(alpha))*np.eye(XtX.shape[0])
    try: return np.linalg.solve(A, Xw.T @ yw)
    except np.linalg.LinAlgError: return np.linalg.pinv(A) @ (Xw.T @ yw)

def ridge_fit_huber(X,y,alpha,delta=5.0,iters=5,decay=1.0):
    n=len(y); w_decay=(decay**np.arange(n)[::-1]) if (decay<1.0) else np.ones(n)
    w=np.ones_like(y,float)
    coef=ridge_fit_wls(X,y,alpha,w*w_decay)
    for _ in range(iters):
        yhat = X@coef
        w_h  = huber_weights(y - yhat, delta=delta)
        coef = ridge_fit_wls(X,y,alpha,w_h*w_decay)
    return coef

def to_logit_y(y):
    p = (np.asarray(y,float) + 0.5) / 101.0
    p = np.clip(p, 1e-6, 1-1e-6)
    return np.log(p/(1-p))
def from_logit_y(z):
    p = 1.0/(1.0+np.exp(-np.asarray(z,float)))
    y = 101.0*p - 0.5
    return np.clip(y, 0.0, 100.0)

def fit_zero_gate(X_full, y, alpha=1.0):
    y_bin=(y>EPS_ZERO).astype(float)
    return ridge_fit(X_full, y_bin, alpha=alpha)

def fit_standardizer(X_train_full):
    mu = X_train_full.mean(axis=0)
    sd = X_train_full.std(axis=0)
    sd = np.where(sd<1e-12, 1.0, sd)
    return mu, sd

def apply_standardizer(X_full, mu, sd):
    return (X_full - mu) / sd

def gate_prob(xrow, w_gate):
    z=float(np.dot(xrow, w_gate))
    if z>50: return 1.0
    if z<-50:return 0.0
    return 1.0/(1.0+np.exp(-z))

def trailing_zero_run(vals, eps=1e-9, cap=30):
    r=0
    for v in vals[::-1]:
        if abs(v)<eps: r+=1
        else: break
    return float(min(r,cap))

def build_feature_row(next_ts, tmp_series, lags, ma_window, use_wd, t_counter):
    row={}
    for L in lags:
        row[f"lag_{L}"]=float(tmp_series.iloc[-L]) if len(tmp_series)>=L else float(tmp_series.iloc[0])
    if USE_MA:
        arr = tmp_series.iloc[-ma_window:].values if len(tmp_series)>=ma_window else tmp_series.values
        row[f"ma{ma_window}"]=float(np.mean(arr))
    if use_wd:
        for wd in range(1,7):
            row[f"wd_{wd}"]=1.0 if next_ts.dayofweek==wd else 0.0
    vals = tmp_series.values
    row["z_lag1"]=1.0 if abs(float(tmp_series.iloc[-1]))<EPS_ZERO else 0.0
    row["z_run"] = trailing_zero_run(vals,eps=EPS_ZERO,cap=30)
    prev_nz=0.0
    for v in vals[::-1]:
        if v>EPS_ZERO: prev_nz=float(v); break
    row["prev_nz"]=prev_nz
    row["max14"]=float(np.max(vals[-14:]) if len(vals)>=14 else np.max(vals))
    alpha=2.0/(7+1); ema=0.0
    for v in vals[-50:]: ema=alpha*v + (1-alpha)*ema
    row["ema7"]=float(ema)
    for k in range(1,FOURIER_K+1):
        row[f"s{k}"]=float(np.sin(2*np.pi*k*t_counter/FOURIER_PERIOD))
        row[f"c{k}"]=float(np.cos(2*np.pi*k*t_counter/FOURIER_PERIOD))
    return row

def recursive_forecast_gate(y_hist, horizon, cols_order, w_gate, w_reg,
                            lags, use_ma, ma_window, use_wd,
                            clip_minmax, t_start, tau, mu, sd,
                            dyn_tau_k=DYN_TAU_K, soft_gate=SOFT_GATE):
    preds=[]; tmp=y_hist.copy(); t_counter=int(t_start)
    for _ in range(horizon):
        next_ts = tmp.index[-1] + pd.Timedelta(days=1)
        row = build_feature_row(next_ts, tmp, lags, ma_window, use_wd, t_counter)
        x = np.array([1.0] + [row[c] for c in cols_order], dtype=float)
        x_std = x.copy()
        x_std[1:] = (x_std[1:] - mu[1:]) / np.where(np.abs(sd[1:])<1e-12, 1.0, sd[1:])
        zr = float(row["z_run"])
        tau_dyn = float(np.clip(tau + dyn_tau_k * (zr / (zr + 4.0)), 0.05, 0.95))
        p = gate_prob(x_std, w_gate)
        if p < tau_dyn:
            yhat = 0.0
        else:
            zhat = float(np.dot(x_std, w_reg))
            yhat_raw = float(from_logit_y(zhat))
            if soft_gate:
                s = (p - tau_dyn) / max(1e-6, (1.0 - tau_dyn))
                s = float(np.clip(s, 0.0, 1.0))
                yhat = yhat_raw * s
            else:
                yhat = yhat_raw
            soft_cap = max(row["max14"]*1.25, row["prev_nz"]*1.5, 10.0)
            yhat = min(yhat, soft_cap)
        if clip_minmax:
            yhat = min(clip_minmax[1], max(clip_minmax[0], yhat))
        preds.append(yhat)
        tmp.loc[next_ts] = yhat
        t_counter += 1
    return np.array(preds, float)

def pick_tau(w_gate, X_hold, y_hold):
    taus=np.linspace(0.10,0.60,11)
    yb=(y_hold>EPS_ZERO).astype(int)
    best_f1, best_tau=0.0, 0.35
    for t in taus:
        p = 1.0/(1.0+np.exp(-(X_hold @ w_gate)))
        yh=(p>=t).astype(int)
        tp=int(((yh==1)&(yb==1)).sum()); fp=int(((yh==1)&(yb==0)).sum()); fn=int(((yh==0)&(yb==1)).sum())
        prec = tp/(tp+fp) if (tp+fp)>0 else 0.0
        rec  = tp/(tp+fn) if (tp+fn)>0 else 0.0
        f1   = 2*prec*rec/(prec+rec) if (prec+rec)>0 else 0.0
        if f1>best_f1: best_f1,best_tau=f1,float(t)
    return best_tau

def forecast_series_two_stage(s: pd.Series, horizon: int) -> List[float]:
    X_df, y_tgt = make_design_matrix(s, LAGS, USE_MA, MA_WINDOW, USE_WD)
    n=len(y_tgt)
    split = n - VAL_DAYS if n > VAL_DAYS + 10 else int(n*0.8)
    split = max(10, min(split, n-2))
    cols_order = list(X_df.columns)

    X_noi = X_df.values
    X_full_noi = np.hstack([np.ones((n,1)), X_noi])
    mu, sd = fit_standardizer(X_full_noi[:split])
    X_full = X_full_noi.copy()
    X_full[:,1:] = apply_standardizer(X_full_noi[:,1:], mu[1:], sd[1:])

    X_train_full = X_full[:split]
    y_train      = y_tgt.iloc[:split].values

    g_split = max(10, int(0.9 * len(y_train)))
    w_gate0 = fit_zero_gate(X_train_full[:g_split], y_train[:g_split], alpha=0.5)
    tau0_raw = pick_tau(w_gate0, X_train_full[g_split:], y_train[g_split:])
    tau0 = max(0.25, float(tau0_raw))

    best = {"alpha":None,"tau":None,"w_gate":None,"w_reg":None,"score":1e18}
    train_last_ts = X_df.index[split-1]
    y_hist = s.loc[:train_last_ts]

    for a in ALPHAS:
        w_gate = fit_zero_gate(X_train_full, y_train, alpha=0.5)
        mask_pos = y_train > EPS_ZERO
        if mask_pos.sum() < 10:
            z_train = to_logit_y(y_train)
            w_reg = ridge_fit_huber(X_train_full, z_train, alpha=a,
                                    delta=HUBER_DELTA, iters=HUBER_ITERS, decay=DECAY)
        else:
            z_train_pos = to_logit_y(y_train[mask_pos])
            w_reg = ridge_fit_huber(X_train_full[mask_pos], z_train_pos, alpha=a,
                                    delta=HUBER_DELTA, iters=HUBER_ITERS, decay=DECAY)
        for f in TAU_NEIGHBOR_FACTORS:
            tau = float(np.clip(tau0*f, 0.25, 0.90))
            preds = recursive_forecast_gate(
                y_hist=y_hist, horizon=min(VAL_DAYS, 7), cols_order=cols_order,
                w_gate=w_gate, w_reg=w_reg, lags=LAGS,
                use_ma=USE_MA, ma_window=MA_WINDOW, use_wd=USE_WD,
                clip_minmax=CLIP_MINMAX, t_start=split, tau=tau, mu=mu, sd=sd
            )
            actual = y_tgt.iloc[split: split+len(preds)].values
            w = np.where(actual < 1e-6, 3.0, 1.0)
            score = float(np.sqrt(np.mean(w * (actual - preds)**2)))
            if score < best["score"]:
                best.update({"alpha":a, "tau":tau, "w_gate":w_gate, "w_reg":w_reg, "score":score})

    preds = recursive_forecast_gate(
        y_hist=s.copy(), horizon=horizon, cols_order=cols_order,
        w_gate=best["w_gate"], w_reg=best["w_reg"], lags=LAGS,
        use_ma=USE_MA, ma_window=MA_WINDOW, use_wd=USE_WD,
        clip_minmax=CLIP_MINMAX, t_start=len(X_df), tau=best["tau"], mu=mu, sd=sd
    )
    return [float(x) for x in preds]

# ---------- Upsert + optional WebSocket ----------
def upsert_forecasts(conn, geo: str, slug: str, start_next: date, preds: List[float]) -> int:
    if not preds: return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    sql = f"""
    INSERT INTO `{FORECAST_TABLE}` (geo, keyword_slug, day, forecast, generated_at)
    VALUES (%s,%s,%s,%s,%s)
    ON DUPLICATE KEY UPDATE
      forecast=VALUES(forecast),
      generated_at=VALUES(generated_at);
    """
    rows = 0
    with conn.cursor() as cur:
        for i, yhat in enumerate(preds, start=1):
            d = start_next + timedelta(days=i - 1)
            cur.execute(sql, (geo, slug, d, int(round(yhat)), now_iso))
            rows += 1
    return rows

def _fanout_items():
    if not (_ddb and CONN_TABLE): return []
    resp = _ddb.scan(TableName=CONN_TABLE, ProjectionExpression="pk, sk, connectionId")
    return resp.get("Items", [])

def _post_to(cid: str, payload: bytes) -> bool:
    try:
        _wsapi.post_to_connection(ConnectionId=cid, Data=payload)
        return True
    except Exception:
        return False

def _delete_conn(pk: str, sk: str):
    try:
        _ddb.delete_item(TableName=CONN_TABLE, Key={"pk": {"S": pk}, "sk": {"S": sk}})
    except Exception:
        pass

def push_trends_updated(geo: str, slugs: List[str], *, horizon: int):
    if not (_wsapi and _ddb and CONN_TABLE): return
    if not slugs: return
    payload = json.dumps({
        "type": "trends.updated",
        "geo": geo,
        "kind": "forecast",
        "slugs": sorted(list(set(slugs))),
        "horizon": horizon,
        "ts": datetime.utcnow().isoformat() + "Z",
    }).encode("utf-8")
    items = _fanout_items()
    sent, dead = 0, 0
    for it in items:
        cid = (it.get("connectionId") or {}).get("S")
        pk  = (it.get("pk") or {}).get("S")
        sk  = (it.get("sk") or {}).get("S")
        if cid and _post_to(cid, payload):
            sent += 1
        else:
            dead += 1
            if pk and sk:
                _delete_conn(pk, sk)
    log.info("trends.updated(kind=forecast) pushed: sent=%d cleaned=%d", sent, dead)

# ---------- Main ----------
def main():
    end_day = _today_sgt()
    conn = _connect()
    total_rows, trained, skipped = 0, 0, []
    touched_slugs = []

    try:
        slugs = load_active_slugs(conn, GEO)
        if not slugs:
            log.info("No active slugs for GEO=%s", GEO)
            return

        for slug in slugs:
            try:
                series = load_daily_series(conn, GEO, slug, end_day, HISTORY_DAYS)
                if len(series) < MIN_TRAIN_DAYS:
                    skipped.append({"slug": slug, "reason": "insufficient_history", "n": len(series)})
                    continue
                last_obs_date = pd.Timestamp(series.index.max()).date()
                preds = forecast_series_two_stage(series, FORECAST_DAYS)
                up = upsert_forecasts(conn, GEO, slug, last_obs_date + timedelta(days=1), preds)
                total_rows += up
                if up > 0:
                    touched_slugs.append(slug)
                trained += 1
            except Exception as e:
                log.exception("Slug %s failed", slug)
                skipped.append({"slug": slug, "reason": str(e)})

        if touched_slugs:
            try:
                push_trends_updated(GEO, touched_slugs, horizon=FORECAST_DAYS)
            except Exception:
                log.warning("WebSocket broadcast failed", exc_info=True)

        log.info("DONE geo=%s trained=%d upserts=%d skipped=%d", GEO, trained, total_rows, len(skipped))
    finally:
        try: conn.close()
        except Exception: pass

if __name__ == "__main__":
    main()
