# worker_handler.py  (Handler: worker_handler.lambda_handler)  -- SQS trigger
import json, os, logging, time, re
import pymysql, requests, boto3
from urllib3.util.retry import Retry
from requests.adapters import HTTPAdapter
from botocore.config import Config as BotoConfig
from urllib.parse import urlparse, urljoin

# ---------- Optional: BeautifulSoup ----------
try:
    from bs4 import BeautifulSoup
except Exception:
    BeautifulSoup = None  # we will raise a clear error if it's missing

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

# =========================
# Secrets / Config helpers
# =========================
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

# =========================
# HTTP session
# =========================
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

# =========================
# Utils / Normalizers
# =========================
NUM_RE = re.compile(r"[\d.,]+")
TRACKING_SALE_RE = re.compile(r'"pdt_sale_price"\s*:\s*"([^"]+)"')
TRACKING_PRICE_RE = re.compile(r'"pdt_price"\s*:\s*"([^"]+)"')
TRACKING_LIST_RE  = re.compile(r'"pdt_list_price"\s*:\s*"([^"]+)"')

V2_SALE_RE   = re.compile(r'<span[^>]*class="[^"]*pdp-v2-product-price-content-salePrice-amount[^"]*"[^>]*>([^<]+)</span>', re.I)
V2_ORIG_RE   = re.compile(r'<span[^>]*class="[^"]*pdp-v2-product-price-content-originalPrice-amount[^"]*"[^>]*>([^<]+)</span>', re.I)

def _to_float(s: str):
    if not s:
        return None
    m = NUM_RE.search(str(s))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except Exception:
        return None

def _fallback_product_from_url(url: str) -> str:
    """Generate a non-empty placeholder to avoid 1048."""
    p = urlparse(url)
    tail = (p.path.rsplit("/", 1)[-1] or p.netloc).replace("-", " ").strip() or p.netloc
    return (tail[:200] or "(unknown product)") or "(unknown product)"

def _norm_url(u: str | None, base: str) -> str | None:
    """Normalize scheme-relative or relative URLs to absolute https URLs."""
    if not u:
        return None
    u = u.strip().strip('"').strip("'")
    if u.startswith("//"):
        return "https:" + u
    if re.match(r"^https?://", u, re.I):
        return u
    try:
        return urljoin(base, u)
    except Exception:
        return u

