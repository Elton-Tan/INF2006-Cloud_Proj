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
  updated_at?: number; // unix seconds
};

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

type Availability = "in_stock" | "out_of_stock" | "unknown";

function Snapshotter() {
  // ====== CONFIG ======
  const API_BASE = "https://unaz4gl673.execute-api.us-east-1.amazonaws.com/dev";

  const AUTH_TOKEN =
    "eyJraWQiOiJEVjRYZ0VPdEZIRmxDeVloWW8zV2llYzRVekFueTBuUEJPMlVwcEsxQTFjPSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiUy1wOUhaNE9wTFFYV3R0dGNkYlNWUSIsInN1YiI6Ijc0Zjg4NDc4LWIwNzEtNzAyZi1jNzc2LWVlNmNiMTY5OTRlZSIsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTEuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0xX1dqUjdqbjd0VSIsImNvZ25pdG86dXNlcm5hbWUiOiJzcGlydWxpbmEtYWRtaW4iLCJhdWQiOiI3OW51bGpoYTdqbnY1aGNhc3MxcnNkM2pqYyIsImV2ZW50X2lkIjoiNTIwNWNhYmUtZDExOC00NzQ2LWI3OGItMDhlZWMzNTVjNzdiIiwidG9rZW5fdXNlIjoiaWQiLCJhdXRoX3RpbWUiOjE3NTg5MDk0NzksImV4cCI6MTc1ODkxMzA3OSwiaWF0IjoxNzU4OTA5NDc5LCJqdGkiOiJiMWU1YWFjNy05MThiLTRmOTAtYTA3ZC04MDhjZTE5Zjc1YTYiLCJlbWFpbCI6ImVsdG9udGFuMDcwOUBnbWFpbC5jb20ifQ.hSh8iXEgwFxHQvPCPulyyIGsyrLShxV5NRWvmMxHTfNxAZAbb6JyEmLRxha68cQEuxMUJdM4ihgpdmuxrPGo6Q0YTTPpQ0qVBeE8LM-Y36J37NXxQVT2HRXCdMinU-KtJn6MKGodd9jFt7x6fE7UVgPzhvKoVb5mrDxj8jSvT5wQLme00QBqyQIHQmlrSvHsETA7d53M43aN0dwx1hnURvMjzeyteB7i5ZZbK8b6_DQyPzSQ-fiY7kKMxJxzVmw86pkj3HapndMzHzKOWe07ibUKVWfUxgRgvZ4mHq8Kpv85YFgQa1ppK82iKH5ZkriYRRZnLCrdXVbebmhTeBVjMw";
  const WS_BASE =
    "wss://ccdg38adi2.execute-api.us-east-1.amazonaws.com/production";
  const USER_ID = "tester";
  const PENDING_KEY = "watchlist.pending.v2";
  const PENDING_TTL_MS = 5 * 60 * 1000;

  // ====== STATE ======
  const { show, Toast } = useToast();
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
      Object.entries(parsed).forEach(([k, v]: [string, any]) => {
        if (typeof v === "string") out[k] = { url: v, ts: Date.now() };
        else if (v && typeof v.url === "string" && typeof v.ts === "number")
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

  const canonicalUrl = (raw: string): string => {
    const trimmed = (raw || "").trim();
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

  // Upsert into array by canonical URL; preserve order: newest first
  const upsertByUrl = (
    list: SnapshotRow[],
    row: SnapshotRow
  ): SnapshotRow[] => {
    const key = canonicalUrl(row.url);
    const idx = list.findIndex((x: SnapshotRow) => canonicalUrl(x.url) === key);
    if (idx === -1) {
      // new → put at top
      return [row, ...list];
    }
    const copy = list.slice();
    const old = copy[idx]!;
    // prefer newer timestamp if available
    const newer = (row.updated_at ?? 0) >= (old.updated_at ?? 0);
    copy[idx] = newer ? { ...old, ...row } : { ...row, ...old };
    return copy;
  };

  // Remove by canonical URL
  const removeByUrl = (list: SnapshotRow[], url: string): SnapshotRow[] => {
    const key = canonicalUrl(url);
    return list.filter((x: SnapshotRow) => canonicalUrl(x.url) !== key);
  };

  // ====== SERVER DEDUPE (URL only, no title-based merge) ======
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

  // ====== LOAD / REFRESH ======
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

      // Merge pending placeholders (not yet resolved) + expire TTL
      const now = Date.now();
      Object.entries(pending).forEach(([tid, ent]: [string, PendingEntry]) => {
        const key = canonicalUrl(ent.url);
        const resolved = next.some(
          (x: SnapshotRow) => canonicalUrl(x.url) === key
        );
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
    void load();
  }, []);

  // ====== WEBSOCKET ======
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

    const connect = (): void => {
      try {
        const url = `${WS_BASE}?token=${encodeURIComponent(AUTH_TOKEN)}`;
        ws = new WebSocket(url);
        attempts += 1;

        ws.onopen = () => {
          attempts = 0;
          setWsOpen(true);
        };

        ws.onmessage = (e: MessageEvent<string>) => {
          try {
            const msg = JSON.parse(e.data) as LiveMsg;
            if (msg.type === "watchlist.row_upserted") {
              console.log("[WS] upserted:", msg.row.url);
              const c = canonicalUrl(msg.row.url);
              setRows((prev: SnapshotRow[]) =>
                upsertByUrl(prev, mapLiveToUi(msg.row))
              );
              setPending((p) => {
                const out: Record<string, PendingEntry> = {};
                Object.entries(p).forEach(
                  ([tid, ent]: [string, PendingEntry]) => {
                    if (canonicalUrl(ent.url) !== c) out[tid] = ent;
                  }
                );
                return out;
              });
            } else if (msg.type === "watchlist.job_failed") {
              setRows((prev: SnapshotRow[]) =>
                upsertByUrl(prev, { url: msg.url, status: "error" })
              );
              setPending((p) => {
                const c = canonicalUrl(msg.url);
                const out: Record<string, PendingEntry> = {};
                Object.entries(p).forEach(
                  ([tid, ent]: [string, PendingEntry]) => {
                    if (canonicalUrl(ent.url) !== c) out[tid] = ent;
                  }
                );
                return out;
              });
              show("Adding failed — please retry.");
            }
          } catch (err) {
            console.error("WS parse error", err);
          }
        };

        ws.onclose = () => {
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
      try {
        ws?.close();
      } catch {}
    };
  }, [WS_BASE, AUTH_TOKEN]); // WS_URL stable here

  // ====== FALLBACK POLLING (only when WS closed and we have pending) ======
  // Reconcile pending regularly whether WS is open or not
  useEffect(() => {
    const hasPending = Object.keys(pending).length > 0;
    if (!hasPending) return;

    let timer: number | undefined;
    let stopped = false;

    // Poll faster if WS is down, slower if WS is up
    let delay = wsOpen ? 7000 : 3000;
    const maxDelay = wsOpen ? 15000 : 12000;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        await load(); // <- this applies your TTL & merges
        delay = Math.min(delay * 1.8, maxDelay); // backoff
      }
      timer = window.setTimeout(tick, delay) as unknown as number;
    };

    timer = window.setTimeout(tick, delay) as unknown as number;

    const onVisible = () => {
      delay = wsOpen ? 7000 : 3000;
      void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      stopped = true;
    };
  }, [pending, wsOpen]); // <-- keep both deps

  // ====== ADD FLOW ======
  // ====== ADD FLOW ======
  const addUrl = async (): Promise<void> => {
    const clean = inputUrl.trim();
    if (!clean) return;

    const key = canonicalUrl(clean);

    // prevent duplicates already in UI
    const exists = rows.some(
      (x: SnapshotRow) =>
        canonicalUrl(x.url) === key &&
        (x.status === "ok" || x.status === "adding")
    );
    if (exists) {
      show("Product already in watchlist.");
      return;
    }

    // (best-effort) server duplicate check
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

    // --- optimistic placeholder (ONCE) ---
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
      const res = await fetch(`${API_BASE}/watchlist`, {
        method: "POST",
        headers: authHeaders(), // Authorization: Bearer <JWT>
        body: JSON.stringify({ url: clean }), // ← no user_id here
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    // --- reconciliation loop (ALWAYS run; exits on success) ---
    const START = Date.now();
    const TIMEOUT = 5 * 60 * 1000; // match your TTL window if you like
    const INTERVAL = 3000;

    const loop = async (): Promise<void> => {
      try {
        const r = await fetch(`${API_BASE}/watchlist`, {
          headers: authHeaders(),
        });
        if (r.ok) {
          const arr = (await r.json()) as ApiWatchRow[];
          const hit = dedupeByUrl(arr).find((x) => canonicalUrl(x.url) === key);
          if (hit) {
            setRows((prev) => upsertByUrl(prev, mapApiToUi(hit)));
            setPending((p) => {
              const { [tempId]: _, ...rest } = p;
              return rest;
            });
            return; // done
          }
        }
      } catch {}
      if (Date.now() - START < TIMEOUT) setTimeout(loop, INTERVAL);
      // else: your watchdog effect + TTL will flip it to error
    };

    setTimeout(loop, INTERVAL);
    // small nudge for perceived speed
    setTimeout(() => {
      void load();
    }, 4000);
  };

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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setInputUrl(e.target.value)
          }
        />
        <button
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
          onClick={addUrl}
        >
          Add
        </button>
        <button
          className="rounded-xl bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
          onClick={() => {
            void load();
          }}
        >
          Refresh
        </button>
      </div>

      <div className="mb-2 text-xs">
        Live:&nbsp;
        <span className={wsOpen ? "text-emerald-600" : "text-amber-600"}>
          {wsOpen ? "connected" : "reconnecting / fallback polling"}
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
              rows.map((r: SnapshotRow) => {
                const key = canonicalUrl(r.url); // key by URL (prevents dupes)
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
      <Toast />
    </section>
  );
}
