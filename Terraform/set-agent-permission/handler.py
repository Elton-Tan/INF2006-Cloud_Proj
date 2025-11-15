# lambda_function.py
import json
import os
import logging
import base64
import pymysql
import boto3
from botocore.config import Config as BotoConfig
from typing import Any, Dict

# ---------- Config ----------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.getLogger().setLevel(LOG_LEVEL)
log = logging.getLogger(__name__)

AWS_REGION = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
DB_SECRET_ARN = os.getenv("DB_SECRET_ARN")  # {host,port,username,password,dbname}
DB_NAME_KEY = os.getenv("DB_NAME_KEY", "spirulinadb")    # name/key for DB in secret

ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "OPTIONS,POST",
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
def _resp(status: int, body: dict | str):
    if not isinstance(body, str):
        body = json.dumps(body)
    return {"statusCode": status, "headers": CORS_HEADERS, "body": body}

def _norm_method(event: Dict[str, Any]) -> str:
    """
    Support API Gateway REST API (v1), HTTP API (v2), and ALB.
    """
    m = event.get("httpMethod")
    if m:
        return m.upper()
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    m = http.get("method") or rc.get("httpMethod")
    return (m or "").upper()

def _boolify(v, default=None):
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("1", "true", "t", "yes", "y"):
            return True
        if s in ("0", "false", "f", "no", "n"):
            return False
    return default

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
        host=host,
        port=port,
        user=user,
        password=pwd,
        db=db,
        connect_timeout=5,
        charset="utf8mb4",
        autocommit=False,      # we'll manage commits
        cursorclass=pymysql.cursors.DictCursor,
    )
    return _conn


# ---------- Core logic ----------
def update_agent_permission(payload: dict):
    """
    Only UPDATE existing row; never INSERT.

    payload:
      - id?: int (defaults to 1 if omitted)
      - monitoring: bool
      - allows_action: bool

    Rule: allows_action == True implies monitoring == True
    """
    if not isinstance(payload, dict):
        raise ValueError("Invalid JSON body")

    # default singleton row id=1 if omitted
    raw_id = payload.get("id", 1)

    try:
        row_id = int(raw_id)
    except Exception:
        raise ValueError("'id' must be an integer.")

    monitoring = _boolify(payload.get("monitoring"))
    allows_action = _boolify(payload.get("allows_action"))

    if monitoring is None or allows_action is None:
        raise ValueError("Both 'monitoring' and 'allows_action' must be provided (true/false).")

    if allows_action and not monitoring:
        raise ValueError("'allows_action' cannot be True when 'monitoring' is False.")

    mon_i = 1 if monitoring else 0
    act_i = 1 if allows_action else 0

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Ensure row exists
            cur.execute("SELECT id FROM agent_permissions WHERE id=%s", (row_id,))
            row = cur.fetchone()
            if not row:
                # No insert allowed; caller must precreate the row
                raise LookupError(f"id {row_id} not found.")

            # Update existing row
            sql = """
                UPDATE agent_permissions
                SET monitoring=%s, allows_action=%s
                WHERE id=%s
            """
            cur.execute(sql, (mon_i, act_i, row_id))
            conn.commit()

            return {
                "action": "update",
                "id": row_id,
                "monitoring": bool(mon_i),
                "allows_action": bool(act_i),
            }
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise


# ---------- Lambda handler ----------
def lambda_handler(event, context):
    method = _norm_method(event)

    # CORS preflight (return empty/204 so browsers are happy)
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}

    if method != "POST":
        return _resp(405, {"error": "Method Not Allowed. Use POST."})

    try:
        body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        payload = json.loads(body)

        result = update_agent_permission(payload)
        return _resp(200, {"ok": True, **result})

    except ValueError as ve:
        log.warning("Validation error: %s", ve)
        return _resp(400, {"ok": False, "error": str(ve)})
    except LookupError as le:
        log.info("Not found: %s", le)
        return _resp(404, {"ok": False, "error": str(le)})
    except pymysql.MySQLError as dbe:
        log.exception("DB error")
        return _resp(500, {"ok": False, "error": "Database error", "detail": str(dbe)})
    except Exception as e:
        log.exception("Unhandled error")
        return _resp(500, {"ok": False, "error": "Internal error", "detail": str(e)})
    finally:
        # keep connection open for reuse
        pass