# =========================
# Site-specific parsers
# =========================
def _parse_lazada(body: str, url: str):
    """
    Returns normalized dict:
    { product, price(final), stock_status, image_url, _debug: {original_price, discount_pct} }
    """
    if not BeautifulSoup:
        raise RuntimeError("BeautifulSoup (bs4) is required. Add it to your layer or package.")
    soup = BeautifulSoup(body, "html.parser")

    # --- PRODUCT NAME ---
    product = None
    for s in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(s.get_text(strip=True) or "{}")
            blocks = data if isinstance(data, list) else [data]
            for d in blocks:
                if isinstance(d, dict) and d.get("name"):
                    product = str(d["name"]).strip()
                    if product:
                        break
            if product:
                break
        except Exception:
            pass
    if not product:
        for sel in ["#module_product_title h1",
                    ".pdp-mod-product-badge-title",
                    "meta[property='og:title']",
                    "title"]:
            el = soup.select_one(sel)
            if not el:
                continue
            product = (el.get("content") if el.name == "meta" else el.get_text()).strip()
            if product:
                break
    if not product:
        product = _fallback_product_from_url(url)

    # --- IMAGE URL ---
    image_url = None
    # JSON-LD image
    for s in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(s.get_text(strip=True) or "{}")
            blocks = data if isinstance(data, list) else [data]
            for d in blocks:
                img = d.get("image")
                if isinstance(img, list) and img:
                    image_url = str(img[0]).strip()
                    break
                if isinstance(img, str) and img:
                    image_url = img.strip()
                    break
            if image_url:
                break
        except Exception:
            pass
    if not image_url:
        m = soup.select_one('meta[property="og:image"], meta[name="og:image"]')
        if m and m.get("content"):
            image_url = m["content"].strip()

    image_url = _norm_url(image_url, url)

    # --- PRICES (final & list) ---
    sale_candidates = []
    list_candidates = []

    # tracking JSON (sometimes present)
    m = TRACKING_SALE_RE.search(body)
    if m:
        sale_candidates.append(_to_float(m.group(1)))

    m = TRACKING_LIST_RE.search(body)
    if m:
        list_candidates.append(_to_float(m.group(1)))

    m = TRACKING_PRICE_RE.search(body)  # pdt_price can be either
    if m:
        val = _to_float(m.group(1))
        if val:
            sale_candidates.append(val)

    # JSON-LD offers
    for s in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(s.get_text(strip=True) or "{}")
            blocks = data if isinstance(data, list) else [data]
            for d in blocks:
                offers = d.get("offers")
                offers = offers if isinstance(offers, list) else [offers] if isinstance(offers, dict) else []
                for o in offers:
                    sale_val = o.get("price") or (o.get("priceSpecification") or {}).get("price")
                    if sale_val:
                        sale_candidates.append(_to_float(str(sale_val)))
                    if o.get("@type") == "AggregateOffer":
                        if o.get("lowPrice"):
                            sale_candidates.append(_to_float(str(o["lowPrice"])))
                        if o.get("highPrice"):
                            list_candidates.append(_to_float(str(o["highPrice"])))
        except Exception:
            pass

    # DOM buy-box (v2 classes first, then legacy)
    for sel in [
        "span.pdp-v2-product-price-content-salePrice-amount",
        "[data-qa-locator='product-price']",
        "[data-qa-locator='price']",
        "[class*='pdp-price']",
        "meta[itemprop='price']",
    ]:
        el = soup.select_one(sel)
        if not el:
            continue
        raw = el.get("content") if el.name == "meta" else el.get_text()
        val = _to_float(raw)
        if val:
            sale_candidates.append(val)
            break

    # If not found via CSS, fall back to regex on raw HTML for v2 sale price
    if not sale_candidates:
        m = V2_SALE_RE.search(body)
        if m:
            val = _to_float(m.group(1))
            if val:
                sale_candidates.append(val)

    # Original/list (strikethrough etc.; prefer v2 classes)
    for sel in [
        "span.pdp-v2-product-price-content-originalPrice-amount",
        "[data-qa-locator='original-price']",
        ".pdp-price_type_deleted",
        ".pdp-price_del",
        ".pdp-price_product_price__old",
        ".product-price-original",
        "del .pdp-price, del, .pdp-price-del",
    ]:
        el = soup.select_one(sel)
        if not el:
            continue
        val = _to_float(el.get_text())
        if val:
            list_candidates.append(val)
            break

    if not list_candidates:
        m = V2_ORIG_RE.search(body)
        if m:
            val = _to_float(m.group(1))
            if val:
                list_candidates.append(val)

    sale_candidates = [v for v in sale_candidates if v and v > 0]
    list_candidates = [v for v in list_candidates if v and v > 0]

    price_final = min(sale_candidates) if sale_candidates else None
    price_list = (max(list_candidates) if list_candidates else None)

    # If inverted, fix it
    if price_final and price_list and price_final > price_list:
        price_final, price_list = price_list, price_final

    discount_pct = None
    if price_final and price_list and price_list > price_final:
        discount_pct = round((price_list - price_final) / price_list * 100, 2)

    # --- AVAILABILITY ---
    availability = None
    for s in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(s.get_text(strip=True) or "{}")
            blocks = data if isinstance(data, list) else [data]
            for d in blocks:
                offers = d.get("offers")
                offers = offers if isinstance(offers, list) else [offers] if isinstance(offers, dict) else []
                for o in offers:
                    avail = str(o.get("availability") or "").lower()
                    if "outofstock" in avail:
                        availability = "out_of_stock"
                        break
                    if "instock" in avail or "preorder" in avail:
                        availability = "in_stock"
                        break
                if availability:
                    break
            if availability:
                break
        except Exception:
            pass
    if availability is None:
        txt = soup.get_text(" ", strip=True).lower()
        if any(w in txt for w in ["out of stock", "sold out", "unavailable"]):
            availability = "out_of_stock"
        elif any(w in txt for w in ["add to cart", "buy now"]):
            availability = "in_stock"
        else:
            availability = "unknown"

    stock_status = "In Stock" if availability == "in_stock" else ("Out of Stock" if availability == "out_of_stock" else "Unknown")

    return {
        "product": product,
        "price": price_final,  # store discounted/final price
        "stock_status": stock_status,
        "image_url": image_url,
        "_debug": {
            "original_price": price_list,
            "discount_pct": discount_pct
        }
    }

