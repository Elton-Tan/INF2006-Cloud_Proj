# scrap_reviews.py
# Lazada PDP review scraper (Selenium) with:
# - Empty-state detection (skip "This product has no reviews")
# - Container-scoped extraction
# - Optional "discover" mode to pull PDP URLs from Lazada search pages
#
# PowerShell examples:
#  A) Scrape known PDP URLs:
#     python .\scrap_reviews.py --urls (Get-Content .\lazada_pdp_urls.txt) --out .\out\lazada_reviews.jsonl --headless --lang en-SG --pages 3 --verbose
#  B) Discover PDPs from search pages, then scrape:
#     python .\scrap_reviews.py --discover "https://www.lazada.sg/catalog/?q=foot%20cream" --discover-limit 8 --out .\out\lazada_reviews.jsonl --headless --lang en-SG --pages 3 --verbose
#  C) Discover from queries (builds the search URL for you):
#     python .\scrap_reviews.py --discover "foot cream" "antifungal foot cream" --discover-limit 8 --out .\out\lazada_reviews.jsonl --headless --lang en-SG --pages 3 --verbose

import argparse, json, random, re, sys, time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Iterable
from urllib.parse import quote_plus

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ---------------- (Playwright-style helpers kept for completeness) ----------------
# These async helpers are defined for parity with other versions; they are unused in this Selenium script.

async def _maybe_switch_to_review_iframe(page):
    """Some sites (Lazada, etc.) render reviews in an iframe. If found, return that frame; else return page."""
    import re as _re
    # try by URL pattern first
    for fr in page.frames:
        try:
            url = fr.url or ""
            if _re.search(r"(review|ratings|pdp-review)", url, _re.I):
                return fr
        except Exception:
            pass
    # try by DOM hint
    try:
        cand = page.locator('iframe:has-text("Review"), iframe[src*="review"], iframe[src*="rating"]')
        if await cand.count() > 0:
            fr = await cand.nth(0).content_frame()
            if fr:
                return fr
    except Exception:
        pass
    return page  # fall back

async def scroll_until_no_new(
    page_or_frame,
    container_selector: str = "body",
    pause_ms: int = 400,
    max_rounds: int = 60,
    min_delta_px: int = 32,
):
    """Scrolls the container until height stops growing or max_rounds reached."""
    last_height = 0
    for _ in range(max_rounds):
        try:
            height = await page_or_frame.evaluate(
                """(sel) => {
                    const el = document.querySelector(sel) || document.scrollingElement || document.body;
                    return el.scrollHeight || document.body.scrollHeight || 0;
                }""",
                container_selector,
            )
            # scroll near bottom
            await page_or_frame.evaluate(
                """(sel) => {
                    const el = document.querySelector(sel) || document.scrollingElement || document.body;
                    el.scrollTo({ top: (el.scrollTop || 0) + (el.clientHeight || 800) * 0.9, behavior: 'instant' });
                }""",
                container_selector,
            )
            await page_or_frame.wait_for_timeout(pause_ms)  # let lazy images/ajax settle
            try:
                await page_or_frame.wait_for_load_state("networkidle", timeout=pause_ms + 600)
            except Exception:
                pass
            new_height = await page_or_frame.evaluate(
                """(sel) => {
                    const el = document.querySelector(sel) || document.scrollingElement || document.body;
                    return el.scrollHeight || document.body.scrollHeight || 0;
                }""",
                container_selector,
            )
            if abs(new_height - last_height) < min_delta_px:
                break
            last_height = new_height
        except Exception:
            # harmless — try a bit more then give up
            await page_or_frame.wait_for_timeout(pause_ms)
            continue

async def click_next_if_available(
    page_or_frame,
    next_selector_candidates=(
        # Lazada / common UI kits
        "a.next-next, button.next-next, li.next a, .next-pagination-item.next, a[aria-label='Next'], button[aria-label='Next']",
    ),
    wait_after_ms: int = 800,
) -> bool:
    """Clicks a 'Next' button if present; returns True if page advanced."""
    candidates = next_selector_candidates if isinstance(next_selector_candidates, (list, tuple)) else [next_selector_candidates]
    for sel in candidates:
        try:
            loc = page_or_frame.locator(sel)
            if await loc.count() > 0 and await loc.first().is_enabled():
                await loc.first().click()
                try:
                    await page_or_frame.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
                await page_or_frame.wait_for_timeout(wait_after_ms)
                return True
        except Exception:
            continue
    return False

async def open_reviews_tab_if_needed(page):
    """Best-effort: click a 'Reviews' tab/link so the review list is visible."""
    candidates = [
        "a:has-text('Reviews')",
        "button:has-text('Reviews')",
        "a:has-text('Ratings & Reviews')",
        "button:has-text('Ratings & Reviews')",
        "[data-qa*='review']",
        "[data-testid*='review']",
    ]
    for sel in candidates:
        try:
            loc = page.locator(sel)
            if await loc.count() > 0:
                await loc.first().click()
                try:
                    await page.wait_for_load_state("networkidle", timeout=4000)
                except Exception:
                    pass
                await page.wait_for_timeout(400)  # let list mount
                break
        except Exception:
            continue


from urllib.parse import urljoin

def _best_from_srcset(srcset: str) -> Optional[str]:
    # pick the largest candidate from srcset
    try:
        parts = [p.strip() for p in srcset.split(",") if p.strip()]
        def parse(p):
            bits = p.split()
            u = bits[0]
            w = 0
            for b in bits[1:]:
                if b.endswith("w"):
                    try: w = int(b[:-1])
                    except: pass
            return (w, u)
        cands = [parse(p) for p in parts]
        cands.sort(key=lambda x: x[0], reverse=True)
        return cands[0][1] if cands else None
    except Exception:
        return None

def _norm_url(u: Optional[str], base: str) -> Optional[str]:
    if not u: return None
    u = u.strip().strip('"').strip("'")
    if u.startswith("//"): u = "https:" + u
    return urljoin(base, u)

