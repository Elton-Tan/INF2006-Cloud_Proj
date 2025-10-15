# handler.py
import os, json, time, logging
from datetime import date, timedelta, datetime, timezone
from typing import List, Dict, Tuple
import boto3, pymysql
import pandas as pd
import numpy as np
from botocore.config import Config as BotoConfig

# ===== ENV =====
SECRET_ARN        = os.environ["DB_SECRET_ARN"]
GEO               = os.getenv("GEO", "SG")
TABLE_NAME        = os.getenv("TABLE_NAME", "google_trends_daily")
KW_TABLE          = os.getenv("KW_TABLE", "trend_keywords")   # groups & keywords
CATEGORY          = int(os.getenv("CATEGORY", "0"))
SLEEP_BETWEEN     = float(os.getenv("SLEEP_BETWEEN", "1.2"))
MAX_KEYS_PER      = int(os.getenv("MAX_KEYS_PER", "5"))
DAYS_BACK         = int(os.getenv("DAYS_BACK", "365"))
INCR_OVERLAP_DAYS = int(os.getenv("INCR_OVERLAP_DAYS", "120"))
PROXY             = os.getenv("PROXY", None)

# Pub/Sub (reuse same infra as your worker)
AWS_REGION   = os.getenv("AWS_REGION") or os.getenv("REGION") or "ap-southeast-1"
WS_ENDPOINT  = os.getenv("WS_ENDPOINT")         # https://...execute-api.../stage
CONN_TABLE   = os.getenv("CONN_TABLE")          # DynamoDB connections table

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_boto_cfg = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
_ddb = boto3.client("dynamodb", region_name=AWS_REGION, config=_boto_cfg) if CONN_TABLE else None
_api = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT, config=_boto_cfg) if WS_ENDPOINT else None

# ===== Pub/Sub helpers =====
def _fanout_items(user_id: str | None = None):
    """
    Return connection items to push to.
    If you later scope by user, pass user_id to query; for now we broadcast to all.
    """
    if not _ddb or not CONN_TABLE:
        return []
    if user_id:
        resp = _ddb.query(
            TableName=CONN_TABLE,
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": {"S": f"user#{user_id}"}},
            ProjectionExpression="pk, sk, connectionId",
        )
        return resp.get("Items", [])
    # broadcast
    resp = _ddb.scan(TableName=CONN_TABLE, ProjectionExpression="pk, sk, connectionId")
    return resp.get("Items", [])

def _post_to(cid: str, payload: bytes) -> bool:
    try:
        _api.post_to_connection(ConnectionId=cid, Data=payload)
        return True
    except Exception:
        # swallow GoneException / transient issues; cleanup happens below
        return False

def _delete_conn(pk: str, sk: str):
    try:
        _ddb.delete_item(TableName=CONN_TABLE, Key={"pk": {"S": pk}, "sk": {"S": sk}})
    except Exception:
        pass

def _push_trends_updated(geo: str, slugs: list[str]):
    """
    Lightweight broadcast that tells UIs to re-fetch /trends/daily series.
    Keep payload small: geo + slugs + timestamp.
    """
    if not (_api and _ddb and CONN_TABLE):
        return
    if not slugs:
        return
    payload = json.dumps({
        "type": "trends.updated",
        "geo": geo,
        "slugs": sorted(list(set(slugs))),
        "ts": datetime.utcnow().isoformat() + "Z",
    }).encode("utf-8")
    items = _fanout_items(user_id=None)
    sent, dead = 0, 0
    for it in items:
        cid = (it.get("connectionId") or {}).get("S")
        pk  = (it.get("pk") or {}).get("S")
        sk  = (it.get("sk") or {}).get("S")
        if not cid:
            continue
        ok = _post_to(cid, payload)
        if ok:
            sent += 1
        else:
            dead += 1
            if pk and sk:
                _delete_conn(pk, sk)
    logger.info("trends.updated pushed: sent=%d cleaned=%d", sent, dead)

