# enqueue_handler.py  (Handler: enqueue_handler.lambda_handler)
import os, json, logging, boto3, base64
from botocore.config import Config as BotoConfig

logging.getLogger().setLevel(logging.INFO)

AWS_REGION = os.getenv("REGION")
QUEUE_URL  = os.getenv("QUEUE_URL")  # e.g. https://sqs.us-east-1.amazonaws.com/975050351129/derm-snapshot-queue
_sqs = boto3.client("sqs", region_name=AWS_REGION, config=BotoConfig(retries={"max_attempts": 3}))

CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "OPTIONS,POST",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json"
}

def _resp(code, body):
    return {"statusCode": code, "headers": CORS, "body": json.dumps(body)}

def lambda_handler(event, _ctx):
    # CORS preflight
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "POST")
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS, "body": ""}

    if not QUEUE_URL:
        return _resp(500, {"error": "config", "detail": "QUEUE_URL is not set"})

    # Parse body (works for HTTP API v2, REST, or direct invoke)
    body = event.get("body")
    if isinstance(body, str) and event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    try:
        data = json.loads(body) if isinstance(body, str) else (body or {})
    except Exception:
        data = event if isinstance(event, dict) else {}

    # Accept {"urls":[...]} or {"url":"..."}
    urls = data.get("urls")
    if not urls:
        single = data.get("url")
        urls = [single] if single else []

    # Clean + de-dup within this request
    clean = []
    seen = set()
    for u in urls:
        if not isinstance(u, str): continue
        u2 = u.strip()
        if not u2: continue
        k = u2.lower().rstrip("/")
        if k not in seen:
            seen.add(k); clean.append(u2)

    if not clean:
        return _resp(400, {"error": "bad_request", "detail": "Provide 'urls': [\"https://...\"] or 'url'."})

    # Send in batches of 10
    accepted = 0
    i = 0
    while i < len(clean):
        chunk = clean[i:i+10]
        entries = [{"Id": str(j), "MessageBody": json.dumps({"url": u})} for j, u in enumerate(chunk)]
        resp = _sqs.send_message_batch(QueueUrl=QUEUE_URL, Entries=entries)
        failed = {f["Id"] for f in resp.get("Failed", [])}
        accepted += sum(1 for idx in range(len(entries)) if str(idx) not in failed)
        i += 10

    return _resp(202, {"accepted": accepted})
