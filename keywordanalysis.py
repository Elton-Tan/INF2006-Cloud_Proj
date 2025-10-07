# aspect_processing_fast.py
# Fast, streaming aspect-attention processing for ~1M reviews.
# Outputs gzipped JSONs: aspects_summary.json.gz and aspect_top_terms.json.gz

import argparse, json, math, re, time, unicodedata, gzip, io, os, sys
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple
import pandas as pd

# -----------------------------
# CLI / Config
# -----------------------------
def get_args():
    ap = argparse.ArgumentParser(description="Aspect Attention Processor (fast)")
    ap.add_argument("--csv", required=True, help="Path to reviews CSV")
    ap.add_argument("--text-cols", default="review_title,review_text",
                    help="Comma-separated text columns to use")
    ap.add_argument("--chunksize", type=int, default=200_000,
                    help="Rows per chunk (raise if you have RAM headroom)")
    ap.add_argument("--min-term-freq", type=int, default=100,
                    help="Prune global terms with total freq below this")
    ap.add_argument("--top-terms", type=int, default=50,
                    help="Top terms per aspect (by lift)")
    ap.add_argument("--enable-vader", action="store_true",
                    help="Compute mean sentiment per aspect (adds some CPU)")
    ap.add_argument("--bigrams", action="store_true",
                    help="Also count bigrams (Adj + token bigrams); more compute")
    ap.add_argument("--progress-every", type=int, default=100_000,
                    help="Progress log interval (rows)")
    ap.add_argument("--outdir", default=".",
                    help="Output directory for JSON.gz files")
    return ap.parse_args()

# -----------------------------
# Normalization / Tokenization
# -----------------------------
_ws_re   = re.compile(r"\s+")
_word_re = re.compile(r"[a-z_]+")  # allow underscores to keep phrases

STOP = {
    "the","and","for","are","you","but","was","with","this","that","have","has","had",
    "its","it's","they","them","too","very","much","lot","any","ive","i've","i","me",
    "she","he","her","him","our","their","there","here","than","then","just","also",
    "use","used","using","really","like","love","hate","product","products","makeup","mask"
}

# Optional domain-leaning stops (uncomment if you want less noise from generic words)
# STOP |= {
#     "skin","face","facial","cream","lotion","serum","gel","wash","cleanser",
#     # If you add these, Packaging aspect will rely more on explicit phrases below.
#     # "bottle","tube","jar","packaging",
# }

# Preserve high-value phrases as single tokens (e.g., "strong scent" -> "strong_scent")
PHRASE_MAP = {
    # Hydration
    "dry patches": "dry_patches",
    "hydrated skin": "hydrated_skin",
    "lightweight moisturizer": "lightweight_moisturizer",
    "apply moisturizer": "apply_moisturizer",
    "dewy hydrated": "dewy_hydrated",
    "moisturizing lotion": "moisturizing_lotion",
    "moisturized after": "moisturized_after",
    "less dry": "less_dry",
    # RoutineUsage
    "morning night": "morning_night",
    "night morning": "night_morning",
    "last step": "last_step",
    "first step": "first_step",
    "layer top": "layer_top",
    "easy apply": "easy_apply",
    "after application": "after_application",
    # Scent
    "strong scent": "strong_scent",
    "pleasant scent": "pleasant_scent",
    "weird smell": "weird_smell",
    "overpowering scent": "overpowering_scent",
    "earthy scent": "earthy_scent",
    # Feel
    "non greasy": "non_greasy",
    "not sticky": "not_sticky",
    "soft smooth": "soft_smooth",
    "feels clean": "feels_clean",
    "greasy oily": "greasy_oily",
    # ValuePrice
    "worth money": "worth_money",
    "good value": "good_value",
    "more expensive": "more_expensive",
    "quite expensive": "quite_expensive",
    # Packaging
    "squeeze tube": "squeeze_tube",
    "pump bottle": "pump_bottle",
    "little spatula": "little_spatula",
    "recyclable packaging": "recyclable_packaging",
    # Longevity
    "lasts longer": "lasts_longer",
    "leave overnight": "leave_overnight",
    "overnight results": "overnight_results",
    # Residue/Finish
    "leave residue": "leave_residue",
    "white residue": "white_residue",
    "greasy residue": "greasy_residue",
    "greasy film": "greasy_film",
    "tacky residue": "tacky_residue",
    "matte finish": "matte_finish",
    "smooth finish": "smooth_finish",
}

