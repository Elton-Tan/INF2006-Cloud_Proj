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

type ApiWatchRow = {
  id: number | string;
  url: string;
  product: string | null;
  price: number | null;
  stock_status: string | null;
  image_url: string | null;
  updated_at?: number | string | null;
};

// UI row for your table
type SnapshotRow = {
  url: string; // identity (canonicalUrl used internally)
  product?: string | null;
  price?: number | null;
  availability?: Availability;
  imageUrl?: string | null;
  status?: "adding" | "ok" | "error";
  updated_at?: number;
};

// ===== Aspect types =====
type AspectSummaryRow = {
  aspect: string;
  docs: number;
  share: number; // 0..1
};

type TopTerm = {
  term: string;
  n: number;
  lift: number;
};

type AspectTopTerms = Record<string, TopTerm[]>;

// Simple JSON fetcher w/ loading + error
function useJson<T>(url: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (alive) setData(json);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to fetch");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  return { data, loading, error };
}

const ASPECT_CONFIG = {
  SUMMARY_URL: "/data/aspects_summary.json", // e.g. served by your app
  TOP_TERMS_URL: "/data/aspect_top_terms.json", // same folder as above
};

const CONFIG = {
  API_BASE: "https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev",
  WS_BASE: "https://d1n59ypscvrsxd.cloudfront.net/production",
  // Put your Cognito **ID token** here (or inject via env at build time)
  AUTH_TOKEN:
    "eyJraWQiOiI4blFndENlNzVNYzdDSmljS2RGQmVxazkxZ3VZcXp0WXBqbDJ0c1M2RFlFPSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiZ2Z6ZjZka2VianhFQ19USWhQU3poZyIsInN1YiI6ImI0ZDg3NDE4LWIwMjEtNzAxNC0xNWExLTJiMTJkZTliYmY1OCIsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTEuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0xXzh3YU9rZG9VUiIsImNvZ25pdG86dXNlcm5hbWUiOiJiNGQ4NzQxOC1iMDIxLTcwMTQtMTVhMS0yYjEyZGU5YmJmNTgiLCJhdWQiOiJvaDJ2ZjlpbWxlMWw1Nm5razZmbWt0ZTBpIiwiZXZlbnRfaWQiOiJjNzhkZTNkYi0wOGJiLTQ2YTAtOWNiZC03ZTYwMTAwN2IwMmIiLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTc1OTM4NDgxMCwiZXhwIjoxNzU5Mzg4NDEwLCJpYXQiOjE3NTkzODQ4MTAsImp0aSI6IjljYTQ5NmJjLWE3NTEtNGQzMy1iOWM0LTZkYmY0MjNlZTgxMiIsImVtYWlsIjoic3VhbmZpeEB0aGVmb290cHJhY3RpY2UuY29tIn0.atSyZb-MLmxveLRjNiXIL3FVlRwYCz74nIBqKi5b93_XDexkGq91OM6-PPnnxi1gBqbDc70-v5tTAi2O1MXQQMnYiF_zkITJLk-dcZF3ZXHdu-wnkdD1peWzVG4b34tr2jiQSBppMqZzY-_wwqfXg4G283MGIJcDZfjyDF7hfB45HjKOxlGzbMY2BiFxSrn8TRys-gu800wiz0kI7Ctvy74VC3POZ-_livTOLe2XBaLqrU8TOWWcW4FbrcG28S0CN6N72jfyBK1ENzXjMVon7kMS80QTY7OX3tRFW-0edGU9-QIzhIDCDTTxaCYv6FDeml4RbHR9QKNrt8h7_TTjzg",
};

const fmtSgt = (t?: number | string | null): string => {
  if (t == null) return "—";
  // Our API now returns ISO with +08:00, but we still handle unix seconds just in case
  const d = typeof t === "number" ? new Date(t * 1000) : new Date(String(t));
  // Force-render in Asia/Singapore
  return d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    hour12: false,
  });
};

const trunc = (s: string, n = 48) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

const buildWsUrl = (baseHttpsUrl: string, token: string) => {
  const u = new URL(baseHttpsUrl);
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.searchParams.set("token", token);
  return u.toString();
};