def extract_primary_image_url(driver, base_url: str) -> Optional[str]:
    # 0) JSON-LD image
    try:
        for s in driver.find_elements(By.XPATH, "//script[@type='application/ld+json']"):
            txt = s.get_attribute("textContent") or ""
            try:
                data = json.loads(txt)
            except Exception:
                continue
            blocks = data if isinstance(data, list) else [data]
            for d in blocks:
                img = d.get("image")
                if isinstance(img, list) and img:
                    return _norm_url(str(img[0]), base_url)
                if isinstance(img, str) and img:
                    return _norm_url(img, base_url)
    except Exception:
        pass

    # 1) Open Graph / meta fallbacks
    for prop in ("og:image", "twitter:image", "og:image:url"):
        try:
            m = driver.find_elements(By.XPATH, f"//meta[@property='{prop}' or @name='{prop}']")
            if m:
                u = m[0].get_attribute("content") or ""
                u = _norm_url(u, base_url)
                if u: return u
        except Exception:
            continue

    # 2) Gallery/buy-box area <img> nodes (common Lazada selectors)
    XPS = [
        # v1/v2 PDP galleries & main image containers
        "//*[@id='module_product_image_1']//img",
        "//*[@id='module_product_image']//img",
        "//*[contains(@class,'pdp-gallery')]//img",
        "//*[contains(@class,'pdp-mod-product-main-img')]//img",
        "//*[contains(@class,'pdp-v2-gallery')]//img",
        # generic: main image within product info column
        "//*[contains(@class,'pdp-mod-product-info')]//img",
        # any visible large image on page as last resort
        "//img"
    ]
    def _grab_img_src(img_el):
        for attr in ("src", "data-src", "data-ks-lazyload", "data-zoom-image", "data-original", "srcset"):
            v = img_el.get_attribute(attr)
            if not v: 
                continue
            if attr == "srcset":
                best = _best_from_srcset(v)
                if best:
                    return _norm_url(best, base_url)
            else:
                u = _norm_url(v, base_url)
                if u and (u.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) or u.startswith("http")):
                    return u
        return None

    for xp in XPS:
        try:
            imgs = [i for i in driver.find_elements(By.XPATH, xp) if i.is_displayed()]
            # prefer the largest displayed image
            scored = []
            for i in imgs:
                try:
                    rect = i.rect or {}
                    area = int(rect.get("width", 0)) * int(rect.get("height", 0))
                    scored.append((area, i))
                except Exception:
                    scored.append((0, i))
            for _, el in sorted(scored, key=lambda t: t[0], reverse=True):
                u = _grab_img_src(el)
                if u: return u
        except Exception:
            continue

    return None

def download_image_to(path_dir: Optional[str], img_url: Optional[str], fname_hint: str):
    if not path_dir or not img_url: return None
    try:
        import requests, os
        Path(path_dir).mkdir(parents=True, exist_ok=True)
        ext = ".jpg"
        for e in (".jpg",".jpeg",".png",".webp"):
            if img_url.lower().split("?")[0].endswith(e):
                ext = e; break
        fn = re.sub(r"[^a-zA-Z0-9._-]+", "_", fname_hint)[:80] or "image"
        fp = str(Path(path_dir) / f"{fn}{ext}")
        r = requests.get(img_url, timeout=15)
        if r.ok:
            with open(fp, "wb") as w: w.write(r.content)
            return fp
    except Exception:
        return None
    return None

# ---------------- CLI ----------------

def parse_args():
    # argparse (add these)


    ap = argparse.ArgumentParser(description="Lazada PDP reviews scraper (Selenium)")
    ap.add_argument("--images-dir", default=None, help="If set, download snapshot image files here")
    ap.add_argument("--profile-dir", default=None, help="Chrome user-data root dir (…\\User Data)")
    ap.add_argument("--profile-name", default=None, help="Chrome profile directory name (e.g., 'Default', 'Profile 6')")


    ap.add_argument("--urls", nargs="*", default=[], help="Lazada PDP URLs")
    ap.add_argument("--discover", nargs="*", default=[], help="Lazada search URLs or plain queries (e.g., 'foot cream')")
    ap.add_argument("--discover-limit", type=int, default=12, help="Max PDPs to collect from discovery")
    ap.add_argument("--discover-scrolls", type=int, default=6, help="Scroll passes on search pages")
    ap.add_argument("--pages", type=int, default=5, help="# of 'Load more reviews' clicks per PDP")
    ap.add_argument("--out", default="out/lazada_reviews.jsonl", help="JSONL output path")
    ap.add_argument("--headless", action="store_true", help="Headless Chrome")
    ap.add_argument("--min-delay", type=float, default=0.5, help="Min delay between actions (s)")
    ap.add_argument("--max-delay", type=float, default=1.2, help="Max delay between actions (s)")
    ap.add_argument("--lang", default="en-SG", help="Accept-Language hint")
    ap.add_argument("--mobile", action="store_true", help="Use a mobile UA (optional)")
    ap.add_argument("--proxy", default=None, help="http://host:port (optional)")
    ap.add_argument("--dump-html", default=None, help="Directory to dump HTML when 0 reviews")
    ap.add_argument("--verbose", action="store_true", help="Verbose logs")
    ap.add_argument("--review-container", default="body", help="CSS selector for the scrollable container holding reviews (default: body)")
    ap.add_argument(
        "--review-next-selector",
        default="a.next-next, button.next-next, li.next a, .next-pagination-item.next, a[aria-label='Next'], button[aria-label='Next']",
        help="CSS selector(s) for the Next button (comma-separated)",
    )
    ap.add_argument("--open-reviews-tab", action="store_true", help="Try clicking a Reviews tab/link before scraping")
    ap.add_argument("--with-snapshot", action="store_true",
                help="Also collect a PDP price/demand snapshot per URL")
    ap.add_argument("--snapshots-out", default="out/lazada_snapshots.jsonl",
                    help="JSONL path for PDP snapshots (used when --with-snapshot or --snapshot-only)")
    ap.add_argument("--snapshot-only", action="store_true",
                    help="Only collect PDP snapshots; skip reviews")

    
    return ap.parse_args()

# ---------------- Helpers ----------------

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1"
)
DESKTOP_UA = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
)

EMPTY_PAT = re.compile(r"\bThis product has no reviews\b", re.I)
BOILERPLATE_PAT = re.compile(
    r"(log[\s-]?in|sign[\s-]?in|store locator|careers|privacy policy|terms & conditions|"
    r"about guardian|categories|all brands|follow us on|©\s*20\d{2}|"
    r"mobile number|log in with (apple|google|facebook))",
    re.I,
)

# --- add near other helpers in scrap_reviews.py ---
NUM_RE = re.compile(r"[\d,]+")
PCT_RE = re.compile(r"-?\d{1,3}%")

# --- put near other helpers ---
OOS_TEXT_PAT = re.compile(
    r"(out\s*of\s*stock|sold\s*out|unavailable|temporarily\s*unavailable|no\s*stock|not\s*available|"
    r"currently\s*unavailable|库存不足|售罄|没有库存|缺货)",
    re.I,
)

# --- Availability: Lazada buy-box scoped, precise, positive-first ---
OOS_PATTERNS = [
    r"\bout of stock\b", r"\bsold out\b", r"\bunavailable\b",
    r"notify (me|when) available", r"no longer available", r"coming soon"
]
IN_STOCK_PATTERNS = [r"\badd to cart\b", r"\bbuy now\b"]

def _find_buybox(driver):
    XPS = [
        "//*[@id='module_add_to_cart']",
        "//*[@data-qa-locator='product-buy-box']",
        "//*[contains(@class,'pdp-button')]",
        "//*[contains(@class,'pdp-actions') or contains(@class,'pdp-btns')]",
    ]
    for xp in XPS:
        els = driver.find_elements(By.XPATH, xp)
        for el in els:
            if el.is_displayed():
                return el
    # fallback: the main product column
    try:
        return driver.find_element(By.XPATH, "//*[contains(@class,'pdp-mod-product-info')]")
    except Exception:
        return None