def normalize_phrases(s: str) -> str:
    out = s
    for k, v in PHRASE_MAP.items():
        out = re.sub(rf"\b{re.escape(k)}\b", v, out)
    # normalize common hyphen/space variants
    out = re.sub(r"\bnon[-\s]?greasy\b", "non_greasy", out)
    out = re.sub(r"\bnon[-\s]?sticky\b", "non_sticky", out)
    out = re.sub(r"\bfragrance[-\s]?free\b", "fragrance_free", out)
    return out

def norm_text(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s)
    s = s.replace("\uFFFD", " ")
    s = s.lower()
    s = _ws_re.sub(" ", s).strip()
    s = normalize_phrases(s)  # keep phrases as single tokens
    return s

def tokens_ngrams(text: str, include_bigrams: bool) -> List[str]:
    # underscores already preserve phrases; keep them as letters
    toks = _word_re.findall(text)
    toks = [t for t in toks if len(t) > 2 and t not in STOP and t != "_"]
    if not include_bigrams:
        return toks
    # optional global bigrams (usually off for speed)
    bigrams = [f"{toks[i]} {toks[i+1]}" for i in range(len(toks)-1)]
    return toks + bigrams

# -----------------------------
# Aspect Lexicon (regex OR-sets) – expanded using your surfaced terms
# -----------------------------
ASPECT_PATTERNS: Dict[str, List[str]] = {
    "Scent": [
        r"\b(scent|smell|fragrance|perfume|odor|odour|aroma)\b",
        r"\b(fragrant|unscented|fragrance[-\s]?free|strong_scent|pleasant_scent|weird_smell|overpowering_scent|earthy_scent)\b",
        r"\b(smell(?:s)?\s+(nice|good|awful|delicious|wonderful|natural))\b",
    ],
    "Feel": [
        r"\b(feel|feels|feeling|texture)\b",
        r"\b(sticky|tacky|greasy|oily|silky|smooth|lightweight|heavy)\b",
        r"\b(non[_\s-]?greasy|non[_\s-]?sticky|not[_\s-]?sticky|feels_clean|soft_smooth)\b",
    ],
    "Hydration": [
        r"\b(hydrat\w+|moisturis\w+|moisturiz\w+)\b",
        r"\b(dry(?:ness|ing)?|dry_patches|chapped|cracked|less_dry|not\s+dry|dewy_hydrated|hydrated_skin|plump\w*)\b",
        r"\b(lightweight_moisturizer|apply_moisturizer|moisturizing_lotion|moisturized_after)\b",
    ],
    "Irritation": [
        r"\b(irritat\w+|sting\w+|burn\w+|itch\w+|breakout|broke?\s?out|purge\w+)\b",
        r"\b(red(?:ness)?|inflamed|sensitive|sensitizing|red\s+face|red\s+marks)\b",
    ],
    "ResidueFinish": [
        r"\b(residue|film|finish|after(?:\s)?feel)\b",
        r"\b(leave_residue|white_residue|greasy_residue|greasy_film|tacky_residue|matte_finish|smooth_finish)\b",
    ],
    "Longevity": [
        r"\b(overnight|lasts?|lasting|lasts_longer|leave_overnight|overnight_results|wear\s*time)\b",
    ],
    "ValuePrice": [
        r"\b(price[dy]?|overprice[sd]?|expensive|cheap|value|worth|dupe)\b",
        r"\b(worth_money|good_value|quite_expensive|more_expensive|pricey)\b",
    ],
    "Packaging": [
        r"\b(tube|jar|pot|spatula|squee?ze|pump|applicator|packag(?:e|ing))\b",
        r"\b(squeeze_tube|pump_bottle|little_spatula|recyclable_packaging|leak(?:s|ed|ing)?|messy|seal)\b",
    ],
    "RoutineUsage": [
        r"\b(routine|step|layer(?:ing)?|morning|evening|night(?:ly)?\s+routine)\b",
        r"\b(morning_night|night_morning|first_step|last_step|layer_top|after_application|how\s+to\s+use|apply|application)\b",
    ],
}

