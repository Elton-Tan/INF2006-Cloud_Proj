# keywordanalysis.py
# Fast, streaming aspect-attention processing for large review CSVs.
# Adds a lightweight "overfitting" diagnostics report (no behavior changes).
# Always writes:
#   - aspects_summary.json.gz
#   - aspect_top_terms.json.gz
#   - manifest.json
# Optional:
#   - aspects_bundle.json                  (with --bundle)
#   - lexicon_auto_patterns.json           (with --emit-lexicon)
#   - lexicon_phrase_candidates.json       (with --emit-lexicon)
#   - lexicon_stop_suggestions.json        (with --emit-lexicon)
# New:
#   - diagnostics.json                     (always)

import argparse, json, re, time, unicodedata, gzip, io, os, sys, math
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple, Any
import pandas as pd

# -----------------------------
# Overfit heuristic thresholds (tune if needed)
# -----------------------------
OVERFIT_THRESHOLDS = {
    # Global
    "docs_with_aspect_hi": 0.95,      # if > 95% of docs match, patterns may be too generic
    "sentence_hit_rate_hi": 0.75,     # if > 75% of sentences match, patterns may be too generic
    "avg_aspects_per_doc_hi": 2.5,    # if average matched aspects per doc is high, overlap may be too big
    "multi_aspect_sentence_rate_hi": 0.35,  # if > 35% sentences hit multiple aspects, regex overlap likely

    # Per aspect
    "avg_top_lift_lo": 1.10,          # if average lift of top terms < 1.10, aspect may be too generic
    "min_docs_abs": 100,              # ignore tiny aspects for warnings
}

# -----------------------------
# CLI / Config
# -----------------------------
def get_args():
    ap = argparse.ArgumentParser(description="Keyword & Aspect Analytics (fast)")
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
                    help="Compute mean sentiment + bins per aspect (adds CPU)")
    ap.add_argument("--bigrams", action="store_true",
                    help="Also count bigrams; more compute")
    ap.add_argument("--progress-every", type=int, default=100_000,
                    help="Progress log interval (rows)")
    ap.add_argument("--outdir", default=".",
                    help="Output directory for JSON files")
    # Review-first suggestions (no auto-adopt)
    ap.add_argument("--emit-lexicon", action="store_true",
                    help="Emit suggested PHRASE_MAP, ASPECT patterns, and STOP additions for review")
    # One-file output for the dashboard
    ap.add_argument("--bundle", action="store_true",
                    help="Also write a single aspects_bundle.json (summary + top_terms + manifest [+lexicon if emitted])")
    # Pure tokenization control (no label bias)
    ap.add_argument("--phrase-map", choices=["off", "normalize"], default="normalize",
                    help="Tokenization: 'normalize' keeps known multi-word phrases as single tokens; 'off' leaves text untouched.")
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

# Preserve high-value phrases as single tokens (pure normalization, not labeling)
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

def normalize_phrases(s: str, mode: str) -> str:
    if mode == "off":
        return s
    out = s
    for k, v in PHRASE_MAP.items():
        out = re.sub(rf"\b{re.escape(k)}\b", v, out)
    # normalize common hyphen/space variants
    out = re.sub(r"\bnon[-\s]?greasy\b", "non_greasy", out)
    out = re.sub(r"\bnon[-\s]?sticky\b", "non_sticky", out)
    out = re.sub(r"\bfragrance[-\s]?free\b", "fragrance_free", out)
    return out

def norm_text(s: str, phrase_mode: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s)
    s = s.replace("\uFFFD", " ")
    s = s.lower()
    s = _ws_re.sub(" ", s).strip()
    s = normalize_phrases(s, phrase_mode)  # purely tokenization, not filtering
    return s

def tokens_ngrams(text: str, include_bigrams: bool) -> List[str]:
    toks = _word_re.findall(text)
    toks = [t for t in toks if len(t) > 2 and t not in STOP and t != "_"]
    if not include_bigrams:
        return toks
    bigrams = [f"{toks[i]} {toks[i+1]}" for i in range(len(toks)-1)]
    return toks + bigrams

# -----------------------------
# Aspect Lexicon (regex OR-sets) – labels sentences to aspects
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
# Lift score
# -----------------------------
def term_lift(term_count_in_aspect: int, aspect_total_terms: int,
              global_count: int, global_total: int, vocab_size: int) -> float:
    num = (term_count_in_aspect + 1.0) / (aspect_total_terms + vocab_size)
    den = (global_count + 1.0) / (global_total + vocab_size)
    return num / den

