import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ComposedChart,
} from "recharts";

// ===============================================================
// TYPES
// ===============================================================

type Severity = "low" | "medium" | "high";

type Alert = {
  id: string;
  ts: string; // ISO
  title: string;
  description: string;
  severity: Severity;
  market?: string;
  channel?: string;
};

type PriceSeriesPoint = {
  day: string;
  avg_price_spiruvita: number;
  avg_price_canesten: number;
  avg_price_lamisil: number;
};

type TrendPoint = {
  day: string;
  foot_cream: number;
  antifungal: number;
  heel_balm: number;
  forecast?: number;
};

// API row coming from /api/watchlist
type ApiWatchRow = {
  id: number;
  product: string | null;
  price: number | null;
  url: string;
  stock_status: string | null; // e.g. "In Stock", "Out of Stock", null
  updated_at: string | null;
  image_url?: string | null; // optional if you add this later
};

// UI row for your table
type SnapshotRow = {
  id: string; // keep as string for React keys; convert from number
  url: string;
  imageUrl?: string | null;
  product?: string | null;
  price?: string | null | number;
  availability?: "in_stock" | "out_of_stock" | "unknown";
  status?: "adding" | "done" | "error";
};

// ===============================================================
// MOCK DATA (unchanged; used by other views only)
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

const MOCK_ASPECTS = [
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
              <code className="rounded bg-gray-100 px-1">/api/watchlist</code>.
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
// VIEW 1 — LIVE FEED (unchanged)
// ===============================================================

function LiveFeed() {
  const [alerts, setAlerts] = useState<Alert[]>(() => MOCK_ALERTS_SEED);

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
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">Real-time Alerts</h2>
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
// VIEW 2 — BATCH ANALYTICS (unchanged)
// ===============================================================

function BatchAnalytics() {
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
// VIEW 3 — SNAPSHOTTER (URL input + table wired to /api/watchlist)
// ===============================================================

function Snapshotter() {
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // helper: map API -> UI
  const mapApiToUi = (r: ApiWatchRow): SnapshotRow => {
    const availability: SnapshotRow["availability"] = r.stock_status
      ? r.stock_status.toLowerCase().includes("out")
        ? "out_of_stock"
        : "in_stock"
      : "unknown";
    return {
      id: String(r.id),
      url: r.url,
      product: r.product,
      price: r.price, // your API uses numeric price; table prints number or —
      availability,
      status: "done",
      imageUrl: r.image_url ?? null, // stays blank unless you add column
    };
  };

  const load = async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch("/api/watchlist"); // CRA proxy → Node API
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiWatchRow[] = await res.json();
      setRows(data.map(mapApiToUi));
    } catch (e: any) {
      console.error(e);
      setError("Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // keep the Add button UI but make it a no-op for now (we're focusing on list)
  function addUrl() {
    if (!url.trim()) return;
    const id = `tmp-${Date.now()}`;
    const pending: SnapshotRow = { id, url: url.trim(), status: "adding" };
    setRows((prev) => [pending, ...prev]);
    setUrl("");
    // TODO: POST to /api/watchlist in future; after success, call load()
    setTimeout(() => {
      setRows((prev) => prev.filter((r) => r.id !== id));
      load();
    }, 1200);
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
          title="Currently demo only — wires to POST later"
        >
          Add
        </button>
        <button
          className="rounded-xl bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
          onClick={load}
        >
          Refresh
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
            {loading && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td className="px-3 py-6 text-center text-rose-600" colSpan={5}>
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                  No items yet.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((r) => (
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
                    {r.price ?? <span className="italic text-gray-500">—</span>}
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
        Notes: This table now **reads** from <code>/api/watchlist</code>. The
        “Add” button is a demo — when you’re ready, wire it to{" "}
        <code>POST /api/watchlist</code> and call <code>load()</code> after
        success.
      </div>
    </section>
  );
}
