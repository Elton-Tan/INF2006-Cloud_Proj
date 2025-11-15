# agent_worker.py
import os
import json
import uuid
import boto3
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, List, Tuple
from botocore.exceptions import ClientError

DDB = boto3.client("dynamodb")
S3  = boto3.client("s3")

# -------- Env --------
JOBS_TABLE = os.environ["JOBS_TABLE"]
S3_BUCKET  = os.environ["S3_BUCKET"]
S3_PREFIX  = os.environ.get("S3_PREFIX", "env/prod")
API_BASE   = os.environ["API_BASE"]                      # your backend base
WS_API_URL = os.environ.get("WS_API_URL", "").strip()    # optional WS relay
SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN", "").strip()
TZ_SGT     = ZoneInfo(os.environ.get("TZ_SGT", "Asia/Singapore"))
GRACE_HOUR = int(os.environ.get("GRACE_HOUR_SGT", "9"))
PURGE_BEFORE_WRITE = os.environ.get("PURGE_BEFORE_WRITE", "true").lower() in ("1", "true", "yes")

# Helpful cold-start log
print({"lambda": "agent_worker", "JOBS_TABLE": JOBS_TABLE, "AWS_REGION": os.environ.get("AWS_REGION")})

# ---------- Folder name mapping (renamed "sub-buckets") ----------
FOLDER_NAMES: Dict[str, str] = {
    "prices":    "live-product-watchlist-prices",
    "social":    "live-social-media-data",
    "trends":    "live-trends-in-words-of-interest",
    "watchlist": "live-product-watchlist",
}

# ======================== Small utils ========================
def _peek_jwt(token: Optional[str]) -> Dict[str, Any]:
    """Decode header+payload (no signature verify) for logs/diags."""
    import base64, json as _json
    if not token or "." not in token:
        return {"_err": "not_a_jwt"}
    try:
        h, p, *_ = token.split(".")
        def dec(s: str) -> Dict[str, Any]:
            s += "=" * (-len(s) % 4)
            return _json.loads(base64.urlsafe_b64decode(s.encode("utf-8")).decode("utf-8"))
        return {"header": dec(h), "payload": dec(p)}
    except Exception as e:
        return {"_err": f"decode_failed:{e!s}"}

def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _get_job(job_id: str) -> Optional[Dict[str, Any]]:
    r = DDB.get_item(
        TableName=JOBS_TABLE,
        Key={"job_id": {"S": job_id}},
        ConsistentRead=True,
    )
    if "Item" not in r:
        return None
    it = r["Item"]

    def S(key: str, default=""):
        return it.get(key, {}).get("S", default)

    job = {
        "job_id": job_id,
        "status": S("status", "queued"),
        "started_at": S("started_at", ""),
        "ended_at": S("ended_at", ""),
        "steps": json.loads(S("steps", "{}")),
        "errors": json.loads(S("errors", "[]")),
        "cancel_requested": it.get("cancel_requested", {}).get("BOOL", False),
    }
    if "user_token" in it:
        job["user_token"] = it["user_token"]["S"]
    return job

def _update_job(job_id: str, require_existing: bool = False, **fields) -> None:
    expr, names, values = [], {}, {}
    for k, v in fields.items():
        nk = f"#{k}"; nv = f":{k}"
        names[nk] = k
        if isinstance(v, (dict, list)):
            values[nv] = {"S": json.dumps(v)}
        elif isinstance(v, bool):
            values[nv] = {"BOOL": v}
        else:
            values[nv] = {"S": str(v)}
        expr.append(f"{nk} = {nv}")

    params = dict(
        TableName=JOBS_TABLE,
        Key={"job_id": {"S": job_id}},
        UpdateExpression="SET " + ", ".join(expr),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    if require_existing:
        params["ConditionExpression"] = "attribute_exists(job_id)"

    try:
        resp = DDB.update_item(**params)
        new_status = (resp.get("Attributes", {}).get("status") or {}).get("S")
        if new_status:
            print({"where": "update_ok", "job_id": job_id, "status": new_status})
    except ClientError as e:
        print({
            "where": "update_item_failed",
            "table": JOBS_TABLE,
            "aws_region": os.environ.get("AWS_REGION"),
            "job_id": job_id,
            "fields": list(fields.keys()),
            "error": str(e),
        })
        raise

def _update_step(job: Dict[str, Any], step: str, **patch) -> None:
    steps = job["steps"]
    s = steps.get(step, {})
    s.update(patch)
    steps[step] = s
    _update_job(job["job_id"], require_existing=True, steps=steps)

# Kept for compatibility (unused after JSON standardization)
def _append_jsonl(s3_key: str, records: List[Dict]) -> None:
    data = "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in records).encode("utf-8")
    S3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=data, ContentType="application/x-ndjson")