# -----------------------------
# Lexicon suggestion builder (review-first)
# -----------------------------
def build_lexicon_suggestions(
    top_terms: Dict[str, List[Dict[str, Any]]],
    global_counts: Counter,
    min_phrase_n=20, min_phrase_lift=1.5,
    min_pat_n=10, min_pat_lift=1.3,
    max_terms_per_aspect=200,
) -> Tuple[Dict[str, List[str]], Dict[str, List[Dict[str, str]]], Dict[str, List[str]]]:

    phrase_cands = set()
    auto_patterns: Dict[str, List[str]] = {}

    # max lift per term across aspects
    term_max_lift = Counter()
    for aspect, arr in top_terms.items():
        for t in arr:
            term_max_lift[t["term"]] = max(term_max_lift[t["term"]], t["lift"])

    # stop suggestions: frequent globally, not representative anywhere
    stop_suggestions: List[str] = []
    GLOBAL_FREQ_MIN = 500
    LIFT_MAX = 1.15
    for term, n in global_counts.items():
        if n >= GLOBAL_FREQ_MIN and term_max_lift[term] <= LIFT_MAX and len(term) > 2:
            stop_suggestions.append(term)
    stop_suggestions.sort(key=lambda t: (-global_counts[t], t))
    stop_suggestions = stop_suggestions[:200]

    def is_phrase(term: str) -> bool:
        return (" " in term) or ("_" in term)

    def to_regex_literal(term: str) -> str:
        t = re.escape(term).replace(r"\_", "_")
        t = t.replace(r"\ ", r"\s+")
        return rf"\b{t}\b"

    for aspect, arr in top_terms.items():
        pats: List[str] = []
        for t in arr:
            term, n, lift = t["term"], t["n"], t["lift"]
            if n >= min_pat_n and lift >= min_pat_lift:
                pats.append(to_regex_literal(term))
            if is_phrase(term) and n >= min_phrase_n and lift >= min_phrase_lift:
                if " " in term:
                    phrase_cands.add((term, term.replace(" ", "_")))
                else:
                    phrase_cands.add((term.replace("_", " "), term))
        auto_patterns[aspect] = pats[:max_terms_per_aspect]

    phrase_candidates = [{"from": a, "to": b} for a, b in sorted(phrase_cands)]
    return auto_patterns, {"items": phrase_candidates}, {"items": stop_suggestions}

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
    EMIT_LEXICON = args.emit_lexicon
    BUNDLE = args.bundle
    PHRASE_MODE = args.phrase_map

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
    usecols = TEXT_COLS

    # Init sentiment tools
    vader = init_vader(ENABLE_VADER)
    use_vader = vader is not None
    sent_score = (lambda s: vader.polarity_scores(s)["compound"]) if use_vader else (lambda s: 0.0)

    # Aggregators
    total_docs = 0
    rows_seen = 0
    aspect_doc_hits: Counter = Counter()
    aspect_sent_sum: Counter = Counter()
    aspect_sent_bins: Dict[str, Dict[str, int]] = defaultdict(lambda: {"pos": 0, "neu": 0, "neg": 0})
    aspect_term_counts: Dict[str, Counter] = defaultdict(Counter)
    global_term_counts: Counter = Counter()

    # Diagnostics aggregators
    total_sents = 0
    matched_sents = 0
    multi_aspect_sents = 0
    aspects_per_doc: List[int] = []

    # Compile patterns once (static rules)
    ASPECT_RX = compile_aspect_regex(ASPECT_PATTERNS)

    # Stream read
    for chunk in pd.read_csv(
        CSV_PATH,
        chunksize=CHUNK_SIZE,
        dtype=str,
        keep_default_na=False,
        usecols=usecols,
        on_bad_lines="skip",
        engine="c",
    ):
        for row in chunk.itertuples(index=False, name=None):
            rows_seen += 1

            parts = []
            for i in col_idx:
                v = row[i]
                if v:
                    parts.append(v)
            if not parts:
                continue

            txt = norm_text(" ".join(parts), PHRASE_MODE)
            if not txt:
                continue

            # Sentence-windowed aspect scan
            sents = re.split(r"[.!?]\s+|\n+", txt)
            aspects_hit_doc: Set[str] = set()

            for sent in sents:
                if not sent:
                    continue
                total_sents += 1

                local_hits = [a for a, rx in ASPECT_RX.items() if rx.search(sent)]
                if local_hits:
                    matched_sents += 1
                    if len(local_hits) > 1:
                        multi_aspect_sents += 1

                if not local_hits:
                    continue

                sscore = sent_score(sent) if use_vader else 0.0
                terms = tokens_ngrams(sent, include_bigrams=INCLUDE_BIGRAMS)

                for a in local_hits:
                    aspects_hit_doc.add(a)
                    if use_vader:
                        aspect_sent_sum[a] += sscore
                        # VADER bins
                        if sscore > 0.05:
                            aspect_sent_bins[a]["pos"] += 1
                        elif sscore < -0.05:
                            aspect_sent_bins[a]["neg"] += 1
                        else:
                            aspect_sent_bins[a]["neu"] += 1
                    if terms:
                        aspect_term_counts[a].update(terms)

                if terms:
                    global_term_counts.update(terms)

            if aspects_hit_doc:
                total_docs += 1
                aspects_per_doc.append(len(aspects_hit_doc))
                for a in aspects_hit_doc:
                    aspect_doc_hits[a] += 1

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

    # Build summary
    summary = []
    for aspect in ASPECT_RX.keys():
        docs = aspect_doc_hits.get(aspect, 0)
        share = docs / rows_seen if rows_seen else 0.0
        entry = {"aspect": aspect, "docs": int(docs), "share": round(share, 6)}
        if use_vader and docs > 0:
            entry["sent_mean"] = round(aspect_sent_sum.get(aspect, 0.0) / docs, 4)
            entry["sent_bins"] = aspect_sent_bins.get(aspect, {"pos": 0, "neu": 0, "neg": 0})
        summary.append(entry)

    # Representative terms per aspect (by lift, then frequency)
    aspect_top_terms: Dict[str, List[Dict[str, Any]]] = {}
    per_aspect_avg_top_lift: Dict[str, float] = {}
    for aspect, ctr in aspect_term_counts.items():
        filtered = {t: n for t, n in ctr.items() if t in vocab}
        aspect_total_terms = sum(filtered.values())
        if aspect_total_terms == 0:
            aspect_top_terms[aspect] = []
            per_aspect_avg_top_lift[aspect] = 0.0
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
        top_scored = scored[:TOP_TERMS_PER_ASPECT]
        top = [{"term": t, "n": int(n), "lift": round(lf, 3)} for t, n, lf in top_scored]
        aspect_top_terms[aspect] = top
        if top_scored:
            per_aspect_avg_top_lift[aspect] = float(sum(lf for _, _, lf in top_scored) / len(top_scored))
        else:
            per_aspect_avg_top_lift[aspect] = 0.0

    # Manifest
    ts = int(time.time())
    # Diagnostics (global)
    docs_with_aspect_share = (total_docs / rows_seen) if rows_seen else 0.0
    sentence_hit_rate = (matched_sents / total_sents) if total_sents else 0.0
    avg_aspects_per_doc = (sum(aspects_per_doc) / len(aspects_per_doc)) if aspects_per_doc else 0.0
    multi_aspect_sentence_rate = (multi_aspect_sents / matched_sents) if matched_sents else 0.0

    # Diagnostics (per aspect)
    per_aspect = []
    top_lift_warned = []
    for row in summary:
        a = row["aspect"]
        docs = row["docs"]
        avg_top_lift = per_aspect_avg_top_lift.get(a, 0.0)
        per_aspect.append({
            "aspect": a,
            "docs": docs,
            "share": row["share"],
            "avg_top_lift": round(avg_top_lift, 4)
        })
        if docs >= OVERFIT_THRESHOLDS["min_docs_abs"] and avg_top_lift < OVERFIT_THRESHOLDS["avg_top_lift_lo"]:
            top_lift_warned.append(a)

    diagnostics = {
        "global": {
            "rows_seen": rows_seen,
            "docs_with_aspect": total_docs,
            "docs_with_aspect_share": round(docs_with_aspect_share, 6),
            "total_sentences": int(total_sents),
            "matched_sentences": int(matched_sents),
            "sentence_hit_rate": round(sentence_hit_rate, 6),
            "avg_aspects_per_doc": round(avg_aspects_per_doc, 3),
            "multi_aspect_sentence_rate": round(multi_aspect_sentence_rate, 6),
        },
        "per_aspect": per_aspect,
        "thresholds": OVERFIT_THRESHOLDS,
        "warnings": []
    }

    # Heuristic warnings
    if docs_with_aspect_share > OVERFIT_THRESHOLDS["docs_with_aspect_hi"]:
        diagnostics["warnings"].append(
            f"High docs_with_aspect_share={docs_with_aspect_share:.1%} (> {OVERFIT_THRESHOLDS['docs_with_aspect_hi']:.0%}). "
            "Patterns may be too generic."
        )
    if sentence_hit_rate > OVERFIT_THRESHOLDS["sentence_hit_rate_hi"]:
        diagnostics["warnings"].append(
            f"High sentence_hit_rate={sentence_hit_rate:.1%} (> {OVERFIT_THRESHOLDS['sentence_hit_rate_hi']:.0%}). "
            "Many sentences match; consider tightening patterns."
        )
    if avg_aspects_per_doc > OVERFIT_THRESHOLDS["avg_aspects_per_doc_hi"]:
        diagnostics["warnings"].append(
            f"High avg_aspects_per_doc={avg_aspects_per_doc:.2f} (> {OVERFIT_THRESHOLDS['avg_aspects_per_doc_hi']:.2f}). "
            "Possible regex overlap across aspects."
        )
    if multi_aspect_sentence_rate > OVERFIT_THRESHOLDS["multi_aspect_sentence_rate_hi"]:
        diagnostics["warnings"].append(
            f"High multi_aspect_sentence_rate={multi_aspect_sentence_rate:.1%} (> {OVERFIT_THRESHOLDS['multi_aspect_sentence_rate_hi']:.0%}). "
            "Sentences commonly match multiple aspects; review overlapping rules."
        )
    if top_lift_warned:
        diagnostics["warnings"].append(
            f"Low avg_top_lift in aspects (≥ {OVERFIT_THRESHOLDS['min_docs_abs']} docs): {', '.join(top_lift_warned)}. "
            f"(avg_top_lift < {OVERFIT_THRESHOLDS['avg_top_lift_lo']:.2f})"
        )

    manifest = {
        "last_updated": ts,
        "rows_seen": rows_seen,
        "docs_with_aspect": total_docs,
        "min_term_freq": MIN_TERM_FREQ_GLOBAL,
        "bigrams": INCLUDE_BIGRAMS,
        "vader": use_vader,
        "phrase_map": PHRASE_MODE,
        "aspects": list(ASPECT_RX.keys()),
        "diagnostics": diagnostics["global"],  # compact summary in manifest
    }

    # -----------------------------
    # Save outputs
    # -----------------------------
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

    # Diagnostics file (pretty JSON)
    out_diag = os.path.join(OUTDIR, "diagnostics.json")
    with open(out_diag, "w", encoding="utf-8") as df:
        json.dump(diagnostics, df, ensure_ascii=False, indent=2)

    # Suggestion files (for curation)
    lex_auto_patterns = {}
    lex_phrase_cands = {}
    lex_stop_suggestions = {}
    if EMIT_LEXICON:
        lex_auto_patterns, lex_phrase_cands, lex_stop_suggestions = build_lexicon_suggestions(
            aspect_top_terms, global_term_counts
        )
        with open(os.path.join(OUTDIR, "lexicon_auto_patterns.json"), "w", encoding="utf-8") as f:
            json.dump(lex_auto_patterns, f, ensure_ascii=False, indent=2)
        with open(os.path.join(OUTDIR, "lexicon_phrase_candidates.json"), "w", encoding="utf-8") as f:
            json.dump(lex_phrase_cands, f, ensure_ascii=False, indent=2)
        with open(os.path.join(OUTDIR, "lexicon_stop_suggestions.json"), "w", encoding="utf-8") as f:
            json.dump(lex_stop_suggestions, f, ensure_ascii=False, indent=2)

    # One-file bundle for the dashboard
    if BUNDLE:
        bundle = {
            "summary": summary,
            "top_terms": aspect_top_terms,
            "manifest": manifest,
        }
        if EMIT_LEXICON:
            bundle["lexicon"] = {
                "auto_patterns": lex_auto_patterns,
                "phrase_candidates": lex_phrase_cands.get("items", []),
                "stop_suggestions": lex_stop_suggestions.get("items", []),
            }
        out_bundle = os.path.join(OUTDIR, "aspects_bundle.json")
        with open(out_bundle, "w", encoding="utf-8") as bf:
            json.dump(bundle, bf, ensure_ascii=False, indent=2)
        print(f"[out] {out_bundle}")

    elapsed = time.time() - t0
    print(f"[done] rows={rows_seen:,} docs_with_aspect={total_docs:,} | elapsed={elapsed:,.1f}s")
    print(f"[out] {out_sum}\n[out] {out_top}\n[out] {out_manifest}\n[out] {out_diag}")
    if EMIT_LEXICON:
        print("[out] lexicon_auto_patterns.json")
        print("[out] lexicon_phrase_candidates.json")
        print("[out] lexicon_stop_suggestions.json")

    # Console diagnostics
    print(f"[diag] docs_with_aspect={docs_with_aspect_share:.1%} | "
          f"avg_aspects_per_doc={avg_aspects_per_doc:.2f} | "
          f"sentence_hit_rate={sentence_hit_rate:.1%} | "
          f"multi_aspect_sentence_rate={multi_aspect_sentence_rate:.1%}")
    for w in diagnostics["warnings"]:
        print(f"[warn] {w}")

if __name__ == "__main__":
    main()
