#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Targeted e-commerce reviews scraper (Selenium)
- Focus on Amazon by ASIN with robust anti-bot mitigations
- Generic URL mode for other sites (best-effort)

CLI examples:
  pip install selenium webdriver-manager beautifulsoup4 undetected-chromedriver
  python scrap_reviews.py --amazon B01J8LETQC --pages 3 --stealth --mobile --mobile-site --profile-dir ./chrome_profile_amz --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

from bs4 import BeautifulSoup

# --- Selenium / Chrome ---
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
]
MOBILE_USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
]

RAND = random.Random()

# -----------------------------
# Output sink
# -----------------------------
@dataclass
class JsonlSink:
    path: Path
    def __post_init__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fp = None
    def _ensure(self):
        if self._fp is None:
            self._fp = open(self.path, "a", encoding="utf-8")
    def emit(self, row: dict):
        self._ensure()
        self._fp.write(json.dumps(row, ensure_ascii=False) + "\n")
        self._fp.flush()
    def close(self):
        if self._fp:
            self._fp.close()
            self._fp = None

# -----------------------------
# Driver setup
# -----------------------------
def make_driver(
    headless: bool = True,
    lang: str = "en-SG",
    stealth: bool = False,
    mobile: bool = False,
    profile_dir: Optional[str] = None,
    proxy: Optional[str] = None,
) -> webdriver.Chrome:
    ua = RAND.choice(MOBILE_USER_AGENTS if mobile else USER_AGENTS)

    if stealth:
        # Prefer undetected_chromedriver if installed
        try:
            import undetected_chromedriver as uc  # type: ignore
            opts = uc.ChromeOptions()
            if headless:
                opts.add_argument("--headless=new")
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
            opts.add_argument("--disable-blink-features=AutomationControlled")
            opts.add_experimental_option("excludeSwitches", ["enable-automation"])
            opts.add_experimental_option("useAutomationExtension", False)
            opts.add_argument(f"--user-agent={ua}")
            opts.add_argument(f"--lang={lang}")
            opts.add_argument("--window-size=390,844" if mobile else "--window-size=1200,2000")
            if profile_dir:
                opts.add_argument(f"--user-data-dir={os.path.abspath(profile_dir)}")
            if proxy:
                opts.add_argument(f"--proxy-server={proxy}")
            driver = uc.Chrome(options=opts)
            try:
                driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
                    "source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
                })
            except Exception:
                pass
            return driver
        except Exception:
            # Fallback to regular driver if uc isn't available
            pass

    opts = ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument(f"--user-agent={ua}")
    opts.add_argument(f"--lang={lang}")
    opts.add_argument("--window-size=390,844" if mobile else "--window-size=1200,2000")
    if profile_dir:
        opts.add_argument(f"--user-data-dir={os.path.abspath(profile_dir)}")
    if proxy:
        opts.add_argument(f"--proxy-server={proxy}")

    svc = ChromeService(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=svc, options=opts)

    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        })
    except Exception:
        pass
    return driver

# -----------------------------
# Anti-bot / consent helpers
# -----------------------------
def click_amazon_consent(driver) -> bool:
    selectors = [
        "#sp-cc-accept",
        "input#sp-cc-accept",
        "button[data-action='sp-cc-accept']",
        "#sp-cc-accept-all",
    ]
    for sel in selectors:
        try:
            btn = WebDriverWait(driver, 3).until(EC.element_to_be_clickable((By.CSS_SELECTOR, sel)))
            btn.click()
            time.sleep(0.3)
            return True
        except Exception:
            pass
    return False

def is_bot_check(html: str) -> bool:
    pat = (
        "Robot Check",
        "Enter the characters you see below",
        "captchacharacters",
        "To discuss automated access",
    )
    return any(s in html for s in pat)

def gentle_scroll(driver, times: int = 3, wait: float = 0.5):
    for _ in range(max(1, times)):
        try:
            driver.execute_script("window.scrollBy(0, document.body.scrollHeight);")
            time.sleep(wait)
        except Exception:
            break

