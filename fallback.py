# worker_handler.py  (Handler: worker_handler.lambda_handler)  -- SQS trigger
import json, os, logging, time
import pymysql, requests, boto3
from urllib3.util.retry import Retry
from requests.adapters import HTTPAdapter
from botocore.config import Config as BotoConfig
from urllib.parse import urlparse

# -------------------- Logging setup --------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.getLogger().setLevel(LOG_LEVEL)
log = logging.getLogger(__name__)
LOG_SNIP = int(os.getenv("LOG_BODY_MAX", "3000"))  # cap large bodies

AWS_REGION = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
DB_SECRET_ARN = os.getenv("DB_SECRET_ARN")
SCRAPER_SECRET_ARN = os.getenv("SCRAPER_SECRET_ARN")

# Pub/Sub (optional, but we use it for job_failed + row_upserted)
WS_ENDPOINT = os.getenv("WS_ENDPOINT")     # https://...execute-api.../prod
CONN_TABLE  = os.getenv("CONN_TABLE")      # e.g., "pubsub"

_boto_cfg = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
_sm = boto3.client("secretsmanager", region_name=AWS_REGION, config=_boto_cfg)
_ddb = boto3.client("dynamodb", region_name=AWS_REGION)
_api = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT) if WS_ENDPOINT else None

_secret_cache = {}


# -------------------- Secret helpers --------------------
def _get_secret(secret_id: str):
    if not secret_id:
        return None
    if secret_id in _secret_cache:
        return _secret_cache[secret_id]
    r = _sm.get_secret_value(SecretId=secret_id)
    raw = r.get("SecretString") or r.get("SecretBinary")
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="ignore")
    try:
        val = json.loads(raw)
    except Exception:
        val = raw
    _secret_cache[secret_id] = val
    return val


def _load_db_cfg():
    s = _get_secret(DB_SECRET_ARN) or {}
    return {
        "host": s.get("host") or os.getenv("DB_HOST"),
        "port": int((s.get("port") or os.getenv("DB_PORT") or 3306)),
        "user": s.get("username") or os.getenv("DB_USER"),
        "password": s.get("password") or os.getenv("DB_PASS"),
        "database": s.get("database") or os.getenv("DB_NAME"),
    }


def _load_scraper_api_key():
    s = _get_secret(SCRAPER_SECRET_ARN)
    if isinstance(s, dict):
        # try common keys
        return s.get("Scrapper-API") or s.get("ScraperAPI") or s.get("api_key")
    return str(s).strip() if s else None


# -------------------- HTTP client --------------------
def _http():
    sess = requests.Session()
    retry = Retry(
        total=2,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"])
    )
    sess.mount("https://", HTTPAdapter(max_retries=retry))
    return sess