# ===== DB / Secrets =====
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

# ===== Pytrends =====
def _pytrends_client():
    from pytrends.request import TrendReq
    kwargs = dict(hl="en-US", tz=480)  # SGT
    if PROXY:
        kwargs["proxies"] = {"https": PROXY, "http": PROXY}
    return TrendReq(**kwargs)

# ===== Keyword loading & grouping =====
def slugify_group(name: str) -> str:
    s = (name or "").lower().strip()
    return "".join(ch if ch.isalnum() else "_" for ch in s)[:64].strip("_")

def load_active_keywords(conn, kw_table: str, geo: str, category: int) -> Dict[str, List[str]]:
    """
    Returns {group_slug: [keyword1, keyword2, ...]} for active rows.
    """
    sql = f"""
      SELECT keyword, group_name
      FROM `{kw_table}`
      WHERE is_active=1 AND geo=%s AND category=%s
      ORDER BY (is_anchor=1) DESC, keyword ASC
    """
    groups: Dict[str, List[str]] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (geo, category))
        for row in cur.fetchall():
            gslug = slugify_group(row["group_name"])
            groups.setdefault(gslug, []).append(row["keyword"])
    return groups

# ===== Windowing/Stitching =====
def make_windows(end: date, days_back: int, span_days: int = 90, step_days: int = 60) -> List[Tuple[date, date]]:
    start_total = end - timedelta(days=days_back)
    windows = []
    cur_start = start_total
    while cur_start < end:
        w_end = min(cur_start + timedelta(days=span_days - 1), end)
        windows.append((cur_start, w_end))
        if w_end >= end: break
        cur_start = cur_start + timedelta(days=step_days)
    return windows

def fetch_window(pytrends, terms: List[str], geo: str, cat: int, start: date, end: date) -> pd.DataFrame:
    timeframe = f"{start.isoformat()} {end.isoformat()}"
    pytrends.build_payload(kw_list=terms, cat=cat, timeframe=timeframe, geo=geo, gprop="")
    df = pytrends.interest_over_time()
    if df is None or df.empty:
        return pd.DataFrame(index=pd.DatetimeIndex([], name="date"))
    cols = [c for c in df.columns if c != "isPartial"]
    return df[cols]

def overlap_scale_factor(ref: pd.Series, cur: pd.Series) -> float:
    idx = ref.index.intersection(cur.index)
    if len(idx) < 3: return 1.0
    a = ref.reindex(idx).astype(float)
    b = cur.reindex(idx).astype(float)
    mask = (a > 0) & (b > 0)
    if mask.sum() < 3:
        eps = 1e-6
        ratios = (a + eps) / (b + eps)
        r = float(np.median(ratios.replace([np.inf, -np.inf], np.nan).dropna()))
        return r if np.isfinite(r) and r > 0 else 1.0
    ratios = (a[mask] / b[mask]).replace([np.inf, -np.inf], np.nan).dropna()
    if len(ratios) == 0: return 1.0
    r = float(np.median(ratios))
    return r if np.isfinite(r) and r > 0 else 1.0