# -----------------------------
# Amazon helpers
# -----------------------------
AMAZON_HOST = "www.amazon.sg"
AMAZON_LANG_PREFIX = "/-/en"  # helps avoid language/region redirects

def amazon_reviews_url(asin: str, page: int) -> str:
    return (
        f"https://{AMAZON_HOST}{AMAZON_LANG_PREFIX}/product-reviews/{asin}/"
        f"?reviewerType=all_reviews&sortBy=recent&pageNumber={page}&ie=UTF8"
    )

def amazon_mobile_reviews_url(asin: str, page: int) -> str:
    # lighter mobile reviews endpoint that often avoids sign-in bumps
    return f"https://{AMAZON_HOST}/gp/aw/cr/{asin}?pageNumber={page}&sort=recent&filterByStar=all_stars"

def amazon_pdp_url(asin: str) -> str:
    return f"https://{AMAZON_HOST}{AMAZON_LANG_PREFIX}/dp/{asin}"

def parse_amazon_reviews(html: str) -> Tuple[Optional[str], List[dict]]:
    soup = BeautifulSoup(html, "html.parser")
    pname_el = soup.select_one('[data-hook="cr-title"], a[data-hook="product-link"], #cm_cr-product_info')
    product_name = pname_el.get_text(" ", strip=True) if pname_el else None

    out: List[dict] = []
    for rev in soup.select('[data-hook="review"]'):
        rid = rev.get("id")
        title_el = rev.select_one('[data-hook="review-title"]')
        body_el = rev.select_one('[data-hook="review-body"]')
        rating_el = rev.select_one('.a-icon-alt')
        author_el = rev.select_one('.a-profile-name')
        date_el = rev.select_one('[data-hook="review-date"]')

        title = title_el.get_text(" ", strip=True) if title_el else None
        body = body_el.get_text(" ", strip=True) if body_el else None

        rating = None
        if rating_el:
            txt = rating_el.get_text(" ", strip=True)
            m = re.search(r"(\d(?:\.\d+)?)\s*out of\s*5", txt)
            if m:
                try:
                    rating = float(m.group(1))
                except Exception:
                    rating = None

        author = author_el.get_text(" ", strip=True) if author_el else None
        date_txt = date_el.get_text(" ", strip=True) if date_el else None

        if body or rating:
            out.append({
                "review_id": rid,
                "review_title": title,
                "review_text": body,
                "rating": rating,
                "author": author,
                "review_date": date_txt,
            })
    return product_name, out

