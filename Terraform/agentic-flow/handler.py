import base64
import boto3
import json
import logging
import os
import time
import re
import urllib.request
import urllib.error
from botocore.exceptions import ClientError

# ---------- Config / clients ----------

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.getLogger().setLevel(LOG_LEVEL)
log = logging.getLogger(__name__)

REGION = os.getenv("AWS_REGION") or os.getenv("BEDROCK_REGION", "us-east-1")

# S3 buckets
IMAGE_BUCKET = os.environ["IMAGE_BUCKET"]        # input bucket (reference images)
OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]      # output bucket (generated images)

# Bedrock KB + text model (for slogans)
KB_ID = os.environ["KB_ID"]                      # Bedrock Knowledge Base ID

TEXT_MODEL_ID = os.getenv(
    "TEXT_MODEL_ID",
    "amazon.titan-text-lite-v1"                  # or amazon.titan-text-express-v1
)

# Gemini image model (Nano Banana) - API key from Secrets Manager
GEMINI_SECRET_ARN = os.environ["GEMINI_SECRET_ARN"]  # full ARN of the secret
GEMINI_MODEL_ID = os.getenv(
    "GEMINI_MODEL_ID",
    "gemini-2.5-flash-image"                     # Nano Banana
)

# Defaults / tuning
DEFAULT_IMAGE_PROMPT = os.getenv(
    "DEFAULT_IMAGE_PROMPT",
    "High-end studio hero shot of the product on a clean background, "
    "soft lighting, glossy highlights, suitable for e-commerce banner."
)

SLOGAN_MAX_WORDS = int(os.getenv("SLOGAN_MAX_WORDS", "12"))

s3 = boto3.client("s3", region_name=REGION)
bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)
bedrock_kb = boto3.client("bedrock-agent-runtime", region_name=REGION)
secretsmanager = boto3.client("secretsmanager", region_name=REGION)

# simple in-memory cache for the Gemini key
_gemini_api_key_cache = None


def get_gemini_api_key() -> str:
    """
    Load Gemini API key from AWS Secrets Manager once and cache it.
    Assumes the secret string is JSON like {"api-key": "..."}.
    If it's plain text, uses the whole string as the key.
    """
    global _gemini_api_key_cache
    if _gemini_api_key_cache:
        return _gemini_api_key_cache

    log.info("Loading Gemini API key from Secrets Manager: %s", GEMINI_SECRET_ARN)

    try:
        resp = secretsmanager.get_secret_value(SecretId=GEMINI_SECRET_ARN)
    except ClientError:
        log.exception("Failed to retrieve Gemini API key from Secrets Manager")
        raise

    secret_str = resp.get("SecretString")
    if not secret_str:
        raise RuntimeError("SecretString is empty for Gemini secret")

    # Expecting {"api-key": "AIza..."}
    api_key = None
    try:
        secret_json = json.loads(secret_str)
        # use the "api-key" field as requested
        api_key = secret_json.get("api-key")
    except json.JSONDecodeError:
        # If you stored plain text instead of JSON, use it directly
        api_key = secret_str

    if not api_key:
        raise RuntimeError("Gemini API key not found in secret (expected key 'api-key')")

    _gemini_api_key_cache = api_key.strip()
    return _gemini_api_key_cache


# ---------- helper: event parsing ----------

def _parse_event(event):
    """
    Support both direct Lambda invoke and API Gateway proxy (HTTP) style.
    Returns a dict payload.
    """
    if "body" in event:
        body = event["body"]
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            log.error("Could not parse JSON body, returning empty dict.")
            return {}
    else:
        return event or {}


# ---------- helper: S3 I/O ----------

def load_image_from_s3(bucket, key) -> bytes:
    """Download image bytes from S3."""
    log.info("Loading reference image from s3://%s/%s", bucket, key)
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()
    except ClientError:
        log.exception("Failed to load image from S3")
        raise


def save_image_to_s3(bucket, key, image_bytes: bytes) -> None:
    """Save generated image bytes to S3 (as PNG)."""
    log.info("Saving generated image to s3://%s/%s", bucket, key)
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=image_bytes,
        ContentType="image/png"
    )


# ---------- helper: Titan Text ----------