def _jsonld_availability(driver):
    try:
        for s in driver.find_elements(By.XPATH, "//script[@type='application/ld+json']"):
            data = json.loads(s.get_attribute("textContent") or "{}")
            objs = data if isinstance(data, list) else [data]
            for d in objs:
                offers = d.get("offers")
                if not offers: continue
                offers = offers if isinstance(offers, list) else [offers]
                for o in offers:
                    avail = (o.get("availability") or "").lower()
                    if "instock" in avail: return "in_stock", "ld+json availability=InStock"
                    if "outofstock" in avail: return "out_of_stock", "ld+json availability=OutOfStock"
    except Exception:
        pass
    return None, None

def detect_lazada_availability(driver):
    # 1) Try JSON-LD first (cheap and reliable when present)
    a, why = _jsonld_availability(driver)
    if a: return a, why

    # 2) Inspect buy-box DOM only
    box = _find_buybox(driver)
    if not box:
        return "unknown", "buy-box not found"

    txt = (box.text or "").lower()
    # positive-first
    for pat in IN_STOCK_PATTERNS:
        if re.search(pat, txt):
            # make sure buttons aren’t disabled
            try:
                add = box.find_element(By.XPATH, ".//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'add to cart') or contains(.,'Buy Now')]")
                disabled = (add.get_attribute("disabled") or add.get_attribute("aria-disabled") or "").lower() in ("true", "disabled")
                if not disabled:
                    return "in_stock", f"matched '{pat}' in buy-box"
            except Exception:
                pass
    # explicit OOS
    for pat in OOS_PATTERNS:
        m = re.search(pat, txt)
        if m:
            return "out_of_stock", f"matched '{m.group(0)}' in buy-box"

    return "unknown", "no clear buy-box signal"


def _has_class(el, *names):
    try:
        cls = (el.get_attribute("class") or "").lower()
        return any(n in cls for n in names)
    except Exception:
        return False

def _is_disabled(el):
    try:
        if el.get_attribute("disabled"): return True
        if (el.get_attribute("aria-disabled") or "").lower() in ("true", "1"): return True
        return _has_class(el, "disabled", "btn-disabled", "button-disabled", "unavailable")
    except Exception:
        return False

def _safe_text(el):
    try:
        return (el.text or el.get_attribute("textContent") or "").strip()
    except Exception:
        return ""
def detect_pdp_availability(driver):
    """
    Returns (is_in_stock: bool, reason: str).
    Designed for Lazada PDPs; robust to images disabled.
    """
    # 0) Structured data (JSON-LD, microdata)
    try:
        # JSON-LD blocks often contain offers.availability
        for s in driver.find_elements(By.XPATH, "//script[@type='application/ld+json']"):
            txt = s.get_attribute("textContent") or ""
            try:
                data = json.loads(txt)
            except Exception:
                continue
            objs = data if isinstance(data, list) else [data]
            for d in objs:
                if not isinstance(d, dict): continue
                offers = d.get("offers")
                buckets = offers if isinstance(offers, list) else [offers] if isinstance(offers, dict) else []
                for off in buckets:
                    avail = (off or {}).get("availability") or ""
                    if isinstance(avail, (list, tuple)):
                        avail = " ".join(map(str, avail))
                    avail = str(avail).lower()
                    if "outofstock" in avail:
                        return (False, "JSON-LD availability=OutOfStock")
                    if "instock" in avail or "preorder" in avail:
                        # keep checking – variant OOS can still override
                        pass
    except Exception:
        pass

    # 1) Look for explicit OOS text anywhere near price/CTA/alerts
    try:
        oos_nodes = driver.find_elements(
            By.XPATH,
            "//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'out of stock')"
            " or contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'sold out')"
            " or contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'unavailable')]"
        )
        for n in oos_nodes:
            t = _safe_text(n)
            if t and OOS_TEXT_PAT.search(t):
                return (False, f"OOS text: {t[:50]}")
    except Exception:
        pass

    # 2) CTA/buttons: if both are missing or disabled, treat as OOS
    try:
        ctas = []
        # common Lazada PDP CTAs
        for xp in [
            "//button[contains(.,'Add to Cart')]",
            "//button[contains(.,'Add to cart')]",
            "//button[contains(.,'Buy Now')]",
            "//button[contains(.,'Buy now')]",
            "//a[contains(.,'Add to Cart')]",
            "//a[contains(.,'Buy Now')]",
            # class-based fallbacks
            "//*[contains(@class,'add-to-cart') or contains(@class,'buy-now') or contains(@class,'addCart')]"
        ]:
            ctas.extend(driver.find_elements(By.XPATH, xp))
        ctas = [b for b in ctas if b.is_displayed()]

        if not ctas:
            # If no purchasable CTA is visible, likely OOS or not sellable in region
            return (False, "CTAs missing")

        enabled_seen = any(not _is_disabled(b) for b in ctas)
        if not enabled_seen:
            return (False, "CTAs disabled")

    except Exception:
        # if anything blows up, be conservative & return unknown -> treat as in stock and let other signals speak
        return (True, "CTA check error")

    # 3) Variant quick-check: if all visible options are disabled, it’s OOS
    try:
        # property blocks often have sku/variant in their locators/classes
        groups = driver.find_elements(By.XPATH,
            "//*[contains(@data-qa-locator,'sku') or contains(@class,'sku') or contains(@class,'variation')][.//li or .//button or .//a]"
        )
        # If there are variant groups, confirm at least one selectable option exists
        if groups:
            at_least_one_selectable = False
            for g in groups:
                opts = []
                # common patterns for options
                for xp in [".//li", ".//button", ".//a", ".//span/.."]:
                    opts.extend(g.find_elements(By.XPATH, xp))
                # any option that is not disabled/NA?
                for o in opts:
                    txt = _safe_text(o).lower()
                    if _is_disabled(o): 
                        continue
                    if "not available" in txt or "unavailable" in txt:
                        continue
                    at_least_one_selectable = True
                    break
            if not at_least_one_selectable:
                return (False, "All variants disabled/unavailable")
    except Exception:
        pass

    return (True, "OK")


def _to_int(s):
    if not s: return None
    m = NUM_RE.search(s.replace("\xa0"," "))
    return int(m.group(0).replace(",", "")) if m else None

def _to_float(s):
    try:
        return float(re.sub(r"[^\d.]", "", s))
    except Exception:
        return None