class AmazonScraper:
    def __init__(self, driver: webdriver.Chrome, out: JsonlSink, min_delay: float, max_delay: float, verbose: bool, use_mobile_site: bool = False):
        self.driver = driver
        self.out = out
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.verbose = verbose
        self.use_mobile_site = use_mobile_site

    def _sleep_a_bit(self):
        time.sleep(RAND.uniform(self.min_delay, self.max_delay))

    def _navigate_via_pdp(self, asin: str) -> bool:
        """Open product page then click 'See all reviews' to look more human."""
        try:
            self.driver.get(amazon_pdp_url(asin))
            click_amazon_consent(self.driver)
            WebDriverWait(self.driver, 15).until(EC.presence_of_element_located((By.CSS_SELECTOR, "body")))
            gentle_scroll(self.driver, times=2, wait=0.6)
            # Footer link
            try:
                link = WebDriverWait(self.driver, 6).until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, "a[data-hook='see-all-reviews-link-foot']"))
                )
                link.click()
                time.sleep(0.8)
                return True
            except TimeoutException:
                try:
                    link = self.driver.find_element(By.CSS_SELECTOR, "a[href*='product-reviews']")
                    link.click()
                    time.sleep(0.8)
                    return True
                except Exception:
                    return False
        except Exception:
            return False

    def scrape_asin(self, asin: str, pages: int):
        # Try via PDP path once (reduces sign-in bumps)
        self._navigate_via_pdp(asin)
        for p in range(1, max(1, pages) + 1):
            url = amazon_mobile_reviews_url(asin, p) if self.use_mobile_site else amazon_reviews_url(asin, p)
            try:
                self.driver.get(url)
                if "/ap/signin" in (self.driver.current_url or ""):
                    if self.verbose:
                        print("Hit sign-in page; backing off and retrying via PDP path once…")
                    self._sleep_a_bit()
                    if not self._navigate_via_pdp(asin):
                        self.driver.get(url)

                click_amazon_consent(self.driver)
                gentle_scroll(self.driver, times=2, wait=0.6)

                try:
                    WebDriverWait(self.driver, 20).until(
                        EC.any_of(
                            EC.presence_of_element_located((By.CSS_SELECTOR, "[data-hook='review']")),
                            EC.presence_of_element_located((By.CSS_SELECTOR, "#cm_cr-review_list [data-hook='review']")),
                            EC.presence_of_element_located((By.CSS_SELECTOR, "[id^='customer_review-']")),
                            EC.presence_of_element_located((By.CSS_SELECTOR, "#noReviewsMessage")),
                        )
                    )
                except TimeoutException:
                    if self.verbose:
                        print(f"Timeout waiting for reviews on p{p} of {asin}")

                html = self.driver.page_source
                if is_bot_check(html) or "/ap/signin" in (self.driver.current_url or ""):
                    print("[Amazon] Sign-in or bot-check appeared. Do not log in. Try --mobile-site and/or --profile-dir (non-headless once).", file=sys.stderr)
                    break

                product_name, rows = parse_amazon_reviews(html)

                emitted = 0
                for r in rows:
                    txt = (r.get("review_text") or "").strip()
                    if not txt or len(txt) < 15:
                        continue
                    row = {
                        "source_domain": AMAZON_HOST,
                        "page_url": url,
                        "product_name": product_name,
                        **r,
                        "page_num": p,
                        "asin": asin.upper(),
                        "ts_ingested": datetime.utcnow().isoformat() + "Z",
                    }
                    self.out.emit(row)
                    emitted += 1

                if self.verbose:
                    print(f"ASIN {asin} p{p}: emitted {emitted} reviews • URL={url}")

            except WebDriverException as e:
                print(f"[Amazon] Error on ASIN {asin} p{p}: {e}", file=sys.stderr)

            self._sleep_a_bit()

# -----------------------------
# Generic site (best-effort)
# -----------------------------
BOILERPLATE_PAT = re.compile(
    r"(Terms of Service|Privacy Policy|Play Pass|Sign In|©\s*20\d{2}|To calculate the overall star rating)",
    re.I,
)
REVIEW_HINTS = {
    "wrap": re.compile(r"review|comment-list|ratings?", re.I),
    "text": re.compile(r"review[-_\s]?text|content|comment|body", re.I),
    "title": re.compile(r"review[-_\s]?title|headline|summary", re.I),
    "rating": re.compile(r"rating|stars?", re.I),
    "author": re.compile(r"author|user|profile|nickname|by[-_\s]?line", re.I),
    "date": re.compile(r"date|time|posted|published", re.I),
}

def find_jsonld(soup: BeautifulSoup) -> List[dict]:
    out: List[dict] = []
    for tag in soup.find_all("script", {"type": "application/ld+json"}):
        txt = (tag.string or tag.get_text() or "").strip()
        if not txt:
            continue
        try:
            data = json.loads(txt)
            if isinstance(data, (dict, list)):
                out.append(data)
        except Exception:
            pass
    return out

def walk_json(o) -> Iterable[dict]:
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk_json(v)
    elif isinstance(o, list):
        for x in o:
            yield from walk_json(x)

