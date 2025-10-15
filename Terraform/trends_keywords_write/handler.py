# write_keyword.py
import json, os, logging
import boto3, pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SECRET_ARN = os.environ["DB_SECRET_ARN"]
DEFAULT_GEO = os.getenv("DEFAULT_GEO", "sg")

sm = boto3.client("secretsmanager")

def get_db_cfg():
    sec = sm.get_secret_value(SecretId=SECRET_ARN)
    j = json.loads(sec.get("SecretString", "{}"))
    return dict(
        host=j["host"],
        port=int(j.get("port", 3306)),
        user=j["username"],
        password=j["password"],
        db=j.get("dbname") or j.get("database") or "app",
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

def lambda_handler(event, context):
    """HTTP POST /trends/keywords
       Body JSON: { "slug" | "keyword": "<new term>", "geo"?: "sg" }
       Notes:
         - defaults applied when fields omitted
         - idempotent for existing keyword (returns existing row)
    """
    try:
        body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8", "ignore")
        payload = json.loads(body)
    except Exception:
        return respond(400, {"error": "invalid_json"})

    # allow either 'slug' or 'keyword'
    raw_kw = (payload.get("keyword") or payload.get("slug") or "").strip()
    if not raw_kw:
        return respond(400, {"error": "keyword_required"})

    # normalize
    keyword = raw_kw[:200]  # clamp length
    geo = (payload.get("geo") or DEFAULT_GEO or "sg").lower().strip()[:8]
    group_name = keyword  # default: same as keyword
    category = 0
    is_active = 1
    is_anchor = 1

    sql_insert = """
        INSERT IGNORE INTO trend_keywords
            (keyword, group_name, geo, category, is_active, is_anchor)
        VALUES
            (%s, %s, %s, %s, %s, %s)
    """
    sql_select = """
        SELECT keyword, group_name, geo, category, is_active, is_anchor,
               UNIX_TIMESTAMP(created_at) AS created_at
        FROM trend_keywords
        WHERE keyword = %s
    """

    try:
        cfg = get_db_cfg()
        with pymysql.connect(**cfg) as conn, conn.cursor() as cur:
            cur.execute(sql_insert, (keyword, group_name, geo, category, is_active, is_anchor))
            # Even if it already exists (INSERT IGNORE), return the current row
            cur.execute(sql_select, (keyword,))
            row = cur.fetchone()
        return respond(200, row or {"keyword": keyword})
    except Exception as e:
        logger.exception("write_keyword failed")
        return respond(500, {"error": "internal_error", "detail": str(e)})
