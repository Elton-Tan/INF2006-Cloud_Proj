import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ScatterChart,
  Scatter,
  ZAxis,
  ComposedChart,
} from "recharts";

// ===============================================================
// TYPES
// ===============================================================

type Severity = "low" | "medium" | "high";

type Alert = {
  id: string;
  ts: string; // ISO
  title: string; // e.g., "Competitor X: posted an ad"
  description: string; // e.g., "Ad is about 30% discount on heel balm"
  severity: Severity;
  market?: string; // SG/MY/etc
  channel?: string; // Lazada/Shopee/etc
};

type PriceSeriesPoint = {
  day: string; // e.g., 2025-09-12
  avg_price_spiruvita: number;
  avg_price_canesten: number;
  avg_price_lamisil: number;
};

type TrendPoint = {
  day: string;
  foot_cream: number;
  antifungal: number;
  heel_balm: number;
  forecast?: number; // optional overlay for forecasted index
};

type AspectSentiment = {
  aspect: string; // greasiness, smell, etc.
  positive: number; // 0..1
  neutral: number; // 0..1
  negative: number; // 0..1
};

type SnapshotRow = {
  id: string;
  url: string;
  imageUrl?: string;
  product?: string;
  price?: string;
  availability?: string; // in_stock / out_of_stock / unknown
  status: "adding" | "done" | "error";
};

// ===============================================================
// MOCK DATA (replace with API wiring later)
// ===============================================================

const MOCK_ALERTS_SEED: Alert[] = [
  {
    id: "al1",
    ts: new Date().toISOString(),
    title: "Competitor X: posted an ad",
    description:
      "Ad is about 20% DISCOUNT for antifungal cream (copy: ‘goodbye itch!’)",
    severity: "medium",
    market: "SG",
    channel: "Meta",
  },
  {
    id: "al2",
    ts: new Date().toISOString(),
    title: "Competitor Y: price drop",
    description: "Lamisil dropped from $7.90 → $6.90 on Lazada",
    severity: "low",
    market: "SG",
    channel: "Lazada",
  },
];

const MOCK_TRENDS: TrendPoint[] = [
  { day: "2025-09-11", foot_cream: 40, antifungal: 55, heel_balm: 33 },
  { day: "2025-09-12", foot_cream: 44, antifungal: 57, heel_balm: 35 },
  { day: "2025-09-13", foot_cream: 49, antifungal: 61, heel_balm: 36 },
  { day: "2025-09-14", foot_cream: 47, antifungal: 60, heel_balm: 39 },
  { day: "2025-09-15", foot_cream: 52, antifungal: 63, heel_balm: 41 },
  { day: "2025-09-16", foot_cream: 55, antifungal: 65, heel_balm: 44 },
  {
    day: "2025-09-17",
    foot_cream: 58,
    antifungal: 64,
    heel_balm: 46,
    forecast: 60,
  },
  {
    day: "2025-09-18",
    foot_cream: 57,
    antifungal: 66,
    heel_balm: 47,
    forecast: 62,
  },
  {
    day: "2025-09-19",
    foot_cream: 0,
    antifungal: 0,
    heel_balm: 0,
    forecast: 63,
  },
  {
    day: "2025-09-20",
    foot_cream: 0,
    antifungal: 0,
    heel_balm: 0,
    forecast: 65,
  },
];

const MOCK_PRICES: PriceSeriesPoint[] = [
  {
    day: "2025-09-11",
    avg_price_spiruvita: 14.9,
    avg_price_canesten: 17.5,
    avg_price_lamisil: 15.8,
  },
  {
    day: "2025-09-12",
    avg_price_spiruvita: 15.1,
    avg_price_canesten: 17.3,
    avg_price_lamisil: 15.9,
  },
  {
    day: "2025-09-13",
    avg_price_spiruvita: 15.0,
    avg_price_canesten: 17.2,
    avg_price_lamisil: 15.6,
  },
  {
    day: "2025-09-14",
    avg_price_spiruvita: 14.8,
    avg_price_canesten: 17.2,
    avg_price_lamisil: 15.5,
  },
  {
    day: "2025-09-15",
    avg_price_spiruvita: 14.7,
    avg_price_canesten: 17.1,
    avg_price_lamisil: 15.4,
  },
  {
    day: "2025-09-16",
    avg_price_spiruvita: 14.9,
    avg_price_canesten: 17.0,
    avg_price_lamisil: 15.2,
  },
  {
    day: "2025-09-17",
    avg_price_spiruvita: 14.6,
    avg_price_canesten: 16.9,
    avg_price_lamisil: 15.0,
  },
];

