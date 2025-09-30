# enqueue_handler.py  (Handler: enqueue_handler.lambda_handler)
import os, json, logging, boto3, base64, time
from datetime import datetime, timezone
from botocore.config import Config as BotoConfig

# NEW: import pymysql for scheduled DB reads
import pymysql

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger(__name__)

AWS_REGION = os.getenv("REGION", os.getenv("AWS_REGION"))
QUEUE_URL  = os.getenv("QUEUE_URL")  # e.g. https://sqs.us-east-1.amazonaws.com/123/queue-name
DB_SECRET_ARN = os.getenv("DB_SECRET_ARN")  # NEW: RDS creds

_cfg = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
_sqs = boto3.client("sqs", region_name=AWS_REGION, config=_cfg)
_sm  = boto3.client("secretsmanager", region_name=AWS_REGION, config=_cfg)

CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "OPTIONS,POST",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json"
}

def _resp(code, body):
    return {"statusCode": code, "headers": CORS, "body": json.dumps(body)}

def _is_eventbridge_schedule(evt: dict) -> bool:
    # Typical EB schedule event has source='aws.events' and detail-type='Scheduled Event'
    return (
        isinstance(evt, dict)
        and (evt.get("source") == "aws.events" or evt.get("detail-type") == "Scheduled Event")
    )

def _decode_body(event):
    body = event.get("body")
    if isinstance(body, str) and event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body).decode("utf-8")
        except Exception:
            pass
    if isinstance(body, str):
        try:
            return json.loads(body)
        except Exception:
            return {}
    return body or {}

# ---------- SQS helpers ----------
def _is_fifo_queue(queue_url: str) -> bool:
    return queue_url.lower().endswith(".fifo")

def _chunk(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i+n]

def _enqueue_urls(urls: list[str]) -> int:
    if not urls:
        return 0

    fifo = _is_fifo_queue(QUEUE_URL)
    accepted = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for group in _chunk(urls, 10):  # SQS batch limit 10
        entries = []
        for idx, u in enumerate(group):
            body = {"url": u, "type": "scrape.pdp", "source": "api", "ts": now_iso}
            entry = {"Id": str(idx), "MessageBody": json.dumps(body)}
            if fifo:
                entry["MessageGroupId"] = "schedule"  # single group for periodic runs
                entry["MessageDeduplicationId"] = f"{hash(u)}-{int(time.time())//3600}"
            entries.append(entry)

        resp = _sqs.send_message_batch(QueueUrl=QUEUE_URL, Entries=entries)
        failed_ids = {f["Id"] for f in resp.get("Failed", [])}
        accepted += sum(1 for e in entries if e["Id"] not in failed_ids)

        if failed_ids:
            log.warning("SQS batch failures: %s", resp.get("Failed"))

    return accepted

# ---------- DB helpers (for scheduled path) ----------
def _get_db_creds():
    if not DB_SECRET_ARN:
        raise RuntimeError("DB_SECRET_ARN is not set")
    sec = _sm.get_secret_value(SecretId=DB_SECRET_ARN)
    data = json.loads(sec.get("SecretString") or "{}")
    return {
        "host": data.get("host") or data.get("hostname"),
        "port": int(data.get("port", 3306)),
        "user": data.get("username"),
        "password": data.get("password"),
        "database": data.get("dbname") or data.get("database") or "spirulinadb",
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.Cursor,
        "connect_timeout": 8,
        "read_timeout": 8,
        "write_timeout": 8,
    }

def _fetch_distinct_urls(conn) -> list[str]:
    sql = """
      SELECT DISTINCT TRIM(url) AS url
      FROM watchlist
      WHERE url IS NOT NULL AND TRIM(url) <> ''
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return [r[0] for r in rows if r and isinstance(r[0], str)]

# ---------- Handler ----------
def lambda_handler(event, _ctx):
    # Handle CORS preflight (API Gateway HTTP API v2)
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "POST")
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS, "body": ""}

    if not QUEUE_URL:
        return _resp(500, {"error": "config", "detail": "QUEUE_URL is not set"})

    # Path A: Scheduled by EventBridge -> read DISTINCT URLs from DB and enqueue
    if _is_eventbridge_schedule(event):
        try:
            creds = _get_db_creds()
            conn = pymysql.connect(**creds)
            try:
                urls = _fetch_distinct_urls(conn)
            finally:
                try: conn.close()
                except Exception: pass

            # Basic clean/dedup like your API path
            seen = set()
            clean = []
            for u in urls:
                k = u.strip().lower().rstrip("/")
                if k and k not in seen:
                    seen.add(k); clean.append(u.strip())

            if not clean:
                return _resp(200, {"accepted": 0, "total_urls": 0})

            accepted = _enqueue_urls(clean)
            return _resp(200, {"accepted": accepted, "total_urls": len(clean), "mode": "scheduled"})
        except Exception as e:
            log.exception("Scheduled enqueue failed")
            return _resp(500, {"error": "scheduled_failed", "detail": str(e)})

    # Path B: Regular API call -> read body and enqueue
    data = _decode_body(event)

    # Accept {"urls":[...]} or {"url":"..."}
    urls = data.get("urls")
    if not urls:
        single = data.get("url")
        urls = [single] if single else []

    # Clean + de-dup within this request
    clean = []
    seen = set()
    for u in urls:
        if not isinstance(u, str): 
            continue
        u2 = u.strip()
        if not u2: 
            continue
        k = u2.lower().rstrip("/")
        if k not in seen:
            seen.add(k); clean.append(u2)

    if not clean:
        return _resp(400, {"error": "bad_request", "detail": "Provide 'urls': [\"https://...\"] or 'url'."})

    accepted = _enqueue_urls(clean)
    return _resp(202, {"accepted": accepted, "mode": "api"})
