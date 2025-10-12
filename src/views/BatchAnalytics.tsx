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

function AspectFlipPoster(props: { summaryUrl: string; termsUrl: string }) {
  const {
    data: summary,
    loading: loadSum,
    error: errSum,
  } = useJson<AspectSummaryRow[]>(props.summaryUrl);
  const {
    data: topTerms,
    loading: loadTerms,
    error: errTerms,
  } = useJson<AspectTopTerms>(props.termsUrl);

  const [mode, setMode] = React.useState<"strips" | "words">("strips");
  const loading = loadSum || loadTerms;
  const error = errSum || errTerms;

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
    const arr = (topTerms && topTerms[aspect]) || [];
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
              {" "}
              <span>View Summary</span>
              <span aria-hidden>⟲</span>{" "}
            </>
          ) : (
            <>
              {" "}
              <span>View Common Words</span>
              <span aria-hidden>⟲</span>{" "}
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
            {error}
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
        appear in the same review.
      </div>
    </section>
  );
}

const MOCK_ASPECTS = [
  { aspect: "greasiness", positive: 0.62, neutral: 0.16, negative: 0.22 },
  { aspect: "smell", positive: 0.48, neutral: 0.18, negative: 0.34 },
  { aspect: "relief_speed", positive: 0.58, neutral: 0.23, negative: 0.19 },
  { aspect: "residue", positive: 0.44, neutral: 0.2, negative: 0.36 },
  { aspect: "packaging", positive: 0.51, neutral: 0.32, negative: 0.17 },
];

export default function BatchAnalytics() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-2">
        <AspectFlipPoster
          summaryUrl={ASPECT_CONFIG.SUMMARY_URL}
          termsUrl={ASPECT_CONFIG.TOP_TERMS_URL}
        />
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Aspect Sentiment (Placeholder)
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          From offline ABSA over historical reviews
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={MOCK_ASPECTS as any}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="aspect"
                tickFormatter={(s) => String(s).replace(/_/g, " ")}
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v) => `${Math.round((v as number) * 100)}%`}
              />
              <Tooltip
                formatter={(v: number) => `${Math.round((v as number) * 100)}%`}
              />
              <Legend />
              <Bar dataKey="positive" stackId="a" name="Positive" />
              <Bar dataKey="neutral" stackId="a" name="Neutral" />
              <Bar dataKey="negative" stackId="a" name="Negative" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

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
