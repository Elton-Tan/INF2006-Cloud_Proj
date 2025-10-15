# handler.py (Python 3.12)
import os, json, logging
from datetime import datetime, timedelta, date
from typing import Dict, Any, List
import boto3, pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SECRET_ARN   = os.environ["DB_SECRET_ARN"]
TABLE_NAME   = os.getenv("TABLE_NAME", "google_trends_daily")
DEFAULT_GEO  = os.getenv("GEO", "SG")
MAX_SLUGS    = int(os.getenv("MAX_SLUGS", "20"))  # sanity cap for query fanout

# ---------- DB helpers ----------
def _load_db_cfg():
    sm = boto3.client("secretsmanager", region_name=os.getenv("AWS_REGION") or os.getenv("REGION"))
    sec = sm.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
    cfg = json.loads(sec)

    dbname = cfg.get("dbname") or cfg.get("db") or os.getenv("DB_NAME")
    if not dbname:
        raise RuntimeError("DB name not provided. Set DB_NAME env var or include 'dbname' in the secret.")

    return dict(
        host=cfg["host"],
        user=cfg["username"],
        password=cfg["password"],
        db=dbname,
        port=int(cfg.get("port", 3306)),
        connect_timeout=10,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )

def _connect():
    return pymysql.connect(**_load_db_cfg())

# ---------- Utils ----------
def _parse_date(s: str) -> date | None:
    if not s: return None
    return datetime.fromisoformat(s[:10]).date()

def _ok(body: Dict[str, Any], status=200):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body, default=str),
    }

def _bad(msg: str, status=400):
    return _ok({"error": msg}, status=status)

# ---------- Handlers ----------
def _catalog(conn, geo: str):
    """Return available slugs with counts and last day."""
    sql = f"""
      SELECT keyword_slug AS slug, COUNT(*) AS rows, MAX(day) AS last_day, MIN(day) AS first_day
      FROM `{TABLE_NAME}`
      WHERE geo=%s
      GROUP BY keyword_slug
      ORDER BY slug ASC;
    """
    with conn.cursor() as cur:
        cur.execute(sql, (geo,))
        rows = cur.fetchall()
    return _ok({"geo": geo, "slugs": rows})

def _series(conn, geo: str, slugs: List[str], start: date | None, end: date | None, last_days: int | None, granularity: str):
    if not slugs:
        return _bad("slugs required for series; omit slugs to get catalog")

    if len(slugs) > MAX_SLUGS:
        return _bad(f"too many slugs (>{MAX_SLUGS})")

    if last_days and (start or end):
        return _bad("use either last_days OR start/end, not both")

    if last_days:
        end = date.today()
        start = end - timedelta(days=last_days)

    # defaults if missing
    if not end:   end = date.today()
    if not start: start = end - timedelta(days=365)

    placeholders = ",".join(["%s"] * len(slugs))
    params: List[Any] = [geo, start, end, *slugs]

    if granularity == "day":
        sql = f"""
          SELECT day AS period, keyword_slug AS slug, interest
          FROM `{TABLE_NAME}`
          WHERE geo=%s AND day BETWEEN %s AND %s AND keyword_slug IN ({placeholders})
          ORDER BY day ASC, keyword_slug ASC;
        """
    elif granularity == "week":
        # ISO week, Monday-based: mode 3 in YEARWEEK; we also return period as the Monday date
        sql = f"""
          SELECT
            DATE_SUB(day, INTERVAL (WEEKDAY(day)) DAY) AS period,
            keyword_slug AS slug,
            ROUND(AVG(interest)) AS interest
          FROM `{TABLE_NAME}`
          WHERE geo=%s AND day BETWEEN %s AND %s AND keyword_slug IN ({placeholders})
          GROUP BY period, slug
          ORDER BY period ASC, slug ASC;
        """
    elif granularity == "month":
        sql = f"""
          SELECT
            DATE_FORMAT(day, '%%Y-%%m-01') AS period,
            keyword_slug AS slug,
            ROUND(AVG(interest)) AS interest
          FROM `{TABLE_NAME}`
          WHERE geo=%s AND day BETWEEN %s AND %s AND keyword_slug IN ({placeholders})
          GROUP BY period, slug
          ORDER BY period ASC, slug ASC;
        """
    else:
        return _bad("granularity must be one of: day, week, month")

    with conn.cursor() as cur:
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

    # Pivot to wide format: one row per period, columns per slug
    series: Dict[str, Dict[str, int]] = {}
    for r in rows:
        p = str(r["period"])
        s = r["slug"]
        v = int(r["interest"]) if r["interest"] is not None else None
        series.setdefault(p, {})[s] = v

    # Build output rows sorted by period
    periods = sorted(series.keys())
    data = []
    for p in periods:
        row = {"period": p}
        for s in slugs:
            row[s] = series[p].get(s)
        data.append(row)

    return _ok({
        "geo": geo,
        "granularity": granularity,
        "start": start,
        "end": end,
        "slugs": slugs,
        "rows": data
    })

def lambda_handler(event, _ctx):
    # HTTP API v2 request
    qs = (event.get("queryStringParameters") or {})
    mode  = (qs.get("mode") or "").lower()   # "catalog" or "series"
    geo   = qs.get("geo") or DEFAULT_GEO
    g     = (qs.get("g") or "day").lower()
    slugs = [s.strip() for s in (qs.get("slugs") or "").split(",") if s and s.strip()]

    start = _parse_date(qs.get("start") or "")
    end   = _parse_date(qs.get("end") or "")
    last_days = int(qs["last_days"]) if qs.get("last_days") else None

    try:
        conn = _connect()
        try:
            if not slugs or mode == "catalog":
                return _catalog(conn, geo)
            else:
                return _series(conn, geo, slugs, start, end, last_days, g)
        finally:
            try: conn.close()
            except: pass
    except Exception as e:
        logger.exception("error")
        return _bad(str(e), status=500)
