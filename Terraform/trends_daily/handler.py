# handler.py — Google Trends Ingestion with sticky proxy, timeouts, health-check, and fast→direct→stitched fallback (AWS Lambda, Python 3.12)

import os, json, time, random, logging
from datetime import date, timedelta, datetime, timezone
from typing import List, Dict, Tuple, Optional, Callable

import boto3, pymysql
import pandas as pd
import numpy as np
import requests
from requests import exceptions as req_exc  # for ReadTimeout detection

# ========= ENV =========
SECRET_ARN        = os.environ["DB_SECRET_ARN"]                # required
GEO               = os.getenv("GEO", "SG")
TABLE_NAME        = os.getenv("TABLE_NAME", "google_trends_daily")
KW_TABLE          = os.getenv("KW_TABLE", "trend_keywords")
CATEGORY          = int(os.getenv("CATEGORY", "0"))
SLEEP_BETWEEN     = float(os.getenv("SLEEP_BETWEEN", "6.0"))   # polite spacing
MAX_KEYS_PER      = int(os.getenv("MAX_KEYS_PER", "5"))        # Trends per call (upper bound)
DAYS_BACK         = int(os.getenv("DAYS_BACK", "30"))          # horizon per run
INCR_OVERLAP_DAYS = int(os.getenv("INCR_OVERLAP_DAYS", "120")) # overlap for stable scaling
FAST_MODE         = os.getenv("FAST_MODE", "1") == "1"         # default ON: 'today 1-m' path
PROXY_API_KEY     = os.getenv("PROXY_API_KEY", "").strip()     # Webshare API key (Authorization)
PROXIES_ENV       = os.getenv("PROXIES", "").strip()           # fallback: comma-separated
PROXY_ENV         = os.getenv("PROXY", "").strip()             # fallback: single
PROXY_STICKY      = os.getenv("PROXY_STICKY", "1") == "1"      # keep one exit for entire run

# Optional tuning knobs for pytrends/requests (timeouts only)
TRENDS_CONNECT_TIMEOUT = float(os.getenv("TRENDS_CONNECT_TIMEOUT", "6.0"))
TRENDS_READ_TIMEOUT    = float(os.getenv("TRENDS_READ_TIMEOUT",    "18.0"))

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ========= DB =========
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

# ========= Webshare proxies =========
def _ua_for(i: int) -> str:
    return _UA_POOL[i % len(_UA_POOL)]

def _proxy_ok(p: str) -> bool:
    """Quick probe to avoid obviously slow/bad exits."""
    try:
        r = requests.get(
            "https://trends.google.com/",
            proxies={"http": p, "https": p},
            headers={"User-Agent": _ua_for(0), "Accept-Language": "en-US,en;q=0.9"},
            timeout=(3.0, 4.0),
        )
        return r.status_code == 200
    except Exception:
        return False

def fetch_webshare_proxies() -> List[str]:
    """
    Returns a list of proxy URLs like:
      ["http://user:pass@ip:port", ...]
    Reads from Webshare API using PROXY_API_KEY.
    Falls back to PROXIES/PROXY envs if unavailable.
    Pre-filters with a tiny health-check to keep only responsive proxies.
    """
    proxies_raw: List[str] = []

    if PROXY_API_KEY:
        try:
            url = "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=25"
            headers = {"Authorization": PROXY_API_KEY}
            r = requests.get(url, headers=headers, timeout=(5.0, 8.0))
            r.raise_for_status()
            data = r.json()
            for it in data.get("results", []):
                if not it.get("valid"):
                    continue
                u = it.get("username"); p = it.get("password")
                host = it.get("proxy_address"); port = it.get("port")
                if u and p and host and port:
                    proxies_raw.append(f"http://{u}:{p}@{host}:{port}")
        except Exception as e:
            logger.warning(f"Webshare proxy fetch failed: {e}; falling back to env.")

    if not proxies_raw:
        if PROXIES_ENV:
            proxies_raw = [s.strip() for s in PROXIES_ENV.split(",") if s.strip()]
        elif PROXY_ENV:
            proxies_raw = [PROXY_ENV]

    if not proxies_raw:
        logger.warning("No proxies available (API + env empty). Continuing without proxies.")
        return []

    # health-check the first dozen only (cheap)
    sample = proxies_raw[:12]
    filtered = [p for p in sample if _proxy_ok(p)]
    if filtered:
        random.shuffle(filtered)
        logger.info(f"Webshare proxies fetched: {len(proxies_raw)} (usable: {len(filtered)})")
        if PROXY_STICKY:
            # Use a single exit for the entire invocation to avoid fingerprint churn.
            return [filtered[0]]
        return filtered

    logger.warning("No responsive proxies from the initial set; proceeding without proxies.")
    return []