def scrape_lazada_pdp_snapshot(driver, url, args):
    driver.get(url)
    WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    jitter(args.min_delay, args.max_delay)

    try:
        close_login_overlays(driver, args.verbose)
    except Exception:
        pass

    name = extract_product_name(driver)
    image_url = extract_primary_image_url(driver, url) 
    image_path = download_image_to(args.images_dir, image_url, name or "pdp")
    price_cur = price_orig = None
    rating_avg = rating_cnt = reviews_cnt = None
    sold_cnt = stock_left = None
    discount_pct = None
    currency = "SGD" if "lazada.sg" in url else None
    brand = category = None

    # Wait a bit for price-ish nodes to appear (but don't block forever)
    try:
        WebDriverWait(driver, 5).until(EC.presence_of_all_elements_located((
            By.XPATH,
            "//*[@data-qa-locator='pdp-price']"
            " | //*[@itemprop='price']"
            " | //meta[@property='product:price:amount']"
            " | //meta[@property='og:price:amount']"
            " | //*[contains(@class,'pdp-price') or contains(@data-qa-locator,'pdp-price')]"
        )))
    except Exception:
        pass

    # --- price (DOM first) ---
    PRICE_XPS = [
        "//*[@data-qa-locator='pdp-price']",
        "//*[contains(@class,'pdp-price')]",
        "//*[@itemprop='price']",
        "//meta[@property='product:price:amount']",
        "//meta[@property='og:price:amount']",
        "//*[contains(@class,'pdp-v2-product-price-content-salePrice-amount')]",        # NEW v2
        "//*[contains(@class,'pdp-v2-product-price-content-originalPrice-amount')]"
    ]
    def _grab_num(el):
        t = (el.get_attribute("textContent") or el.get_attribute("content") or el.text or "").strip()
        return _to_float(t)

    for xp in PRICE_XPS:
        els = driver.find_elements(By.XPATH, xp)
        for el in els:
            v = _grab_num(el)
            if v is not None:
                price_cur = v; break
        if price_cur is not None: break

    for xp in [
        "//*[contains(@class,'pdp-price_type_deleted')]",
        "//del//*[contains(@class,'price') or @itemprop='price']",
        "//del"
    ]:
        els = driver.find_elements(By.XPATH, xp)
        for el in els:
            v = _grab_num(el)
            if v is not None:
                price_orig = v; break
        if price_orig is not None: break

    # --- currency (meta) ---
    if currency is None:
        for prop in ("product:price:currency", "og:price:currency"):
            els = driver.find_elements(By.XPATH, f"//meta[@property='{prop}']")
            if els:
                c = (els[0].get_attribute("content") or "").strip()
                if c: currency = c; break

    # --- JSON-LD fallback (price, rating, counts, brand) ---
    try:
        for s in driver.find_elements(By.XPATH, "//script[@type='application/ld+json']"):
            txt = s.get_attribute("textContent") or ""
            try:
                data = json.loads(txt)
            except Exception:
                continue
            blocks = data if isinstance(data, list) else [data]
            for d in blocks:
                if not isinstance(d, dict): continue

                # offers/price
                offers = d.get("offers")
                if isinstance(offers, dict):
                    p = offers.get("price") or offers.get("lowPrice") or offers.get("highPrice")
                    if p is not None and price_cur is None:
                        price_cur = _to_float(str(p))
                    if not currency:
                        currency = offers.get("priceCurrency") or currency
                elif isinstance(offers, list):
                    for o in offers:
                        if isinstance(o, dict):
                            p = o.get("price") or o.get("lowPrice") or o.get("highPrice")
                            if p is not None and price_cur is None:
                                price_cur = _to_float(str(p))
                            if not currency and o.get("priceCurrency"):
                                currency = o.get("priceCurrency")

                # aggregate rating
                ar = d.get("aggregateRating")
                if isinstance(ar, dict):
                    rv = ar.get("ratingValue")
                    rc = ar.get("ratingCount") or ar.get("reviewCount")
                    if rv is not None and rating_avg is None:
                        try: rating_avg = float(rv)
                        except Exception: pass
                    if rc is not None and (rating_cnt is None or reviews_cnt is None):
                        try:
                            n = int(str(rc).replace(",", ""))
                            # ambiguous which count it is; set both if empty
                            rating_cnt = rating_cnt or n
                            reviews_cnt = reviews_cnt or n
                        except Exception:
                            pass

                # brand
                if not brand:
                    b = d.get("brand")
                    if isinstance(b, dict):
                        brand = b.get("name") or brand
                    elif isinstance(b, str):
                        brand = b

                # name
                if not name and d.get("name"):
                    name = d["name"]
    except Exception:
        pass

    # --- other counts visible on page ---
    for xp in [
        "//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'ratings')]",
        "//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'reviews')]",
    ]:
        try:
            txt = safe_text(driver.find_element(By.XPATH, xp))
            if txt:
                if "rating" in txt.lower() and _to_int(txt): rating_cnt = rating_cnt or _to_int(txt)
                if "review" in txt.lower() and _to_int(txt): reviews_cnt = reviews_cnt or _to_int(txt)
        except Exception:
            pass

    # sold / stock
    for xp in ["//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'sold')]"]:
        try:
            txt = safe_text(driver.find_element(By.XPATH, xp))
            if txt and "sold" in txt.lower():
                sold_cnt = _to_int(txt); break
        except Exception:
            pass
    for xp in ["//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'only') and contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'left')]"]:
        try:
            stock_left = _to_int(safe_text(driver.find_element(By.XPATH, xp))); break
        except Exception:
            pass

    # discount %
    for xp in ["//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'%') or contains(.,'Voucher') or contains(.,'Flash Sale')]"]:
        try:
            txt = safe_text(driver.find_element(By.XPATH, xp))
            if txt:
                m = PCT_RE.search(txt)
                if m:
                    discount_pct = int(m.group(0).replace('%',''))
                break
        except Exception:
            pass
    if discount_pct is not None:
        discount_pct = abs(discount_pct)

    # category (breadcrumb best-effort)
    for xp in ["//nav//a[contains(@href,'catalog')][last()]", "//a[contains(@href,'category')][last()]"]:
        try:
            category = safe_text(driver.find_element(By.XPATH, xp)) or category
        except Exception:
            pass

    # DEBUG DUMPS when key fields missing
    if args.dump_html and (price_cur is None or (rating_avg is None and rating_cnt is None and reviews_cnt is None)):
        write_dump(args.dump_html, _dump_name_for(url, "snapshot_page.html"), driver.page_source)
        try:
            nodes = driver.find_elements(By.XPATH, "//*[contains(@class,'price') or @itemprop='price' or contains(@data-qa-locator,'price')]")
            html = "\n\n".join((n.get_attribute("outerHTML") or "") for n in nodes[:200])
            write_dump(args.dump_html, _dump_name_for(url, "snapshot_price_candidates.html"), html)
        except Exception:
            pass
    availability, why = detect_lazada_availability(driver)
    return {
        "source_domain": "www.lazada.sg",
        "page_url": url,
        "ts_ingested": datetime.utcnow().isoformat()+"Z",
        "product_name": name,
        "image_url": image_url,
        "image_path": image_path,
        "currency": currency,
        "price_current": price_cur,
        "price_original": price_orig,
        "discount_pct": discount_pct,
        "rating_avg": rating_avg,
        "rating_count": rating_cnt,
        "reviews_count": reviews_cnt,
        "sold_count": sold_cnt,
        "stock_left": stock_left,
        "brand": brand,
        "category": category,
        "availability": availability,
        "oos_reason": why if availability == "out_of_stock" else None,
    }



def jitter(a, b):
    time.sleep(random.uniform(a, b))

def log(msg, v):
    if v:
        print(msg, flush=True)

