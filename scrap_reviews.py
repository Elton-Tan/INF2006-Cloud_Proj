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

# ---------------- CLI ----------------
def parse_args():
    ap = argparse.ArgumentParser(description="Lazada PDP reviews scraper (Selenium)")
    ap.add_argument("--urls", nargs="*", default=[], help="Lazada PDP URLs")
    ap.add_argument("--discover", nargs="*", default=[], help="Lazada search URLs or plain queries (e.g., 'foot cream')")
    ap.add_argument("--discover-limit", type=int, default=12, help="Max PDPs to collect from discovery")
    ap.add_argument("--discover-scrolls", type=int, default=6, help="Scroll passes on search pages")
    ap.add_argument("--pages", type=int, default=2, help="# of 'Load more reviews' clicks per PDP")
    ap.add_argument("--out", default="out/lazada_reviews.jsonl", help="JSONL output path")
    ap.add_argument("--headless", action="store_true", help="Headless Chrome")
    ap.add_argument("--min-delay", type=float, default=0.5, help="Min delay between actions (s)")
    ap.add_argument("--max-delay", type=float, default=1.2, help="Max delay between actions (s)")
    ap.add_argument("--lang", default="en-SG", help="Accept-Language hint")
    ap.add_argument("--mobile", action="store_true", help="Use a mobile UA (optional)")
    ap.add_argument("--profile-dir", default=None, help="Chrome user-data-dir (optional)")
    ap.add_argument("--proxy", default=None, help="http://host:port (optional)")
    ap.add_argument("--dump-html", default=None, help="Directory to dump HTML when 0 reviews")
    ap.add_argument("--verbose", action="store_true", help="Verbose logs")
    return ap.parse_args()

# ---------------- Helpers ----------------
MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1")
DESKTOP_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

EMPTY_PAT = re.compile(r"\bThis product has no reviews\b", re.I)
BOILERPLATE_PAT = re.compile(
    r"(log[\s-]?in|sign[\s-]?in|store locator|careers|privacy policy|terms & conditions|"
    r"about guardian|categories|all brands|follow us on|©\s*20\d{2}|"
    r"mobile number|log in with (apple|google|facebook))",
    re.I
)

def jitter(a,b): time.sleep(random.uniform(a,b))
def log(msg, v): 
    if v: print(msg, flush=True)

def ensure_outfile(p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists(): p.touch()

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
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--window-size=1400,2600")
    opts.add_argument(f"--lang={args.lang}")
    opts.add_argument(f"user-agent={(MOBILE_UA if args.mobile else DESKTOP_UA)}")
    if args.profile_dir: opts.add_argument(f"--user-data-dir={Path(args.profile_dir).absolute()}")
    if args.proxy: opts.add_argument(f"--proxy-server={args.proxy}")
    drv = webdriver.Chrome(options=opts)
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
    if not path_dir: return
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
        overlays = driver.find_elements(By.XPATH, "//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'log in') or contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login')]")
        if overlays:
            lst = driver.find_elements(By.XPATH, "//*[@id='module_product_review'] | //*[contains(@data-qa-locator,'review-list')]")
            if not lst:
                return False
    except Exception:
        pass
    return True

def find_reviews_container(driver, verbose):
    """Return the primary reviews container element if visible, else None."""
    wait = WebDriverWait(driver, 12)
    # Try clicking Reviews tab if present (desktop layout)
    try:
        tab = wait.until(EC.element_to_be_clickable(
            (By.XPATH,
             "//a[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review')]"
             " | //button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review')]"
             " | //div[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'ratings')]")
        ))
        driver.execute_script("arguments[0].click();", tab)
        log("Clicked reviews tab", verbose)
        time.sleep(0.6)
    except Exception:
        log("Reviews tab not clickable (maybe already active or mobile layout)", verbose)

    # Scroll a bit to trigger lazy load
    for _ in range(5):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(0.7)

    # Candidate containers
    X_CONTAINERS = [
        "//*[@id='module_product_review']",
        "//*[@data-qa-locator='review-list']",
        "//*[contains(@data-qa-locator,'review-list')]",
        "//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'mod-reviews')]",
    ]
    for xp in X_CONTAINERS:
        try:
            el = driver.find_element(By.XPATH, xp)
            if el.is_displayed():
                return el
        except Exception:
            continue
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
        "//h1"
    ]:
        try:
            t = safe_text(driver.find_element(By.XPATH, xp))
            if t: return t
        except Exception:
            continue
    try:
        return driver.title.split("|")[0].strip() or None
    except Exception:
        return None