# ========= UA pool =========
_UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
]

# ========= Pytrends client (build per attempt/proxy) =========
def _build_pytrends(proxy_url: Optional[str], ua: str):
    from pytrends.request import TrendReq

    # NOTE: do NOT pass retries/backoff; pytrends may use deprecated urllib3 args
    requests_args = {
        "headers": {
            "User-Agent": ua,
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://trends.google.com/",
        }
    }
    kwargs = dict(
        hl="en-US",
        tz=480,
        timeout=(TRENDS_CONNECT_TIMEOUT, TRENDS_READ_TIMEOUT),
        requests_args=requests_args,
    )
    if proxy_url:
        kwargs["proxies"] = [proxy_url]

    tr = TrendReq(**kwargs)

    # Optional warmup — do not fail invocation if it flaps
    try:
        tr.build_payload(["test"], cat=0, timeframe="now 7-d", geo=GEO, gprop="")
    except Exception:
        pass
    return tr

# Light client cache: reuse client (and its cookies) during this process
_client_cache = {"client": None, "proxy": None, "ua": None}

def _pytrends_attempt(attempt: int, proxies: List[str]):
    """
    Return (pytrends_client, proxy_used).
    With PROXY_STICKY: keep same proxy & UA for the whole run to reduce churn.
    """
    if attempt == 0 and _client_cache["client"] is not None:
        return _client_cache["client"], _client_cache["proxy"]

    proxy = (proxies[0] if proxies else None) if PROXY_STICKY else (proxies[attempt % len(proxies)] if proxies else None)
    ua = _client_cache["ua"] or _ua_for(0) if PROXY_STICKY else _ua_for(attempt)

    client = _build_pytrends(proxy, ua)

    if attempt == 0 and _client_cache["client"] is None:
        _client_cache.update({"client": client, "proxy": proxy, "ua": ua})

    return client, proxy

# ========= Keywords/groups =========
def slugify_group(name: str) -> str:
    s = (name or "").lower().strip()
    return "".join(ch if ch.isalnum() else "_" for ch in s)[:64].strip("_")

def load_active_keywords(conn, kw_table: str, geo: str, category: int) -> Dict[str, List[str]]:
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

# ========= Window helpers =========
def make_windows(end: date, days_back: int, span_days: int = 90, step_days: int = 60) -> List[Tuple[date, date]]:
    start_total = end - timedelta(days=days_back)
    windows = []
    cur_start = start_total
    while cur_start < end:
        w_end = min(cur_start + timedelta(days=span_days - 1), end)
        windows.append((cur_start, w_end))
        if w_end >= end:
            break
        cur_start = cur_start + timedelta(days=step_days)
    return windows

def _sleep_with_jitter(base: float, factor: float, attempt: int):
    t = base * (factor ** attempt)
    jitter = random.uniform(0.25, 0.75)
    time.sleep(t * jitter)