# -------------------- ScrapingBee with rich logging --------------------
def _scrape(url: str, api_key: str):
    rules = {
        "summary": (
            "extract product name as 'product', current price as 'price' (number), "
            "main product image url as 'image_url', and availability "
            "(true if Add to Cart is enabled, false otherwise) as 'availability'"
        )
    }
    params = {
        "api_key": api_key,
        "url": url,
        "country_code": "sg",
        "stealth_proxy": "true",
        "wait": "1000",
        "block_resources": "true",
        "render_js": "false",
        "ai_extract_rules": json.dumps(rules),
    }

    # Log request (redact key)
    log.info("ScrapingBee request: url=%s country_code=%s stealth=%s render_js=%s",
             params["url"], params["country_code"], params["stealth_proxy"], params["render_js"])

    sess = _http()
    try:
        r = sess.get("https://app.scrapingbee.com/api/v1", params=params, timeout=(5, 120))
        # Log status + selected headers
        log.info("ScrapingBee response: status=%s headers=%s",
                 r.status_code, {k: v for k, v in r.headers.items() if k.lower() in (
                     "content-type", "x-remaining-credits", "x-scrapingbee-request-id",
                     "x-request-id", "date"
                 )})

        body_for_log = r.text[:LOG_SNIP] if r.text else ""
        if r.status_code >= 400:
            log.error("ScrapingBee error status=%s body=%s", r.status_code, body_for_log)
            r.raise_for_status()

        # Try parse JSON, fall back to text
        try:
            data = r.json()
            log.debug("ScrapingBee JSON: %s", json.dumps(data, ensure_ascii=False)[:LOG_SNIP])
        except Exception as je:
            log.warning("Failed to parse JSON from ScrapingBee: %s; body(snipped)=%s", je, body_for_log)
            raise

        # Some variants return {"summary":[{...}]}, others directly dicts
        item = None
        if isinstance(data, dict):
            summary = data.get("summary")
            if isinstance(summary, list) and summary:
                item = summary[0]
            elif isinstance(summary, dict):
                item = summary
            else:
                # try top-level
                item = data
        elif isinstance(data, list) and data:
            item = data[0]

        if not isinstance(item, dict):
            log.error("Unexpected ScrapingBee payload shape: %s", type(item).__name__)
            item = {}

        # Log the extracted fields for visibility
        log.info("Extracted (pre-normalize): %s",
                 {k: item.get(k) for k in ("product", "product_name", "price", "image_url", "availability")})

        # Normalize fields
        price_raw = item.get("price")
        try:
            price = float(str(price_raw).replace(",", "")) if price_raw is not None else None
        except Exception:
            price = None

        stock = "In Stock" if item.get("availability") else "Out of Stock"
        product_name = item.get("product") or item.get("product_name")
        image_url = item.get("image_url")

        # Return normalized snapshot + raw for debugging
        snap = {
            "product": product_name,
            "price": price,
            "stock_status": stock,
            "image_url": image_url,
            "_raw": item  # keep raw in memory (not stored), for logs if needed
        }
        log.info("Normalized snapshot: %s", {k: snap[k] for k in ("product", "price", "stock_status", "image_url")})
        return snap

    except requests.RequestException as re:
        log.exception("ScrapingBee request failed for %s", url)
        raise


# -------------------- DB helpers --------------------
def _fallback_product_from_url(url: str) -> str:
    """Generate a non-empty placeholder to avoid 1048."""
    p = urlparse(url)
    tail = (p.path.rsplit("/", 1)[-1] or p.netloc).replace("-", " ").strip() or p.netloc
    return (tail[:200] or "(unknown product)") or "(unknown product)"