# ---- Unified JSON writers ----
def _put_json_obj(key: str, obj: Dict[str, Any]) -> None:
    S3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(obj, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
    )

def _put_json_arr(key: str, arr: List[Dict[str, Any]]) -> None:
    S3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(arr, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
    )

def _sgt_today_label() -> str:
    now = datetime.now(TZ_SGT)
    if now.hour < GRACE_HOUR:
        adj = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        return adj.strftime("%Y-%m-%d")
    return now.strftime("%Y-%m-%d")

def _s3_day_folder(kind: str) -> str:
    # Map logical kind to renamed folder name
    day = _sgt_today_label()
    physical = FOLDER_NAMES.get(kind, kind)
    return f"{S3_PREFIX}/agent/{physical}/dt={day}"

def _s3_part(kind: str) -> str:
    # retained for compatibility; not used now that we write single JSON files
    return f"{_s3_day_folder(kind)}/part-000.jsonl"

def _http_json(url: str, token: Optional[str] = None, method: str = "GET",
               payload: Optional[Dict] = None, timeout: int = 30) -> Dict[str, Any]:
    req = urllib.request.Request(url, method=method)
    req.add_header("Accept", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    else:
        body = None
    try:
        with urllib.request.urlopen(req, data=body, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "ignore")
        except Exception:
            pass
        print({
            "where": "http_error",
            "status": getattr(e, "code", None),
            "url": url,
            "body_snip": body[:300]
        })
        raise RuntimeError(f"HTTP {getattr(e, 'code', None)} {url}") from e
    except urllib.error.URLError as e:
        print({"where": "http_url_error", "url": url, "error": str(e)})
        raise RuntimeError(f"HTTP error {url}: {e}") from e

def _maybe_push_ws(event: Dict[str, Any]) -> None:
    if not WS_API_URL:
        return
    try:
        _http_json(WS_API_URL, method="POST", payload=event, timeout=5)
    except Exception:
        pass  # best-effort

# -------- Token helpers --------
def _extract_token(container: Optional[Dict[str, Any]]) -> Optional[str]:
    """
    Extract a bearer token from various possible fields:
    - "Authorization": "Bearer <token>"
    - "user_token" / "access_token" / "id_token"
    Returns the bare token string (no 'Bearer '), or None.
    """
    if not isinstance(container, dict):
        return None

    auth = container.get("Authorization") or container.get("authorization")
    if isinstance(auth, str) and auth.strip():
        s = auth.strip()
        if s.lower().startswith("bearer "):
            return s[7:].strip()
        return s.strip()

    for k in ("user_token", "access_token", "id_token"):
        v = container.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()

    return None

def _auth_token(job: Dict[str, Any], sqs_msg: Optional[Dict[str, Any]] = None) -> Optional[str]:
    tok = _extract_token(sqs_msg) or (job.get("user_token") or "").strip()
    tok = tok or SERVICE_TOKEN
    return tok or None

def _to_unix(v) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except Exception:
        return None

# -------- S3 purge helpers --------
def _delete_prefix(prefix: str) -> int:
    deleted = 0
    token = None
    while True:
        kw = {"Bucket": S3_BUCKET, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = S3.list_objects_v2(**kw)
        keys = [{"Key": obj["Key"]} for obj in resp.get("Contents", [])]
        if keys:
            for i in range(0, len(keys), 1000):
                batch = {"Objects": keys[i:i+1000], "Quiet": True}
                S3.delete_objects(Bucket=S3_BUCKET, Delete=batch)
                deleted += len(batch["Objects"])
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            break
    return deleted

def _purge_day_folder(kind: str) -> int:
    folder = f"{_s3_day_folder(kind)}/"
    return _delete_prefix(folder)

# ======================== Steps ========================
def _run_trends(job: Dict[str, Any], msg: Dict[str, Any]) -> None:
    step = "trends_fetch"
    _update_step(job, step, status="running", message="Retrieving Google Trends (week + forecast)…", progress=0.0)
    _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Retrieving Google Trends (week + forecast)…"})

    token = _auth_token(job, msg)

    # token diagnostics (safe)
    try:
        pay = _peek_jwt(token).get("payload", {}) if token else {}
        print({
            "where": "worker_token_probe",
            "step": step,
            "token_use": pay.get("token_use"),
            "scope": pay.get("scope"),
            "aud": pay.get("aud"),
            "client_id": pay.get("client_id"),
            "has_email": "email" in pay,
            "iss": pay.get("iss")
        })
    except Exception:
        print({"where": "worker_token_probe", "step": step, "note": "token_peek_failed"})

    if PURGE_BEFORE_WRITE:
        _update_step(job, step, message="Cleaning previous trends outputs…")
        _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Cleaning previous trends outputs…"})
        _purge_day_folder("trends")

    catalog = _http_json(f"{API_BASE}/trends/daily?mode=catalog", token=token)
    slugs: List[str] = []
    if isinstance(catalog, dict) and "slugs" in catalog:
        for c in catalog["slugs"]:
            slugs.append(c["slug"] if isinstance(c, dict) else str(c))
    elif isinstance(catalog, list):
        for c in catalog:
            slugs.append(c["slug"] if isinstance(c, dict) else str(c))
    slugs = slugs[:6]
    if not slugs:
        raise RuntimeError("No fresh slugs")

    j = _http_json(
        f"{API_BASE}/trends/daily?mode=series&slugs={','.join(slugs)}&g=day&window=week&include_forecast=true&forecast_days=7",
        token=token,
    )

    folder      = _s3_day_folder("trends")
    series_key  = f"{folder}/series.json"
    rows_key    = f"{folder}/rows.json"

    # write raw series.json
    S3.put_object(
        Bucket=S3_BUCKET,
        Key=series_key,
        Body=json.dumps(j, separators=(",",":")).encode("utf-8"),
        ContentType="application/json",
    )

    rows = j.get("rows") or []
    out_long = [{
        "job_id": job["job_id"],
        "source": "trends",
        "period": r.get("period"),
        "slug": r.get("slug"),
        "interest": r.get("interest"),
        "granularity": j.get("granularity", "day"),
        "end": j.get("end"),
        "ts_ingested": _iso_now(),
    } for r in rows]

    _put_json_arr(rows_key, out_long)

    _update_step(
        job, step,
        status="succeeded",
        message=f"Google Trends written ({len(out_long)} rows; week+forecast)",
        s3_keys=[f"s3://{S3_BUCKET}/{series_key}", f"s3://{S3_BUCKET}/{rows_key}"]
    )
    _maybe_push_ws({"type":"trends.updated"})

def _run_prices(job: Dict[str, Any], msg: Dict[str, Any]) -> None:
    step = "prices_fetch"
    _update_step(job, step, status="running", message="Fetching price series (week window)…", progress=0.0)
    _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Fetching price series (week window)…"})

    token = _auth_token(job, msg)

    # token diagnostics (safe)
    try:
        pay = _peek_jwt(token).get("payload", {}) if token else {}
        print({
            "where": "worker_token_probe",
            "step": step,
            "token_use": pay.get("token_use"),
            "scope": pay.get("scope"),
            "aud": pay.get("aud"),
            "client_id": pay.get("client_id"),
            "has_email": "email" in pay,
            "iss": pay.get("iss")
        })
    except Exception:
        print({"where": "worker_token_probe", "step": step, "note": "token_peek_failed"})

    if PURGE_BEFORE_WRITE:
        _update_step(job, step, message="Cleaning previous prices outputs…")
        _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Cleaning previous prices outputs…"})
        _purge_day_folder("prices")

    # Pull the whole week window (no collapse to latest)
    j = _http_json(f"{API_BASE}/watchlist/series?range=week", token=token)
    series = j.get("series") or []
    declared_products = set(j.get("products") or [])

    # Union of products seen across all series rows
    found_products = set()
    for row in series:
        for k, v in row.items():
            if k == "bucket":
                continue
            if isinstance(v, (int, float)):
                found_products.add(k)

    products = sorted(declared_products.union(found_products))

    # Sort series by bucket asc
    def _b_ts(row): return _to_unix(row.get("bucket")) or 0
    series.sort(key=_b_ts)

    folder = _s3_day_folder("prices")
    key = f"{folder}/series.json"

    _put_json_obj(key, {
        "job_id": job["job_id"],
        "range": "week",
        "products": products,
        "series": series,  # [{bucket, <product>: avg_price, ...}]
        "ts_ingested": _iso_now(),
    })

    _update_step(job, step, status="succeeded",
                 message=f"Price series (week window) written: {len(series)} buckets, {len(products)} products",
                 s3_keys=[f"s3://{S3_BUCKET}/{key}"])
    _maybe_push_ws({"type":"agent.step_succeeded","job_id":job["job_id"],"step":step,
                    "message":"Price series (week window) written","s3_keys":[f"s3://{S3_BUCKET}/{key}"]})

def _run_watchlist(job: Dict[str, Any], msg: Dict[str, Any]) -> None:
    step = "watchlist_refresh"
    _update_step(job, step, status="running", message="Refreshing watchlist (latest 2 per product)…", progress=0.0)
    _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Refreshing watchlist (latest 2 per product)…"})

    token = _auth_token(job, msg)

    # token diagnostics (safe)
    try:
        pay = _peek_jwt(token).get("payload", {}) if token else {}
        print({
            "where": "worker_token_probe",
            "step": step,
            "token_use": pay.get("token_use"),
            "scope": pay.get("scope"),
            "aud": pay.get("aud"),
            "client_id": pay.get("client_id"),
            "has_email": "email" in pay,
            "iss": pay.get("iss")
        })
    except Exception:
        print({"where": "worker_token_probe", "step": step, "note": "token_peek_failed"})

    if PURGE_BEFORE_WRITE:
        _update_step(job, step, message="Cleaning previous watchlist outputs…")
        _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Cleaning previous watchlist outputs…"})
        _purge_day_folder("watchlist")

    items: List[Dict[str, Any]] = []
    cursor_ts: Optional[str] = None
    cursor_id: Optional[int] = None
    for _ in range(5):
        url = f"{API_BASE}/watchlist?limit=200"
        if cursor_ts and cursor_id is not None:
            url += f"&after_ts={cursor_ts}&after_id={cursor_id}"
        page = _http_json(url, token=token)
        items.extend(page.get("items") or [])
        nxt = page.get("next_cursor")
        if not nxt:
            break
        cursor_ts, cursor_id = nxt.get("after_ts"), nxt.get("after_id")

    seen_by_url: Dict[str, Tuple[int, Dict[str, Any]]] = {}
    for r in items:
        url = (r.get("url") or "").strip()
        if not url:
            continue
        key = url.lower().rstrip("/")
        ts = _to_unix(r.get("updated_at")) or 0
        prev = seen_by_url.get(key)
        if not prev or ts > prev[0]:
            seen_by_url[key] = (ts, r)
    deduped = [r for _, r in seen_by_url.values()]

    by_product: Dict[str, List[Dict[str, Any]]] = {}
    for r in deduped:
        p = (r.get("product") or "").strip() or "__UNKNOWN__"
        by_product.setdefault(p, []).append(r)

    out: List[Dict[str, Any]] = []
    for prod, arr in by_product.items():
        arr.sort(key=lambda r: _to_unix(r.get("updated_at")) or 0, reverse=True)
        top2 = arr[:2]
        for idx, r in enumerate(top2, start=1):
            out.append({
                "job_id": job["job_id"],
                "source": "watchlist",
                "url": r.get("url"),
                "product": r.get("product"),
                "price": r.get("price"),
                "stock_status": r.get("stock_status"),
                "image_url": r.get("image_url"),
                "updated_at": _to_unix(r.get("updated_at")),
                "rank": idx,
                "ts_ingested": _iso_now(),
            })

    key = f"{_s3_day_folder('watchlist')}/rows.json"
    _put_json_arr(key, out)

    _update_step(job, step, status="succeeded",
                 message=f"Watchlist (latest 2 per product) written: {len(out)} rows",
                 s3_keys=[f"s3://{S3_BUCKET}/{key}"])
    _maybe_push_ws({"type":"agent.step_succeeded","job_id":job["job_id"],"step":step,
                    "message":"Watchlist (latest 2 per product) written","s3_keys":[f"s3://{S3_BUCKET}/{key}"]})

def _run_social(job: Dict[str, Any], msg: Dict[str, Any]) -> None:
    step = "social_listening"
    _update_step(job, step, status="running", message="Social listening ingest…", progress=0.0)
    _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Social listening ingest…"})

    token = _auth_token(job, msg)

    # token diagnostics (safe)
    try:
        pay = _peek_jwt(token).get("payload", {}) if token else {}
        print({
            "where": "worker_token_probe",
            "step": step,
            "token_use": pay.get("token_use"),
            "scope": pay.get("scope"),
            "aud": pay.get("aud"),
            "client_id": pay.get("client_id"),
            "has_email": "email" in pay,
            "iss": pay.get("iss")
        })
    except Exception:
        print({"where": "worker_token_probe", "step": step, "note": "token_peek_failed"})

    if PURGE_BEFORE_WRITE:
        _update_step(job, step, message="Cleaning previous social outputs…")
        _maybe_push_ws({"type":"agent.step_progress","job_id":job["job_id"],"step":step,"status":"running","message":"Cleaning previous social outputs…"})
        _purge_day_folder("social")

    try:
        brandsRes = _http_json(f"{API_BASE}/social/brands?limit=10", token=token)
        inflRes   = _http_json(f"{API_BASE}/social/influencers?limit=10", token=token)
        tagsRes   = _http_json(f"{API_BASE}/social/hashtags?limit=20", token=token)
        sentRes   = _http_json(f"{API_BASE}/social/sentiment", token=token)

        brands = (brandsRes.get("brands") or [])
        infls  = (inflRes.get("influencers") or [])
        tags   = (tagsRes.get("hashtags") or [])
        senti  = (sentRes.get("platforms") or {})

    except Exception as e:
        raise RuntimeError(f"Social API fetch failed: {e}") from e

    folder = _s3_day_folder("social")
    keys_written: List[str] = []

    def _put_json(name: str, obj: Dict[str, Any]) -> str:
        key = f"{folder}/{name}.json"
        S3.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=json.dumps(obj, separators=(",",":")).encode("utf-8"),
            ContentType="application/json",
        )
        keys_written.append(f"s3://{S3_BUCKET}/{key}")
        return key

    _put_json("brands", {"brands": brands})
    _put_json("influencers", {"influencers": infls})
    _put_json("hashtags", {"hashtags": tags})
    _put_json("sentiment", {"platforms": senti})

    rows_key = f"{folder}/rows.json"
    nd_rows: List[Dict[str, Any]] = []

    for b in brands:
        nd_rows.append({
            "source": "social.brand",
            "brand": b.get("brand"),
            "mention_count": b.get("mention_count"),
            "total_engagement": b.get("total_engagement"),
            "sentiment": b.get("sentiment"),
            "ts_ingested": _iso_now(),
            "job_id": job["job_id"],
        })

    for inf in infls:
        nd_rows.append({
            "source": "social.influencer",
            "handle": inf.get("handle"),
            "posts": inf.get("posts"),
            "avg_engagement": inf.get("avg_engagement"),
            "influence_score": inf.get("influence_score"),
            "products_mentioned": inf.get("products_mentioned"),
            "ts_ingested": _iso_now(),
            "job_id": job["job_id"],
        })

    for t in tags:
        nd_rows.append({
            "source": "social.hashtag",
            "hashtag": t.get("hashtag"),
            "post_count": t.get("post_count"),
            "total_engagement": t.get("total_engagement"),
            "ts_ingested": _iso_now(),
            "job_id": job["job_id"],
        })

    for platform, stats in (senti or {}).items():
        nd_rows.append({
            "source": "social.sentiment",
            "platform": platform,
            "total": stats.get("total"),
            "positive_pct": stats.get("positive_pct"),
            "neutral_pct": stats.get("neutral_pct"),
            "negative_pct": stats.get("negative_pct"),
            "ts_ingested": _iso_now(),
            "job_id": job["job_id"],
        })

    if nd_rows:
        _put_json_arr(rows_key, nd_rows)
        keys_written.append(f"s3://{S3_BUCKET}/{rows_key}")

    _update_step(
        job, step,
        status="succeeded",
        message=f"Social data ingested (brands={len(brands)}, influencers={len(infls)}, hashtags={len(tags)}, platforms={len(senti)})",
        s3_keys=keys_written
    )
    _maybe_push_ws({"type":"agent.step_succeeded","job_id":job["job_id"],"step":step,
                    "message":"Social data ingested","s3_keys":keys_written})

# ======================== Handler ========================
def lambda_handler(event, context):
    # SQS batch
    for rec in event.get("Records", []):
        msg = json.loads(rec["body"])
        job_id = msg["job_id"]
        job = _get_job(job_id)
        if not job:
            print({"skip": "job_not_found", "job_id": job_id})
            continue

        # Persist token from SQS once for visibility/continuations
        token_from_msg = _extract_token(msg) or ""
        if token_from_msg and not job.get("user_token"):
            _update_job(job_id, require_existing=True, user_token=token_from_msg)
            job = _get_job(job_id) or job

        if job["status"] in ("succeeded", "failed", "cancelled"):
            print({"skip": "job_already_terminal", "job_id": job_id, "status": job["status"]})
            continue

        _update_job(job_id, require_existing=True, status="running", started_at=_iso_now())
        _maybe_push_ws({"type": "agent.job_started", "job_id": job_id, "ts": _iso_now()})

        steps_order = ["trends_fetch", "prices_fetch", "watchlist_refresh", "social_listening"]
        final_status = "succeeded"
        errors: List[Dict[str, Any]] = []

        for step in steps_order:
            job = _get_job(job_id) or job
            if job.get("cancel_requested"):
                final_status = "cancelled"
                _update_step(job, step, status="cancelled", message="Cancelled by user")
                break

            try:
                if step == "trends_fetch":
                    _run_trends(job, msg)
                elif step == "prices_fetch":
                    _run_prices(job, msg)
                elif step == "watchlist_refresh":
                    _run_watchlist(job, msg)
                elif step == "social_listening":
                    _run_social(job, msg)
            except Exception as e:
                final_status = "failed"
                emsg = str(e)
                job = _get_job(job_id) or {"job_id": job_id, "steps": {}}
                _update_step(job, step, status="failed", message=emsg, error_code="STEP_ERROR")
                _maybe_push_ws({"type":"agent.step_failed","job_id":job_id,"step":step,
                                "error_code":"STEP_ERROR","message":emsg})
                errors.append({"step": step, "message": emsg})
                break

        ended_at = _iso_now()
        _update_job(job_id, require_existing=True, status=final_status, ended_at=ended_at, errors=errors)

        # Job manifest removed to save space
        _maybe_push_ws({
            "type": "agent.job_completed",
            "job_id": job_id,
            "overall": final_status,
        })