def titan_generate_text(prompt: str) -> str:
    """
    Call a Titan Text model (Lite/Express) to generate text.
    """
    body = {
        "inputText": prompt,
        "textGenerationConfig": {
            "maxTokenCount": 128,
            "temperature": 0.7,
            "topP": 0.9,
        },
    }

    resp = bedrock_runtime.invoke_model(
        modelId=TEXT_MODEL_ID,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )

    resp_body = json.loads(resp["body"].read())
    # Titan Text response shape: results[0].outputText
    text = (
        resp_body.get("results", [{}])[0]
        .get("outputText", "")
        .strip()
    )
    return text


def clean_slogan(raw: str) -> str:
    """
    Extract a single, clean slogan from the model output:
    - Prefer the first quoted sentence if present
    - Otherwise, use the first non-empty line
    - Strip labels like 'Slogan:' etc
    - Strip wrapping quotes
    - Clamp word count
    """
    if not raw:
        return raw

    text = raw.strip()

    # 1) If there's a quoted sentence, take the first one
    m = re.search(r'"([^"]{3,200})"', text)
    if m:
        text = m.group(1).strip()
    else:
        # 2) Otherwise, take the first non-empty line
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if lines:
            text = lines[0]
        else:
            text = raw.strip()

    # 3) Remove leading labels like "Slogan:", "Here's a marketing slogan..."
    lower = text.lower()
    prefixes = [
        "slogan:",
        "tagline:",
        "headline:",
        "here's a marketing slogan for the product:",
        "here is a marketing slogan for the product:",
    ]
    for prefix in prefixes:
        if lower.startswith(prefix):
            text = text[len(prefix):].strip()
            break

    # 4) Strip wrapping quotes again if they re-appeared
    if (text.startswith('"') and text.endswith('"')) or (
        text.startswith("'") and text.endswith("'")
    ):
        text = text[1:-1].strip()

    # 5) Final safety clamp on word count
    words = text.split()
    if len(words) > SLOGAN_MAX_WORDS:
        text = " ".join(words[:SLOGAN_MAX_WORDS])

    return text


# ---------- helper: KB + Titan Text to make slogan ----------

def generate_slogan_with_kb(product_query: str) -> str:
    """
    1) Use Bedrock Knowledge Base to RETRIEVE relevant chunks
    2) Feed those chunks + product info into Titan Text to generate a slogan
    """

    question = (
        f"Brand and marketing information for this product: {product_query}. "
        f"Return any brand voice, tone, positioning, key benefits and taglines."
    )

    log.info("Retrieving context from KB %s", KB_ID)

    # --- Step 1: retrieve chunks from KB (no generation here) ---
    retrieve_resp = bedrock_kb.retrieve(
        knowledgeBaseId=KB_ID,
        retrievalQuery={"text": question},
        retrievalConfiguration={
            "vectorSearchConfiguration": {
                "numberOfResults": 5  # small to keep token+cost low
            }
        },
    )

    chunks = []
    for r in retrieve_resp.get("retrievalResults", []):
        txt = r.get("content", {}).get("text")
        if txt:
            chunks.append(txt)

    log.info("KB retrieval returned %d chunks", len(chunks))

    context = "\n\n".join(chunks)
    # keep context reasonably short to avoid wasting tokens
    if len(context) > 4000:
        context = context[:4000]

    log.debug("KB context (first 500 chars): %s", context[:500])

    # --- Step 2: ask Titan Text to write the slogan using that context ---
    prompt = f"""
You are a professional skincare and wellness brand copywriter.

Context:
{context}

Product: {product_query}

Task:
- Use ONLY the information in the context to understand:
  - Brand voice and tone
  - Product benefits
  - Target customer
- Then write ONE short marketing slogan for this product.

Tone:
- Warm, encouraging, and benefit-focused.
- Concrete, not vague.
- Stay aligned with the claims and language in the context.

Formatting rules (VERY IMPORTANT):
- Respond with EXACTLY ONE sentence.
- Output ONLY the slogan text.
- Do NOT include any labels like "Slogan:" or "Tagline:".
- Do NOT include quotation marks around the slogan.
- Do NOT add explanations, bullet points, or follow-up questions.
- Maximum {SLOGAN_MAX_WORDS} words.
"""

    raw_slogan = titan_generate_text(prompt)
    if not raw_slogan:
        raise RuntimeError("Titan text returned empty slogan.")

    slogan = clean_slogan(raw_slogan)

    log.info("Generated raw slogan: %s", raw_slogan)
    log.info("Cleaned slogan: %s", slogan)
    return slogan


# ---------- helper: mime type from key ----------

def guess_mime_type_from_key(key: str) -> str:
    lower = key.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    # Fallback
    return "image/png"


# ---------- helper: Gemini image generation (Nano Banana) ----------

