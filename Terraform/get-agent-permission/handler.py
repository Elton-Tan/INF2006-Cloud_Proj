# lambda_get_permissions.py
import json
import os
import logging
import pymysql
import boto3
from botocore.config import Config as BotoConfig
from typing import Any, Dict, List, Tuple, Optional

# ---------- Config ----------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.getLogger().setLevel(LOG_LEVEL)
log = logging.getLogger(__name__)

AWS_REGION = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
DB_SECRET_ARN = os.getenv("DB_SECRET_ARN")
DB_NAME_KEY = os.getenv("DB_NAME_KEY", "dbname")

ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "OPTIONS,GET",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Content-Type": "application/json",
}

_boto_cfg = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
_sm = boto3.client("secretsmanager", region_name=AWS_REGION, config=_boto_cfg)

_conn = None  # warm-connection reuse


# ---------- Helpers ----------
def _resp(status: int, body: Dict[str, Any] | List[Dict[str, Any]] | str):
    if not isinstance(body, str):
        body = json.dumps(body)
    return {"statusCode": status, "headers": CORS_HEADERS, "body": body}

def _norm_method(event: Dict[str, Any]) -> str:
    # REST API v1: event.httpMethod
    m = event.get("httpMethod")
    if m:
        return m.upper()
    # HTTP API v2: event.requestContext.http.method
    m = (event.get("requestContext", {}) or {}).get("http", {}).get("method")
    if m:
        return m.upper()
    # ALB / others sometimes expose requestContext.httpMethod
    m = (event.get("requestContext", {}) or {}).get("httpMethod")
    return (m or "").upper()

def _get_qs(event: Dict[str, Any]) -> Dict[str, str]:
    # Works for both v1/v2; prefer single-value
    q = event.get("queryStringParameters") or {}
    # If multi-value exists, collapse first value
    mv = event.get("multiValueQueryStringParameters") or {}
    for k, v in (mv or {}).items():
        if isinstance(v, list) and v and k not in q:
            q[k] = v[0]
    return q

def _boolify(v: Optional[str]) -> Optional[bool]:
    if v is None:
        return None
    s = v.strip().lower()
    if s in ("1", "true", "t", "yes", "y"): return True
    if s in ("0", "false", "f", "no", "n"): return False
    return None

def _parse_ids(qsp: Dict[str, str]) -> Optional[List[int]]:
    if "id" in qsp and qsp["id"]:
        try:
            return [int(qsp["id"])]
        except Exception:
            raise ValueError("Query param 'id' must be an integer")
    ids = qsp.get("ids")
    if ids:
        try:
            arr = [x.strip() for x in ids.split(",") if x.strip()]
            return [int(x) for x in arr]
        except Exception:
            raise ValueError("Query param 'ids' must be a comma-separated list of integers")
    return None

def _get_conn():
    global _conn
    if _conn and _conn.open:
        return _conn
    if not DB_SECRET_ARN:
        raise RuntimeError("Missing DB_SECRET_ARN environment variable")
    sec = _sm.get_secret_value(SecretId=DB_SECRET_ARN)
    secret = json.loads(sec["SecretString"])
    host = secret.get("host")
    port = int(secret.get("port", 3306))
    user = secret.get("username")
    pwd  = secret.get("password")
    db   = secret.get(DB_NAME_KEY, secret.get("database"))
    if not all([host, user, pwd, db]):
        raise RuntimeError("Database secret missing one of: host, username, password, dbname")
    _conn = pymysql.connect(
        host=host, port=port, user=user, password=pwd, db=db,
        connect_timeout=5, charset="utf8mb4", autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )
    return _conn


# ---------- Core ----------
def query_agent_permissions(
    ids: Optional[List[int]],
    monitoring: Optional[bool],
    allows_action: Optional[bool],
    limit: int,
    offset: int,
) -> Tuple[List[Dict[str, Any]], int]:
    where = []
    params: List[Any] = []
    if ids:
        where.append(f"id IN ({','.join(['%s'] * len(ids))})")
        params.extend(ids)
    if monitoring is not None:
        where.append("monitoring = %s")
        params.append(1 if monitoring else 0)
    if allows_action is not None:
        where.append("allows_action = %s")
        params.append(1 if allows_action else 0)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    count_sql = f"SELECT COUNT(*) AS cnt FROM agent_permissions{where_sql}"
    data_sql = (
        f"SELECT id, monitoring, allows_action "
        f"FROM agent_permissions{where_sql} "
        f"ORDER BY id ASC LIMIT %s OFFSET %s"
    )
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(count_sql, params)
        total = int(cur.fetchone()["cnt"])
        cur.execute(data_sql, params + [limit, offset])
        rows = cur.fetchall() or []
    for r in rows:
        r["monitoring"] = bool(r["monitoring"])
        r["allows_action"] = bool(r["allows_action"])
    return rows, total


# ---------- Lambda handler ----------
def lambda_handler(event, context):
    method = _norm_method(event)

    # CORS preflight for both v1/v2
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}

    if method != "GET":
        return _resp(405, {"error": "Method Not Allowed. Use GET."})

    try:
        qsp = _get_qs(event)

        ids = _parse_ids(qsp)
        monitoring = _boolify(qsp.get("monitoring"))
        allows_action = _boolify(qsp.get("allows_action"))

        try:
            limit = int(qsp.get("limit", "100"))
            offset = int(qsp.get("offset", "0"))
        except Exception:
            return _resp(400, {"ok": False, "error": "limit and offset must be integers"})

        if limit <= 0: limit = 100
        if limit > 1000: limit = 1000
        if offset < 0: offset = 0

        items, total = query_agent_permissions(ids, monitoring, allows_action, limit, offset)
        return _resp(200, {"ok": True, "count": total, "items": items, "limit": limit, "offset": offset})

    except ValueError as ve:
        log.warning("Validation error: %s", ve)
        return _resp(400, {"ok": False, "error": str(ve)})
    except pymysql.MySQLError as dbe:
        log.exception("DB error")
        return _resp(500, {"ok": False, "error": "Database error", "detail": str(dbe)})
    except Exception as e:
        log.exception("Unhandled error")
        return _resp(500, {"ok": False, "error": "Internal error", "detail": str(e)})