def _parse_generic_meta(body: str, url: str):
    """
    Very light fallback for unknown domains. You can keep or remove.
    """
    if not BeautifulSoup:
        raise RuntimeError("BeautifulSoup (bs4) is required. Add it to your layer or package.")
    soup = BeautifulSoup(body, "html.parser")
    product = None
    for sel in ["meta[property='og:title']", "title"]:
        el = soup.select_one(sel)
        if not el:
            continue
        product = (el.get("content") if el.name == "meta" else el.get_text()).strip()
        if product:
            break
    if not product:
        product = _fallback_product_from_url(url)
    img = None
    m = soup.select_one('meta[property="og:image"], meta[name="og:image"]')
    if m and m.get("content"):
        img = m["content"].strip()
    img = _norm_url(img, url)
    # No reliable price parser here; set None
    return {"product": product, "price": None, "stock_status": "Unknown", "image_url": img}

# Map host -> parser
SITE_PARSERS = {
    # Lazada SG (add more lazada ccTLDs if needed)
    "www.lazada.sg": _parse_lazada,
    "lazada.sg": _parse_lazada,
}

def _choose_parser(host: str):
    # Exact match first
    if host in SITE_PARSERS:
        return SITE_PARSERS[host]
    # Heuristics
    if "lazada" in host:
        return _parse_lazada
    # Default
    return _parse_generic_meta

# =========================
# Scraping via ScrapingBee
# =========================
def _scrape(url: str, api_key: str):
    """
    Fetches HTML (no AI extract), routes to a site parser, and returns normalized snapshot.
    """
    p = urlparse(url)
    host = p.netloc.lower()
    parser = _choose_parser(host)

    params = {
        "api_key": api_key,
        "url": url,
        "country_code": "sg",
        "stealth_proxy": "true",
        "wait": "1000",
        "block_resources": "true",
        "render_js": "false",
        "return_page_source": "true",  # HTML mode
    }

    log.info("ScrapingBee request(HTML): url=%s host=%s", url, host)
    sess = _http()
    r = sess.get("https://app.scrapingbee.com/api/v1", params=params, timeout=(5, 120))

    log.info("ScrapingBee response: status=%s headers=%s",
             r.status_code, {k: v for k, v in r.headers.items() if k.lower() in (
                 "content-type", "x-remaining-credits", "x-scrapingbee-request-id",
                 "x-request-id", "date"
             )})

    body = r.text or ""
    if r.status_code >= 400 or not body.strip():
        log.error("ScrapingBee error: %s %s", r.status_code, (body[:LOG_SNIP]))
        r.raise_for_status()

    # Parse with site-specific parser
    snap = parser(body, url)

    # Ensure required fields exist / normalize
    if not (snap.get("product") or "").strip():
        snap["product"] = _fallback_product_from_url(url)

    # Price must be final (after discount) for storage
    price_raw = snap.get("price")
    try:
        snap["price"] = float(price_raw) if price_raw is not None else None
    except Exception:
        snap["price"] = None

    # Stock status normalized
    ss = (snap.get("stock_status") or "").lower()
    if "in stock" in ss or ss == "instock":
        snap["stock_status"] = "In Stock"
    elif "out of stock" in ss or ss == "out_of_stock":
        snap["stock_status"] = "Out of Stock"
    else:
        snap["stock_status"] = "Unknown"

    # If we likely captured only a single (possibly list) price, try one JS render to discover discount
    only_list_seen = bool(snap.get("price")) and not snap.get("_debug", {}).get("original_price")
    if only_list_seen:
        try:
            params_js = {
                "api_key": api_key,
                "url": url,
                "country_code": "sg",
                "stealth_proxy": "true",
                "wait": "2500",
                "block_resources": "true",
                "render_js": "true",
                "return_page_source": "true",
            }
            r2 = _http().get("https://app.scrapingbee.com/api/v1", params=params_js, timeout=(5, 120))
            if r2.ok and (r2.text or "").strip():
                snap2 = parser(r2.text, url)
                try:
                    p1 = float(snap.get("price")) if snap.get("price") is not None else None
                except Exception:
                    p1 = None
                try:
                    p2 = float(snap2.get("price")) if snap2.get("price") is not None else None
                except Exception:
                    p2 = None
                # prefer strictly lower price (discounted)
                if p2 is not None and (p1 is None or p2 < p1):
                    ss2 = (snap2.get("stock_status") or snap.get("stock_status"))
                    img2 = snap2.get("image_url") or snap.get("image_url")
                    snap = {
                        "product": snap2.get("product") or snap.get("product"),
                        "price": p2,
                        "stock_status": ss2,
                        "image_url": _norm_url(img2, url),
                        "_debug": snap2.get("_debug", {}),
                    }
        except Exception:
            pass

    log.info("Normalized snapshot: %s", {k: snap.get(k) for k in ("product", "price", "stock_status", "image_url")})
    return snap