def ensure_outfile(p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.touch()

def ensure_dir(d: Optional[str]):
    if d:
        Path(d).mkdir(parents=True, exist_ok=True)

def is_lazada_pdp(url: str) -> bool:
    u = url.lower()
    return "www.lazada.sg" in u and ("/products/" in u or "/product/" in u or "/pdp" in u)

def is_search_like(s: str) -> bool:
    s = s.lower().strip()
    return s.startswith("https://www.lazada.sg/catalog/?q=") or s.startswith("http://www.lazada.sg/catalog/?q=")

def build_search_url(term: str) -> str:
    if is_search_like(term):
        return term
    return f"https://www.lazada.sg/catalog/?q={quote_plus(term)}"

def get_driver(args):
    opts = ChromeOptions()
    if args.headless:
        opts.add_argument("--headless=new")
    if args.profile_dir:
        opts.add_argument(f"--user-data-dir={Path(args.profile_dir).absolute()}")
    if args.profile_name:
        opts.add_argument(f"--profile-directory={args.profile_name}")
    if not args.profile_dir and not args.profile_name:
        opts.add_argument(f"--user-agent={DESKTOP_UA}")
    elif args.mobile:
        opts.add_argument(f"--user-agent={MOBILE_UA}")

    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--window-size=1200,1000")
    opts.add_argument("--disable-extensions")
    opts.add_argument("--disable-background-networking")
    opts.add_argument("--disable-sync")
    opts.add_argument("--metrics-recording-only")
    opts.add_argument("--no-first-run")
    opts.add_argument("--no-default-browser-check")
    opts.add_argument("--safebrowsing-disable-auto-update")
    opts.add_argument(f"--lang={args.lang}")
    opts.add_argument(f"--user-agent={(MOBILE_UA if args.mobile else DESKTOP_UA)}")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument("--disable-blink-features=AutomationControlled")


    prefs = {
        "profile.default_content_setting_values.notifications": 2
    }
    opts.add_experimental_option("prefs", prefs)

    if args.profile_dir:
        opts.add_argument(f"--user-data-dir={Path(args.profile_dir).absolute()}")
    if args.proxy:
        opts.add_argument(f"--proxy-server={args.proxy}")

    drv = webdriver.Chrome(options=opts)
    try:
        drv.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": """
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US','en']});
            Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
            """
        })
    except Exception:
        pass

    drv.set_page_load_timeout(45)
    drv.implicitly_wait(0)
    return drv


def safe_text(el) -> Optional[str]:
    try:
        t = (el.text or "").strip()
        return t if t else None
    except Exception:
        return None

def write_dump(path_dir: Optional[str], name: str, content: str):
    if not path_dir:
        return
    ensure_dir(path_dir)
    (Path(path_dir) / name).write_text(content, encoding="utf-8", errors="ignore")

# ---------------- Discovery ----------------

def discover_pdp_urls(driver, term_or_url: str, scrolls: int, limit: int, verbose: bool) -> List[str]:
    """Open a Lazada search page and harvest PDP URLs."""
    url = build_search_url(term_or_url)
    log(f"[discover] open: {url}", verbose)
    driver.get(url)
    WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    for _ in range(max(1, scrolls)):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(0.8)

    # collect anchors that look like PDPs
    hrefs = set()
    for a in driver.find_elements(By.XPATH, "//a[contains(@href,'/products/') or contains(@href,'/pdp-')]"):
        try:
            href = a.get_attribute("href") or ""
            if is_lazada_pdp(href):
                hrefs.add(href.split("#")[0])
            if len(hrefs) >= limit:
                break
        except Exception:
            continue
    found = list(hrefs)[:limit]
    log(f"[discover] found {len(found)} PDPs", verbose)
    return found

# ---------------- Lazada-specific helpers ----------------

def close_login_overlays(driver, verbose):
    """Dismiss login overlays; if a blocking login remains AND no review list is visible, we skip."""
    try:
        body = driver.find_element(By.TAG_NAME, "body")
        body.send_keys(Keys.ESCAPE); time.sleep(0.2); body.send_keys(Keys.ESCAPE)
    except Exception:
        pass
    for xp in [
        "//button[contains(@aria-label,'close')]",
        "//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'close')]",
        "//*[@class[contains(.,'dialog-close') or contains(.,'modal__close')]]",
        "//div[contains(@class,'next-dialog-close')]",
    ]:
        try:
            for b in driver.find_elements(By.XPATH, xp)[:3]:
                driver.execute_script("arguments[0].click();", b)
                log("Closed a modal", verbose)
                time.sleep(0.2)
        except Exception:
            continue
    try:
        overlays = driver.find_elements(By.XPATH,
            "//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'log in') or contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login')]")
        if overlays:
            lst = driver.find_elements(By.XPATH, "//*[@id='module_product_review'] | //*[contains(@data-qa-locator,'review-list')]")
            if not lst:
                return False
    except Exception:
        pass
    return True

def find_reviews_container(driver, verbose, try_click_tab: bool = False, quick_wait_s: float = 1.5):
    """Return the primary reviews container element if visible, else None.
    - Only tries clicking a Reviews tab if `try_click_tab` is True (from --open-reviews-tab).
    - Uses short, non-blocking probes vs. long WebDriverWait(10).
    """
    # tiny nudge to trigger lazy mounts near the top
    try:
        driver.execute_script("window.scrollBy(0, 300);")
        time.sleep(0.1)
    except Exception:
        pass

    # 1) (optional) try a quick, best-effort Reviews-tab click
    if try_click_tab:
        XPS_CLICK = [
            "//a[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review')]",
            "//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review')]",
            "//div[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'ratings')]",
        ]
        deadline = time.time() + max(0.3, quick_wait_s)
        for xp in XPS_CLICK:
            while time.time() < deadline:
                try:
                    els = driver.find_elements(By.XPATH, xp)
                    if els:
                        el = els[0]
                        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
                        driver.execute_script("arguments[0].click();", el)
                        if verbose:
                            print("Clicked reviews tab (quick)")
                        time.sleep(0.2)
                        # after a successful click, stop probing further xpaths
                        raise StopIteration
                except StopIteration:
                    break
                except Exception:
                    pass
                time.sleep(0.1)

    # 2) try common containers (no long waits)
    X_CONTAINERS = [
        "//*[@id='module_product_review']",
        "//*[@data-qa-locator='review-list']",
        "//*[contains(@data-qa-locator,'review-list')]",
        "//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'mod-reviews')]",
        # Heading → following list
        "((//*[self::h2 or self::div][contains(.,'Ratings') or contains(.,'Reviews')])[1]/following::*[@data-qa-locator='review-list'])[1]",
    ]
    for xp in X_CONTAINERS:
        try:
            el = driver.find_element(By.XPATH, xp)
            if el.is_displayed():
                return el
        except Exception:
            continue

    # 3) small fallback scroll & retry once
    try:
        driver.execute_script("window.scrollBy(0, 800);")
        time.sleep(0.15)
    except Exception:
        pass
    for xp in X_CONTAINERS:
        try:
            el = driver.find_element(By.XPATH, xp)
            if el.is_displayed():
                return el
        except Exception:
            continue

    if verbose:
        print("Reviews container not found quickly")
    return None


def container_is_empty(container) -> bool:
    """Detect 'This product has no reviews' empty state."""
    try:
        html = container.get_attribute("outerHTML") or ""
        if EMPTY_PAT.search(html):
            return True
        # explicit empty markers found in Lazada DOM
        if "mod-empty" in html or "empty-title" in html:
            return True
    except Exception:
        pass
    return False

def click_load_more_in_container(container, pages, verbose, min_d, max_d):
    """Click 'Load more' ONLY inside the review container."""
    for i in range(max(0, pages)):
        clicked = False
        for xp in [
            ".//button[contains(., 'Load more')]",
            ".//a[contains(., 'Load more')]",
            ".//*[contains(@data-qa-locator,'see-more')]",
            ".//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'load more')]",
        ]:
            try:
                btn = container.find_element(By.XPATH, xp)
                container._parent.execute_script("arguments[0].click();", btn)
                log(f"Clicked 'Load more' inside container ({i+1})", verbose)
                clicked = True
                jitter(min_d, max_d)
                break
            except Exception:
                continue
        if not clicked:
            break

def extract_product_name(driver) -> Optional[str]:
    for xp in [
        "//h1[contains(@class,'pdp-mod-product-badge-title')]",
        "//h1[contains(@class,'pdp-mod-product-title')]",
        "//h1",
    ]:
        try:
            t = safe_text(driver.find_element(By.XPATH, xp))
            if t:
                return t
        except Exception:
            continue
    try:
        return driver.title.split("|")[0].strip() or None
    except Exception:
        return None

def parse_rating(label: str) -> Optional[float]:
    if not label:
        return None
    m = re.search(r"(\d(?:\.\d+)?)\s*out of\s*5", label, re.I)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            return None
    return None

def wait_for_review_growth(container_el, old_count, timeout=6.0, poll=0.15):
    """Wait until review items count increases using the flexible rows_len()."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            new_n = rows_len(container_el)
            if new_n > old_count:
                return new_n
        except Exception:
            pass
        time.sleep(poll)
    # return the latest count even if no growth detected (avoid long stalls)
    try:
        return rows_len(container_el)
    except Exception:
        return old_count


def extract_reviews_from_container(container) -> List[dict]:
    """
    Extract reviews inside the given container. Prefer explicit data-qa-locator nodes, then fall back heuristics.
    """
    reviews = []
    items = container.find_elements(By.XPATH, ".//*[@data-qa-locator='review-item']")
    if not items:
        items = container.find_elements(By.XPATH, ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review')]")
    if not items:
        items = container.find_elements(By.XPATH, ".//*")

    for node in items:
        try:
            body = None
            rating = None
            author = None
            date_txt = None

            for xp in [
                ".//*[@data-qa-locator='review-content']",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'content')]",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review-body')]",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'comment')]",
            ]:
                try:
                    body = safe_text(node.find_element(By.XPATH, xp))
                    if body:
                        break
                except Exception:
                    continue
            if not body:
                t = safe_text(node)
                if t and len(t) > 60:
                    body = t

            for xp in [
                ".//*[@data-qa-locator='review-star-rating']",
                ".//*[contains(@aria-label,'out of 5') or contains(@alt,'out of 5') or contains(text(),'out of 5')]",
            ]:
                try:
                    el = node.find_element(By.XPATH, xp)
                    label = (el.get_attribute("aria-label") or el.get_attribute("alt") or safe_text(el) or "")
                    rating = parse_rating(label or "")
                    if rating is not None:
                        break
                except Exception:
                    continue

            for xp in [
                ".//*[@data-qa-locator='review-user-name']",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'author')]",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'name')]",
            ]:
                try:
                    author = safe_text(node.find_element(By.XPATH, xp))
                    if author:
                        break
                except Exception:
                    continue

            for xp in [
                ".//*[@data-qa-locator='review-time']",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'date')]",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'time')]",
            ]:
                try:
                    date_txt = safe_text(node.find_element(By.XPATH, xp))
                    if date_txt:
                        break
                except Exception:
                    continue

            if body and len(body) >= 15 and not BOILERPLATE_PAT.search(body):
                reviews.append({
                    "review_id": None,
                    "title": None,
                    "review_text": body,
                    "rating": rating,
                    "author": author,
                    "review_date": date_txt,
                })
        except Exception:
            continue

    # de-dup
    seen, out = set(), []
    for r in reviews:
        key = ((r.get("author") or "").strip(), (r.get("review_text") or "")[:100])
        if key in seen:
            continue
        seen.add(key); out.append(r)
    return out