def stitch_daily(pytrends, terms: List[str], geo: str, cat: int, end_day: date, days_back: int) -> pd.DataFrame:
    windows = make_windows(end=end_day, days_back=days_back, span_days=90, step_days=60)
    win_series: List[pd.DataFrame] = []
    for i, (ws, we) in enumerate(windows, 1):
        ok = False
        for attempt in range(4):
            try:
                df = fetch_window(pytrends, terms, geo, cat, ws, we)
                ok = True; break
            except Exception as e:
                wait = SLEEP_BETWEEN * (attempt + 1)
                logger.warning(f"window {i}/{len(windows)} fetch error: {e} → sleep {wait:.1f}s")
                time.sleep(wait)
        if not ok:
            df = pd.DataFrame(index=pd.DatetimeIndex([], name="date"))
        win_series.append(df); time.sleep(SLEEP_BETWEEN)

    anchor = terms[0] if terms else None
    merged: pd.DataFrame | None = None

    for df in win_series:
        if df is None or df.empty: continue
        df = df.copy(); df.index = pd.to_datetime(df.index.date)
        if merged is None:
            merged = df; continue
        anchor_col = anchor if anchor in df.columns and anchor in merged.columns else None
        if anchor_col is None:
            for c in terms:
                if c in df.columns and c in merged.columns:
                    anchor_col = c; break
        scale = 1.0
        if anchor_col:
            scale = overlap_scale_factor(merged[anchor_col], df[anchor_col])
        df_scaled = (df * scale).astype(float)
        merged = pd.concat([merged, df_scaled]).groupby(level=0).mean()

    if merged is None: return pd.DataFrame()
    merged = (merged.clip(0.0, 100.0)
                    .sort_index()
                    .asfreq("D")
                    .interpolate(limit_direction="both")
                    .clip(0.0, 100.0))
    return merged

# ===== Aggregation by group =====
def groups_from_terms_df(df_terms: pd.DataFrame, groups: Dict[str, List[str]]) -> pd.DataFrame:
    out = {}
    for gslug, alts in groups.items():
        cols = [c for c in alts if c in df_terms.columns]
        if cols:
            out[gslug] = df_terms[cols].max(axis=1)  # max across synonyms
    gdf = pd.DataFrame(out); gdf.index.name = "day"
    return gdf

# ===== Upsert =====
def upsert_rows(conn, table: str, geo: str, gdf: pd.DataFrame) -> int:
    if gdf.empty: return 0
    gdf = gdf.copy(); gdf.index = pd.to_datetime(gdf.index).date
    now_iso = datetime.now(timezone.utc).isoformat()
    sql = f"""
    INSERT INTO `{table}`
      (`day`,`geo`,`keyword_slug`,`keyword_raw`,`interest`,`is_partial`,`ingested_at`)
    VALUES (%s,%s,%s,%s,%s,%s,%s)
    ON DUPLICATE KEY UPDATE
      `interest`=VALUES(`interest`),
      `keyword_raw`=VALUES(`keyword_raw`),
      `is_partial`=VALUES(`is_partial`),
      `ingested_at`=VALUES(`ingested_at`);
    """
    rows = 0
    with conn.cursor() as cur:
        for day, row in gdf.iterrows():
            for slug, val in row.items():
                if pd.isna(val):
                    continue
                interest = int(round(float(val)))
                cur.execute(sql, (
                    day.isoformat(), geo, slug, slug.replace("_", " "),
                    interest,
                    1 if (day >= (date.today() - timedelta(days=1))) else 0,
                    now_iso,
                ))
                rows += 1
    return rows

# ===== Incremental helpers =====
def get_last_days(conn, table: str, geo: str, slugs: List[str]) -> Dict[str, date]:
    if not slugs:
        return {}
    placeholders = ",".join(["%s"] * len(slugs))
    sql = f"""
      SELECT keyword_slug, MAX(day) AS last_day
      FROM `{table}`
      WHERE geo=%s AND keyword_slug IN ({placeholders})
      GROUP BY keyword_slug
    """
    out: Dict[str, date] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (geo, *slugs))
        for row in cur.fetchall():
            if row["last_day"]:
                out[row["keyword_slug"]] = row["last_day"]
    return out

def filter_new_rows_per_slug(gdf: pd.DataFrame, last_days: Dict[str, date]) -> pd.DataFrame:
    if gdf.empty:
        return gdf
    gdf = gdf.copy()
    day_index = pd.to_datetime(gdf.index).date
    mask = pd.DataFrame(True, index=gdf.index, columns=gdf.columns)
    for slug, ld in last_days.items():
        if slug in gdf.columns and ld:
            mask.loc[day_index <= ld, slug] = False
    gdf = gdf.where(mask)
    gdf = gdf.dropna(how="all", axis=1)  # drop slugs with no new rows
    gdf = gdf.dropna(how="all", axis=0)  # drop days with no remaining values
    return gdf