const MOCK_ASPECTS: AspectSentiment[] = [
  { aspect: "greasiness", positive: 0.62, neutral: 0.16, negative: 0.22 },
  { aspect: "smell", positive: 0.48, neutral: 0.18, negative: 0.34 },
  { aspect: "relief_speed", positive: 0.58, neutral: 0.23, negative: 0.19 },
  { aspect: "residue", positive: 0.44, neutral: 0.2, negative: 0.36 },
  { aspect: "packaging", positive: 0.51, neutral: 0.32, negative: 0.17 },
];

// ===============================================================
// LAYOUT + NAV
// ===============================================================

const NAV = [
  { key: "live", label: "Live Feed" },
  { key: "batch", label: "Batch Analytics" },
  { key: "snapshot", label: "Snapshotter" },
] as const;

type NavKey = (typeof NAV)[number]["key"];

export default function SpiruvitaDashboardV2() {
  const [nav, setNav] = useState<NavKey>("live");

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-white/80 px-4 backdrop-blur">
        <div className="flex-1 font-semibold">Spiruvita Intelligence</div>
        <div className="text-xs text-gray-500">Prototype • v2</div>
      </header>

      {/* Shell */}
      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-4 px-4 py-4">
        {/* Sidebar */}
        <aside className="col-span-12 h-full rounded-2xl border bg-white p-2 shadow-sm md:col-span-3 lg:col-span-2">
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => setNav(n.key)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-gray-100 ${
                  nav === n.key ? "bg-gray-100 font-medium" : ""
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-xs text-gray-600">
            <div className="font-medium">Hint</div>
            <p>
              Replace mock arrays with API calls:{" "}
              <code className="rounded bg-gray-100 px-1">/api/alerts</code>,{" "}
              <code className="rounded bg-gray-100 px-1">/api/trends</code>,{" "}
              <code className="rounded bg-gray-100 px-1">/api/prices</code>,{" "}
              <code className="rounded bg-gray-100 px-1">/api/sentiment</code>,{" "}
              <code className="rounded bg-gray-100 px-1">/api/snapshots</code>.
            </p>
          </div>
        </aside>

        {/* Main */}
        <main className="col-span-12 grid gap-4 md:col-span-9 lg:col-span-10">
          {nav === "live" && <LiveFeed />}
          {nav === "batch" && <BatchAnalytics />}
          {nav === "snapshot" && <Snapshotter />}
        </main>
      </div>
    </div>
  );
}

// ===============================================================
// VIEW 1 — LIVE FEED
// ===============================================================