def scroll_reviews_container(container, passes: int = 3, delay: float = 0.25, verbose: bool = False):
    """Scroll only the reviews container to load lazy reviews. Never scroll the window."""
    last_h = -1
    for i in range(max(1, passes)):
        try:
            h = container._parent.execute_script("return arguments[0].scrollHeight;", container)
            container._parent.execute_script("arguments[0].scrollTop = arguments[0].scrollHeight;", container)
            if verbose:
                print(f"[scroll] reviews container pass {i+1}/{passes} (h={h})")
            time.sleep(delay)
            new_h = container._parent.execute_script("return arguments[0].scrollHeight;", container)
            # stop if no growth after 2 passes
            if i >= 1 and new_h <= h:
                break
            last_h = new_h
        except Exception:
            break

def ensure_container_in_view(driver, container):
    """Scroll the window just enough so the reviews container is in view."""
    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block:'start', inline:'nearest'});",
            container
        )
        time.sleep(0.15)
    except Exception:
        pass

def pin_container_into_view(driver, container, offset: int = 100):
    """Keep the reviews container near the top of the viewport without scrolling past it."""
    try:
        driver.execute_script(
            "window.scrollTo(0, arguments[0].getBoundingClientRect().top + window.pageYOffset - arguments[1]);",
            container, offset
        )
        time.sleep(0.08)
    except Exception:
        pass

def switch_into_review_iframe_if_present(driver, verbose=False) -> bool:
    """If reviews are inside an iframe, switch into it. Returns True if switched."""
    css_list = [
        "iframe[src*='review']",
        "iframe[src*='rating']",
        "iframe[id*='review']",
        "iframe[name*='review']",
    ]
    try:
        frames = []
        for css in css_list:
            frames.extend(driver.find_elements(By.CSS_SELECTOR, css))
        for fr in frames:
            try:
                driver.switch_to.frame(fr)
                time.sleep(0.2)
                # quick probe for known review nodes
                if driver.find_elements(By.XPATH, "//*[@id='module_product_review'] | //*[@data-qa-locator='review-list'] | //*[contains(@data-qa-locator,'review-list')]"):
                    if verbose:
                        print("[iframe] Switched into review iframe")
                    return True
                driver.switch_to.default_content()
            except Exception:
                # make sure we are back to default for the next attempt
                try:
                    driver.switch_to.default_content()
                except Exception:
                    pass
                continue
    except Exception:
        pass
    # ensure default content if nothing matched
    try:
        driver.switch_to.default_content()
    except Exception:
        pass
    return False