# ===== Lambda =====
def lambda_handler(_event, _ctx):
    end_day = date.today()

    # 1) Load active keywords from DB and group by group_name
    conn_meta = _connect()
    try:
        groups_dict = load_active_keywords(conn_meta, KW_TABLE, GEO, CATEGORY)
    finally:
        try: conn_meta.close()
        except: pass

    if not groups_dict:
        return {"statusCode": 400, "body": json.dumps({"error": "no_active_keywords"})}

    # Flatten all distinct terms (Google limit ~5 per request; we honor via MAX_KEYS_PER)
    all_terms = []
    seen = set()
    for alts in groups_dict.values():
        for t in alts:
            tl = t.lower()
            if tl not in seen:
                all_terms.append(t); seen.add(tl)

    if len(all_terms) > MAX_KEYS_PER:
        return {"statusCode": 400, "body": json.dumps({"error": "too_many_terms", "n": len(all_terms)})}

    # 2) Incremental planning per group_slug
    slugs = list(groups_dict.keys())

    conn_meta = _connect()
    try:
        last_days = get_last_days(conn_meta, TABLE_NAME, GEO, slugs)
    finally:
        try: conn_meta.close()
        except: pass

    starts_needed = []
    for slug in slugs:
        ld = last_days.get(slug)
        if ld:
            # Existing group: overlap only (but never earlier than backfill horizon)
            start_slug = max(end_day - timedelta(days=DAYS_BACK),
                              ld - timedelta(days=INCR_OVERLAP_DAYS))
        else:
            # New group: full backfill window
            start_slug = end_day - timedelta(days=DAYS_BACK)
        starts_needed.append(start_slug)

    start_overall = min(starts_needed) if starts_needed else (end_day - timedelta(days=DAYS_BACK))
    effective_days_back = max(1, (end_day - start_overall).days)

    # 3) Fetch & stitch
    pytrends = _pytrends_client()
    df_terms = stitch_daily(pytrends, all_terms, GEO, CATEGORY, end_day, effective_days_back)
    if df_terms.empty:
        return {"statusCode": 500, "body": json.dumps({"error": "empty_result"})}

    # 4) Aggregate synonyms per group
    gdf = groups_from_terms_df(df_terms, groups_dict)

    # 5) Only write brand-new days for existing slugs; write all for new slugs
    gdf_to_write = filter_new_rows_per_slug(gdf, last_days)

    if gdf_to_write.empty:
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "geo": GEO, "rows_upserted": 0, "cols": list(gdf.columns),
                "start": str(gdf.index.min()), "end": str(gdf.index.max()),
                "table": TABLE_NAME, "mode": "incremental", "note": "no_new_rows"
            })
        }

    # 6) Upsert
    conn = _connect()
    try:
        n = upsert_rows(conn, TABLE_NAME, GEO, gdf_to_write)
    finally:
        try: conn.close()
        except: pass

    new_slugs = sorted([s for s in slugs if s not in last_days])
    existed_slugs = sorted([s for s in slugs if s in last_days])

    # 7) Push a small Pub/Sub event (only if we actually wrote something)
    try:
        touched_slugs = list(gdf_to_write.columns)
        if n > 0 and touched_slugs:
            _push_trends_updated(GEO, touched_slugs)
    except Exception:
        logger.warning("trends.updated push failed", exc_info=True)

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({
            "geo": GEO,
            "rows_upserted": n,
            "cols": list(gdf_to_write.columns),
            "start": str(gdf_to_write.index.min()),
            "end": str(gdf_to_write.index.max()),
            "table": TABLE_NAME,
            "mode": "backfill" if new_slugs else "incremental",
            "existed_slugs": existed_slugs,
            "new_slugs": new_slugs,
            "effective_days_back": effective_days_back
        })
    }
