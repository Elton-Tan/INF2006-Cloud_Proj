// src/views/BatchAnalytics.tsx
import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
} from "recharts";
import { ASPECT_CONFIG } from "../config";
import { useJson } from "../hooks";
import { AspectSummaryRow, AspectTopTerms, TopTerm } from "../types";
import ConsumerPreferencesRadar from "../components/ConsumerPreferencesRadar";

/** Bundle shape produced by keywordanalysis.py */
type AspectsBundle = {
  summary: AspectSummaryRow[];
  top_terms: AspectTopTerms;
  manifest: {
    last_updated: number;
    rows_seen: number;
    docs_with_aspect: number;
    bigrams: boolean;
    vader: boolean;
    phrase_map: "off" | "normalize";
    aspects: string[];
  };
  lexicon?: {
    auto_patterns: Record<string, string[]>;
    phrase_candidates: { from: string; to: string }[];
    stop_suggestions: string[];
  };
};

/* ─ Utilities & naming ─ */
const pctNum = (x: number) => Math.round(x * 100);
const humanCamel = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");
const canon = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

// Hide globally
const HIDE_CANON = new Set<string>(["longevity", "residuefinish"]);
// Keep list around if you want to tag problem-type aspects later
const NEG_ORIENTED = new Set<string>([]);

// Friendly labels
const DISPLAY_NAME: Record<string, string> = {
  routineusage: "Routine Fit",
  valueprice: "Value for Money",
};
const labelFor = (k: string) => DISPLAY_NAME[canon(k)] ?? humanCamel(k);

/* ─ Shared: Key findings card ─ */
function KeyFindingsCard({
  title,
  items,
  footnote,
}: {
  title: string;
  items: Array<string | React.ReactNode>;
  footnote?: React.ReactNode;
}) {
  return (
    <aside className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-4 shadow-sm h-full md:sticky md:top-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <ul className="space-y-2 text-sm leading-5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[6px] h-[6px] w-[6px] rounded-full bg-gray-400 shrink-0" />
            <span className="text-gray-700">{it}</span>
          </li>
        ))}
      </ul>
      {footnote && <div className="mt-3 text-xs text-gray-500">{footnote}</div>}
    </aside>
  );
}