def parse_schema_reviews(blocks: List[dict]) -> Tuple[Optional[str], List[dict]]:
    name = None
    rows: List[dict] = []
    for node in walk_json(blocks):
        if not isinstance(node, dict):
            continue
        t = node.get("@type")
        if isinstance(t, list):
            t = t[0] if t else None
        if t == "Product":
            if not name and isinstance(node.get("name"), str):
                name = node.get("name").strip() or name
            revs = node.get("review")
            if isinstance(revs, list):
                for r in revs:
                    if not isinstance(r, dict):
                        continue
                    rows.append({
                        "review_title": r.get("name"),
                        "review_text": r.get("reviewBody"),
                        "rating": (r.get("reviewRating") or {}).get("ratingValue") if isinstance(r.get("reviewRating"), dict) else None,
                        "author": (r.get("author") or {}).get("name") if isinstance(r.get("author"), dict) else r.get("author"),
                        "review_date": r.get("datePublished"),
                    })
        elif t == "Review":
            rows.append({
                "review_title": node.get("name"),
                "review_text": node.get("reviewBody"),
                "rating": (node.get("reviewRating") or {}).get("ratingValue") if isinstance(node.get("reviewRating"), dict) else None,
                "author": (node.get("author") or {}).get("name") if isinstance(node.get("author"), dict) else node.get("author"),
                "review_date": node.get("datePublished"),
            })
    out = []
    seen = set()
    for r in rows:
        txt = (r.get("review_text") or "").strip()
        key = ((r.get("author") or "").strip(), txt[:80])
        if not txt or len(txt) < 15 or BOILERPLATE_PAT.search(txt) or key in seen:
            continue
        seen.add(key)
        out.append(r)
    return name, out

class GenericUrlScraper:
    def __init__(self, driver: webdriver.Chrome, out: JsonlSink, min_delay: float, max_delay: float, verbose: bool):
        self.driver = driver
        self.out = out
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.verbose = verbose

    def _sleep_a_bit(self):
        time.sleep(RAND.uniform(self.min_delay, self.max_delay))

    def scrape_url(self, url: str):
        try:
            self.driver.get(url)
            WebDriverWait(self.driver, 12).until(lambda d: d.execute_script("return document.readyState") == "complete")
            html = self.driver.page_source
            soup = BeautifulSoup(html, "html.parser")
            name, rows = parse_schema_reviews(find_jsonld(soup))
            if not rows:
                rows = []
                candidates = []
                for el in soup.find_all(True):
                    label = (" ".join(el.get("class", [])) + " " + (el.get("id") or "")).lower()
                    if REVIEW_HINTS["wrap"].search(label):
                        candidates.append(el)
                if not candidates:
                    candidates = [soup]
                for container in candidates[:6]:
                    for item in container.find_all(True, recursive=True):
                        text = item.get_text(" ", strip=True)
                        if not text or len(text) < 12:
                            continue
                        body_el = item.find(attrs={"class": REVIEW_HINTS["text"]})
                        title_el = item.find(attrs={"class": REVIEW_HINTS["title"]}) or item.find(["h3", "h4"])
                        rating_el = item.find(attrs={"class": REVIEW_HINTS["rating"]}) or item.find(
                            attrs={"aria-label": re.compile(r"\d(\.\d+)? out of 5", re.I)}
                        )
                        author_el = item.find(attrs={"class": REVIEW_HINTS["author"]})
                        date_el = item.find(attrs={"class": REVIEW_HINTS["date"]})
                        body = body_el.get_text(" ", strip=True) if body_el else None
                        title = title_el.get_text(" ", strip=True) if title_el else None
                        rating = None
                        if rating_el:
                            label = rating_el.get("aria-label") or rating_el.get_text(" ", strip=True)
                            m = re.search(r"(\d(?:\.\d+)?)\s*out of\s*5", label)
                            if m:
                                try:
                                    rating = float(m.group(1))
                                except Exception:
                                    rating = None
                        author = author_el.get_text(" ", strip=True) if author_el else None
                        date_txt = date_el.get_text(" ", strip=True) if date_el else None
                        txt_ok = body and len(body) >= 15 and not BOILERPLATE_PAT.search(body or "")
                        if txt_ok or rating or title:
                            rows.append({
                                "review_title": title,
                                "review_text": body,
                                "rating": rating,
                                "author": author,
                                "review_date": date_txt,
                            })
            emitted = 0
            seen = set()
            for r in rows:
                txt = (r.get("review_text") or "").strip()
                if not txt or len(txt) < 15:
                    continue
                key = ((r.get("author") or "").strip(), txt[:80])
                if key in seen:
                    continue
                seen.add(key)
                row = {
                    "source_domain": re.sub(r"^https?://", "", url).split("/")[0],
                    "page_url": url,
                    "product_name": name,
                    **r,
                    "ts_ingested": datetime.utcnow().isoformat() + "Z",
                }
                self.out.emit(row)
                emitted += 1
            if self.verbose:
                print(f"URL scraped: {url} • emitted {emitted}")
        except WebDriverException as e:
            print(f"[Generic] Error on URL {url}: {e}", file=sys.stderr)
        self._sleep_a_bit()

