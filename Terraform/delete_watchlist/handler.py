# delete_watchlist.py  (Handler: delete_watchlist.lambda_handler)
import json, os, logging, base64
import pymysql
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import boto3
from botocore.config import Config as BotoConfig

log = logging.getLogger()
log.setLevel(logging.INFO)

AWS_REGION    = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
DB_SECRET_ARN = os.getenv("DB_SECRET_ARN")

_boto_cfg = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
_sm       = boto3.client("secretsmanager", region_name=AWS_REGION, config=_boto_cfg)

DROP_PARAMS = {
    "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
    "spm","from","clickTrackInfo"
}

# ------------------------ helpers ------------------------

def _cors_headers():
    return {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "OPTIONS,GET,POST,DELETE",
        "access-control-allow-headers": "content-type,authorization",
        "content-type": "application/json",
    }

def _resp(code: int, body: dict):
    return {"statusCode": code, "headers": _cors_headers(), "body": json.dumps(body)}

def _get_method(event: dict) -> str:
    # HTTP API v2
    m = ((event.get("requestContext") or {}).get("http") or {}).get("method")
    # REST API v1 (fallback)
    return m or event.get("httpMethod") or ""

def _get_body_json(event: dict) -> dict:
    body = event.get("body")
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body).decode("utf-8", errors="ignore")
        except Exception:
            return {}
    try:
        return json.loads(body)
    except Exception:
        return {}

def _get_query_param(event: dict, key: str) -> str | None:
    q = event.get("queryStringParameters") or {}
    return q.get(key)

def _get_db():
    sec = json.loads(_sm.get_secret_value(SecretId=DB_SECRET_ARN)["SecretString"])
    return pymysql.connect(
        host=sec["host"],
        user=sec["username"],
        password=sec["password"],
        database=sec.get("dbname") or sec.get("db") or "spirulinadb",
        port=int(sec.get("port", 3306)),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )

def canonical_url(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    try:
        u = urlparse(s)
        u = u._replace(fragment="")  # drop hash
        host = (u.netloc or "").lower()
        for pre in ("www.", "m."):
            if host.startswith(pre):
                host = host[len(pre):]
        qs = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k not in DROP_PARAMS]
        path = u.path.rstrip("/") or "/"
        u2 = u._replace(netloc=host, query=urlencode(qs, doseq=True), path=path)
        return urlunparse(u2)
    except Exception:
        return s.rstrip("/")

# ------------------------ handler ------------------------

def lambda_handler(event, _ctx):
    try:
        method = _get_method(event)

        # CORS preflight (HTTP API sends OPTIONS automatically)
        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        if method != "DELETE":
            return _resp(405, {"error": "method_not_allowed"})

        body = _get_body_json(event)
        raw_url = (body.get("url") if isinstance(body, dict) else None) or _get_query_param(event, "url")

        if not raw_url or not isinstance(raw_url, str):
            return _resp(400, {"error": "missing_url"})

        canon = canonical_url(raw_url)
        if not canon:
            return _resp(400, {"error": "bad_url"})

        host = urlparse(canon).netloc
        if not host:
            return _resp(400, {"error": "bad_url_host"})

        deleted_ids = []
        with _get_db() as conn, conn.cursor() as cur:
            # Prefilter by host (fast) then re-check with canonicalizer (exact)
            cur.execute(
                "SELECT id, url FROM watchlist WHERE LOCATE(%s, url) > 0",
                (host,),
            )
            rows = cur.fetchall() or []
            match_ids = [r["id"] for r in rows if canonical_url(r["url"]) == canon]

            if match_ids:
                for i in range(0, len(match_ids), 500):
                    chunk = match_ids[i:i+500]
                    placeholders = ",".join(["%s"] * len(chunk))
                    cur.execute(f"DELETE FROM watchlist WHERE id IN ({placeholders})", chunk)
                deleted_ids = match_ids

        return _resp(200, {"ok": True, "deleted_count": len(deleted_ids), "deleted_ids": deleted_ids})

    except Exception as e:
        log.exception("delete error")
        return _resp(500, {"error": "server_error", "detail": str(e)})
