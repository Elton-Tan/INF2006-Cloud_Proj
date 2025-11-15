import os
import json
import uuid
import base64
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from botocore.exceptions import ClientError
import boto3

# ---------------- AWS clients ----------------
DDB = boto3.client("dynamodb")
SM  = boto3.client("secretsmanager")
SQS = boto3.client("sqs")

# ---------------- Env ----------------
JOBS_TABLE  = os.environ["JOBS_TABLE"]
JOBS_QUEUE  = os.environ["JOBS_QUEUE_URL"]
SECRET_ARN  = os.environ["COGNITO_OAUTH_SECRET_ARN"]  # single source of truth

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ----- CORS helpers -----------------------------------------------------------
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",  # or your domain
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
        ,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
}

def _resp(status: int, body: dict | str):
    if isinstance(body, (dict, list)):
        body = json.dumps(body)
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": body,
    }

# ---------------- Secrets loading (cached) ----------------
_secret_cache: dict | None = None

def _load_oauth_secret() -> dict:
    """
    Loads and caches the Cognito OAuth config from Secrets Manager.

    Expected JSON structure (string SecretString):
    {
      "client_id": "xxxx",
      "client_secret": "yyyy",
      "domain": "https://<your-domain>.auth.<region>.amazoncognito.com",
      "scope": "api/read api/write"
    }
    """
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    try:
        r = SM.get_secret_value(SecretId=SECRET_ARN)
    except ClientError as e:
        print({"where": "get_secret_value_failed", "secret_arn": SECRET_ARN, "error": str(e)})
        raise

    s = r.get("SecretString") or ""
    if not s:
        raise RuntimeError("SecretString missing in secret")

    try:
        data = json.loads(s)
    except Exception:
        # Some folks store key=value lines; try to coerce if needed
        data = {}
        for line in s.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip()

    # minimal validation
    for key in ("client_id", "client_secret", "domain", "scope"):
        if not data.get(key):
            raise RuntimeError(f"Secret missing required key: {key}")

    _secret_cache = data
    # Never print secrets
    print({"where": "secret_loaded", "domain": data.get("domain"), "scope_len": len(data.get("scope", ""))})
    return data

