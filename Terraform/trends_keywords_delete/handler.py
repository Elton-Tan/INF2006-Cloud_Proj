# delete_keyword.py
import os, json, logging, base64
from datetime import datetime, timezone
import boto3, pymysql
from botocore.config import Config as BotoConfig

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# -------- Env / Config --------
SECRET_ARN   = os.environ["DB_SECRET_ARN"]
AWS_REGION   = os.getenv("AWS_REGION") or os.getenv("REGION") or "ap-southeast-1"
DEFAULT_GEO  = os.getenv("DEFAULT_GEO", "sg")
SOFT_DELETE  = os.getenv("SOFT_DELETE", "false").lower() == "true"  # UPDATE is_active=0 instead of DELETE
SCOPE_BY_GEO = os.getenv("SCOPE_BY_GEO", "false").lower() == "true" # if true, require geo match to delete

# Optional: allow DB name via env, but we'll also read from secret
DB_NAME_ENV  = os.getenv("DB_NAME")

boto_cfg = BotoConfig(retries={"max_attempts": 3, "mode": "standard"})
sm = boto3.client("secretsmanager", region_name=AWS_REGION, config=boto_cfg)

# -------- Helpers --------
def get_db_cfg():
    sec = sm.get_secret_value(SecretId=SECRET_ARN)
    j = json.loads(sec.get("SecretString", "{}"))

    # Prefer env if provided, else secret keys commonly used in RDS secrets
    dbname = DB_NAME_ENV or j.get("dbname") or j.get("db") or j.get("database")
    if not dbname:
        raise RuntimeError("DB name not found: set DB_NAME env or include dbname in the secret")

    return dict(
        host=j["host"],
        port=int(j.get("port", 3306)),
        user=j["username"],
        password=j["password"],
        db=dbname,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )

def respond(status: int, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }

def _parse_params(event):
    qs = event.get("queryStringParameters") or {}
    if not qs and event.get("body"):  # allow JSON in DELETE body (rare)
        try:
            body = event["body"]
            if event.get("isBase64Encoded"):
                body = base64.b64decode(body).decode("utf-8", "ignore")
            j = json.loads(body)
            qs = {k: v for k, v in j.items() if v is not None}
        except Exception:
            pass
    return qs

# -------- Lambda --------
def lambda_handler(event, context):
    """
    HTTP DELETE /trends/keywords?slug=<keyword> [ &geo=sg ]
    Aliases: slug=..., keyword=..., id=...  (id is treated as the slug for this table schema)

    Behavior:
      - If SOFT_DELETE=true: UPDATE trend_keywords SET is_active=0 WHERE keyword=? [AND geo=?]
      - Else:                 DELETE FROM trend_keywords WHERE keyword=? [AND geo=?]
    """
    try:
        qs = _parse_params(event)

        # Accept slug / keyword / id (treat id as keyword, since table has no 'id' column)
        slug_raw = (qs.get("slug") or qs.get("keyword") or qs.get("id") or "").strip()
        if not slug_raw:
            return respond(400, {"error": "missing_slug", "hint": "Provide slug= or keyword= (id= accepted as alias)"} )

        # Geo handling (optional)
        geo = (qs.get("geo") or DEFAULT_GEO or "sg").strip()
        geo = geo[:8]  # enforce max len

        # Build SQL
        params = [slug_raw]
        if SOFT_DELETE:
            sql = "UPDATE trend_keywords SET is_active = 0 WHERE keyword = %s"
        else:
            sql = "DELETE FROM trend_keywords WHERE keyword = %s"

        # Only scope by geo if caller provides &geo=... or SCOPE_BY_GEO=true (to avoid wiping other regions)
        if qs.get("geo") or SCOPE_BY_GEO:
            sql += " AND LOWER(geo) = LOWER(%s)"
            params.append(geo)

        # Safety: we operate on a PK (keyword) or (keyword,geo) unique constraint; LIMIT not necessary but harmless
        if not SOFT_DELETE:
            sql += " LIMIT 1"

        # Execute
        cfg = get_db_cfg()
        with pymysql.connect(**cfg) as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            affected = cur.rowcount

        if affected < 1:
            return respond(404, {
                "ok": False,
                "deleted": 0,
                "soft_delete": SOFT_DELETE,
                "reason": "not_found",
                "where": {"keyword": slug_raw, **({"geo": geo} if (qs.get("geo") or SCOPE_BY_GEO) else {})}
            })

        return respond(200, {
            "ok": True,
            "deleted": (0 if SOFT_DELETE else affected),
            "soft_updated": (affected if SOFT_DELETE else 0),
            "soft_delete": SOFT_DELETE,
            "where": {"keyword": slug_raw, **({"geo": geo} if (qs.get("geo") or SCOPE_BY_GEO) else {})},
            "ts_utc": datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
        })

    except Exception as e:
        logger.exception("delete_keyword failed")
        return respond(500, {"error": "internal_error", "detail": str(e)})