def _insert_snapshot(conn, url: str, snap: dict):
    # Coalesce product to avoid IntegrityError 1048
    product = (snap.get("product") or "").strip()
    if not product:
        product = _fallback_product_from_url(url)
        log.warning("Missing product from scraper; using fallback='%s' for url=%s", product, url)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO watchlist (url, product, price, stock_status, image_url, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE
              product=VALUES(product),
              price=VALUES(price),
              stock_status=VALUES(stock_status),
              image_url=VALUES(image_url),
              updated_at=NOW()
            """,
            (url, product, snap.get("price"), snap.get("stock_status"), snap.get("image_url")),
        )


# -------------------- WebSocket push helpers --------------------
def _post_to(cid: str, payload_bytes: bytes):
    try:
        _api.post_to_connection(ConnectionId=cid, Data=payload_bytes)
        return True
    except _api.exceptions.GoneException:
        # client disconnected; signal caller to delete from table
        return False
    except Exception:
        log.exception("post_to_connection failed for %s", cid)
        return False


def _delete_conn(pk: str, sk: str):
    try:
        _ddb.delete_item(TableName=CONN_TABLE, Key={"pk": {"S": pk}, "sk": {"S": sk}})
    except Exception:
        log.exception("Failed to delete stale connection %s/%s", pk, sk)


def _fanout_items(user_id: str | None):
    if not CONN_TABLE:
        return []
    if user_id:
        resp = _ddb.query(
            TableName=CONN_TABLE,
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": {"S": f"user#{user_id}"}},
            ProjectionExpression="pk, sk, connectionId"
        )
        return resp.get("Items", [])
    resp = _ddb.scan(TableName=CONN_TABLE, ProjectionExpression="pk, sk, connectionId")
    return resp.get("Items", [])


def _push_row_upserted(user_id: str | None, row: dict):
    if not (_api and CONN_TABLE):
        return
    payload = json.dumps({"type": "watchlist.row_upserted", "row": row}).encode("utf-8")
    items = _fanout_items(user_id)
    log.debug("WS push row_upserted to %d connections", len(items))
    for it in items:
        cid = it.get("connectionId", {}).get("S")
        pk  = it.get("pk", {}).get("S")
        sk  = it.get("sk", {}).get("S")
        if not cid:
            continue
        ok = _post_to(cid, payload)
        if not ok and pk and sk:
            _delete_conn(pk, sk)


def _push_job_failed(user_id: str | None, url: str, reason: str):
    if not (_api and CONN_TABLE):
        return
    payload = json.dumps({
        "type": "watchlist.job_failed",
        "url": url,
        "reason": reason[:500]
    }).encode("utf-8")
    items = _fanout_items(user_id)
    log.debug("WS push job_failed to %d connections: url=%s reason=%s", len(items), url, reason)
    for it in items:
        cid = it.get("connectionId", {}).get("S")
        pk  = it.get("pk", {}).get("S")
        sk  = it.get("sk", {}).get("S")
        if not cid:
            continue
        ok = _post_to(cid, payload)
        if not ok and pk and sk:
            _delete_conn(pk, sk)


# -------------------- Lambda handler --------------------
def lambda_handler(event, _ctx):
    db = _load_db_cfg()
    api_key = _load_scraper_api_key()

    missing = [k for k, v in [
        ("db.host", db.get("host")),
        ("db.user", db.get("user")),
        ("db.password", db.get("password")),
        ("db.database", db.get("database")),
        ("scraper.api_key", api_key),
    ] if not v]
    if missing:
        log.error("Missing config: %s", ", ".join(missing))
        raise RuntimeError("Missing required config: " + ", ".join(missing))

    # Show DB host and user (not password)
    log.info("DB target: host=%s port=%s user=%s db=%s",
             db["host"], db["port"], db["user"], db["database"])
    log.info("WS configured: %s (table=%s)", bool(_api), CONN_TABLE or "-")

    conn = pymysql.connect(
        host=db["host"], port=db["port"], user=db["user"], password=db["password"],
        database=db["database"], connect_timeout=5, read_timeout=10, write_timeout=10,
        autocommit=True,
    )

    failures = []
    for rec in event.get("Records", []):
        rec_id = rec.get("messageId")
        try:
            body = rec.get("body") or "{}"
            payload = json.loads(body)
            url = payload.get("url")
            user_id = payload.get("user_id")  # may be None if enqueue didn't include it

            if not url or not isinstance(url, str):
                raise ValueError("Record has no 'url'")

            log.info("SQS record: id=%s url=%s user=%s", rec_id, url, user_id or "-")
            # quick outbound probe (best-effort)
            try:
                requests.get("https://httpbin.org/ip", timeout=(3, 5))
            except Exception:
                pass

            # SCRAPE (with detailed logs inside)
            snap = _scrape(url, api_key)

            # INSERT (with product fallback)
            _insert_snapshot(conn, url, snap)

            # Build the row sent to UI
            row = {
                "url": url,
                "product": snap.get("product"),
                "price": snap.get("price"),
                "stock_status": snap.get("stock_status"),
                "image_url": snap.get("image_url"),
                "updated_at": int(time.time())
            }

            # Push to WebSocket
            _push_row_upserted(user_id, row)

            log.info("Scrape done: %s • %s • %.2f",
                     url, row["stock_status"], (row["price"] or 0.0))

        except Exception as e:
            log.exception("Record failed: %s", rec_id)
            # Best-effort notify UI so 'adding...' doesn't hang forever
            try:
                bad_url = None
                try:
                    bad_url = json.loads(rec.get("body") or "{}").get("url")
                except Exception:
                    pass
                if bad_url:
                    _push_job_failed(
                        (json.loads(rec.get("body") or "{}").get("user_id")),
                        bad_url,
                        f"{type(e).__name__}: {e}"
                    )
            except Exception:
                log.warning("Unable to push job_failed for record %s", rec_id)

            failures.append({"itemIdentifier": rec_id})

    try:
        conn.close()
    except Exception:
        pass

    return {"batchItemFailures": failures}
