import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ReferenceArea,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ComposedChart,
} from "recharts";

// ---------------------------------------
// TYPES
// ---------------------------------------

const MARKETS = ["SG", "MY", "PH", "TH", "VN", "ID"] as const;
type Market = (typeof MARKETS)[number];

const CHANNELS = ["Lazada", "Shopee", "Amazon", "Guardian", "Watsons"] as const;
type Channel = (typeof CHANNELS)[number];

type PriceRatingPoint = {
  product_id: string;
  product: string;
  market: Market;
  channel: Channel;
  price: number;
  rating: number; // 1..5
  reviews: number;
};

type ForecastPoint = {
  week: string; // e.g., 2025-08-18
  market: Market;
  channel: Channel;
  demand_index: number; // normalized 0..100
  promo?: boolean; // overlay
};

type AspectSentiment = {
  market: Market;
  channel: Channel;
  aspect: "greasiness" | "smell" | "relief_speed" | "residue" | "packaging";
  positive: number; // 0..1
  negative: number; // 0..1
  neutral: number; // 0..1
};

type CompetitorPoint = {
  product_id: string;
  product: string;
  market: Market;
  price: number;
  naturalness_score: number; // 0..100 derived from ingredients/claims
  claims_score: number; // 0..100 derived from # of strong claims
  cluster?: string; // optional labeling
};

type PromoImpactPoint = {
  market: Market;
  channel: Channel;
  week: string;
  baseline_sales: number;
  promo_sales: number;
  lift_pct: number; // computed
};

type AlertItem = {
  id: string;
  ts: string;
  type:
    | "negative_review_burst"
    | "competitor_stockout"
    | "price_drop"
    | "promo_detected";
  market: Market;
  channel?: Channel;
  product?: string;
  severity: "low" | "medium" | "high";
  message: string;
};

// ---------------------------------------
// MOCK DATA (replace with API calls later)
// ---------------------------------------

const PRICE_RATING: PriceRatingPoint[] = [
  {
    product_id: "A1",
    product: "Scholl Heel Repair",
    market: "SG",
    channel: "Guardian",
    price: 14.9,
    rating: 4.2,
    reviews: 812,
  },
  {
    product_id: "A2",
    product: "Canesten AF Cream",
    market: "SG",
    channel: "Watsons",
    price: 17.5,
    rating: 4.5,
    reviews: 1201,
  },
  {
    product_id: "A3",
    product: "TeaTree Foot Balm",
    market: "SG",
    channel: "Shopee",
    price: 11.0,
    rating: 4.1,
    reviews: 311,
  },
  {
    product_id: "B1",
    product: "Scholl Heel Repair",
    market: "MY",
    channel: "Watsons",
    price: 12.2,
    rating: 4.0,
    reviews: 430,
  },
  {
    product_id: "B2",
    product: "Lamisil",
    market: "MY",
    channel: "Lazada",
    price: 16.0,
    rating: 4.6,
    reviews: 650,
  },
  {
    product_id: "B3",
    product: "Spiruvita Foot Cream",
    market: "SG",
    channel: "Shopee",
    price: 15.0,
    rating: 4.7,
    reviews: 98,
  },
];

const FORECAST_SG_LAZADA: ForecastPoint[] = [
  { week: "2025-07-07", market: "SG", channel: "Lazada", demand_index: 45 },
  { week: "2025-07-14", market: "SG", channel: "Lazada", demand_index: 48 },
  {
    week: "2025-07-21",
    market: "SG",
    channel: "Lazada",
    demand_index: 52,
    promo: true,
  },
  {
    week: "2025-07-28",
    market: "SG",
    channel: "Lazada",
    demand_index: 61,
    promo: true,
  },
  { week: "2025-08-04", market: "SG", channel: "Lazada", demand_index: 55 },
  { week: "2025-08-11", market: "SG", channel: "Lazada", demand_index: 58 },
  { week: "2025-08-18", market: "SG", channel: "Lazada", demand_index: 63 },
  { week: "2025-08-25", market: "SG", channel: "Lazada", demand_index: 67 },
];

