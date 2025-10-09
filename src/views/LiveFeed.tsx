import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  Area,
  ReferenceArea,
  LineChart,
} from "recharts";
import { Alert, TrendPoint } from "../types";
import { useAuth, useBus } from "../contexts";
import { trunc } from "../utils";

const NAVY = {}; // noop – keeps file lean

const MOCK_ALERTS_SEED: Alert[] = [
  {
    id: "al1",
    ts: new Date().toISOString(),
    title: "Competitor X: posted an ad",
    description: "Ad is about 20% DISCOUNT for antifungal cream",
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

export function PriceSeries() {
  const { apiBase, token } = useAuth();
  const bus = useBus();

  type SeriesPoint = { bucket: string; [product: string]: number | string };

  const [range, setRange] = React.useState<"day" | "week" | "month">("week");
  const [series, setSeries] = React.useState<SeriesPoint[]>([]);
  const [products, setProducts] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const headers = React.useCallback(
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
        headers: headers(),
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
  }, [apiBase, range, headers]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!bus) return;
    let debounce: number | null = null;
    const onChange = () => {
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
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
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

export default function LiveFeed() {
  const [alerts, setAlerts] = React.useState<Alert[]>(() => MOCK_ALERTS_SEED);

  React.useEffect(() => {
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
            ? "Ad is about BUY 1 GET 1"
            : "SKU ‘Heel Balm 50g’ unavailable on Shopee",
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
                  {a.market}
                  {a.channel ? ` • ${a.channel}` : ""}
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
              <YAxis />
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
