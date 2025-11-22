import os
import json
import logging
    return f"https://{bucket}.s3.amazonaws.com/{quoted_key}"

def graph_request(path: str, params: dict, method: str = "POST") -> dict:
    """Standard wrapper for Graph API calls using urllib"""
    if method.upper() == "GET":
        qs = urllib.parse.urlencode(params)
        url = f"{FB_GRAPH_BASE}/{path}?{qs}"
        data = None
    else:
        url = f"{FB_GRAPH_BASE}/{path}"
        body = urllib.parse.urlencode(params)
        data = body.encode("utf-8")

    log.info(f"API Call: {method} {url}")

    req = urllib.request.Request(url, data=data, method=method.upper())
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="ignore")
        log.error(f"Graph API Error {e.code}: {raw}")
        # Raise explicit error with detail
        raise Exception(f"Graph API Error {e.code}: {raw}")
    except Exception as e:
        log.error(f"Network Error: {e}")
        raise

# --- Posting Logic ---

def post_to_facebook(caption, image_url):
    """Direct 1-step post to Facebook Page Feed"""
    if not FB_PAGE_ID:
        return {"status": "skipped", "reason": "Missing FB_PAGE_ID"}
        
    log.info("Posting to Facebook...")
    res = graph_request(
        f"{FB_PAGE_ID}/photos",
        {
            "caption": caption,
            "url": image_url,
            "access_token": FB_PAGE_ACCESS_TOKEN,
            "published": "true",
        },
        method="POST"
    )
    # Attempt to get permalink (optional)
    post_id = res.get("post_id") or res.get("id")
    permalink = None
    if post_id:
        try:
            meta = graph_request(
                post_id,
                {"fields": "permalink_url", "access_token": FB_PAGE_ACCESS_TOKEN},
                method="GET"
            )
            permalink = meta.get("permalink_url")
        except:
            pass
            
    return {"status": "success", "post_id": post_id, "permalink": permalink}

def post_to_instagram(caption, image_url):
    """2-step post to Instagram Feed"""
    if not IG_USER_ID:
        return {"status": "skipped", "reason": "Missing IG_USER_ID"}

    log.info("Posting to Instagram...")
    
    # Step 1: Create Container
    container_res = graph_request(
        f"{IG_USER_ID}/media",
        {
            "image_url": image_url,
            "caption": caption,
            "access_token": FB_PAGE_ACCESS_TOKEN
        },
        method="POST"
    )
    
    creation_id = container_res.get("id")
    if not creation_id:
        raise Exception(f"Container creation failed: {container_res}")

    # Wait a brief moment for processing (sometimes needed for large images)
    # In a real production app, you might query the status, but a short sleep usually works for photos.
    time.sleep(2)

    # Step 2: Publish Container
    publish_res = graph_request(
        f"{IG_USER_ID}/media_publish",
        {
            "creation_id": creation_id,
            "access_token": FB_PAGE_ACCESS_TOKEN
        },
        method="POST"
    )
    
    # Attempt to get permalink
    media_id = publish_res.get("id")
    permalink = None
    if media_id:
        try:
            meta = graph_request(
                media_id,
                {"fields": "permalink,shortcode", "access_token": FB_PAGE_ACCESS_TOKEN},
                method="GET"
            )
            permalink = meta.get("permalink")
        except:
            pass

    return {"status": "success", "media_id": media_id, "permalink": permalink}

# --- Main Handler ---

def lambda_handler(event, context):
    log.info(f"Event: {json.dumps(event)}")

    if not FB_PAGE_ACCESS_TOKEN:
        return {"statusCode": 500, "body": json.dumps({"error": "Server missing Access Token"})}

    # 1. Parse Body
    try:
        if "body" in event:
            body = event["body"]
            if event.get("isBase64Encoded"):
                body = base64.b64decode(body).decode("utf-8")
            payload = json.loads(body)
        else:
            payload = event
    except Exception as e:
        return {"statusCode": 400, "body": json.dumps({"error": "Invalid JSON body"})}

    # 2. Get Data
    slogan = payload.get("slogan")
    image_url = payload.get("image_url")
    
    # Construct S3 URL if direct URL missing
    if not image_url:
        bucket = payload.get("image_bucket")
        key = payload.get("image_key")
        if bucket and key:
            image_url = build_s3_url(bucket, key)
    
    if not slogan or not image_url:
        return {"statusCode": 400, "body": json.dumps({"error": "Missing 'slogan' or image details"})}

    results = {}

    # 3. Execute Facebook Post
    try:
        results["facebook"] = post_to_facebook(slogan, image_url)
    except Exception as e:
        log.error(f"Facebook Post Failed: {e}")
        results["facebook"] = {"status": "error", "error": str(e)}

    # 4. Execute Instagram Post
    try:
        results["instagram"] = post_to_instagram(slogan, image_url)
    except Exception as e:
        log.error(f"Instagram Post Failed: {e}")
        results["instagram"] = {"status": "error", "error": str(e)}

    # 5. Determine overall status code (200 if at least one succeeded)
    status_code = 200
    if results.get("facebook", {}).get("status") == "error" and \
       results.get("instagram", {}).get("status") == "error":
        status_code = 502

    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(results)
    }