type AuthCtx = { apiBase: string; wsBase: string; token: string };
const AuthContext = React.createContext<AuthCtx | null>(null);
const useAuth = (): AuthCtx => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("AuthContext missing");
  return ctx;
};

// Lightweight app-wide event bus (for cross-component notifications)
const BusContext = React.createContext<EventTarget | null>(null);
const useBus = (): EventTarget | null => React.useContext(BusContext);

// Provider wrapper
function AppProviders({ children }: { children: React.ReactNode }) {
  const [auth] = React.useState<AuthCtx>({
    apiBase: CONFIG.API_BASE,
    wsBase: CONFIG.WS_BASE,
    token: CONFIG.AUTH_TOKEN,
  });

  // Single EventTarget instance for pub/sub
  const [bus] = React.useState<EventTarget>(() => new EventTarget());

  return (
    <AuthContext.Provider value={auth}>
      <BusContext.Provider value={bus}>{children}</BusContext.Provider>
    </AuthContext.Provider>
  );
}

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string, ms = 2200) => {
    setMsg(m);
    window.clearTimeout((show as any)._t);
    (show as any)._t = window.setTimeout(() => setMsg(null), ms);
  };

  const Toast = () =>
    msg ? (
      <>
        {/* optional dim overlay — uncomment to add a subtle backdrop */}
        {/* <div className="fixed inset-0 z-[9998] bg-black/20" /> */}

        <div
          role="alert"
          className="fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2
                     rounded-xl border border-red-300 bg-red-600 px-4 py-3 text-white
                     shadow-2xl pointer-events-none"
        >
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-white" />
            <span className="text-sm font-medium">{msg}</span>
          </div>
        </div>
      </>
    ) : null;

  return { show, Toast };
}

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
  return (
    <AppProviders>
      <DashboardShell />
    </AppProviders>
  );
}

// Move your previous component body into this:
function DashboardShell() {
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

function LiveBadge() {
  const bus = useBus();
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    if (!bus) return;
    let t: number | null = null;
    const handler = () => {
      setOn(true);
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => setOn(false), 1200);
    };
    bus.addEventListener("watchlist:changed", handler);
    return () => {
      bus.removeEventListener("watchlist:changed", handler);
      if (t) window.clearTimeout(t);
    };
  }, [bus]);

  if (!on) return null;
  return (
    <span className="ml-2 align-middle rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      live
    </span>
  );
}

function LiveFeed() {
  const [alerts, setAlerts] = useState<Alert[]>(() => MOCK_ALERTS_SEED);
  type SeriesPoint = { bucket: string; [product: string]: number | string };
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
          Competitor Prices <LiveBadge />
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Average prices across PDPs (SGT buckets). Switch Day/Week/Month.
        </p>
        <PriceSeries />
      </section>
    </div>
  );
}