function LiveFeed() {
  const [alerts, setAlerts] = useState<Alert[]>(() => MOCK_ALERTS_SEED);

  // Simulate streaming alerts every ~7s
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      const demo: Alert = {
        id: `al${now.getTime()}`,
        ts: now.toISOString(),
        title:
          Math.random() > 0.5
            ? "Competitor X: posted an ad"
            : "Competitor Z: stock out",
        description:
          Math.random() > 0.5
            ? "Ad is about BUY 1 GET 1 (skincare bundle)"
            : "SKU ‘Heel Balm 50g’ unavailable on Shopee — 3rd party sellers only",
        severity:
          Math.random() > 0.75
            ? "high"
            : Math.random() > 0.4
            ? "medium"
            : "low",
        market: Math.random() > 0.5 ? "SG" : "MY",
        channel: Math.random() > 0.5 ? "Lazada" : "Shopee",
      };
      setAlerts((prev) => [demo, ...prev].slice(0, 30));
    }, 7000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Alerts feed */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">Real‑time Alerts</h2>
        <p className="mb-3 text-sm text-gray-500">
          Examples: competitor ad posts, stockouts, price drops.
        </p>
        <div className="flex max-h-80 flex-col gap-3 overflow-auto pr-2">
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
                    : "bg-emerald-500"
                }`}
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(a.ts).toLocaleString()}
                  </div>
                </div>
                <div className="text-sm text-gray-600">
                  {a.market} {a.channel ? `• ${a.channel}` : ""}
                </div>
                <div className="text-sm">{a.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Google Trends + Forecast (mock) */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Interest in Skincare (Google Trends • mock)
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Foot cream • Antifungal • Heel balm (with forecast overlay)
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={MOCK_TRENDS}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="foot_cream"
                name="Foot cream"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="antifungal"
                name="Antifungal"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="heel_balm"
                name="Heel balm"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                fillOpacity={0.1}
              />
              {/* Shade the forecast horizon */}
              <ReferenceArea
                x1="2025-09-18"
                x2="2025-09-20"
                y1={0}
                y2={100}
                fillOpacity={0.08}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Competitor prices (past week) */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-2">
        <h2 className="mb-1 text-lg font-semibold">
          Competitor Aggregate Prices — Past Week (mock)
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Average prices across PDPs in market SG
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={MOCK_PRICES}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="avg_price_spiruvita"
                name="Spiruvita"
              />
              <Line
                type="monotone"
                dataKey="avg_price_canesten"
                name="Canesten"
              />
              <Line
                type="monotone"
                dataKey="avg_price_lamisil"
                name="Lamisil"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

// ===============================================================
// VIEW 2 — BATCH ANALYTICS (static mock)
// ===============================================================

function BatchAnalytics() {
  // Reuse MOCK_ASPECTS for a stacked bar of sentiment
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">Aspect Sentiment (batch)</h2>
        <p className="mb-3 text-sm text-gray-500">
          From offline ABSA over historical reviews
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={MOCK_ASPECTS}
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
        <h2 className="mb-1 text-lg font-semibold">Promo Impact (example)</h2>
        <p className="mb-3 text-sm text-gray-500">
          Baseline vs Promo lift (placeholder)
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={[
                { week: "2025-09-01", baseline: 100, promo: 140, lift: 40 },
                { week: "2025-09-08", baseline: 105, promo: 136, lift: 30 },
                { week: "2025-09-15", baseline: 110, promo: 155, lift: 41 },
              ]}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="baseline" name="Baseline" />
              <Bar dataKey="promo" name="Promo" />
              <Line type="monotone" dataKey="lift" name="Lift %" yAxisId={1} />
              <YAxis
                yAxisId={1}
                orientation="right"
                tickFormatter={(v) => `${v}%`}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-2">
        <h2 className="mb-1 text-lg font-semibold">Notes</h2>
        <ul className="list-inside list-disc text-sm text-gray-700">
          <li>
            Connect this view to your batch pipelines output tables (e.g.,
            RDS/Postgres).
          </li>
          <li>
            Populate charts with server responses: <code>/api/sentiment</code>,{" "}
            <code>/api/promo-impact</code>, <code>/api/price-rating</code>.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ===============================================================
// VIEW 3 — SNAPSHOTTER (URL input + table)
// ===============================================================

function Snapshotter() {
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState<SnapshotRow[]>([
    {
      id: "r1",
      url: "https://www.lazada.sg/products/pdp-123",
      imageUrl: "https://picsum.photos/seed/a/80/80",
      product: "Example Product A",
      price: "$14.90",
      availability: "in_stock",
      status: "done",
    },
  ]);

  function addUrl() {
    if (!url.trim()) return;
    const id = `tmp-${Date.now()}`;
    const pending: SnapshotRow = {
      id,
      url: url.trim(),
      status: "adding",
    };
    setRows((prev) => [pending, ...prev]);
    setUrl("");

    // Simulate long-running snapshot job completing later
    setTimeout(() => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                imageUrl: "https://picsum.photos/seed/" + id + "/80/80",
                product: "(mock) Parsed Product Name",
                price: "$15.50",
                availability: Math.random() > 0.2 ? "in_stock" : "out_of_stock",
                status: "done",
              }
            : r
        )
      );
    }, 2200);
  }

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Snapshotter</h2>
      <p className="mb-3 text-sm text-gray-500">
        Enter a Lazada PDP URL to add to the queue. Below table is fixed height
        with scroll.
      </p>

      {/* Input row */}
      <div className="mb-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
          placeholder="https://www.lazada.sg/products/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
          onClick={addUrl}
        >
          Add
        </button>
      </div>

      {/* Table */}
      <div className="max-h-80 overflow-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2">Image</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">URL / Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt={r.product || ""}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-gray-100" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="line-clamp-2 max-w-xs">
                    {r.product || (
                      <span className="italic text-gray-500">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {r.price || <span className="italic text-gray-500">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.status === "adding" ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      pending…
                    </span>
                  ) : r.availability === "in_stock" ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                      in stock
                    </span>
                  ) : r.availability === "out_of_stock" ? (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                      out of stock
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      unknown
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <a
                      href={r.url}
                      className="truncate text-blue-600 underline"
                      title={r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.url}
                    </a>
                    {r.status === "adding" && (
                      <span className="text-xs text-gray-500">
                        • adding url {r.url}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Notes: UI only. Wire <code>/api/snapshots:add</code> for queueing and{" "}
        <code>/api/snapshots:list</code> for listing rows.
      </div>
    </section>
  );
}
