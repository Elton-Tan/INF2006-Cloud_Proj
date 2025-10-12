# read_keywords.py
import json, os, logging
import boto3, pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SECRET_ARN = os.environ["DB_SECRET_ARN"]

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
    """HTTP GET /trends/keywords
       Optional query params:
         - active=0|1  (filter by is_active)
         - q=<substring> (filter keyword ILIKE)
         - limit=<int> (default 500)
    """
    qs = event.get("queryStringParameters") or {}
    active = qs.get("active")
    q = qs.get("q")
    try:
        limit = max(1, min(5000, int(qs.get("limit", "500"))))
    except:
        limit = 500

    where = []
    args = []
    if active is not None:
        where.append("is_active = %s")
        args.append(1 if str(active) == "1" else 0)
    if q:
        where.append("keyword LIKE %s")
        args.append(f"%{q}%")
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    sql = f"""
        SELECT keyword, group_name, geo, category, is_active, is_anchor,
               UNIX_TIMESTAMP(created_at) AS created_at
        FROM trend_keywords
        {where_sql}
        ORDER BY created_at DESC, keyword ASC
        LIMIT %s
    """

    try:
        cfg = get_db_cfg()
        with pymysql.connect(**cfg) as conn, conn.cursor() as cur:
            cur.execute(sql, (*args, limit))
            rows = cur.fetchall()
        return respond(200, {"items": rows})
    except Exception as e:
        logger.exception("read_keywords failed")
        return respond(500, {"error": "internal_error", "detail": str(e)})