# ========= Fetchers =========
def fetch_fast(terms, geo: str, months=1, cat: int = 0,
               ctx_remaining_ms=None, max_attempts: int = 3,
               proxies: Optional[List[str]] = None) -> pd.DataFrame:
    """'today N-m' path with bounded retries, time budget, and (optionally sticky) proxy."""
    import pytrends.exceptions as pte
    timeframe = f"today {months}-m"
    base = 2.5
    proxies = proxies or []

    for attempt in range(max_attempts):
        if ctx_remaining_ms and ctx_remaining_ms() < 7000:
            logging.warning("fast fetch: low time budget; aborting")
            return pd.DataFrame()

        pytrends, p_used = _pytrends_attempt(attempt, proxies)
        try:
            pytrends.build_payload(terms, cat=cat, timeframe=timeframe, geo=geo, gprop="")
            df = pytrends.interest_over_time()
            if df is None or df.empty:
                return pd.DataFrame()
            df = df.drop(columns=[c for c in df.columns if c == "isPartial"], errors="ignore")
            df.index = pd.to_datetime(df.index.date)
            if p_used:
                logging.info(f"fast fetch success via proxy {p_used}")
            return df

        except pte.TooManyRequestsError:
            # 429 — back off, then retry
            sleep_s = base * (1.9 ** attempt) * (0.6 + random.random() * 0.8)
            if ctx_remaining_ms:
                sleep_s = min(sleep_s, max(0.0, (ctx_remaining_ms() - 5000) / 1000.0))
            logging.warning(f"429 on fast fetch (attempt {attempt+1}/{max_attempts}) via {p_used}; sleeping {sleep_s:.1f}s")
            if sleep_s <= 0:
                break
            time.sleep(sleep_s)

        except Exception as e:
            # If it's a read-timeout, rotate immediately without sleeping (when not sticky)
            if isinstance(e, req_exc.ReadTimeout) and not PROXY_STICKY:
                logging.warning(f"fast fetch read timeout via {p_used}; rotating proxy immediately")
                continue
            # Otherwise do a light increasing sleep (bounded by remaining time)
            sleep_s = 1.5 * (attempt + 1)
            if ctx_remaining_ms:
                sleep_s = min(sleep_s, max(0.0, (ctx_remaining_ms() - 5000) / 1000.0))
            logging.warning(f"fast fetch transient error via {p_used}: {e}; sleeping {sleep_s:.1f}s")
            if sleep_s <= 0:
                break
            time.sleep(sleep_s)

    # === Fallback A: one direct (no proxy) try on fast path ===
    try:
        client = _build_pytrends(None, _client_cache.get("ua") or _ua_for(0))
        client.build_payload(terms, cat=cat, timeframe=timeframe, geo=geo, gprop="")
        df = client.interest_over_time()
        if df is not None and not df.empty:
            df = df.drop(columns=[c for c in df.columns if c == "isPartial"], errors="ignore")
            df.index = pd.to_datetime(df.index.date)
            logging.info("fast fetch fallback success without proxy")
            return df
    except Exception as e:
        logging.warning(f"fast direct fallback failed: {e}")

    return pd.DataFrame()

def fetch_window_with_retry(terms: List[str], geo: str, cat: int, start: date, end: date,
                            base_sleep: float, max_attempts: int,
                            ctx_remaining_ms: Optional[Callable[[], int]],
                            proxies: Optional[List[str]] = None) -> pd.DataFrame:
    """Stitched window fetch with proxy+UA rotation per attempt (still sticky by default)."""
    proxies = proxies or []

    def _fetch(pytrends):
        timeframe = f"{start.isoformat()} {end.isoformat()}"
        pytrends.build_payload(kw_list=terms, cat=cat, timeframe=timeframe, geo=geo, gprop="")
        df = pytrends.interest_over_time()
        if df is None or df.empty:
            return pd.DataFrame(index=pd.DatetimeIndex([], name="date"))
        cols = [c for c in df.columns if c != "isPartial"]
        return df[cols]

    for attempt in range(max_attempts):
        if ctx_remaining_ms is not None and ctx_remaining_ms() < 5000:
            logger.warning("Low time budget; aborting window fetch")
            return pd.DataFrame(index=pd.DatetimeIndex([], name="date"))
        pytrends, p_used = _pytrends_attempt(attempt, proxies)
        try:
            return _fetch(pytrends)
        except Exception as e:
            logger.warning(f"window fetch error via {p_used}: {e} (attempt {attempt+1}/{max_attempts})")
            _sleep_with_jitter(base_sleep, 1.8, attempt)
    return pd.DataFrame(index=pd.DatetimeIndex([], name="date"))

def overlap_scale_factor(ref: pd.Series, cur: pd.Series) -> float:
    idx = ref.index.intersection(cur.index)
    if len(idx) < 3:
        return 1.0
    a = ref.reindex(idx).astype(float)
    b = cur.reindex(idx).astype(float)
    mask = (a > 0) & (b > 0)
    if mask.sum() < 3:
        eps = 1e-6
        ratios = (a + eps) / (b + eps)
        r = float(ratios.replace([np.inf, -np.inf], np.nan).dropna().median())
        return r if np.isfinite(r) and r > 0 else 1.0
    ratios = (a[mask] / b[mask]).replace([np.inf, -np.inf], np.nan).dropna()
    if len(ratios) == 0:
        return 1.0
    r = float(np.median(ratios))
    return r if np.isfinite(r) and r > 0 else 1.0

