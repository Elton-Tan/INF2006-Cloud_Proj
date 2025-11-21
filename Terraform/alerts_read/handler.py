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

def _get_db_config():
    """
    Load database configuration from AWS Secrets Manager or environment variables.
    Supports both Lambda (Secrets Manager) and local testing (env vars).
    """
    # Try Secrets Manager first (for Lambda/production)
    secret_arn = os.environ.get("DB_SECRET_ARN")
    if secret_arn:
        region = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
        sm = boto3.client("secretsmanager", region_name=region)
        sec = sm.get_secret_value(SecretId=secret_arn)["SecretString"]
        cfg = json.loads(sec)
        return {
            "host": cfg["host"],
            "user": cfg.get("username", cfg.get("user")),
            "password": cfg["password"],
            "database": cfg.get("database", "spirulinadb"),
            "port": int(cfg.get("port", 3306)),
        }

    # Fallback to environment variables (for local testing)
    return {
        "host": os.environ.get("DB_HOST"),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
        "database": os.environ.get("DB_NAME", "spirulinadb"),
        "port": int(os.environ.get("DB_PORT", 3306)),
    }

def lambda_handler(event, _ctx):
    # Support ?limit= query param (default 50, max 200)
    limit = 50
    qp = (event or {}).get("queryStringParameters") or {}
    if "limit" in qp:
        try:
            limit = max(1, min(200, int(qp["limit"])))
        except:
            pass

    # Get database configuration
    cfg = _get_db_config()

    conn = pymysql.connect(
        host=cfg["host"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        port=cfg["port"],
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

        # Transform data to match frontend expectations
        transformed_alerts = []
        for row in rows:
            alert = {
                'id': row['id'],
                'type': row['title'],
                'severity': row['severity'],
                'message': row['description'],
                'timestamp': row['ts'],
                'read': False,
                'details': {
                    'market': row.get('market'),
                    'channel': row.get('channel')
                }
            }
            # Remove None values from details
            alert['details'] = {k: v for k, v in alert['details'].items() if v is not None}
            transformed_alerts.append(alert)

        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET,OPTIONS",
                "access-control-allow-headers": "content-type,authorization",
            },
            "body": json.dumps({"alerts": transformed_alerts}, default=_json_default),
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