/* ─ Keywords Analytics (chart + findings) ─ */
function AspectFlipPosterFromBundle(props: { bundleUrl: string }) {
  const {
    data: bundle,
    loading,
    error,
  } = useJson<AspectsBundle>(props.bundleUrl);

  const summary = bundle?.summary;
  const topTerms = bundle?.top_terms;
  const [mode, setMode] = React.useState<"strips" | "words">("strips");

  const filtered = React.useMemo(() => {
    if (!summary) return [];
    return summary.filter((r) => !HIDE_CANON.has(canon(r.aspect)));
  }, [summary]);

  const visible = React.useMemo(
    () => [...filtered].sort((a, b) => b.share - a.share).slice(0, 7),
    [filtered]
  );

  const kwordsFindings = React.useMemo(() => {
    if (!filtered.length) return [];
    const top3 = [...filtered].sort((a, b) => b.share - a.share).slice(0, 3);
    const sizes = top3.map(
      (r) => `${labelFor(r.aspect)} (${pctNum(r.share)}% of reviews)`
    );
    return [
      `Most-discussed aspects: ${sizes.join(", ")}.`,
      "Hydration + Feel dominate overall conversation in this category.",
      "“Routine Fit” = layering/AM–PM usage & how easily it fits into routines (not inherently positive/negative).",
    ];
  }, [filtered]);

  const colors = [
    "bg-emerald-50 border-emerald-200",
    "bg-sky-50 border-sky-200",
    "bg-amber-50 border-amber-200",
    "bg-violet-50 border-violet-200",
    "bg-rose-50 border-rose-200",
    "bg-lime-50 border-lime-200",
    "bg-cyan-50 border-cyan-200",
  ];

  function topNWords(aspect: string, k = 12): TopTerm[] {
    const arr = (topTerms && (topTerms as any)[aspect]) || [];
    return [...arr]
      .sort((a, b) => (b.lift !== a.lift ? b.lift - a.lift : b.n - a.n))
      .slice(0, k);
  }

  const pct = (x: number) => `${pctNum(x)}%`;

  return (
    <section className="relative">
      {/* SIDE-BY-SIDE inside this section only */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Chart (8/12) */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-8">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">Keywords Analytics</h2>
            <button
              onClick={() =>
                setMode((m) => (m === "words" ? "strips" : "words"))
              }
              className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
              title={
                mode === "words" ? "Show Strip Poster" : "Show Frequent Words"
              }
            >
              {mode === "words" ? (
                <>
                  <span>View Summary</span>
                  <span aria-hidden>⟲</span>
                </>
              ) : (
                <>
                  <span>View Common Words</span>
                  <span aria-hidden>⟲</span>
                </>
              )}
            </button>
            <p className="w-full text-sm text-gray-500 md:max-w-[60ch]">
              Which aspects do customers focus on?
            </p>
          </div>

          <div className="min-h-[240px]">
            {loading ? (
              <div className="flex h-60 items-center justify-center text-sm text-gray-500">
                Loading…
              </div>
            ) : error ? (
              <div className="flex h-60 items-center justify-center text-sm text-rose-600">
                {String(error)}
              </div>
            ) : !summary || !topTerms ? (
              <div className="flex h-60 items-center justify-center text-sm text-gray-500">
                No data.
              </div>
            ) : mode === "words" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {visible.map((row, i) => {
                  const terms = topNWords(row.aspect, 12);
                  return (
                    <div
                      key={row.aspect}
                      className={`rounded-xl border p-3 ${
                        colors[i % colors.length]
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">
                          {labelFor(row.aspect)}
                        </div>
                        <div className="text-xs text-gray-600">
                          {pct(row.share)} of reviews
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {terms.map((t, idx) => {
                          const w = Math.max(
                            0.9,
                            Math.min(
                              1.3,
                              0.9 + (t.lift / (terms[0]?.lift || 1)) * 0.4
                            )
                          );
                          return (
                            <span
                              key={idx}
                              className="rounded-full bg-white/70 px-2 py-1 text-[0.85rem] shadow-sm ring-1 ring-black/5"
                              style={{ fontSize: `${w}em` }}
                              title={`n=${t.n} • lift=${t.lift}`}
                            >
                              {t.term.replace(/_/g, " ")}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {visible.map((row, i) => {
                  const terms = topNWords(row.aspect, 8)
                    .map((t) => t.term.replace(/_/g, " "))
                    .join(" • ");
                  const widthPct = Math.max(16, Math.round(row.share * 100));
                  return (
                    <div key={row.aspect} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-right text-xs text-gray-600">
                        {labelFor(row.aspect)}
                      </div>
                      <div
                        className={`h-10 rounded-xl border px-3 py-2 text-sm leading-none ${
                          colors[i % colors.length]
                        } overflow-hidden`}
                        style={{ width: `${widthPct}%` }}
                        title={`${pct(row.share)} of reviews`}
                      >
                        <div className="truncate">
                          <span className="font-medium">{pct(row.share)}</span>
                          <span className="mx-2 text-gray-400">|</span>
                          <span className="opacity-80">{terms}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Note: Sum may not add to 100% because words of multiple aspects can
            appear in the same review. Using{" "}
            {bundle?.manifest?.docs_with_aspect?.toLocaleString() ?? "—"}{" "}
            reviews that contained aspects, out of 900000+ gathered from
            skincare products <br />
            <br />
            Data Source:
            https://www.kaggle.com/datasets/nadyinky/sephora-products-and-skincare-reviews
          </div>
        </div>

        {/* Findings (4/12) */}
        <div className="md:col-span-4">
          <KeyFindingsCard
            title="Key findings"
            items={kwordsFindings}
            footnote={<span></span>}
          />
        </div>
      </div>
    </section>
  );
}

/* ─ Page: Radar (full width) + Keywords pair, then Sentiment pair BELOW ─ */
export default function BatchAnalytics() {
  const {
    data: bundle,
    loading,
    error,
  } = useJson<AspectsBundle>(ASPECT_CONFIG.BUNDLE_URL);
  const summary = bundle?.summary;

  const aspectWhitelist = React.useMemo(() => {
    const a = new Set<string>(bundle?.manifest?.aspects ?? []);
    Object.keys(bundle?.top_terms ?? {}).forEach((k) => a.add(k));
    return a;
  }, [bundle]);

  const isNegOriented = React.useCallback(
    (k: string) => NEG_ORIENTED.has(canon(k)),
    []
  );

  const [sentSort, setSentSort] = React.useState<"neg" | "pos" | "share">(
    "neg"
  );
  const [sentTopN, setSentTopN] = React.useState<number>(0); // All

  const sentimentRows = React.useMemo(() => {
    if (!summary) return [];
    const rows = summary
      .filter((s: any) => aspectWhitelist.has(s.aspect))
      .filter((s: any) => !HIDE_CANON.has(canon(s.aspect)))
      .filter((s: any) => (s as any).sent_bins && s.docs > 0)
      .map((s: any) => {
        const b = s.sent_bins as { pos: number; neu: number; neg: number };
        const total = (b?.pos || 0) + (b?.neu || 0) + (b?.neg || 0) || 1;

        const positive = (b.pos || 0) / total;
        const neutral = (b.neu || 0) / total;
        const negative = (b.neg || 0) / total;

        const base = labelFor(s.aspect);
        const label = isNegOriented(s.aspect) ? `${base} (problem-type)` : base;

        return {
          aspectKey: s.aspect,
          aspect: label,
          docs: s.docs,
          share: s.share,
          positive,
          neutral,
          negative,
          positiveCount: b.pos || 0,
          neutralCount: b.neu || 0,
          negativeCount: b.neg || 0,
        };
      });

    rows.sort((a, b) => {
      if (sentSort === "pos")
        return b.positive - a.positive || b.share - a.share;
      if (sentSort === "share")
        return b.share - a.share || b.negative - a.negative;
      return b.negative - a.negative || b.share - a.share;
    });

    return sentTopN > 0 ? rows.slice(0, sentTopN) : rows;
  }, [summary, aspectWhitelist, sentSort, sentTopN, isNegOriented]);

  const sentimentFindings = React.useMemo(() => {
    if (!sentimentRows.length) return [];
    const topNeg = [...sentimentRows]
      .sort((a, b) => b.negative - a.negative)
      .slice(0, 3)
      .map((r) => `${r.aspect} (${Math.round(r.negative * 100)}% unfavorable)`);
    const topPos = [...sentimentRows]
      .sort((a, b) => b.positive - a.positive)
      .slice(0, 3)
      .map((r) => `${r.aspect} (${Math.round(r.positive * 100)}% favorable)`);
    const avgFav =
      Math.round(
        (sentimentRows.reduce((acc, r) => acc + r.positive, 0) /
          sentimentRows.length) *
          100
      ) || 0;

    return [
      `Most unfavorable: ${topNeg.join(", ")}.`,
      `Strongest positives: ${topPos.join(", ")}.`,
      `Average favorable share across shown aspects: ${avgFav}%.`,
      `Irritation favorable shares means that the product reviewers explicitly say the product does not cause irritation such as non-irritating for sensitive skin`,
      "“Routine Fit” being favorable means that reviewers saying it layers well or fits AM/PM steps , with unfavorable hinting frictions with routines",
    ];
  }, [sentimentRows]);

  const chartHeight = Math.max(320, 32 * sentimentRows.length + 96);

  return (
    // FLEX COLUMN = sections are guaranteed to stack into their own rows
    <div className="flex flex-col gap-4">
      {/* 1) Radar (full width row) */}
      <ConsumerPreferencesRadar />

      {/* 2) Keywords (full width row; internal grid handles 8/12 + 4/12) */}
      <AspectFlipPosterFromBundle bundleUrl={ASPECT_CONFIG.BUNDLE_URL} />

      {/* 3) Sentiment (full width row; internal grid handles 8/12 + 4/12) */}
      <section className="relative">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Chart (8/12) */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-8">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Aspect Sentiment</h2>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">Sort</label>
                <select
                  value={sentSort}
                  onChange={(e) => setSentSort(e.target.value as any)}
                  className="rounded-md border px-2 py-1 text-xs"
                  title="Sort order"
                >
                  <option value="neg">Most unfavorable</option>
                  <option value="pos">Most favorable</option>
                  <option value="share">Most mentioned</option>
                </select>

                <label className="ml-3 text-xs text-gray-600">Show</label>
                <select
                  value={sentTopN}
                  onChange={(e) => setSentTopN(Number(e.target.value))}
                  className="rounded-md border px-2 py-1 text-xs"
                  title="How many aspects to display"
                >
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                  <option value={15}>Top 15</option>
                  <option value={0}>All</option>
                </select>
              </div>

              <p className="w-full text-sm text-gray-500 md:max-w-[60ch]">
                Favorable / Neutral / Unfavorable share per aspect derived from
                Keywords Analytics and their sentiment analysis
              </p>
            </div>

            <div style={{ height: chartHeight }}>
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  Loading…
                </div>
              ) : error ? (
                <div className="flex h-full items-center justify-center text-sm text-rose-600">
                  {String(error)}
                </div>
              ) : sentimentRows.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  No sentiment bins found. (Did you run with{" "}
                  <code>--enable-vader</code>?)
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={sentimentRows as any}
                    margin={{ top: 12, right: 28, bottom: 12, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      domain={[0, 1]}
                      tickFormatter={(v) =>
                        `${Math.round((v as number) * 100)}%`
                      }
                    />
                    <YAxis type="category" dataKey="aspect" width={200} />
                    <Tooltip
                      formatter={(v: number, name, ctx) => {
                        const row: any = (ctx && (ctx.payload as any)) || {};
                        const map: Record<string, string> = {
                          Favorable: "positiveCount",
                          Neutral: "neutralCount",
                          Unfavorable: "negativeCount",
                        };
                        const count = row[map[String(name)]] ?? 0;
                        const p = Math.round((v as number) * 100);
                        return [
                          `${p}% (${count.toLocaleString()} aspect-matched sentences)`,
                          name,
                        ];
                      }}
                      labelFormatter={(label) => String(label)}
                    />
                    <Legend />
                    <Bar
                      dataKey="positive"
                      stackId="a"
                      name="Favorable"
                      fill="#16a34a"
                    />
                    <Bar
                      dataKey="neutral"
                      stackId="a"
                      name="Neutral"
                      fill="#9ca3af"
                    />
                    <Bar
                      dataKey="negative"
                      stackId="a"
                      name="Unfavorable"
                      fill="#dc2626"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="mt-2 text-xs text-gray-500">
              Analysed based on Keywords Analytics + VADER.
              <br />
              <br />
              Data Source:
              https://www.kaggle.com/datasets/nadyinky/sephora-products-and-skincare-reviews
            </div>
          </div>

          {/* Findings (4/12) */}
          <div className="md:col-span-4">
            <KeyFindingsCard
              title="Key findings"
              items={sentimentFindings}
              footnote={<span></span>}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
