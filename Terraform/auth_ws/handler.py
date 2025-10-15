# Runtime: Python 3.12
# Dependencies: python-jose==3.3.0  (see requirements.txt below)
#
# Env vars required:
#   COGNITO_REGION          e.g., "us-east-1"
#   COGNITO_USER_POOL_ID    e.g., "us-east-1_Abc123XYZ"
#   COGNITO_APP_CLIENT_ID   e.g., "7abc...clientid"
# Optional:
#   ACCEPT_ACCESS_TOKEN     "true" to accept access tokens instead of ID tokens

import json, os, time, logging, base64
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from jose import jwk, jwt
from jose.utils import base64url_decode

log = logging.getLogger()
log.setLevel(logging.INFO)

REGION = os.environ["COGNITO_REGION"]
USER_POOL_ID = os.environ["COGNITO_USER_POOL_ID"]
APP_CLIENT_ID = os.environ["COGNITO_APP_CLIENT_ID"]
ACCEPT_ACCESS_TOKEN = os.getenv("ACCEPT_ACCESS_TOKEN", "false").lower() == "true"

ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}"
JWKS_URL = f"{ISSUER}/.well-known/jwks.json"

# ---- Simple in-memory cache for JWKS across warm invocations
_JWKS_CACHE = {"fetched_at": 0, "jwks": None}
_JWKS_TTL_SECONDS = 60 * 60  # 1 hour

def _fetch_jwks():
    now = time.time()
    if _JWKS_CACHE["jwks"] and now - _JWKS_CACHE["fetched_at"] < _JWKS_TTL_SECONDS:
        return _JWKS_CACHE["jwks"]

    req = Request(JWKS_URL, headers={"User-Agent": "lambda-authorizer/1.0"})
    with urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    _JWKS_CACHE["jwks"] = data
    _JWKS_CACHE["fetched_at"] = now
    return data

def _deny(method_arn, principal="unauthorized"):
    return {
        "principalId": principal,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{"Action": "execute-api:Invoke", "Effect": "Deny", "Resource": method_arn}],
        },
        "context": {"reason": "denied"},
    }

def _allow(method_arn, principal, ctx):
    # All values in 'context' MUST be strings
    ctx_str = {k: ("" if v is None else str(v)) for k, v in ctx.items()}
    return {
        "principalId": str(principal),
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{"Action": "execute-api:Invoke", "Effect": "Allow", "Resource": method_arn}],
        },
        "context": ctx_str,
    }

def _get_token(event):
    # Prefer query param ?token=... (WebSocket style), then Authorization header
    q = (event.get("queryStringParameters") or {})
    token = q.get("token")
    if token:
        return token.strip()

    hdrs = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    auth = hdrs.get("authorization") or hdrs.get("sec-websocket-protocol")
    # Some WS clients stuff token in Sec-WebSocket-Protocol; handle "Bearer xxx" or raw token
    if auth:
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return auth.strip()

    return None

def _verify_cognito_jwt(token):
    """Return (claims, header) if valid, else raise Exception."""
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    if not kid:
        raise ValueError("Missing kid in header")

    jwks = _fetch_jwks()
    keys = jwks.get("keys", [])
    key = next((k for k in keys if k.get("kid") == kid), None)
    if not key:
        raise ValueError("Public key not found for kid")

    # Verify signature manually (works without extra crypto deps)
    public_key = jwk.construct(key)
    message, encoded_sig = token.rsplit(".", 1)
    decoded_sig = base64url_decode(encoded_sig.encode("utf-8"))
    if not public_key.verify(message.encode("utf-8"), decoded_sig):
        raise ValueError("Invalid token signature")

    claims = jwt.get_unverified_claims(token)

    # Time-based checks
    now = int(time.time())
    if "exp" in claims and now > int(claims["exp"]):
        raise ValueError("Token expired")
    if "nbf" in claims and now < int(claims["nbf"]):
        raise ValueError("Token not yet valid")

    # Issuer check
    if claims.get("iss") != ISSUER:
        raise ValueError("Invalid issuer")

    # Token use & audience checks
    if ACCEPT_ACCESS_TOKEN:
        # Access token path
        if claims.get("token_use") != "access":
            raise ValueError("Expecting access token")
        # Access tokens typically carry client_id
        if claims.get("client_id") != APP_CLIENT_ID:
            raise ValueError("Invalid client_id")
    else:
        # ID token path (default)
        if claims.get("token_use") != "id":
            raise ValueError("Expecting ID token")
        aud = claims.get("aud")
        if aud != APP_CLIENT_ID:
            raise ValueError("Invalid audience")

    return claims, headers

def handler(event, context):
    # API Gateway will provide methodArn on WS authorizer invoke
    method_arn = event.get("methodArn") or "*"

    token = _get_token(event)
    if not token:
        log.warning("No token supplied")
        return _deny(method_arn, "anonymous")

    try:
        claims, header = _verify_cognito_jwt(token)

        principal = claims.get("sub", "user")
        ctx = {
            "sub": claims.get("sub", ""),
            "username": claims.get("cognito:username", ""),
            "email": claims.get("email", ""),
            "iss": ISSUER,
            "kid": header.get("kid", ""),
            "token_use": claims.get("token_use", ""),
        }
        return _allow(method_arn, principal, ctx)

    except Exception as e:
        log.error("JWT verification failed: %s", e, exc_info=False)
        return _deny(method_arn, "unauthorized")