function PriceSeries() {
  type SeriesPoint = { bucket: string; [product: string]: number | string };

  const { apiBase, token } = useAuth();
  const bus = useBus();

  const [range, setRange] = React.useState<"day" | "week" | "month">("week");
  const [series, setSeries] = React.useState<SeriesPoint[]>([]);
  const [products, setProducts] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const authHeaders = React.useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/watchlist/series?range=${range}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSeries(data.series || []);
      setProducts(data.products || []);
    } catch (e) {
      console.error(e);
      setError("Failed to load price series");
      setSeries([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, range, authHeaders]);

  // initial + on range change
  React.useEffect(() => {
    void load();
  }, [load]);

  // === Pub/Sub: refresh when watchlist data changes ===
  React.useEffect(() => {
    if (!bus) return;
    let debounce: number | null = null;
    const onChange = () => {
      // debounce rapid bursts (e.g., multiple rows within a short time)
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void load();
        debounce = null;
      }, 800);
    };
    bus.addEventListener("watchlist:changed", onChange);
    return () => {
      bus.removeEventListener("watchlist:changed", onChange);
      if (debounce) window.clearTimeout(debounce);
    };
  }, [bus, load]);

  return (
    <>
      {/* Range selector */}
      <div className="mb-3 inline-flex rounded-xl border bg-white p-1">
        {(["day", "week", "month"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setRange(opt)}
            className={`px-3 py-1.5 text-sm rounded-lg transition ${
              range === opt ? "bg-gray-900 text-white" : "hover:bg-gray-100"
            }`}
          >
            {opt === "day"
              ? "Day (hourly)"
              : opt === "week"
              ? "Week (daily)"
              : "Month (daily)"}
          </button>
        ))}
      </div>

      <div className="h-72">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Loading…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-rose-600">
            {error}
          </div>
        ) : series.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={series}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 12 }}
                tickFormatter={(s: string) =>
                  range === "day" ? s.slice(11, 16) : s
                }
              />
              <YAxis />
              <Tooltip
                formatter={(value: any, name: string) => [
                  value,
                  <span title={name}>{trunc(name)}</span>,
                ]}
              />
              <Legend
                formatter={(value: string) => (
                  <span title={value}>{trunc(value)}</span>
                )}
              />

              {products.map((p) => (
                <Line
                  key={p}
                  type="monotone"
                  dataKey={p}
                  name={p}
                  strokeWidth={2}
                  dot={{ r: 3 }} // dot at EVERY bucket (hour/day)
                  activeDot={{ r: 5 }} // a bit larger on hover
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}

// ===============================================================
// VIEW 2 — BATCH ANALYTICS (unchanged)
// ===============================================================
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

  // pick 6–8 visible aspects by share
  const visible = React.useMemo(() => {
    if (!summary) return [];
    return [...summary].sort((a, b) => b.share - a.share).slice(0, 7);
  }, [summary]);

  // utility: palette for strips (kept subtle)
  const colors = [
    "bg-emerald-50 border-emerald-200",
    "bg-sky-50 border-sky-200",
    "bg-amber-50 border-amber-200",
    "bg-violet-50 border-violet-200",
    "bg-rose-50 border-rose-200",
    "bg-lime-50 border-lime-200",
    "bg-cyan-50 border-cyan-200",
  ];

  // Make a quick “weight” for words: by lift first, then n
  function topNWords(aspect: string, k = 10): TopTerm[] {
    const arr = (topTerms && topTerms[aspect]) || [];
    return [...arr]
      .sort((a, b) => {
        if (b.lift !== a.lift) return b.lift - a.lift;
        return b.n - a.n;
      })
      .slice(0, k);
  }

  // small helper for % text
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <section className="relative rounded-2xl border bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-1 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Keywords Analytics</h2>
          <p className="text-sm text-gray-500">
            Which aspects do customers focus on?
          </p>
        </div>

        {/* Flip button */}
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

      {/* Body */}
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
          // ===== Mode A: Frequent words preview per aspect (tile grid) =====
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
                      // scale font-size by lift (cap 0.9..1.3em)
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
          // ===== Mode B: Strip poster (one strip per aspect, width ~ share) =====
          <div className="flex flex-col gap-2">
            {visible.map((row, i) => {
              const terms = topNWords(row.aspect, 8)
                .map((t) => t.term.replace(/_/g, " "))
                .join(" • ");
              const widthPct = Math.max(16, Math.round(row.share * 100)); // keep visible
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

      {/* Footer hint */}
      <div className="mt-3 text-xs text-gray-500">
        Note: Sum may not add to 100% because words of multiple aspects can
        appear in the same single review
      </div>
    </section>
  );
}

function BatchAnalytics() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-2">
        <AspectFlipPoster
          summaryUrl={ASPECT_CONFIG.SUMMARY_URL}
          termsUrl={ASPECT_CONFIG.TOP_TERMS_URL}
        />
      </section>

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

type Availability = "in_stock" | "out_of_stock" | "unknown";

function Snapshotter() {
  // ====== STATE (confirm modal) ======
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // ====== CONFIG ======
  const { apiBase: API_BASE, token: AUTH_TOKEN, wsBase: WS_BASE } = useAuth();
  const bus = useBus();
  const PENDING_KEY = "watchlist.pending.v2";
  const PENDING_TTL_MS = 5 * 60 * 1000;

  // ====== TOAST ======
  const { show, Toast } = useToast();

  // ====== STATE ======
  const [inputUrl, setInputUrl] = useState<string>("");
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsOpen, setWsOpen] = useState<boolean>(false);

  type PendingEntry = { url: string; ts: number };
  const [pending, setPending] = useState<Record<string, PendingEntry>>(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, any>;
      const out: Record<string, PendingEntry> = {};
      Object.entries(parsed).forEach(([k, v]) => {
        if (typeof v === "string") out[k] = { url: v, ts: Date.now() };
        else if (
          v &&
          typeof (v as any).url === "string" &&
          typeof (v as any).ts === "number"
        )
          out[k] = v as PendingEntry;
      });
      return out;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {}
  }, [pending]);

  // ====== HELPERS ======
  const authHeaders = (): Record<string, string> => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  });

  const canonicalUrl = (raw?: string | null): string => {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return "";
    try {
      const u = new URL(trimmed);
      u.hash = "";
      u.host = u.host.toLowerCase().replace(/^(www|m)\./, "");
      [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "spm",
        "from",
        "clickTrackInfo",
      ].forEach((k) => u.searchParams.delete(k));
      u.pathname = u.pathname.replace(/\/+$/, "") || "/";
      return u.toString();
    } catch {
      return trimmed.replace(/\/+$/, "");
    }
  };

  const toAvail = (s?: string | null): Availability => {
    if (!s) return "unknown";
    const v = s.toLowerCase();
    if (v.includes("out")) return "out_of_stock";
    if (v.includes("in")) return "in_stock";
    return "unknown";
  };

  const toUnix = (t?: number | string | null): number | undefined => {
    if (t == null) return undefined;
    if (typeof t === "number") return t;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
  };

  const mapApiToUi = (r: ApiWatchRow): SnapshotRow => ({
    url: r.url,
    product: r.product,
    price: r.price ?? undefined,
    availability: toAvail(r.stock_status),
    imageUrl: r.image_url ?? null,
    status: "ok",
    updated_at: toUnix(r.updated_at),
  });

  // Upsert by canonical URL
  const upsertByUrl = (
    list: SnapshotRow[],
    row: SnapshotRow
  ): SnapshotRow[] => {
    const key = canonicalUrl(row.url);
    const idx = list.findIndex((x) => canonicalUrl(x.url) === key);
    if (idx === -1) return [row, ...list];
    const copy = list.slice();
    const old = copy[idx]!;
    const newer = (row.updated_at ?? 0) >= (old.updated_at ?? 0);
    copy[idx] = newer ? { ...old, ...row } : { ...row, ...old };
    return copy;
  };

  const removeByUrl = (list: SnapshotRow[], url: string): SnapshotRow[] => {
    const key = canonicalUrl(url);
    return list.filter((x) => canonicalUrl(x.url) !== key);
  };

  const dedupeByUrl = (list: ApiWatchRow[]): ApiWatchRow[] => {
    const byUrl = new Map<string, ApiWatchRow>();
    const isNewer = (a: ApiWatchRow, b?: ApiWatchRow): boolean => {
      if (!b) return true;
      const au = toUnix(a.updated_at) ?? 0;
      const bu = toUnix(b.updated_at) ?? 0;
      return au !== bu ? au > bu : Number(a.id) > Number(b.id);
    };
    for (const r of list) {
      const k = canonicalUrl(r.url);
      const prev = byUrl.get(k);
      if (isNewer(r, prev)) byUrl.set(k, r);
    }
    return Array.from(byUrl.values());
  };

  // ====== LOAD ONCE (no periodic refresh) ======
  const load = async (): Promise<void> => {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch(`${API_BASE}/watchlist`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiWatchRow[];

      // Real rows from server
      let next: SnapshotRow[] = [];
      for (const r of dedupeByUrl(data))
        next = upsertByUrl(next, mapApiToUi(r));

      // Merge pending placeholders with TTL
      const now = Date.now();
      Object.entries(pending).forEach(([tid, ent]) => {
        const key = canonicalUrl(ent.url);
        const resolved = next.some((x) => canonicalUrl(x.url) === key);
        const expired = now - ent.ts > PENDING_TTL_MS;
        if (!resolved && !expired) {
          next = upsertByUrl(next, {
            url: ent.url,
            status: "adding",
            availability: "unknown",
          });
        } else if (!resolved && expired) {
          next = upsertByUrl(next, { url: ent.url, status: "error" });
          setPending((p) => {
            const { [tid]: _, ...rest } = p;
            return rest;
          });
        } else if (resolved) {
          setPending((p) => {
            const { [tid]: _, ...rest } = p;
            return rest;
          });
        }
      });

      setRows(next);
    } catch (e) {
      console.error(e);
      setError("Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(); // initial fetch only
  }, []);

  // ====== DELETE ======
  const deleteByUrl = async (targetUrl: string): Promise<void> => {
    setConfirmBusy(true);
    try {
      const r = await fetch(
        `${API_BASE}/watchlist?url=${encodeURIComponent(targetUrl)}`,
        { method: "DELETE", headers: authHeaders() }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      setRows((prev) => removeByUrl(prev, targetUrl));
      bus?.dispatchEvent(new Event("watchlist:changed"));
      setPending((p) => {
        const c = canonicalUrl(targetUrl);
        const out: Record<string, { url: string; ts: number }> = {};
        Object.entries(p).forEach(([k, v]) => {
          if (canonicalUrl(v.url) !== c) out[k] = v;
        });
        return out;
      });
      show(
        `Removed ${data.deleted_count ?? 0} entr${
          (data.deleted_count ?? 0) === 1 ? "y" : "ies"
        }.`
      );
    } catch (e) {
      console.error(e);
      show("Failed to delete. Try again.");
    } finally {
      setConfirmBusy(false);
      setConfirmOpen(false);
      setConfirmUrl(null);
    }
  };

  type LiveUpsert = {
    type: "watchlist.row_upserted";
    row: {
      url: string;
      product?: string | null;
      price?: number | null;
      stock_status?: string | null;
      image_url?: string | null;
      updated_at?: number;
    };
  };
  type LiveFailed = {
    type: "watchlist.job_failed";
    url: string;
    reason?: string;
  };
  type LiveMsg = LiveUpsert | LiveFailed;

  function isRecord(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === "object";
  }

  function isLiveUpsert(v: unknown): v is LiveUpsert {
    if (!isRecord(v)) return false;
    if (v.type !== "watchlist.row_upserted") return false;
    const row = v.row;
    return (
      isRecord(row) &&
      typeof row.url === "string" &&
      (row.updated_at == null || typeof row.updated_at === "number")
    );
  }

  function isLiveFailed(v: unknown): v is LiveFailed {
    return (
      isRecord(v) &&
      v.type === "watchlist.job_failed" &&
      typeof v.url === "string"
    );
  }

  function parseLiveMsg(raw: string): LiveMsg | null {
    try {
      const data = JSON.parse(raw);
      if (isLiveUpsert(data) || isLiveFailed(data)) return data;
      return null;
    } catch {
      return null;
    }
  }

  const mapLiveToUi = (r: LiveUpsert["row"]): SnapshotRow => ({
    url: r.url,
    product: r.product ?? undefined,
    price: r.price ?? undefined,
    availability: toAvail(r.stock_status),
    imageUrl: r.image_url ?? null,
    status: "ok",
    updated_at: typeof r.updated_at === "number" ? r.updated_at : undefined,
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempts = 0;
    let reconnectTimer: number | undefined;
    let heartbeat: number | undefined;

    const connect = () => {
      try {
        const url = buildWsUrl(WS_BASE, AUTH_TOKEN);
        ws = new WebSocket(url);
        attempts += 1;

        ws.onopen = () => {
          attempts = 0;
          setWsOpen(true);
          heartbeat = window.setInterval(() => {
            try {
              ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}');
            } catch {}
          }, 30000) as unknown as number;
        };

        ws.onmessage = (e: MessageEvent<string>) => {
          const msg = parseLiveMsg(e.data);
          if (!msg) return; // ignore unknown messages

          if (msg.type === "watchlist.row_upserted") {
            const uiRow = mapLiveToUi(msg.row);

            // optional: normalize updated_at (server sends seconds; ensure seconds)
            if (
              typeof uiRow.updated_at === "number" &&
              uiRow.updated_at > 1e12
            ) {
              // looks like ms, convert to s
              uiRow.updated_at = Math.floor(uiRow.updated_at / 1000);
            }

            const c = canonicalUrl(msg.row.url);
            setRows((prev) => upsertByUrl(prev, uiRow));

            // clear any pending placeholders for this URL
            setPending((p) => {
              const out: Record<string, PendingEntry> = {};
              Object.entries(p).forEach(([tid, ent]) => {
                if (canonicalUrl(ent.url) !== c) out[tid] = ent;
              });
              return out;
            });

            // notify the app bus so charts refresh
            bus?.dispatchEvent(new Event("watchlist:changed"));
          }

          if (msg.type === "watchlist.job_failed") {
            setRows((prev) =>
              upsertByUrl(prev, { url: msg.url, status: "error" })
            );

            setPending((p) => {
              const c = canonicalUrl(msg.url);
              const out: Record<string, PendingEntry> = {};
              Object.entries(p).forEach(([tid, ent]) => {
                if (canonicalUrl(ent.url) !== c) out[tid] = ent;
              });
              return out;
            });

            // optional: toast + notify charts (e.g., a row disappeared)
            show("Adding failed — please retry.");
            bus?.dispatchEvent(new Event("watchlist:changed"));
          }
        };

        ws.onclose = () => {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }
          setWsOpen(false);
          const delay = Math.min(1000 * Math.max(1, attempts), 10000);
          reconnectTimer = window.setTimeout(
            connect,
            delay
          ) as unknown as number;
        };

        ws.onerror = () => {
          try {
            ws?.close();
          } catch {}
        };
      } catch {
        const delay = Math.min(1000 * Math.max(1, attempts), 10000);
        reconnectTimer = window.setTimeout(connect, delay) as unknown as number;
      }
    };

    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeat) clearInterval(heartbeat); // add this
      try {
        ws?.close();
      } catch {}
    };
  }, [WS_BASE, AUTH_TOKEN, bus]);

  // ====== ADD FLOW (no reconciliation polling; rely on WS or manual Refresh) ======
  const addUrl = async (): Promise<void> => {
    const clean = inputUrl.trim();
    if (!clean) return;

    const key = canonicalUrl(clean);

    // prevent duplicates already in UI
    const exists = rows.some(
      (x) =>
        canonicalUrl(x.url) === key &&
        (x.status === "ok" || x.status === "adding")
    );
    if (exists) {
      show("Product already in watchlist.");
      return;
    }

    // best-effort server duplicate check
    try {
      const res = await fetch(`${API_BASE}/watchlist`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as ApiWatchRow[];
        const found = dedupeByUrl(data).some(
          (r) => canonicalUrl(r.url) === key
        );
        if (found) {
          show("Product already in watchlist.");
          return;
        }
      }
    } catch {}

    // optimistic placeholder
    const tempId = `tmp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    setRows((prev) =>
      upsertByUrl(prev, {
        url: clean,
        status: "adding",
        availability: "unknown",
      })
    );
    setPending((p) => ({ ...p, [tempId]: { url: clean, ts: Date.now() } }));
    setInputUrl("");

    // enqueue
    try {
      const res = await fetch(`${API_BASE}/enqueue`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ url: clean }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // No reconciliation loop — expect WS to upsert; user can hit Refresh if needed.
    } catch (e) {
      console.error(e);
      setRows((prev) => upsertByUrl(prev, { url: clean, status: "error" }));
      setPending((p) => {
        const { [tempId]: _, ...rest } = p;
        return rest;
      });
      show("Failed to add. Try again.");
      return;
    }
  };

  // ====== SELECTED ROW / DISPLAY TEXT FOR CONFIRM MODAL ======
  const selectedRow = React.useMemo(() => {
    if (!confirmUrl) return null;
    const key = canonicalUrl(confirmUrl);
    return rows.find((r) => canonicalUrl(r.url) === key) ?? null;
  }, [confirmUrl, rows]);

  const confirmDisplayText =
    (selectedRow?.product && selectedRow.product.trim()) ||
    canonicalUrl(selectedRow?.url || confirmUrl);

  // ====== RENDER ======
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Snapshotter</h2>
      <p className="mb-3 text-sm text-gray-500">
        Enter a Lazada PDP URL to add to the queue. Below table is fixed height
        with scroll.
      </p>

      <div className="mb-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
          placeholder="https://www.lazada.sg/products/..."
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
        />
        <button
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
          onClick={addUrl}
        >
          Add
        </button>
        <button
          className="rounded-xl bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      <div className="mb-2 text-xs">
        Live:&nbsp;
        <span className={wsOpen ? "text-emerald-600" : "text-amber-600"}>
          {wsOpen ? "connected" : "reconnecting"}
        </span>
      </div>

      <div className="max-h-80 overflow-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2">Image</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">URL / Status</th>
              <th className="px-3 py-2">Last Updated</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td className="px-3 py-6 text-center text-rose-600" colSpan={6}>
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>
                  No items yet.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((r) => {
                const key = canonicalUrl(r.url);
                return (
                  <tr key={key} className="border-t">
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
                      $
                      {typeof r.price === "number" ? (
                        r.price
                      ) : (
                        <span className="italic text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "adding" ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          adding…
                        </span>
                      ) : r.status === "error" ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                          error
                        </span>
                      ) : r.availability === "in_stock" ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                          In Stock
                        </span>
                      ) : r.availability === "out_of_stock" ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                          Out of Stock
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
                          className="inline-flex items-center gap-1 text-blue-600 underline"
                          title={r.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View product <span aria-hidden>↗</span>
                        </a>
                        {r.status === "adding" && (
                          <span className="text-xs text-gray-500">
                            queuing…
                          </span>
                        )}
                        {r.status === "error" && (
                          <>
                            <span className="text-xs text-rose-600">
                              adding failed — please retry
                            </span>
                            <button
                              className="text-xs underline"
                              onClick={() => {
                                setInputUrl(r.url);
                                void addUrl();
                              }}
                            >
                              Retry
                            </button>
                            <button
                              className="text-xs underline"
                              onClick={() =>
                                setRows((prev) => removeByUrl(prev, r.url))
                              }
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-700">
                        {fmtSgt(r.updated_at)}{" "}
                        <span className="text-gray-400">SGT</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {/* Hide delete while adding */}
                      {r.status !== "adding" && (
                        <button
                          className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                          onClick={() => {
                            setConfirmUrl(r.url);
                            setConfirmOpen(true);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Uses GET/POST {API_BASE.replace("https://", "")}/watchlist with an
        Authorization header.
      </div>

      {confirmOpen && confirmUrl && (
        <>
          <div className="fixed inset-0 z-[10000] bg-black/40" />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 z-[10001] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-rose-300 bg-white shadow-2xl"
          >
            <div className="rounded-t-2xl border-b bg-rose-600/90 p-3 text-white">
              <div className="text-sm font-semibold">Remove from watchlist</div>
            </div>
            <div className="p-4 text-sm text-gray-800">
              <p className="mb-2">
                This will remove{" "}
                <span className="font-medium">all entries</span> that match:
              </p>
              <div
                className="mb-4 rounded-lg bg-gray-50 p-2 text-xs text-gray-700"
                title={confirmUrl}
              >
                {confirmDisplayText}
              </div>
              <p>
                Are you sure you want to remove product from watchlist? This
                action will delete all data related to the product. This action
                is IRREVERSIBLE.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-3">
              <button
                className="rounded-md px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmUrl(null);
                }}
                disabled={confirmBusy}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                onClick={() => confirmUrl && deleteByUrl(confirmUrl)}
                disabled={confirmBusy}
              >
                {confirmBusy ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </>
      )}

      <Toast />
    </section>
  );
}