def get_active_review_page(container) -> Optional[int]:
    """Return the current active review page number inside the container, if present."""
    XPS = [
        "(.//li[contains(@class,'active')]//a)[1]",
        "(.//li[contains(@class,'next-pagination-item') and contains(@class,'active')])[1]",
        "(.//button[@aria-current='page'])[1]",
        "(.//a[@aria-current='page'])[1]",
    ]
    for xp in XPS:
        try:
            txt = (container.find_element(By.XPATH, xp).text or "").strip()
            m = re.search(r"\d+", txt)
            if m:
                return int(m.group(0))
        except Exception:
            continue
    return None

def rows_len(container_el) -> int:
    try:
        n = len(container_el.find_elements(By.XPATH, ".//*[@data-qa-locator='review-item']"))
        if n == 0:
            # Fallback: many pages drop the explicit locator after page 2
            n = len(container_el.find_elements(
                By.XPATH,
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review') and (self::div or self::li)]"
            ))
        return n
    except Exception:
        return 0

def _dump_name_for(url: str, suffix: str) -> str:
    tail = url.split("/")[-1] or "page"
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", tail)[:90]
    return f"{safe}__{suffix}"

def wait_for_page_change(container, old_page: Optional[int], timeout=2.0, poll=0.1) -> bool:
    """Wait until the active page number changes OR the container HTML/content grows."""
    t0 = time.time()
    try:
        old_len = rows_len(container)
    except Exception:
        old_len = 0
    try:
        old_sig = (container.get_attribute("innerHTML") or "")[:4000]
    except Exception:
        old_sig = ""
    while time.time() - t0 < timeout:
        try:
            now_page = get_active_review_page(container)
            if old_page is not None and now_page is not None and now_page != old_page:
                return True
            if rows_len(container) > old_len:
                return True
            now_sig = (container.get_attribute("innerHTML") or "")[:4000]
            if now_sig != old_sig:
                return True
        except Exception:
            pass
        time.sleep(poll)
    return False


# ---------------- Main flow ----------------

@dataclass
class Stats:
    scanned: int = 0
    emitted: int = 0
    skipped: int = 0
    empty: int = 0
    snapshots: int = 0



def scrape_lazada_pdp(driver, url, args) -> List[dict]:
    """Open a Lazada PDP, load as many reviews as possible, and return parsed rows."""

    # ---- tiny local helpers (scoped to this function) ----
    def wait_for_invisible(driver, css_or_xpath: str, timeout=2.0):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if css_or_xpath.startswith("/") or css_or_xpath.startswith("("):
                    els = driver.find_elements(By.XPATH, css_or_xpath)
                else:
                    els = driver.find_elements(By.CSS_SELECTOR, css_or_xpath)
                if not any(e.is_displayed() for e in els):
                    return True
            except Exception:
                return True
            time.sleep(0.08)
        return False

    def _container_sig(container, k=4000) -> str:
        try:
            return (container.get_attribute("innerHTML") or "")[:k]
        except Exception:
            return ""

    def _wait_for_container_change(container, prev_sig, timeout=4.0, poll=0.1) -> bool:
        t0 = time.time()
        while time.time() - t0 < timeout:
            if _container_sig(container) != prev_sig:
                return True
            time.sleep(poll)
        return False

    def try_click_numeric_next_in_container(container_el, current_page: Optional[int],
                                            driver, next_selectors: Optional[str]) -> bool:
        """Click the next page (prefer numeric), then wait for the list to grow or HTML to change."""
        prev_sig = _container_sig(container_el)
        old_n = rows_len(container_el)

        def _clicked_wait() -> bool:
            # Prefer a count increase; fall back to DOM signature change
            if wait_for_review_growth(container_el, old_n, timeout=4.0, poll=0.15) > old_n:
                return True
            return _wait_for_container_change(container_el, prev_sig, timeout=2.0, poll=0.1)

        # 0) user-supplied selectors first (try inside container, then page-level)
        if next_selectors:
            for css in [s.strip() for s in next_selectors.split(",") if s.strip()]:
                try:
                    btn = container_el.find_element(By.CSS_SELECTOR, css)
                    if btn.is_displayed() and (not hasattr(btn, "is_enabled") or btn.is_enabled()):
                        (container_el._parent or driver).execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                        (container_el._parent or driver).execute_script("arguments[0].click();", btn)
                        wait_for_invisible(driver, ".next-loading, .ant-spin-spinning, .next-loading-tip", timeout=0.8)
                        return _clicked_wait()
                except Exception:
                    pass
                try:
                    btn = driver.find_element(By.CSS_SELECTOR, css)
                    if btn.is_displayed() and (not hasattr(btn, "is_enabled") or btn.is_enabled()):
                        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                        driver.execute_script("arguments[0].click();", btn)
                        wait_for_invisible(driver, ".next-loading, .ant-spin-spinning, .next-loading-tip", timeout=0.8)
                        return _clicked_wait()
                except Exception:
                    pass

        # 1) numeric target (current_page + 1)
        if current_page is not None:
            target = str(current_page + 1)
            for xp in (
                f".//li[not(contains(@class,'jump')) and not(contains(@class,'more')) and not(contains(@class,'last'))]/a[normalize-space(text())='{target}']",
                f".//a[normalize-space(text())='{target}']",
            ):
                try:
                    btn = container_el.find_element(By.XPATH, xp)
                    if btn.is_displayed():
                        container_el._parent.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                        container_el._parent.execute_script("arguments[0].click();", btn)
                        wait_for_invisible(driver, ".next-loading, .ant-spin-spinning, .next-loading-tip", timeout=0.8)
                        return _clicked_wait()
                except Exception:
                    continue

        # 2) conservative “Next” inside container
        for xp in (
            ".//a[(contains(@aria-label,'Next') or contains(.,'Next')) and not(contains(@class,'disabled'))]",
            ".//button[(contains(@aria-label,'Next') or contains(.,'Next')) and not(contains(@class,'disabled'))]",
            ".//li[contains(@class,'active')]/following-sibling::li[1]/a[not(contains(@class,'disabled'))]",
            ".//*[contains(@class,'next-pagination-item') and contains(@class,'next')]//a[not(contains(@class,'disabled'))]"
        ):
            try:
                btn = container_el.find_element(By.XPATH, xp)
                cls = (btn.get_attribute("class") or "").lower()
                if any(k in cls for k in ("jump", "more", "quick", "last", "double", "fast", "disabled")):
                    continue
                if btn.is_displayed():
                    container_el._parent.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                    container_el._parent.execute_script("arguments[0].click();", btn)
                    wait_for_invisible(driver, ".next-loading, .ant-spin-spinning, .next-loading-tip", timeout=0.8)
                    return _clicked_wait()
            except Exception:
                continue

        # 3) page-level fallbacks
        for css in ("a.next-next", "button.next-next",
                    ".next-pagination-item.next a", ".next-pagination-item.next button",
                    "a[aria-label='Next']", "button[aria-label='Next']", "li.next a"):
            try:
                btn = driver.find_element(By.CSS_SELECTOR, css)
                if btn.is_displayed() and (not hasattr(btn, "is_enabled") or btn.is_enabled()):
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                    driver.execute_script("arguments[0].click();", btn)
                    wait_for_invisible(driver, ".next-loading, .ant-spin-spinning, .next-loading-tip", timeout=0.8)
                    return _clicked_wait()
            except Exception:
                continue

        return False

    # ---- open PDP ----
    driver.get(url)
    WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    jitter(args.min_delay, args.max_delay)

    # dismiss blocking overlays; skip if hard login wall
    try:
        if not close_login_overlays(driver, args.verbose):
            log("Login wall detected, skipping page", args.verbose)
            return []
    except Exception:
        pass

    # switch to review iframe if present
    _ = switch_into_review_iframe_if_present(driver, args.verbose)

    # locate the reviews container (optionally click "Reviews" tab first)
    container = find_reviews_container(driver, args.verbose, try_click_tab=args.open_reviews_tab)
    if not container:
        if args.dump_html:
            write_dump(args.dump_html, "page_source.html", driver.page_source)
        return []

    # bail fast on explicit empty state
    if container_is_empty(container):
        if args.dump_html:
            try:
                html = container.get_attribute("outerHTML") or ""
            except Exception:
                html = driver.page_source
            write_dump(args.dump_html, _dump_name_for(url, "reviews_empty.html"), html)
        return []

    # keep the container in view and warm it up
    try:
        pin_container_into_view(driver, container)
    except Exception:
        pass
    scroll_reviews_container(container, passes=3, delay=0.25, verbose=args.verbose)

    # ---- main load loop ----
    total_loops = max(1, int(args.pages))
    prev_count = rows_len(container)
    loops_done = 0
    seen = set()
    collected: List[dict] = []

    while loops_done < total_loops:
        # click a single "Load more" inside the container (no-op if absent)
        click_load_more_in_container(container, 1, args.verbose, args.min_delay, args.max_delay)

        # scroll the container to trigger lazy loads
        scroll_reviews_container(container, passes=3, delay=0.25, verbose=args.verbose)

        # container may re-mount; refresh the handle if we still can find it
        try:
            container = find_reviews_container(driver, args.verbose, try_click_tab=False) or container
        except Exception:
            pass

        curr_count = wait_for_review_growth(container, prev_count, timeout=2.5, poll=0.1)
        if args.verbose:
            log(f"[reviews] count grew {prev_count} → {curr_count}", True)

        # harvest current batch
        for r in extract_reviews_from_container(container):
            key = (r.get("author") or "", (r.get("review_text") or "")[:120])
            if key not in seen:
                seen.add(key)
                collected.append(r)

        # If no growth, try paginated "Next"
        if curr_count <= prev_count:
            old_page = get_active_review_page(container)
            if not try_click_numeric_next_in_container(container, old_page, driver, args.review_next_selector):
                break
            # Wait for page number or content change to avoid skipping
            if not wait_for_page_change(container, old_page):
                break
            # re-pin and gentle warm-up
            try:
                pin_container_into_view(driver, container, offset=120)
            except Exception:
                pass
            scroll_reviews_container(container, passes=3, delay=0.25, verbose=args.verbose)
            try:
                container = find_reviews_container(driver, args.verbose, try_click_tab=False) or container
            except Exception:
                pass
            curr_count = rows_len(container)
            if args.verbose:
                log(f"[reviews-next] page advanced; count now {curr_count}", True)
            if curr_count <= prev_count:
                break

        prev_count = curr_count
        loops_done += 1
        jitter(args.min_delay, args.max_delay)

    # final pass to catch any late-mount items
    for r in extract_reviews_from_container(container):
        key = (r.get("author") or "", (r.get("review_text") or "")[:120])
        if key not in seen:
            seen.add(key); collected.append(r)

    # dump the container HTML if nothing parsed (for debugging)
    if not collected and args.dump_html:
        try:
            html = container.get_attribute("outerHTML") or ""
            write_dump(args.dump_html, "reviews_container.html", html)
        except Exception:
            html = driver.page_source
        write_dump(args.dump_html, _dump_name_for(url, "reviews_container.html"), html)

    # enrich rows
    pname = extract_product_name(driver)
    now = datetime.utcnow().isoformat() + "Z"
    out: List[dict] = []
    for r in collected:
        out.append({
            "source_domain": "www.lazada.sg",
            "page_url": url,
            "product_name": pname,
            "review_id": r.get("review_id"),
            "review_title": r.get("title"),
            "review_text": r.get("review_text"),
            "rating": r.get("rating"),
            "author": r.get("author"),
            "review_date": r.get("review_date"),
            "ts_ingested": now,
        })
    return out