# -----------------------------
# CLI & main
# -----------------------------
def parse_args():
    ap = argparse.ArgumentParser(description="Targeted reviews scraper (Selenium)")
    ap.add_argument("--amazon", nargs="*", help="ASIN list for Amazon.sg (e.g., B01J8LETQC B0C1234567)")
    ap.add_argument("--urls", nargs="*", help="Specific product URLs to scrape (Guardian/Watsons/etc.)")
    ap.add_argument("--pages", type=int, default=3, help="# of review pages per ASIN (Amazon only)")
    ap.add_argument("--out", default="out/reviews.jsonl", help="JSONL output path")
    ap.add_argument("--headless", action="store_true", help="Run headless Chrome")
    ap.add_argument("--min-delay", type=float, default=0.8, help="Min delay between pages (s)")
    ap.add_argument("--max-delay", type=float, default=1.8, help="Max delay between pages (s)")
    ap.add_argument("--lang", default="en-SG", help="Accept-Language / UI language hint for sites")
    ap.add_argument("--mobile", action="store_true", help="Use a mobile user agent (can reduce sign-in walls)")
    ap.add_argument("--stealth", action="store_true", help="Use undetected_chromedriver for anti-bot")
    ap.add_argument("--mobile-site", action="store_true", help="Use Amazon mobile reviews endpoint (gp/aw/cr/ASIN)")
    ap.add_argument("--profile-dir", help="Persist Chrome profile at this path (keeps cookies)")
    ap.add_argument("--proxy", help="HTTP proxy like http://host:port (optional)")
    ap.add_argument("--verbose", action="store_true", help="Verbose logs")
    return ap.parse_args()

def main():
    args = parse_args()
    if not args.amazon and not args.urls:
        print("Nothing to do. Provide --amazon ASINs and/or --urls product pages.")
        sys.exit(2)

    sink = JsonlSink(Path(args.out))
    driver = make_driver(
        headless=args.headless,
        lang=args.lang,
        stealth=args.stealth,
        mobile=args.mobile,
        profile_dir=args.profile_dir,
        proxy=args.proxy,
    )
    try:
        if args.amazon:
            amz = AmazonScraper(driver, sink, args.min_delay, args.max_delay, args.verbose, use_mobile_site=args.mobile_site)
            for asin in args.amazon:
                asin = asin.strip().upper()
                if not re.fullmatch(r"[A-Z0-9]{10}", asin):
                    print(f"[Amazon] Skipping invalid ASIN: {asin}")
                    continue
                amz.scrape_asin(asin, args.pages)
        if args.urls:
            gen = GenericUrlScraper(driver, sink, args.min_delay, args.max_delay, args.verbose)
            for url in args.urls:
                gen.scrape_url(url)
    finally:
        sink.close()
        try:
            driver.quit()
        except Exception:
            pass

if __name__ == "__main__":
    main()