def stitch_daily(terms: List[str], geo: str, cat: int, end_day: date, days_back: int,
                 ctx_remaining_ms: Optional[Callable[[], int]] = None,
                 proxies: Optional[List[str]] = None) -> pd.DataFrame:
    """Stitch windows across time; rotate proxy per attempt per window (sticky default)."""
    proxies = proxies or []
    if days_back <= 30:
        span_days, step_days = 30, 30
    elif days_back <= 60:
        span_days, step_days = 60, 60
    else:
        span_days, step_days = 90, 60

    windows = make_windows(end=end_day, days_back=days_back, span_days=span_days, step_days=step_days)

    merged: Optional[pd.DataFrame] = None
    anchor = terms[0] if terms else None

    for i, (ws, we) in enumerate(windows, 1):
        df = fetch_window_with_retry(
            terms, geo, cat, ws, we,
            base_sleep=SLEEP_BETWEEN, max_attempts=7,
            ctx_remaining_ms=ctx_remaining_ms,
            proxies=proxies,
        )
        if df is None or df.empty:
            logger.warning(f"window {i}/{len(windows)} empty after retries; continuing")
            continue

        df = df.copy()
        df.index = pd.to_datetime(df.index.date)

        if merged is None:
            merged = df
        else:
            anchor_col = anchor if (anchor in df.columns and anchor in merged.columns) else None
            if anchor_col is None:
                for c in terms:
                    if c in df.columns and c in merged.columns:
                        anchor_col = c; break
            scale = overlap_scale_factor(merged[anchor_col], df[anchor_col]) if anchor_col else 1.0
            merged = pd.concat([merged, (df * scale).astype(float)]).groupby(level=0).mean()

        time.sleep(SLEEP_BETWEEN)

    if merged is None or merged.empty:
        return pd.DataFrame()

    return (
        merged.clip(0.0, 100.0)
        .sort_index()
        .asfreq("D")
        .interpolate(limit_direction="both")
        .clip(0.0, 100.0)
    )

# ========= Cross-batch (>5 terms) =========
def fetch_all_terms_batched_with_anchor(all_terms: List[str], anchor: str,
                                        geo: str, cat: int, end_day: date, days_back: int,
                                        per_req_limit: int,
                                        ctx_remaining_ms: Optional[Callable[[], int]] = None,
                                        proxies: Optional[List[str]] = None) -> pd.DataFrame:
    proxies = proxies or []
    if anchor not in all_terms:
        all_terms = [anchor] + all_terms
    others = [t for t in all_terms if t != anchor]

    internal_chunk = 1  # anchor + 1 — gentlest on 429s
    chunks = [others[i:i + internal_chunk] for i in range(0, len(others), internal_chunk)] or [[]]

    base_df: Optional[pd.DataFrame] = None
    for idx, ch in enumerate(chunks, 1):
        terms = [anchor] + ch
        if FAST_MODE:
            df = fetch_fast(terms, geo, months=1, cat=cat,
                            ctx_remaining_ms=ctx_remaining_ms, max_attempts=4,
                            proxies=proxies)
            if df is None or df.empty:
                logging.info("fast path empty in batch → trying stitched windows")
                df = stitch_daily(terms, geo, cat, end_day, days_back,
                                  ctx_remaining_ms=ctx_remaining_ms, proxies=proxies)
        else:
            df = stitch_daily(terms, geo, cat, end_day, days_back,
                              ctx_remaining_ms=ctx_remaining_ms, proxies=proxies)

        if df is None or df.empty:
            logger.info(f"batch {idx}/{len(chunks)} empty; continuing")
            time.sleep(SLEEP_BETWEEN)
            continue

        df = df.copy(); df.index = pd.to_datetime(df.index)
        if base_df is None:
            base_df = df
            logger.info(f"batch {idx}/{len(chunks)} set as base; cols={list(df.columns)}")
        else:
            scale = 1.0
            if (anchor in base_df.columns) and (anchor in df.columns):
                scale = overlap_scale_factor(base_df[anchor], df[anchor])
            base_df = pd.concat([base_df, (df * scale).astype(float)]).groupby(level=0).mean()
            logger.info(f"batch {idx}/{len(chunks)} merged; scale={scale:.4f}")

        time.sleep(SLEEP_BETWEEN)

    return pd.DataFrame() if base_df is None else base_df.sort_index()

# ========= Aggregation / Upsert =========
def groups_from_terms_df(df_terms: pd.DataFrame, groups: Dict[str, List[str]]) -> pd.DataFrame:
    out = {}
    for gslug, alts in groups.items():
        cols = [c for c in alts if c in df_terms.columns]
        if cols:
            out[gslug] = df_terms[cols].max(axis=1)
    gdf = pd.DataFrame(out); gdf.index.name = "day"
    return gdf

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
                if pd.isna(val):  # masked cells
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
    gdf = gdf.dropna(how="all", axis=1)
    gdf = gdf.dropna(how="all", axis=0)
    return gdf

