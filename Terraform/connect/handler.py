# connect_handler.py  (Handler: connect_handler.lambda_handler)
import os, time, json, boto3, traceback

TABLE = os.getenv("CONN_TABLE")  # e.g., "pubsub"
TTL_DAYS = int(os.getenv("TTL_DAYS", "1"))
ddb = boto3.client("dynamodb")

def _resp(code, body):
    return {"statusCode": code, "body": json.dumps(body)}

def lambda_handler(event, _ctx):
    try:
        print("CONNECT EVENT:", json.dumps({
            "keys": list(event.keys()),
            "qs": event.get("queryStringParameters"),
            "rc_keys": list((event.get("requestContext") or {}).keys())
        }))
        if not TABLE:
            print("ENV MISSING: CONN_TABLE")
            return _resp(500, {"error": "config", "detail": "CONN_TABLE not set"})

        qp = (event.get("queryStringParameters") or {})
        user_id = qp.get("user") or "anon"
        cid = event["requestContext"]["connectionId"]
        ttl = int(time.time()) + TTL_DAYS * 24 * 3600

        print(f"WRITE DDB -> table={TABLE} user={user_id} cid={cid}")
        ddb.put_item(
            TableName=TABLE,
            Item={
                "pk": {"S": f"user#{user_id}"},
                "sk": {"S": f"conn#{cid}"},
                "connectionId": {"S": cid},
                "ttl": {"N": str(ttl)}
            }
        )
        print("PUT OK")
        return _resp(200, {"ok": True})
    except Exception as e:
        print("CONNECT ERROR:", repr(e))
        traceback.print_exc()
        return _resp(500, {"error": "internal"})
