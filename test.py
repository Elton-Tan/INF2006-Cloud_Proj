import os, json, re, requests, time
from urllib.parse import urlencode

SCRAPERAPI_KEY = os.getenv("SCRAPERAPI_KEY") or "903e97c1224624d63d2ce0d52ba7ac0e"
PDP_URL = "https://www.lazada.sg/products/raspberry-pi-4-heat-sinks-1-copper-2-aluminium-3-piece-cooling-heatsink-heat-sink-accessories-i453778483.html"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
HL = "en-SG,en;q=0.9"

def get_html(api_key, url, *, country="sg", session="pdp123", premium=False, ultra=False, timeout=75):
    params = {
        "api_key": api_key,
        "url": url,
        "country_code": country,
        "render": "true",               # enable headless browser
        "device_type": "desktop",
        "session": session,             # sticky IP for sub-requests
        "keep_headers": "true",
    }
    if premium:
        params["premium"] = "true"
    if ultra:
        params["ultra_premium"] = "true"

    headers = {
        "User-Agent": UA,
        "Accept-Language": HL,
    }

    r = requests.get("http://api.scraperapi.com/", params=params, headers=headers, timeout=timeout)
    return r

def first_json(s):
    try:
        return json.loads(s)
    except Exception:
        return None

def select_product_ldjson(blobs):
    for b in blobs:
        if isinstance(b, list):
            for x in b:
                if isinstance(x, dict) and str(x.get("@type","")).lower() == "product":
                    return x
        elif isinstance(b, dict):
            t = b.get("@type")
            if isinstance(t, list) and any(str(tt).lower()=="product" for tt in t):
                return b
            if isinstance(t, str) and t.lower()=="product":
                return b
    for b in blobs:
        if isinstance(b, dict) and ("offers" in b or "name" in b):
            return b
    return None

def extract_item_id(html: str):
    for pat in (
        r'"itemId"\s*:\s*"?(?P<id>\d+)"?',
        r"itemId\s*=\s*'?(?P<id>\d+)'?",
        r"data-item-id\s*=\s*['\"](?P<id>\d+)['\"]",
    ):
        m = re.search(pat, html, re.I)
        if m:
            return m.group("id")
    return None

def parse_html(html: str):
    # JSON-LD blocks
    scripts = re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, flags=re.I|re.S)
    blobs = []
    for s in scripts:
        j = first_json(s.strip())
        if j is not None:
            blobs.append(j)
    product = select_product_ldjson(blobs)

    data = {}
    if isinstance(product, dict):
        data["name"] = product.get("name")
        data["description"] = product.get("description")
        imgs = product.get("image")
        if isinstance(imgs, list): data["images"] = imgs
        elif isinstance(imgs, str): data["images"] = [imgs]

        offers = product.get("offers") or {}
        if isinstance(offers, list): offers = offers[0] if offers else {}
        data["price"]         = offers.get("price")
        data["priceCurrency"] = offers.get("priceCurrency")
        data["availability"]  = offers.get("availability")

        ar = product.get("aggregateRating") or {}
        data["ratingValue"] = ar.get("ratingValue")
        data["reviewCount"] = ar.get("reviewCount")

        data["brand"] = product.get("brand", {}).get("name") if isinstance(product.get("brand"), dict) else product.get("brand")
        data["sku"]   = product.get("sku")

    # extras
    data["itemId"] = extract_item_id(html)
    m = re.search(r'"promoPrice"\s*:\s*"?(?P<pp>[\d.]+)"?', html, re.I)
    if m: data["promoPrice"] = m.group("pp")

    return data

def scrape_pdp(url, key):
    if not key or key == "YOUR_SCRAPERAPI_KEY":
        return {"ok": False, "error": "Missing SCRAPERAPI_KEY"}

    attempts = [
        {"premium": False, "ultra": False},
        {"premium": True,  "ultra": False},
        {"premium": False, "ultra": True},   # only if your plan supports it
    ]

    last_err = None
    for i, opts in enumerate(attempts, 1):
        r = get_html(key, url, premium=opts["premium"], ultra=opts["ultra"])
        if r.status_code == 200 and "<html" in r.text.lower():
            data = parse_html(r.text)
            return {"ok": True, "http_status": 200, "strategy": opts, "data": data}
        else:
            last_err = {"status": r.status_code, "text": r.text[:800], "strategy": opts}
            # small backoff then escalate
            time.sleep(1.2)

    return {"ok": False, "error": "all_strategies_failed", "last": last_err, "target_url": url}

if __name__ == "__main__":
    out = scrape_pdp(PDP_URL, SCRAPERAPI_KEY)
    print(json.dumps(out, ensure_ascii=False, indent=2))