# ---------------- Cognito token helpers ----------------
def _fetch_cognito_cc_token_from_secret() -> str:
    """
    Fetch an access token via OAuth2 Client Credentials using fields from the secret.
    """
    cfg = _load_oauth_secret()
    domain = cfg["domain"].rstrip("/")
    token_url = f"{domain}/oauth2/token"
    client_id = cfg["client_id"]
    client_secret = cfg["client_secret"]
    scope = cfg["scope"]  # space-delimited

    # Prefer HTTP Basic auth per OAuth2 spec
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    headers["Authorization"] = f"Basic {basic}"

    form = {
        "grant_type": "client_credentials",
        "scope": scope,
        # client_id duplicated is okay; with Basic it's optional, but harmless
        "client_id": client_id,
    }
    data = urllib.parse.urlencode(form).encode("utf-8")

    req = urllib.request.Request(token_url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore") if hasattr(e, "read") else ""
        print({"where": "cognito_token_http_error", "status": getattr(e, "code", None), "detail_snip": detail[:200]})
        raise
    except Exception as e:
        print({"where": "cognito_token_error", "error": str(e)})
        raise

    tok = payload.get("access_token") or ""
    if not tok:
        print({"where": "cognito_token_missing_access_token", "keys": list(payload.keys())})
        raise RuntimeError("Cognito token payload missing access_token")
    return tok

def _resolve_token(headers_in: dict, is_eventbridge: bool) -> str:
    """
    Priority:
      1) Authorization: Bearer <JWT> (frontend session)
      2) X-Service-Token (explicit override from a system caller)
      3) If EventBridge or no header: use Client Credentials via secret
    """
    # Frontend / explicit header path
    auth_header = headers_in.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()

    svc_hdr = headers_in.get("x-service-token", "").strip()
    if svc_hdr:
        return svc_hdr

    # Machine token fallback
    return _fetch_cognito_cc_token_from_secret()

# ---------------- DDB helpers ----------------
def _put_job(job: dict) -> None:
    DDB.put_item(
        TableName=JOBS_TABLE,
        Item={
            "job_id": {"S": job["job_id"]},
            "status": {"S": job["status"]},  # queued|running|succeeded|failed|cancelled
            "started_at": {"S": job["started_at"]},
            "steps": {"S": json.dumps(job["steps"])},
            "errors": {"S": json.dumps(job.get("errors", []))},
            "cancel_requested": {"BOOL": False},
            **({"user_token": {"S": job["user_token"]}} if "user_token" in job else {}),
        },
        ConditionExpression="attribute_not_exists(job_id)",
    )

def _get_job(job_id: str) -> dict | None:
    try:
        r = DDB.get_item(
            TableName=JOBS_TABLE,
            Key={"job_id": {"S": job_id}},
            ConsistentRead=True,  # <- important!
        )
    except ClientError as e:
        print({"where": "get_item_failed", "table": JOBS_TABLE, "job_id": job_id, "error": str(e)})
        raise
    if "Item" not in r:
        return None
    it = r["Item"]

    def _S(name: str, default=""):
        return it.get(name, {}).get("S", default)

    job = {
        "job_id": job_id,
        "status": _S("status", "queued"),
        "started_at": _S("started_at", ""),
        "ended_at": _S("ended_at", ""),
        "steps": json.loads(_S("steps", "{}")),
        "errors": json.loads(_S("errors", "[]")),
        "cancel_requested": it.get("cancel_requested", {}).get("BOOL", False),
    }
    if "user_token" in it:
        job["user_token"] = it["user_token"]["S"]
    return job

def _update_job(job_id: str, **fields) -> None:
    expr, names, values = [], {}, {}
    for k, v in fields.items():
        nk, nv = f"#{k}", f":{k}"
        names[nk] = k
        if isinstance(v, (dict, list)):
            values[nv] = {"S": json.dumps(v)}
        elif isinstance(v, bool):
            values[nv] = {"BOOL": v}
        else:
            values[nv] = {"S": str(v)}
        expr.append(f"{nk} = {nv}")
    try:
        DDB.update_item(
            TableName=JOBS_TABLE,
            Key={"job_id": {"S": job_id}},
            UpdateExpression="SET " + ", ".join(expr),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as e:
        print({"where": "update_item_failed", "table": JOBS_TABLE, "job_id": job_id, "fields": list(fields.keys()), "error": str(e)})
        raise

# ---------------- Lambda entry ----------------
def lambda_handler(event, context):
    # Detect EventBridge Scheduled/Event invocation (no API GW)
    is_eventbridge = (
        isinstance(event, dict)
        and "requestContext" not in event
        and ("source" in event or "detail-type" in event or event.get("version") == "0")
    )

    if is_eventbridge:
        # default action for EB: start the monitoring job
        method = "POST"
        raw_path = "/agent/monitoring/start"
        qs = {}
        headers_in = {}
        body_obj = {}
    else:
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
        raw_path = event.get("rawPath", "/") or "/"
        qs = event.get("queryStringParameters") or {}
        headers_in = {(k or "").lower(): v for k, v in (event.get("headers") or {}).items()}
        try:
            body_obj = json.loads(event.get("body") or "{}")
        except Exception:
            body_obj = {}

    # CORS preflight (API GW only)
    if not is_eventbridge and method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}

    # Debug environment
    if not is_eventbridge and method == "GET" and qs.get("dbg") == "1":
        return _resp(200, {
            "lambda": "agent_monitoring_api",
            "JOBS_TABLE": JOBS_TABLE,
            "AWS_REGION": os.environ.get("AWS_REGION"),
            "path": raw_path
        })

    # --- START ---
    if method == "POST" and raw_path.endswith("/agent/monitoring/start"):
        try:
            user_token = _resolve_token(headers_in, is_eventbridge)
        except Exception as e:
            # Don't leak secrets. Provide clean error.
            return _resp(500, {"error": "failed_to_resolve_token", "detail": str(e)})

        job_id = f"am_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        steps = {
            "trends_fetch": {"status": "queued"},
            "prices_fetch": {"status": "queued"},
            "watchlist_refresh": {"status": "queued"},
            "social_listening": {"status": "queued"},
        }
        job = {
            "job_id": job_id,
            "status": "queued",
            "started_at": _now_iso(),
            "steps": steps,
            "user_token": user_token,  # always present now
        }

        _put_job(job)

        msg = {"job_id": job_id, "user_token": user_token}
        send_args = {"QueueUrl": JOBS_QUEUE, "MessageBody": json.dumps(msg)}
        if JOBS_QUEUE.endswith(".fifo"):
            send_args["MessageGroupId"] = "agent"
        SQS.send_message(**send_args)

        return _resp(200, {"job_id": job_id, "accepted": True})

    # --- STATUS ---
    if method == "GET" and raw_path.endswith("/agent/monitoring/status"):
        job_id = (qs.get("job_id") or "").strip()
        if not job_id:
            return _resp(400, {"error": "job_id required"})

        # helpful telemetry to spot region/table mismatches
        print({"where": "status_get", "table": JOBS_TABLE, "aws_region": os.environ.get("AWS_REGION"), "job_id": job_id})

        job = _get_job(job_id)
        if not job:
            return _resp(404, {"error": "not found", "job_id": job_id})

        return _resp(200, {
            "job_id": job["job_id"],
            "status": job["status"],
            "started_at": job["started_at"],
            "ended_at": job.get("ended_at"),
            "steps": job["steps"],
            "errors": job["errors"],
        })

    # --- CANCEL ---
    if method == "POST" and raw_path.endswith("/agent/monitoring/cancel"):
        job_id = (body_obj.get("job_id") or "").strip()
        if not job_id:
            return _resp(400, {"error": "job_id required"})
        _update_job(job_id, cancel_requested=True)
        return _resp(200, {"cancelled": True})

    return _resp(404, {"error": "route not found", "path": raw_path})
