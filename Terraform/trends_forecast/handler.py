# handler.py  (Python 3.12)
import os, json, logging
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import boto3, pymysql
import pandas as pd
import numpy as np

# =====================
# ENV / CONFIG
# =====================
SECRET_ARN         = os.environ["DB_SECRET_ARN"]
GEO                = os.getenv("GEO", "SG")
DAILY_TABLE        = os.getenv("TABLE_NAME", "google_trends_daily")
KW_TABLE           = os.getenv("KW_TABLE", "trend_keywords")          # enumerate active groups/slugs
FORECAST_TABLE     = os.getenv("FORECAST_TABLE", "google_trends_forecast")

HISTORY_DAYS       = int(os.getenv("HISTORY_DAYS", "420"))            # lookback for training
FORECAST_DAYS      = int(os.getenv("FORECAST_DAYS", "7"))             # horizon
MIN_TRAIN_DAYS     = int(os.getenv("MIN_TRAIN_DAYS", "120"))          # minimal usable history
CV_FOLDS           = int(os.getenv("CV_FOLDS", "5"))
ALPHAS_STR         = os.getenv("RIDGE_ALPHAS", "0.1,0.3,1,3,10")      # exclude 0 in default sweep
# Clamp any provided zeros to a tiny epsilon to avoid OLS singularities
ALPHAS             = [max(1e-6, float(x)) for x in ALPHAS_STR.split(",") if x.strip() != ""]

# Features
LAGS               = [1,2,3,4,5,6,7,14,21]
USE_MA7            = True
USE_WEEKDAY_ONEHOT = True

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# =====================
# DB Helpers
# =====================
def _load_db_cfg():
    sm = boto3.client("secretsmanager", region_name=os.getenv("AWS_REGION") or os.getenv("REGION"))
    sec = sm.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
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
    return pymysql.connect(**_load_db_cfg())

def _today_sgt() -> date:
    return (datetime.utcnow() + timedelta(hours=8)).date()

# =====================
# Data loading
# =====================
def load_active_group_slugs(conn, geo: str) -> List[str]:
    """
    Forecast at the 'group' (slug) level (same aggregation you write in the scraper).
    """
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
    idx = pd.to_datetime(df["day"])                 # DatetimeIndex
    s = pd.Series(df["interest"].astype(float).values, index=idx, name=slug)

    # Dense daily index; fill gaps for a stable design matrix
    full_idx = pd.date_range(start=idx.min(), end=idx.max(), freq="D")
    s = s.reindex(full_idx)
    s = s.interpolate(limit_direction="both").ffill().bfill()
    return s

# =====================
# Feature engineering
# =====================
def make_design_matrix(y: pd.Series) -> Tuple[pd.DataFrame, pd.Series]:
    """
    Build supervised dataset X, y_tgt from univariate daily series y.
    y index must be consecutive daily timestamps.
    """
    df = pd.DataFrame({"y": y.values}, index=pd.to_datetime(y.index))

    # Lags
    for L in LAGS:
        df[f"lag_{L}"] = df["y"].shift(L)

    # Moving average
    if USE_MA7:
        df["ma7"] = df["y"].rolling(window=7, min_periods=1).mean().shift(1)

    # Weekday one-hot (drop wd_0 to avoid dummy-variable trap with intercept)
    if USE_WEEKDAY_ONEHOT:
        for wd in range(1, 7):  # 1..6 only
            df[f"wd_{wd}"] = (df.index.weekday == wd).astype(float)

    # Drop rows with NaNs (introduced by lags)
    df = df.dropna()

    X = df.drop(columns=["y"]).astype(float)
    y_tgt = df["y"].astype(float)
    return X, y_tgt