def compile_aspect_regex(aspect_patterns: Dict[str, List[str]]) -> Dict[str, re.Pattern]:
    compiled = {}
    for aspect, plist in aspect_patterns.items():
        patt = "|".join(plist)
        compiled[aspect] = re.compile(patt)
    return compiled

# -----------------------------
# Optional: VADER sentiment
# -----------------------------
def init_vader(enable: bool):
    if not enable:
        return None
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        return SentimentIntensityAnalyzer()
    except Exception:
        print("[warn] VADER not available; continuing without sentiment.", file=sys.stderr)
        return None

# -----------------------------
# Lift (representativeness) score
# -----------------------------
def term_lift(term_count_in_aspect: int, aspect_total_terms: int,
              global_count: int, global_total: int, vocab_size: int) -> float:
    # Lift ≈ (term share within aspect) / (term share global) with additive smoothing
    num = (term_count_in_aspect + 1.0) / (aspect_total_terms + vocab_size)
    den = (global_count + 1.0) / (global_total + vocab_size)
    return num / den

# -----------------------------
# Main processing
# -----------------------------
def main():
    args = get_args()
    CSV_PATH = args.csv
    TEXT_COLS = [c.strip() for c in args.text_cols.split(",") if c.strip()]
    CHUNK_SIZE = args.chunksize
    MIN_TERM_FREQ_GLOBAL = args.min_term_freq
    TOP_TERMS_PER_ASPECT = args.top_terms
    ENABLE_VADER = args.enable_vader
    INCLUDE_BIGRAMS = args.bigrams
    PROGRESS_EVERY = args.progress_every
    OUTDIR = args.outdir

    os.makedirs(OUTDIR, exist_ok=True)
    t0 = time.time()

    # Read header once; map text columns to positions
    try:
        header = pd.read_csv(CSV_PATH, nrows=0).columns.tolist()
    except Exception as e:
        print(f"[error] Failed to read header from {CSV_PATH}: {e}", file=sys.stderr)
        sys.exit(1)

    missing = [c for c in TEXT_COLS if c not in header]
    if missing:
        print(f"[error] Missing expected text columns: {missing}", file=sys.stderr)
        sys.exit(1)

    col_idx = [header.index(c) for c in TEXT_COLS]
    usecols = TEXT_COLS  # only read what we need

    # Compile patterns once
    ASPECT_RX = compile_aspect_regex(ASPECT_PATTERNS)

    # Init sentiment
    vader = init_vader(ENABLE_VADER)
    use_vader = vader is not None
    sent_score = (lambda s: vader.polarity_scores(s)["compound"]) if use_vader else (lambda s: 0.0)

    # Aggregators
    total_docs = 0
    rows_seen = 0
    aspect_doc_hits: Counter = Counter()
    aspect_sent_sum: Counter = Counter()
    aspect_term_counts: Dict[str, Counter] = defaultdict(Counter)
    global_term_counts: Counter = Counter()

    # Stream read
    last_log = time.time()
    for chunk in pd.read_csv(
        CSV_PATH,
        chunksize=CHUNK_SIZE,
        dtype=str,
        keep_default_na=False,
        usecols=usecols,
        on_bad_lines="skip",
        engine="c",
    ):
        # Iterate rows as tuples (no Series allocations)
        for row in chunk.itertuples(index=False, name=None):
            rows_seen += 1

            parts = []
            for i in col_idx:
                v = row[i]
                if v:
                    parts.append(v)
            if not parts:
                continue

            txt = norm_text(" ".join(parts))
            if not txt:
                continue

            # ---- Sentence-windowed aspect scan ----
            sents = re.split(r"[.!?]\s+|\n+", txt)
            aspects_hit_doc: Set[str] = set()

            for sent in sents:
                if not sent:
                    continue
                local_hits = [a for a, rx in ASPECT_RX.items() if rx.search(sent)]
                if not local_hits:
                    continue

                # Optional sentiment per matched sentence
                sscore = sent_score(sent) if use_vader else 0.0
                terms = tokens_ngrams(sent, include_bigrams=INCLUDE_BIGRAMS)

                # Update per-aspect counts for this sentence
                for a in local_hits:
                    aspects_hit_doc.add(a)
                    if use_vader:
                        aspect_sent_sum[a] += sscore
                    if terms:
                        aspect_term_counts[a].update(terms)

                # Update global vocabulary once per matched sentence
                if terms:
                    global_term_counts.update(terms)

            # After all sentences for this doc
            if aspects_hit_doc:
                total_docs += 1
                for a in aspects_hit_doc:
                    aspect_doc_hits[a] += 1

            # Progress
            if rows_seen % PROGRESS_EVERY == 0:
                elapsed = time.time() - t0
                rps = rows_seen / max(elapsed, 1e-6)
                print(f"[progress] rows={rows_seen:,} docs_with_aspect={total_docs:,} | {rps:,.0f} rows/s | elapsed={elapsed:,.1f}s")

    # -----------------------------
    # Post-process
    # -----------------------------
    # Prune rare global terms
    vocab = {t for t, n in global_term_counts.items() if n >= MIN_TERM_FREQ_GLOBAL}
    vocab_size = len(vocab)
    global_total_terms = sum(global_term_counts[t] for t in vocab)

    # Build summary (share and optional sentiment)
    summary = []
    for aspect in ASPECT_RX.keys():
        docs = aspect_doc_hits.get(aspect, 0)
        share = docs / rows_seen if rows_seen else 0.0
        entry = {"aspect": aspect, "docs": int(docs), "share": round(share, 6)}
        if use_vader and docs > 0:
            entry["sent_mean"] = round(aspect_sent_sum.get(aspect, 0.0) / docs, 4)
        summary.append(entry)

    # Representative terms per aspect (by lift, then frequency)
    aspect_top_terms = {}
    for aspect, ctr in aspect_term_counts.items():
        # keep only pruned vocab terms
        filtered = {t: n for t, n in ctr.items() if t in vocab}
        aspect_total_terms = sum(filtered.values())
        if aspect_total_terms == 0:
            aspect_top_terms[aspect] = []
            continue
        scored = []
        for t, n in filtered.items():
            lf = term_lift(
                term_count_in_aspect=n,
                aspect_total_terms=aspect_total_terms,
                global_count=global_term_counts[t],
                global_total=global_total_terms,
                vocab_size=vocab_size or 1,
            )
            scored.append((t, n, lf))
        scored.sort(key=lambda x: (x[2], x[1]), reverse=True)
        top = [{"term": t, "n": int(n), "lift": round(lf, 3)} for t, n, lf in scored[:TOP_TERMS_PER_ASPECT]]
        aspect_top_terms[aspect] = top

    # -----------------------------
    # Save gzipped outputs
    # -----------------------------
    ts = int(time.time())
    manifest = {"last_updated": ts,
                "rows_seen": rows_seen,
                "docs_with_aspect": total_docs,
                "min_term_freq": MIN_TERM_FREQ_GLOBAL,
                "bigrams": INCLUDE_BIGRAMS,
                "vader": use_vader}

    def write_gz(obj, path):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        with open(path, "wb") as f:
            f.write(buf.getvalue())

    out_sum = os.path.join(OUTDIR, "aspects_summary.json.gz")
    out_top = os.path.join(OUTDIR, "aspect_top_terms.json.gz")
    out_manifest = os.path.join(OUTDIR, "manifest.json")

    write_gz(summary, out_sum)
    write_gz(aspect_top_terms, out_top)
    with open(out_manifest, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, ensure_ascii=False, indent=2)

    elapsed = time.time() - t0
    print(f"[done] rows={rows_seen:,} docs_with_aspect={total_docs:,} | elapsed={elapsed:,.1f}s")
    print(f"[out] {out_sum}\n[out] {out_top}\n[out] {out_manifest}")

if __name__ == "__main__":
    main()