const FORECAST_SG_SHOPEE: ForecastPoint[] = [
  { week: "2025-07-07", market: "SG", channel: "Shopee", demand_index: 40 },
  { week: "2025-07-14", market: "SG", channel: "Shopee", demand_index: 44 },
  { week: "2025-07-21", market: "SG", channel: "Shopee", demand_index: 49 },
  {
    week: "2025-07-28",
    market: "SG",
    channel: "Shopee",
    demand_index: 58,
    promo: true,
  },
  {
    week: "2025-08-04",
    market: "SG",
    channel: "Shopee",
    demand_index: 54,
    promo: true,
  },
  { week: "2025-08-11", market: "SG", channel: "Shopee", demand_index: 56 },
  { week: "2025-08-18", market: "SG", channel: "Shopee", demand_index: 60 },
  { week: "2025-08-25", market: "SG", channel: "Shopee", demand_index: 65 },
];

const FORECAST: ForecastPoint[] = [
  ...FORECAST_SG_LAZADA,
  ...FORECAST_SG_SHOPEE,
];

const ASPECTS: AspectSentiment[] = [
  {
    market: "SG",
    channel: "Shopee",
    aspect: "greasiness",
    positive: 0.62,
    negative: 0.22,
    neutral: 0.16,
  },
  {
    market: "SG",
    channel: "Shopee",
    aspect: "smell",
    positive: 0.48,
    negative: 0.34,
    neutral: 0.18,
  },
  {
    market: "SG",
    channel: "Shopee",
    aspect: "relief_speed",
    positive: 0.58,
    negative: 0.19,
    neutral: 0.23,
  },
  {
    market: "SG",
    channel: "Shopee",
    aspect: "residue",
    positive: 0.44,
    negative: 0.36,
    neutral: 0.2,
  },
  {
    market: "SG",
    channel: "Shopee",
    aspect: "packaging",
    positive: 0.51,
    negative: 0.17,
    neutral: 0.32,
  },
];

const COMPETITORS: CompetitorPoint[] = [
  {
    product_id: "A1",
    product: "Scholl Heel Repair",
    market: "SG",
    price: 14.9,
    naturalness_score: 42,
    claims_score: 70,
    cluster: "legacy",
  },
  {
    product_id: "A2",
    product: "Canesten AF",
    market: "SG",
    price: 17.5,
    naturalness_score: 28,
    claims_score: 85,
    cluster: "clinical",
  },
  {
    product_id: "A3",
    product: "TeaTree Balm",
    market: "SG",
    price: 11.0,
    naturalness_score: 78,
    claims_score: 40,
    cluster: "botanical",
  },
  {
    product_id: "A4",
    product: "Spiruvita Foot Cream",
    market: "SG",
    price: 15.0,
    naturalness_score: 82,
    claims_score: 65,
    cluster: "premium_botanical",
  },
  {
    product_id: "B1",
    product: "Lamisil",
    market: "MY",
    price: 16.0,
    naturalness_score: 20,
    claims_score: 90,
    cluster: "clinical",
  },
];

const PROMO_IMPACT: PromoImpactPoint[] = [
  {
    market: "SG",
    channel: "Shopee",
    week: "2025-07-28",
    baseline_sales: 100,
    promo_sales: 148,
    lift_pct: 48,
  },
  {
    market: "SG",
    channel: "Shopee",
    week: "2025-08-04",
    baseline_sales: 110,
    promo_sales: 150,
    lift_pct: 36,
  },
  {
    market: "SG",
    channel: "Lazada",
    week: "2025-07-21",
    baseline_sales: 95,
    promo_sales: 130,
    lift_pct: 37,
  },
  {
    market: "SG",
    channel: "Lazada",
    week: "2025-07-28",
    baseline_sales: 102,
    promo_sales: 141,
    lift_pct: 38,
  },
];

// ---------------------------------------
// UTILITIES
// ---------------------------------------

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(n);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

// ---------------------------------------
// CHART TOOLTIP RENDERERS
// ---------------------------------------

const PriceRatingTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const p = payload[0].payload as PriceRatingPoint;
    return (
      <div className="rounded-2xl border bg-white p-3 shadow">
        <div className="font-semibold">{p.product}</div>
        <div className="text-sm text-gray-600">
          {p.market} · {p.channel}
        </div>
        <div className="mt-1 text-sm">Price: {formatCurrency(p.price)}</div>
        <div className="text-sm">
          Rating: {p.rating.toFixed(2)} ⭐ ({p.reviews} reviews)
        </div>
      </div>
    );
  }
  return null;
};

const CompetitorTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const p = payload[0].payload as CompetitorPoint;
    return (
      <div className="rounded-2xl border bg-white p-3 shadow">
        <div className="font-semibold">{p.product}</div>
        <div className="text-sm text-gray-600">{p.market}</div>
        <div className="mt-1 text-sm">Price: {formatCurrency(p.price)}</div>
        <div className="text-sm">Naturalness: {p.naturalness_score}</div>
        <div className="text-sm">Claims: {p.claims_score}</div>
        {p.cluster && (
          <div className="text-xs text-gray-500">Cluster: {p.cluster}</div>
        )}
      </div>
    );
  }
  return null;
};

// ---------------------------------------
// MAIN DASHBOARD COMPONENT
// ---------------------------------------

export default function MarketIntelligenceDashboard() {
  const [market, setMarket] = useState<Market>("SG");
  const [channel, setChannel] = useState<Channel | "ALL">("ALL");
  const [alerts, setAlerts] = useState<AlertItem[]>([
    {
      id: "al1",
      ts: new Date().toISOString(),
      type: "negative_review_burst",
      market: "SG",
      channel: "Shopee",
      product: "Scholl Heel Repair",
      severity: "high",
      message: "Negative reviews +220% vs 4-week avg (greasiness, residue)",
    },
  ]);

  // Simulate real-time alerts (prototype)
  useEffect(() => {
    const t = setInterval(() => {
      const demo: AlertItem = {
        id: `al${Date.now()}`,
        ts: new Date().toISOString(),
        type: Math.random() > 0.5 ? "competitor_stockout" : "price_drop",
        market: ["SG", "MY"][Math.floor(Math.random() * 2)] as Market,
        channel: ["Shopee", "Lazada"][Math.floor(Math.random() * 2)] as Channel,
        product: ["Canesten AF", "Lamisil", "TeaTree Balm"][
          Math.floor(Math.random() * 3)
        ],
        severity: Math.random() > 0.7 ? "high" : "medium",
        message:
          Math.random() > 0.5
            ? "Competitor stockout detected"
            : "Price drop -8% observed",
      };
      setAlerts((prev) => [demo, ...prev].slice(0, 20));
    }, 8000);
    return () => clearInterval(t);
  }, []);

  // FILTERED DATA
  const priceRatingData = useMemo(() => {
    return PRICE_RATING.filter(
      (p) => p.market === market && (channel === "ALL" || p.channel === channel)
    );
  }, [market, channel]);

  const forecastData = useMemo(() => {
    return FORECAST.filter(
      (f) => f.market === market && (channel === "ALL" || f.channel === channel)
    );
  }, [market, channel]);

  const aspectsData = useMemo(() => {
    return ASPECTS.filter(
      (a) => a.market === market && (channel === "ALL" || a.channel === channel)
    );
  }, [market, channel]);

  const competitorData = useMemo(() => {
    return COMPETITORS.filter((c) => c.market === market);
  }, [market]);

  const promoImpactData = useMemo(() => {
    return PROMO_IMPACT.filter(
      (d) => d.market === market && (channel === "ALL" || d.channel === channel)
    );
  }, [market, channel]);

  const markets = useMemo<Market[]>(() => {
    const set = new Set<Market>();
    PRICE_RATING.forEach((p) => set.add(p.market));
    FORECAST.forEach((f) => set.add(f.market));
    COMPETITORS.forEach((c) => set.add(c.market));
    PROMO_IMPACT.forEach((d) => set.add(d.market));
    return Array.from(set);
  }, []);

  const channels = useMemo<(Channel | "ALL")[]>(() => {
    const set = new Set<Channel>();
    PRICE_RATING.forEach((p) => set.add(p.channel));
    FORECAST.forEach((f) => set.add(f.channel));
    PROMO_IMPACT.forEach((d) => set.add(d.channel));
    return ["ALL", ...Array.from(set)];
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-50">
      <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-2xl font-bold">
              Spiruvita Market Intelligence
            </h1>
            <p className="text-sm text-gray-500">
              Prototype • Foot moisturiser & antifungal category
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="rounded-xl border px-3 py-2"
              value={market}
              onChange={(e) => setMarket(e.target.value as Market)}
            >
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border px-3 py-2"
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel | "ALL")}
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-2">
        {/* Price vs Rating Scatter */}
        <section className="col-span-1 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">
            Price vs Rating (find sweet spots)
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            Each dot is a product in {market}
            {channel !== "ALL" ? ` • ${channel}` : ""}.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="price"
                  name="Price"
                  tickFormatter={(v) => `$${v}`}
                />
                <YAxis
                  type="number"
                  dataKey="rating"
                  name="Rating"
                  domain={[0, 5]}
                />
                <ZAxis
                  type="number"
                  dataKey="reviews"
                  range={[60, 200]}
                  name="Reviews"
                />
                <Tooltip
                  content={<PriceRatingTooltip />}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                <Legend />
                <Scatter name="Products" data={priceRatingData} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Demand Forecast with Promo Overlays */}
        <section className="col-span-1 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">
            Demand Forecast with Promo Overlays
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            Weekly demand index • Promo windows shaded.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={forecastData}
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                {/* Promo shaded regions */}
                {(() => {
                  const ranges: { start: string; end: string }[] = [];
                  let start: string | null = null;
                  forecastData.forEach((d, i) => {
                    if (d.promo && !start) start = d.week;
                    const next = forecastData[i + 1];
                    if (start && (!next || !next.promo)) {
                      ranges.push({ start, end: d.week });
                      start = null;
                    }
                  });
                  return ranges.map((r, idx) => (
                    <ReferenceArea
                      key={idx}
                      x1={r.start}
                      x2={r.end}
                      y1={0}
                      y2={100}
                      fillOpacity={0.12}
                    />
                  ));
                })()}
                <Line
                  type="monotone"
                  dataKey="demand_index"
                  name="Demand"
                  dot
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Aspect Sentiment Bars */}
        <section className="col-span-1 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Aspect Sentiment</h2>
          <p className="mb-3 text-sm text-gray-500">
            Greasiness, smell, relief speed, residue, packaging.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={aspectsData}
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="aspect"
                  tickFormatter={(s) => s.replace(/_/g, " ")}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                />
                <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Legend />
                <Bar dataKey="positive" stackId="a" name="Positive" />
                <Bar dataKey="neutral" stackId="a" name="Neutral" />
                <Bar dataKey="negative" stackId="a" name="Negative" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Competitor Map (2D cluster) */}
        <section className="col-span-1 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Competitor Map</h2>
          <p className="mb-3 text-sm text-gray-500">
            Price vs Naturalness • Claim strength in tooltip.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="price"
                  name="Price"
                  tickFormatter={(v) => `$${v}`}
                />
                <YAxis
                  type="number"
                  dataKey="naturalness_score"
                  name="Naturalness"
                  domain={[0, 100]}
                />
                <ZAxis
                  type="number"
                  dataKey="claims_score"
                  range={[80, 240]}
                  name="Claims"
                />
                <Tooltip
                  content={<CompetitorTooltip />}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                <Legend />
                <Scatter name="Competitors" data={competitorData} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Promo Impact Lift Chart */}
        <section className="col-span-1 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Promo Impact (Lift)</h2>
          <p className="mb-3 text-sm text-gray-500">
            Baseline vs Promo sales • Lift % labels.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={promoImpactData}
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="baseline_sales" name="Baseline" />
                <Bar dataKey="promo_sales" name="Promo" />
                <Line
                  type="monotone"
                  dataKey="lift_pct"
                  name="Lift %"
                  yAxisId={1}
                />
                <YAxis
                  yAxisId={1}
                  orientation="right"
                  tickFormatter={(v) => `${v}%`}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Alert Feed */}
        <section className="col-span-1 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Real-time Alerts</h2>
          <p className="mb-3 text-sm text-gray-500">
            Negative review bursts • Competitor stockouts • Price drops • Promos
          </p>
          <div className="flex max-h-72 flex-col gap-3 overflow-auto pr-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-xl border p-3"
              >
                <span
                  className={`mt-1 inline-flex h-3 w-3 rounded-full ${
                    a.severity === "high"
                      ? "bg-red-500"
                      : a.severity === "medium"
                      ? "bg-amber-500"
                      : "bg-green-500"
                  }`}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {a.type.replace(/_/g, " ")}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(a.ts).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    {a.market}
                    {a.channel ? ` • ${a.channel}` : ""}
                    {a.product ? ` • ${a.product}` : ""}
                  </div>
                  <div className="text-sm">{a.message}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer / API wiring hints */}
      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-2 text-xs text-gray-500">
        <p>
          Prototype wiring: replace mock arrays with API calls →
          /api/price-rating, /api/forecast, /api/aspects, /api/competitors,
          /api/promo-impact, /api/alerts. Consider WebSocket for live alerts and
          promo detects.
        </p>
      </footer>
    </div>
  );
}