def parse_rating(label: str) -> Optional[float]:
    if not label: return None
    m = re.search(r"(\d(?:\.\d+)?)\s*out of\s*5", label, re.I)
    if m:
        try: return float(m.group(1))
        except Exception: return None
    return None

def extract_reviews_from_container(container) -> List[dict]:
    """
    Extract reviews inside the given container.
    Prefer explicit data-qa-locator nodes, then fall back heuristics.
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
                    if body: break
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
                    if rating is not None: break
                except Exception:
                    continue

            for xp in [
                ".//*[@data-qa-locator='review-user-name']",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'author')]",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'name')]",
            ]:
                try:
                    author = safe_text(node.find_element(By.XPATH, xp))
                    if author: break
                except Exception:
                    continue

            for xp in [
                ".//*[@data-qa-locator='review-time']",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'date')]",
                ".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'time')]",
            ]:
                try:
                    date_txt = safe_text(node.find_element(By.XPATH, xp))
                    if date_txt: break
                except Exception:
                    continue

            if body and len(body) >= 15 and not BOILERPLATE_PAT.search(body):
                if (rating is not None) or re.search(r"\b(quality|texture|greasy|greasiness|smell|sticky|absorb|relief|worked|didn'?t work|crack|heel|itch|fungus)\b", body, re.I):
                    reviews.append({
                        "review_id": None,
                        "title": None,
                        "review_text": body,
                        "rating": rating,
                        "author": author,
                        "review_date": date_txt
                    })
        except Exception:
            continue

    # de-dup
    seen, out = set(), []
    for r in reviews:
        key = ((r.get("author") or "").strip(), (r.get("review_text") or "")[:100])
        if key in seen: continue
        seen.add(key); out.append(r)
    return out

# ---------------- Main flow ----------------
@dataclass
class Stats:
    scanned:int=0; emitted:int=0; skipped:int=0; empty:int=0

def scrape_lazada_pdp(driver, url, args) -> List[dict]:
    driver.get(url)
    WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    jitter(args.min_delay, args.max_delay)

    if not close_login_overlays(driver, args.verbose):
        log("Login wall detected, skipping page", args.verbose)
        return []

    container = find_reviews_container(driver, args.verbose)
    if not container:
        log("No visible reviews container found", args.verbose)
        if args.dump_html:
            write_dump(args.dump_html, "page_source.html", driver.page_source)
        return []

    # NEW: fast path — detect empty-state and bail
    if container_is_empty(container):
        log("PDP has zero reviews (empty-state)", args.verbose)
        return []

    click_load_more_in_container(container, args.pages, args.verbose, args.min_delay, args.max_delay)

    pname = extract_product_name(driver)
    rows = extract_reviews_from_container(container)
    if not rows and args.dump_html:
        html = container.get_attribute("outerHTML") or ""
        write_dump(args.dump_html, "reviews_container.html", html)

    now = datetime.utcnow().isoformat() + "Z"
    out=[]
    for r in rows:
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
            "ts_ingested": now
        })
    return out

def uniq_keep_order(xs: Iterable[str]) -> List[str]:
    seen=set(); out=[]
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

        with out_path.open("a", encoding="utf-8") as f:
            for url in urls:
                stats.scanned += 1
                try:
                    rows = scrape_lazada_pdp(driver, url, args)
                    if not rows:
                        # Count empty PDPs separately for visibility
                        stats.empty += 1
                    for row in rows:
                        f.write(json.dumps(row, ensure_ascii=False) + "\n")
                    stats.emitted += len(rows)
                    log(f"URL scraped: {url} • emitted {len(rows)}", True)
                except Exception as e:
                    log(f"Error scraping {url}: {e}", True)
                jitter(args.min_delay, args.max_delay)
    finally:
        if driver:
            try: driver.quit()
            except Exception: pass

    print(f"Done. Scanned={stats.scanned} Emitted={stats.emitted} EmptyPDPs={stats.empty} Skipped=0")

if __name__ == "__main__":
    main()
