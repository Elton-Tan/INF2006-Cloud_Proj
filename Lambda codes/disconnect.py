# disconnect_handler.py  (Handler: disconnect_handler.lambda_handler)
import os, json, boto3, traceback

TABLE = os.environ.get("CONN_TABLE")              # e.g., "pubsub"
GSI   = os.environ.get("CONN_GSI", "gsi_conn")    # GSI on connectionId
ddb   = boto3.client("dynamodb")

def _resp(code: int, body: dict | None = None):
    return {"statusCode": code, "body": json.dumps(body or {"ok": True})}

def lambda_handler(event, _ctx):
    try:
        # 1) Basic sanity logs
        print("DISCONNECT EVENT keys:", list(event.keys()))
        rc = event.get("requestContext") or {}
        cid = rc.get("connectionId")
        stage = rc.get("stage")
        api_id = rc.get("apiId")
        print(f"DISCONNECT ctx: stage={stage} apiId={api_id} connectionId={cid}")
        print(f"ENV: TABLE={TABLE} GSI={GSI}")

        if not TABLE:
            print("ERROR: CONN_TABLE env missing")
            return _resp(500, {"error": "config_missing", "detail": "CONN_TABLE not set"})

        if not cid:
            print("ERROR: No connectionId in requestContext")
            return _resp(400, {"error": "bad_request", "detail": "missing connectionId"})

        # 2) Look up pk/sk via GSI on connectionId
        try:
            q = ddb.query(
                TableName=TABLE,
                IndexName=GSI,
                KeyConditionExpression="connectionId = :c",
                ExpressionAttributeValues={":c": {"S": cid}},
                ProjectionExpression="pk, sk"
            )
        except ddb.exceptions.ResourceNotFoundException as e:
            print("ERROR: GSI not found or wrong IndexName:", repr(e))
            return _resp(500, {"error": "gsi_not_found", "index": GSI})
        except Exception as e:
            print("ERROR: Query failed:", repr(e))
            traceback.print_exc()
            return _resp(500, {"error": "query_failed"})

        items = q.get("Items", [])
        print(f"GSI query returned {len(items)} item(s) for connectionId={cid}")

        if not items:
            # Not fatal—client could time out; just log
            return _resp(200, {"ok": True, "deleted": 0})

        # 3) Delete the entries we found
        deleted = 0
        for it in items:
            try:
                pk = it["pk"]
                sk = it["sk"]
                ddb.delete_item(TableName=TABLE, Key={"pk": pk, "sk": sk})
                deleted += 1
            except Exception as e:
                print("ERROR: DeleteItem failed for", it, "err:", repr(e))
                traceback.print_exc()

        print(f"Deleted {deleted} item(s) for connectionId={cid}")
        return _resp(200, {"ok": True, "deleted": deleted})

    except Exception as e:
        print("UNCAUGHT ERROR in disconnect:", repr(e))
        traceback.print_exc()
        return _resp(500, {"error": "internal"})
