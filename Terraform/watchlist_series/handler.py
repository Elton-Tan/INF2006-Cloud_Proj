# watchlist_series/handler.py  (GROUP BY product)
import os, json, boto3, pymysql
from datetime import date, datetime
from decimal import Decimal

def _json_default(o):
    if isinstance(o, (datetime, date)): return o.isoformat()
    if isinstance(o, Decimal): return float(o)
    return str(o)

def _cors_headers():
    return {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
    }

def lambda_handler(event, _ctx):
    qp   = (event or {}).get("queryStringParameters") or {}
    gran = (qp.get("range") or "week").lower()
    if gran not in ("day", "week", "month"): gran = "week"

    region     = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
    secret_arn = os.environ["DB_SECRET_ARN"]

    sm  = boto3.client("secretsmanager", region_name=region)
    cfg = json.loads(sm.get_secret_value(SecretId=secret_arn)["SecretString"])

    conn = pymysql.connect(
        host=cfg["host"], user=cfg["username"], password=cfg["password"],
        database=cfg["database"], port=int(cfg.get("port", 3306)),
        autocommit=True, cursorclass=pymysql.cursors.Cursor,
    )

    if gran == "day":
        bucket_fmt, horizon = "%Y-%m-%d %H:00", "1 DAY"
    elif gran == "week":
        bucket_fmt, horizon = "%Y-%m-%d", "7 DAY"
    else:
        bucket_fmt, horizon = "%Y-%m-%d", "30 DAY"

    sql = f"""
      SELECT
        product,
        DATE_FORMAT(CONVERT_TZ(updated_at,'+00:00','+08:00'), '{bucket_fmt}') AS bucket,
        AVG(price) AS avg_price
      FROM watchlist
      WHERE updated_at >= UTC_TIMESTAMP() - INTERVAL {horizon}
        AND price IS NOT NULL AND price > 0
      GROUP BY product, bucket
      ORDER BY bucket ASC, product ASC;
    """

    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()  # (product, bucket, avg_price)

        by_bucket = {}
        products  = set()
        for prod, bucket, avgp in rows:
            key = str(bucket)
            name = prod or "Unknown"
            products.add(name)
            if key not in by_bucket:
                by_bucket[key] = {"bucket": key}
            by_bucket[key][name] = float(avgp) if avgp is not None else None

        data = [by_bucket[k] for k in sorted(by_bucket.keys())]

        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps({
                "range": gran,
                "series": data,
                "products": sorted(list(products)),
                "tz": "Asia/Singapore"
            }, default=_json_default),
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": _cors_headers(),
            "body": json.dumps({"error": str(e)}),
        }