# =====================
# Ridge regression (closed-form) + CV
# =====================
def ridge_fit(X: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
    """
    Closed-form ridge: w = (X^T X + alpha I)^-1 X^T y
    Adds a bias column inside X (caller handles).
    """
    XtX = X.T @ X
    d = XtX.shape[0]
    a = max(1e-6, float(alpha))                 # ensure strictly positive ridge
    A = XtX + a * np.eye(d)
    try:
        return np.linalg.solve(A, X.T @ y)
    except np.linalg.LinAlgError:
        # Extremely ill-conditioned; fall back to pseudo-inverse
        return np.linalg.pinv(A) @ (X.T @ y)

def ridge_predict(X: np.ndarray, w: np.ndarray) -> np.ndarray:
    return X @ w

def time_series_cv_rmse(X: np.ndarray, y: np.ndarray, k_folds: int, alpha: float) -> float:
    """
    Rolling-origin CV: split by time; never leak future into past.
    """
    n = len(y)
    if n < k_folds + 5:
        # Short series: hold-out last 20%
        split = int(max(5, n * 0.8))
        try:
            w = ridge_fit(X[:split], y[:split], alpha)
            yhat = ridge_predict(X[split:], w)
        except Exception:
            return 1e9
        err = yhat - y[split:]
        return float(np.sqrt(np.mean(err**2)))

    # Growing-window folds from ~50% to n-1
    fold_sizes = np.linspace(int(n * 0.5), n - 1, k_folds, dtype=int)
    rmses = []
    for split in fold_sizes:
        if split + 1 >= n:
            break
        try:
            w = ridge_fit(X[:split], y[:split], alpha)
            yhat = ridge_predict(X[split:], w)
        except Exception:
            rmses.append(1e9)
            continue
        err = yhat - y[split:]
        rmses.append(float(np.sqrt(np.mean(err**2))))
    return float(np.mean(rmses)) if rmses else 1e9

def select_alpha(X: np.ndarray, y: np.ndarray, alphas: List[float], k_folds: int) -> float:
    best_alpha, best_rmse = alphas[0], 1e18
    for a in alphas:
        rmse = time_series_cv_rmse(X, y, k_folds, a)
        if rmse < best_rmse:
            best_rmse, best_alpha = rmse, a
    return best_alpha

# =====================
# Forecast logic
# =====================
def train_and_forecast(y: pd.Series, horizon: int) -> List[float]:
    """
    Train ridge with CV, then recursive 1-step forecasting for 'horizon' days.
    """
    if len(y) < MIN_TRAIN_DAYS:
        raise ValueError(f"insufficient_history: {len(y)} < {MIN_TRAIN_DAYS}")

    # Optional safety for ultra-flat series: persistence forecast
    if float(np.nanstd(y.values)) < 1e-6:
        last = float(y.values[-1])
        return [max(0.0, min(100.0, last))] * horizon

    # Build design matrix
    X_df, y_tgt = make_design_matrix(y)
    # Add bias column
    X_full = np.hstack([np.ones((len(X_df), 1)), X_df.values])
    y_full = y_tgt.values

    # Choose alpha by CV and fit
    alpha = select_alpha(X_full, y_full, ALPHAS, CV_FOLDS)
    w = ridge_fit(X_full, y_full, alpha)

    # Recursive forecast
    preds: List[float] = []
    y_hist = y.copy()  # DatetimeIndex

    for _ in range(horizon):
        next_ts = y_hist.index[-1] + pd.Timedelta(days=1)
        tmp = pd.Series(y_hist.values, index=y_hist.index)
        row = {}

        # Lags from y_hist (includes prior preds)
        for L in LAGS:
            row[f"lag_{L}"] = float(tmp.iloc[-L]) if len(tmp) >= L else float(tmp.iloc[0])

        if USE_MA7:
            window_vals = tmp.iloc[-7:].values if len(tmp) >= 7 else tmp.values
            row["ma7"] = float(np.mean(window_vals))

        if USE_WEEKDAY_ONEHOT:
            for wd in range(1, 7):  # match training columns
                row[f"wd_{wd}"] = 1.0 if next_ts.dayofweek == wd else 0.0

        # Keep feature order exactly as in training
        x_vec = np.array([1.0] + [row[k] for k in X_df.columns], dtype=float)
        yhat = float(ridge_predict(x_vec.reshape(1, -1), w)[0])

        # Clip to Google Trends range
        yhat = max(0.0, min(100.0, yhat))
        preds.append(yhat)

        # Append to history for next-step lags
        y_hist.loc[next_ts] = yhat

    return preds

# =====================
# Upsert forecast rows
# =====================
def upsert_forecasts(conn, geo: str, slug: str, start_next: date, preds: List[float]) -> int:
    if not preds:
        return 0
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

# =====================
# Lambda
# =====================
def lambda_handler(_event, _ctx):
    end_day = _today_sgt()
    conn = _connect()
    try:
        slugs = load_active_group_slugs(conn, GEO)
        if not slugs:
            return {"statusCode": 200, "body": json.dumps({"note": "no_active_slugs"})}

        total_upsert = 0
        trained = 0
        skipped = []

        for slug in slugs:
            try:
                series = load_daily_series(conn, GEO, slug, end_day, HISTORY_DAYS)
                if len(series) < MIN_TRAIN_DAYS:
                    skipped.append({"slug": slug, "reason": "insufficient_history", "n": len(series)})
                    continue

                last_obs_date = pd.Timestamp(series.index.max()).date()
                preds = train_and_forecast(series, FORECAST_DAYS)
                up = upsert_forecasts(
                    conn, GEO, slug,
                    start_next=(last_obs_date + timedelta(days=1)),
                    preds=preds
                )
                total_upsert += up
                trained += 1
            except Exception as e:
                logger.exception(f"slug {slug} failed")
                skipped.append({"slug": slug, "reason": str(e)})

        body = {
            "geo": GEO,
            "trained_slugs": trained,
            "rows_upserted": total_upsert,
            "skipped": skipped,
            "history_days": HISTORY_DAYS,
            "horizon_days": FORECAST_DAYS,
            "cv_folds": CV_FOLDS,
            "alphas": ALPHAS,
        }
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body)
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass
