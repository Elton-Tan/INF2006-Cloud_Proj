# alerts_read/handler.py
import os, json, boto3, pymysql
from decimal import Decimal
from datetime import date, datetime

def _json_default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    return str(o)

def lambda_handler(event, _ctx):
    # Support ?limit= query param (default 50, max 200)
    limit = 50
    qp = (event or {}).get("queryStringParameters") or {}
    if "limit" in qp:
        try:
            limit = max(1, min(200, int(qp["limit"])))
        except:
            pass

    region = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
    secret_arn = os.environ["DB_SECRET_ARN"]

    sm = boto3.client("secretsmanager", region_name=region)
    sec = sm.get_secret_value(SecretId=secret_arn)["SecretString"]
    cfg = json.loads(sec)

    conn = pymysql.connect(
        host=cfg["host"],
        user=cfg["username"],
        password=cfg["password"],
        database="spirulinadb",  # Explicitly use spirulinadb
        port=int(cfg.get("port", 3306)),
        autocommit=True,
        cursorclass=pymysql.cursors.Cursor,
    )

    sql = """
      SELECT id, ts, title, description, severity, market, channel
      FROM alerts
      ORDER BY ts DESC
      LIMIT %s
    """

    try:
        with conn.cursor() as cur:
            cur.execute(sql, (limit,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET,OPTIONS",
                "access-control-allow-headers": "content-type,authorization",
            },
            "body": json.dumps({"alerts": rows}, default=_json_default),
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
            },
            "body": json.dumps({"error": str(e)}),
        }
    finally:
        conn.close()
