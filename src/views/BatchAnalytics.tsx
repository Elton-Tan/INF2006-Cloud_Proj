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

/** Shape of the single-file bundle produced by keywordanalysis.py */
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

function AspectFlipPosterFromBundle(props: { bundleUrl: string }) {
  const {
    data: bundle,
    loading,
    error,
  } = useJson<AspectsBundle>(props.bundleUrl);

  const summary = bundle?.summary;
  const topTerms = bundle?.top_terms;

  const [mode, setMode] = React.useState<"strips" | "words">("strips");

  const visible = React.useMemo(() => {
    if (!summary) return [];
    return [...summary].sort((a, b) => b.share - a.share).slice(0, 7);
  }, [summary]);

  const colors = [
    "bg-emerald-50 border-emerald-200",
    "bg-sky-50 border-sky-200",
    "bg-amber-50 border-amber-200",
    "bg-violet-50 border-violet-200",
    "bg-rose-50 border-rose-200",
    "bg-lime-50 border-lime-200",
    "bg-cyan-50 border-cyan-200",
  ];

  function topNWords(aspect: string, k = 10): TopTerm[] {
    const arr = (topTerms && (topTerms as any)[aspect]) || [];
    return [...arr]
      .sort((a, b) => (b.lift !== a.lift ? b.lift - a.lift : b.n - a.n))
      .slice(0, k);
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <section className="relative rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Keywords Analytics</h2>
          <p className="text-sm text-gray-500">
            Which aspects do customers focus on?
          </p>
        </div>
        <button
          onClick={() => setMode((m) => (m === "words" ? "strips" : "words"))}
          className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
          title={mode === "words" ? "Show Strip Poster" : "Show Frequent Words"}
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
                      {row.aspect.replace(/([a-z])([A-Z])/g, "$1 $2")}
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
                    {row.aspect.replace(/([a-z])([A-Z])/g, "$1 $2")}
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
        appear in the same review. Using 800,683 reviews which contained aspects
        out of all 925,117
      </div>
    </section>
  );
}

export default function BatchAnalytics() {
  const {
    data: bundle,
    loading,
    error,
  } = useJson<AspectsBundle>(ASPECT_CONFIG.BUNDLE_URL);
  const summary = bundle?.summary;

  // Sentiment controls
  const [sentSort, setSentSort] = React.useState<"neg" | "pos" | "share">(
    "neg"
  );
  const [sentTopN, setSentTopN] = React.useState<number>(10); // 0 = all

  // Build sentiment rows from sent_bins (with counts)
  const sentimentRows = React.useMemo(() => {
    if (!summary) return [];
    const rows = summary
      .filter((s: any) => (s as any).sent_bins && s.docs > 0)
      .map((s: any) => {
        const b = s.sent_bins as { pos: number; neu: number; neg: number };
        const total = (b?.pos || 0) + (b?.neu || 0) + (b?.neg || 0) || 1;
        const posP = (b.pos || 0) / total;
        const neuP = (b.neu || 0) / total;
        const negP = (b.neg || 0) / total;
        // inside sentimentRows map(...)
        return {
          aspectKey: s.aspect,
          aspect: s.aspect.replace(/([a-z])([A-Z])/g, "$1 $2"),
          docs: s.docs,
          share: s.share,
          // rename to match legend names
          positiveCount: b.pos || 0,
          neutralCount: b.neu || 0,
          negativeCount: b.neg || 0,
          positive: (b.pos || 0) / total,
          neutral: (b.neu || 0) / total,
          negative: (b.neg || 0) / total,
        };
      });

    // Sort strategy
    rows.sort((a, b) => {
      if (sentSort === "pos")
        return b.positive - a.positive || b.share - a.share;
      if (sentSort === "share")
        return b.share - a.share || b.negative - a.negative;
      return b.negative - a.negative || b.share - a.share; // default "neg"
    });

    return sentTopN > 0 ? rows.slice(0, sentTopN) : rows;
  }, [summary, sentSort, sentTopN]);

  // Chart height scales with rows
  const chartHeight = Math.max(320, 32 * sentimentRows.length + 96);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Consumer Preferences Radar Chart - Full Width */}
      <ConsumerPreferencesRadar />

      {/* Keywords */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-2">
        <AspectFlipPosterFromBundle bundleUrl={ASPECT_CONFIG.BUNDLE_URL} />
      </section>

      {/* Sentiment */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Aspect Sentiment</h2>
            <p className="text-sm text-gray-500">
              Based on keywords identified in Keywords Analytics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Sort</label>
            <select
              value={sentSort}
              onChange={(e) => setSentSort(e.target.value as any)}
              className="rounded-md border px-2 py-1 text-xs"
              title="Sort order"
            >
              <option value="neg">Most negative</option>
              <option value="pos">Most positive</option>
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
              {/* Vertical stacked bars so all labels fit */}
              <BarChart
                layout="vertical"
                data={sentimentRows as any}
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(v) => `${Math.round((v as number) * 100)}%`}
                />
                <YAxis type="category" dataKey="aspect" width={160} />
                <Tooltip
                  formatter={(v: number, name, ctx) => {
                    const row: any = (ctx && (ctx.payload as any)) || {};
                    const map: Record<string, string> = {
                      Positive: "positiveCount",
                      Neutral: "neutralCount",
                      Negative: "negativeCount",
                    };
                    const count = row[map[String(name)]] ?? 0;
                    const pct = Math.round((v as number) * 100);
                    return [
                      `${pct}% (${count.toLocaleString()} aspect-matched sentences)`,
                      name,
                    ];
                  }}
                  labelFormatter={(label) => String(label)}
                />

                <Legend />
                {/* Distinct fills for clarity */}
                <Bar
                  dataKey="positive"
                  stackId="a"
                  name="Positive"
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
                  name="Negative"
                  fill="#dc2626"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Analysed based on Keywords Analysis and Vader Sentiment Analysis
        </div>
      </section>

      {/* Keep your other sections (e.g., Promo Impact)… */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Promo Impact (Placeholder)
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Baseline vs Promo lift (placeholder)
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={
                [
                  { week: "2025-09-01", baseline: 100, promo: 140, lift: 40 },
                  { week: "2025-09-08", baseline: 105, promo: 136, lift: 30 },
                  { week: "2025-09-15", baseline: 110, promo: 155, lift: 41 },
                ] as any
              }
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="baseline" name="Baseline" />
              <Bar dataKey="promo" name="Promo" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