# ========= Lambda handler =========
def lambda_handler(event, ctx):
    end_day = date.today()

    # (A) Get proxies (Webshare → env fallback) with pre-filter (sticky by default)
    proxies = fetch_webshare_proxies()

    # (B) Keywords/groups
    conn_meta = _connect()
    try:
        groups_dict = load_active_keywords(conn_meta, KW_TABLE, GEO, CATEGORY)
    finally:
        try: conn_meta.close()
        except: pass

    if not groups_dict:
        return {"statusCode": 400, "body": json.dumps({"error": "no_active_keywords"})}

    # dedupe terms (first = anchor)
    all_terms: List[str] = []
    seen = set()
    for alts in groups_dict.values():
        for t in alts:
            tl = t.lower()
            if tl not in seen:
                all_terms.append(t); seen.add(tl)

    slugs = list(groups_dict.keys())

    # (C) Incremental planning
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
            start_slug = max(end_day - timedelta(days=DAYS_BACK), ld - timedelta(days=INCR_OVERLAP_DAYS))
        else:
            start_slug = end_day - timedelta(days=DAYS_BACK)
        starts_needed.append(start_slug)

    start_overall = min(starts_needed) if starts_needed else (end_day - timedelta(days=DAYS_BACK))
    computed_days_back = max(1, (end_day - start_overall).days)
    effective_days_back = min(DAYS_BACK, computed_days_back)  # cap so overlap can’t widen it

    # (D) Remaining-time function
    ctx_remaining_ms = (lambda: ctx.get_remaining_time_in_millis()) if ctx else None

    # (E) Fetch strategy: fast → (if empty) stitched
    if len(all_terms) <= MAX_KEYS_PER:
        if FAST_MODE:
            df_terms = fetch_fast(all_terms, GEO, months=1, cat=CATEGORY,
                                  ctx_remaining_ms=ctx_remaining_ms, max_attempts=4,
                                  proxies=proxies)
            if df_terms is None or df_terms.empty:
                logging.info("fast path empty → trying stitched windows")
                df_terms = stitch_daily(all_terms, GEO, CATEGORY, end_day, effective_days_back,
                                        ctx_remaining_ms=ctx_remaining_ms, proxies=proxies)
        else:
            df_terms = stitch_daily(all_terms, GEO, CATEGORY, end_day, effective_days_back,
                                    ctx_remaining_ms=ctx_remaining_ms, proxies=proxies)
    else:
        anchor_term = all_terms[0]
        df_terms = fetch_all_terms_batched_with_anchor(
            all_terms=all_terms,
            anchor=anchor_term,
            geo=GEO,
            cat=CATEGORY,
            end_day=end_day,
            days_back=effective_days_back,
            per_req_limit=MAX_KEYS_PER,
            ctx_remaining_ms=ctx_remaining_ms,
            proxies=proxies,
        )

    # Handle rate limit gracefully
    if df_terms is None or df_terms.empty:
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "geo": GEO,
                "rows_upserted": 0,
                "note": "rate_limited_or_no_data",
                "effective_days_back": effective_days_back,
                "proxies_used": len(proxies)
            })
        }

    # (F) Aggregate by group (max across synonyms)
    gdf = groups_from_terms_df(df_terms, groups_dict)

    # (G) Write only new rows per slug
    gdf_to_write = filter_new_rows_per_slug(gdf, last_days)
    if gdf_to_write.empty:
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "geo": GEO, "rows_upserted": 0, "cols": list(gdf.columns),
                "start": str(gdf.index.min()), "end": str(gdf.index.max()),
                "table": TABLE_NAME, "mode": "incremental", "note": "no_new_rows",
                "effective_days_back": effective_days_back,
                "proxies_used": len(proxies)
            })
        }

    # (H) Upsert
    conn = _connect()
    try:
        n = upsert_rows(conn, TABLE_NAME, GEO, gdf_to_write)
    finally:
        try: conn.close()
        except: pass

    new_slugs = sorted([s for s in slugs if s not in last_days])
    existed_slugs = sorted([s for s in slugs if s in last_days])

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
            "effective_days_back": effective_days_back,
            "proxies_used": len(proxies)
        })
    }