# =========================
# DB helpers
# =========================
def _insert_snapshot(conn, url: str, snap: dict):
    # Coalesce product to avoid IntegrityError 1048
    product = (snap.get("product") or "").strip()
    if not product:
        product = _fallback_product_from_url(url)
        log.warning("Missing product from scraper; using fallback='%s' for url=%s", product, url)

    # Always normalize image URL before storing
    img = _norm_url(snap.get("image_url"), url)

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
            (url, product, snap.get("price"), snap.get("stock_status"), img),
        )

# =========================
# WebSocket push helpers
# =========================
def _post_to(cid: str, payload_bytes: bytes):
    try:
        _api.post_to_connection(ConnectionId=cid, Data=payload_bytes)
        return True
    except _api.exceptions.GoneException:
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

# =========================
# Lambda handler
# =========================
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

    log.info("DB target: host=%s port=%s user=%s db=%s", db["host"], db["port"], db["user"], db["database"])
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
            user_id = payload.get("user_id")  # may be None

            if not url or not isinstance(url, str):
                raise ValueError("Record has no 'url'")

            log.info("SQS record: id=%s url=%s user=%s", rec_id, url, user_id or "-")

            # quick outbound probe (best-effort)
            try:
                requests.get("https://httpbin.org/ip", timeout=(3, 5))
            except Exception:
                pass

            snap = _scrape(url, api_key)
            _insert_snapshot(conn, url, snap)

            row = {
                "url": url,
                "product": snap.get("product"),
                "price": snap.get("price"),
                "stock_status": snap.get("stock_status"),
                "image_url": _norm_url(snap.get("image_url"), url),
                "updated_at": int(time.time())
            }
            _push_row_upserted(user_id, row)

            log.info("Scrape done: %s • %s • %.2f",
                     url, row["stock_status"], (row["price"] or 0.0))

        except Exception as e:
            log.exception("Record failed: %s", rec_id)
            # Best-effort notify UI so 'adding...' doesn't hang forever
            try:
                bad = json.loads(rec.get("body") or "{}")
                _push_job_failed(bad.get("user_id"), bad.get("url"), f"{type(e).__name__}: {e}")
            except Exception:
                log.warning("Unable to push job_failed for record %s", rec_id)
            failures.append({"itemIdentifier": rec_id})

    try:
        conn.close()
    except Exception:
        pass

    return {"batchItemFailures": failures}