def generate_marketing_image_with_gemini(reference_image_bytes: bytes,
                                         text_prompt: str,
                                         image_key: str) -> bytes:
    """
    Call Gemini 2.5 Flash Image (Nano Banana) via REST.
    We send:
      - inline image (base64) as inlineData
      - text prompt describing desired style / edits

    We then parse the first inlineData image from the response.
    """

    log.info("Calling Gemini model %s for image generation", GEMINI_MODEL_ID)

    img_b64 = base64.b64encode(reference_image_bytes).decode("utf-8")
    mime_type = guess_mime_type_from_key(image_key)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL_ID}:generateContent"

    gemini_api_key = get_gemini_api_key()

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini_api_key,
    }

    body = {
        "contents": [
            {
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": img_b64,
                        }
                    },
                    {
                        "text": text_prompt
                    }
                ]
            }
        ]
    }

    data_bytes = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp_body = resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        log.error("Gemini HTTP error %s: %s", e.code, err_body)
        raise RuntimeError(f"Gemini HTTP error {e.code}: {err_body}") from e
    except urllib.error.URLError as e:
        log.error("Gemini URL error: %s", str(e))
        raise RuntimeError(f"Gemini URL error: {e}") from e

    try:
        resp_json = json.loads(resp_body)
    except json.JSONDecodeError:
        log.error("Failed to parse Gemini response as JSON: %s", resp_body[:500])
        raise RuntimeError("Gemini response was not valid JSON")

    # Expect: candidates[0].content.parts[*].inlineData.data (base64)
    candidates = resp_json.get("candidates", [])
    if not candidates:
        log.error("Gemini returned no candidates: %s", resp_json)
        raise RuntimeError("Gemini returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    image_b64 = None
    for p in parts:
        inline = p.get("inlineData") or p.get("inline_data")
        if inline and "data" in inline:
            image_b64 = inline["data"]
            break

    if not image_b64:
        log.error("Gemini response contained no inline image data: %s", resp_json)
        raise RuntimeError("Gemini returned no image data in response")

    image_bytes = base64.b64decode(image_b64.encode("utf-8"))
    log.info("Generated image bytes from Gemini: %d bytes", len(image_bytes))
    return image_bytes


# ---------- Lambda handler ----------

def lambda_handler(event, context):
    """
    Expected payload (direct invoke or API Gateway JSON body):

    {
      "image_key": "Spirulina Cream.jpg",        # required (in IMAGE_BUCKET)
      "product_query": "Foot cream for dry, cracked heels",  # optional
      "image_bucket": "override-bucket-name",    # optional override input bucket
      "custom_prompt": "optional override for hero shot prompt"
    }
    """
    log.info("Event: %s", json.dumps(event))

    payload = _parse_event(event)

    image_key = payload.get("image_key")
    if not image_key:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "image_key is required"})
        }

    image_bucket = payload.get("image_bucket") or IMAGE_BUCKET
    product_query = payload.get("product_query", image_key)
    custom_prompt = payload.get("custom_prompt", DEFAULT_IMAGE_PROMPT)

    try:
        # 1) Generate slogan from KB + Titan Text
        slogan = generate_slogan_with_kb(product_query)

        # 2) Load reference image from S3
        ref_bytes = load_image_from_s3(image_bucket, image_key)

        # 3) Generate marketing image via Gemini 2.5 Flash Image
        hero_prompt = (
            f"{custom_prompt} "
            f"Use the same product as in the reference image, "
            f"do not change the logo or label text. "
            f"Composition should highlight the product as main subject. Be creative about the way you want to present it"
        )
        gen_bytes = generate_marketing_image_with_gemini(
            ref_bytes, hero_prompt, image_key
        )

        # 4) Save new image to OUTPUT_BUCKET
        timestamp = int(time.time())
        base_name = os.path.splitext(os.path.basename(image_key))[0]
        output_key = f"generated/{base_name}-{timestamp}.png"
        save_image_to_s3(OUTPUT_BUCKET, output_key, gen_bytes)

        result = {
            "slogan": slogan,
            "output_bucket": OUTPUT_BUCKET,
            "output_key": output_key,
        }

        # If front-end via API Gateway, wrap in HTTP response
        if "body" in event:
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(result)
            }
        else:
            return result

    except Exception as e:
        log.exception("Error in marketing generation pipeline")
        error_body = {"error": str(e)}
        if "body" in event:
            return {
                "statusCode": 500,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(error_body)
            }
        else:
            return error_body