def uniq_keep_order(xs: Iterable[str]) -> List[str]:
    seen = set(); out = []
    for x in xs:
        if x not in seen:
            seen.add(x); out.append(x)
    return out

def main():
    args = parse_args()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ensure_outfile(out_path)

    # Build list of PDP URLs
    urls = list(args.urls) if args.urls else []
    driver = None
    stats = Stats()

    try:
        driver = get_driver(args)

        # Discover PDPs from search terms/URLs if requested
        for term in args.discover:
            urls.extend(discover_pdp_urls(driver, term, args.discover_scrolls, args.discover_limit, args.verbose))

        urls = [u for u in uniq_keep_order(urls) if is_lazada_pdp(u)]
        if not urls:
            print("No PDP URLs to scrape. Use --urls or --discover.")
            sys.exit(1)

        snap_path = None
        if args.with_snapshot or args.snapshot_only:
            snap_path = Path(args.snapshots_out)
            snap_path.parent.mkdir(parents=True, exist_ok=True)
            ensure_outfile(snap_path)

        with out_path.open("a", encoding="utf-8") as f:
            snap_f = snap_path.open("a", encoding="utf-8") if snap_path else None
            for url in urls:
                stats.scanned += 1
                try:
                    # --- PDP SNAPSHOT ---
                    if snap_f is not None:
                        try:
                            snap = scrape_lazada_pdp_snapshot(driver, url, args)
                            if snap:
                                snap_f.write(json.dumps(snap, ensure_ascii=False) + "\n")
                                stats.snapshots += 1
                                log(f"[snapshot] {url}", args.verbose)
                        except Exception as se:
                            log(f"[snapshot] Error: {se}", True)

                    # --- REVIEWS (skip if snapshot-only) ---
                    if not args.snapshot_only:
                        rows = scrape_lazada_pdp(driver, url, args)
                        if not rows:
                            stats.empty += 1
                        for row in rows:
                            f.write(json.dumps(row, ensure_ascii=False) + "\n")
                        stats.emitted += len(rows)
                        log(f"URL scraped: {url} • emitted {len(rows)}", True)

                except Exception as e:
                    log(f"Error scraping {url}: {e}", True)
                finally:
                    jitter(args.min_delay, args.max_delay)

            if snap_f is not None:
                snap_f.close()

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    print(f"Done. Scanned={stats.scanned} EmittedReviews={stats.emitted} "
      f"Snapshots={stats.snapshots} EmptyPDPs={stats.empty} Skipped=0")

if __name__ == "__main__":
    main()
