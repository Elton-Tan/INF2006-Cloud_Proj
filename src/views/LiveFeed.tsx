import React, { type ReactElement } from "react";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  ReferenceArea,
  LineChart,
} from "recharts";
import { Alert } from "../types";
import { useAuth, useBus } from "../contexts";
import { trunc } from "../utils";

const NAVY = {}; // noop – keeps file lean

/* -------------------------- Shared helpers -------------------------- */

function buildWsUrl(base: string, jwt: string): string {
  // Accepts https:// or wss:// — converts http(s) → ws(s)
  const url = base.replace(/^http/i, "ws");
  const u = new URL(url);
  u.searchParams.set("auth", jwt);
  return u.toString();
}

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
    // Reuse the same glow for any realtime update we dispatch
    const events = [
      "watchlist:changed",
      "trends:updated",
      "prices:updated",
      "alerts:created",
    ];
    events.forEach((ev) => bus.addEventListener(ev, handler));
    return () => {
      events.forEach((ev) => bus.removeEventListener(ev, handler));
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

/* ------------------------------ Prices ------------------------------ */

export function PriceSeries() {
  const { apiBase, token } = useAuth();
  const bus = useBus();

  type SeriesPoint = { bucket: string; [product: string]: number | string };

  const [range, setRange] = React.useState<"day" | "week" | "month">("week");
  const [series, setSeries] = React.useState<SeriesPoint[]>([]);
  const [products, setProducts] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const headers = React.useCallback(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

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
    if (!token) return; // wait for token
    void load();
  }, [token, load]);

  // 🔔 PubSub: refresh when backend broadcasts price updates
  React.useEffect(() => {
    if (!bus) return;
    const onPricesUpdated = () => void load();
    bus.addEventListener("prices:updated", onPricesUpdated);
    return () => bus.removeEventListener("prices:updated", onPricesUpdated);
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

/* ------------------------------ Trends ------------------------------ */

/** Live Google Trends chart — last 7 days (SGT) + next 7 days forecast with keyword (slug) dropdown */
function TrendsTrends() {
  const { apiBase, token } = useAuth();
  const bus = useBus();

  type CatalogItem = {
    slug: string;
    total_rows: number;
    first_day: string;
    last_day: string;
  };
  type SeriesRow = { period: string; [slug: string]: number | string | null };
  type SeriesResp = {
    geo: string;
    granularity: "day";
    start: string; // e.g., 2025-10-05
    end: string; // e.g., 2025-10-11 (last historical day)
    slugs: string[];
    rows: SeriesRow[];
    forecast?: { included: boolean; days: number };
  };

  const [catalog, setCatalog] = React.useState<CatalogItem[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]); // slugs
  const [openDD, setOpenDD] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<SeriesResp | null>(null);

  const headers = React.useCallback(() => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  // ---- Dynamic color palette (stable across renders) ----
  const colorMap = React.useMemo<Record<string, string>>(() => {
    const slugs = catalog.map((c) => c.slug);
    const n = Math.max(1, slugs.length);
    const map: Record<string, string> = {};
    for (let i = 0; i < slugs.length; i++) {
      const hue = Math.round((360 * i) / n);
      map[slugs[i]] = `hsl(${hue} 70% 45%)`;
    }
    return map;
  }, [catalog]);

  // Load catalog
  React.useEffect(() => {
    if (!token) return;
    let abort = false;
    (async () => {
      try {
        const url = new URL(`${apiBase}/trends/daily`);
        url.searchParams.set("mode", "catalog");
        const res = await fetch(url.toString(), { headers: headers() });
        if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
        const j = await res.json();
        if (abort) return;
        const slugs: CatalogItem[] = (j.slugs || []) as CatalogItem[];
        setCatalog(slugs);
        const defaults = slugs.slice(0, 3).map((s) => s.slug);
        setSelected((prev) => (prev.length ? prev : defaults));
      } catch (e) {
        console.error(e);
        if (!abort) setError("Failed to load keywords");
      }
    })();
    return () => {
      abort = true;
    };
  }, [apiBase, headers, token]);

  const fetchSeries = React.useCallback(async () => {
    if (!token || selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${apiBase}/trends/daily`);
      url.searchParams.set("mode", "series");
      url.searchParams.set("slugs", selected.join(","));
      url.searchParams.set("g", "day"); // daily points
      url.searchParams.set("window", "week"); // last 7 days (SGT)
      url.searchParams.set("include_forecast", "true"); // ask for next 7 days
      url.searchParams.set("forecast_days", "7");
      const res = await fetch(url.toString(), { headers: headers() });
      if (!res.ok) throw new Error(`series HTTP ${res.status}`);
      const j = (await res.json()) as SeriesResp;
      setData(j);
    } catch (e) {
      console.error(e);
      setError("Failed to load trend series");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, headers, selected, token]);

  // initial + when selection changes
  React.useEffect(() => {
    if (!token || selected.length === 0) return;
    void fetchSeries();
  }, [token, selected, fetchSeries]);

  // 🔔 PubSub: refresh when backend broadcasts trend updates
  React.useEffect(() => {
    if (!bus) return;
    const onTrendsUpdated = () => void fetchSeries();
    bus.addEventListener("trends:updated", onTrendsUpdated);
    return () => bus.removeEventListener("trends:updated", onTrendsUpdated);
  }, [bus, fetchSeries]);

  const toggleSlug = (slug: string) =>
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );

  const allChecked = selected.length === catalog.length && catalog.length > 0;
  const someChecked = selected.length > 0 && selected.length < catalog.length;

  // --- Helpers to style forecast zone ---
  const endHist = data?.end ?? ""; // YYYY-MM-DD
  const rows = data?.rows ?? [];
  const lastPeriod = rows.length ? rows[rows.length - 1].period : "";
  const futureStart = endHist
    ? new Date(new Date(endHist + "T00:00:00Z").getTime() + 86400000)
        .toISOString()
        .slice(0, 10)
    : "";

  // Render hollow dots only for forecast dates (must always return an SVG element)
  type DotRenderer = (props: any) => React.ReactElement<SVGElement>;
  const ForecastDot =
    (endISO: string): DotRenderer =>
    (props: any) => {
      const { cx, cy, payload, stroke } = props;
      const isFuture =
        typeof payload?.period === "string" && payload.period > endISO;
      if (!isFuture)
        return (<g />) as unknown as React.ReactElement<SVGElement>;
      return (
        <circle
          cx={cx}
          cy={cy}
          r={3.5}
          fill="white"
          stroke={stroke}
          strokeWidth={2}
        />
      ) as unknown as React.ReactElement<SVGElement>;
    };

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Interest in Words for Past 7-Days
          <LiveBadge />
        </h2>

        {/* Keyword dropdown with color chips + checkboxes */}
        <div className="relative">
          <button
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
            onClick={() => setOpenDD((v) => !v)}
          >
            {selected.length ? `${selected.length} selected` : "Pick keywords"}
          </button>
          {openDD && (
            <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border bg-white p-2 shadow-lg">
              <div className="flex items-center justify-between px-2 pb-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={() => {
                      if (allChecked) setSelected([]);
                      else setSelected(catalog.map((c) => c.slug));
                    }}
                  />
                  <span>Select all</span>
                </label>
                <button
                  className="text-xs text-gray-500 hover:text-gray-700"
                  onClick={() => setOpenDD(false)}
                >
                  Close
                </button>
              </div>
              <div className="max-h-60 overflow-auto pr-1">
                {catalog.map((c) => (
                  <label
                    key={c.slug}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50"
                    title={c.slug}
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: colorMap[c.slug] }}
                    />
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.includes(c.slug)}
                      onChange={() => toggleSlug(c.slug)}
                    />
                    <span className="flex-1 truncate text-sm">
                      {c.slug.replaceAll("_", " ")}
                    </span>
                    <span className="text-xs text-gray-400">
                      {c.total_rows}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mb-3 text-sm text-gray-500">
        Data Gathered from Google Trends
      </p>

      {data?.forecast?.included && (
        <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
          <span className="inline-block h-3 w-6 rounded bg-black/5 ring-1 ring-black/10" />
          <span>Next 7-Days Forecast</span>
        </div>
      )}

      <div className="h-72">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Loading…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-rose-600">
            {error}
          </div>
        ) : !data || !rows.length ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No data.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip
                formatter={(value: any, name: string, ctx: any) => {
                  const isFuture = ctx?.payload?.period > endHist;
                  return [
                    value,
                    <span title={name}>
                      {trunc(String(name))} {isFuture ? "(forecast)" : ""}
                    </span>,
                  ];
                }}
              />
              <Legend
                formatter={(value: string) => (
                  <span title={value}>{trunc(value)}</span>
                )}
              />

              {/* Shade forecast area if present */}
              {data?.forecast?.included &&
                futureStart &&
                lastPeriod &&
                futureStart <= lastPeriod && (
                  <ReferenceArea
                    x1={futureStart}
                    x2={lastPeriod}
                    fill="#000"
                    fillOpacity={0.05}
                  />
                )}

              {/* Lines: no dots for history; hollow dots for forecast points only */}
              {data.slugs.map((s) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  dot={ForecastDot(endHist)} // only renders on future points
                  activeDot={{ r: 5 }}
                  strokeWidth={2}
                  isAnimationActive={false}
                  stroke={colorMap[s] ?? undefined}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

/* ---------------------------- Page wrapper --------------------------- */

export default function LiveFeed() {
  const { apiBase, token, wsBase } = useAuth(); // wsBase needed for WS
  const bus = useBus();

  const [alerts, setAlerts] = React.useState<Alert[]>([]);
  const [wsOpen, setWsOpen] = React.useState<boolean>(false);

  // 🔌 Single WebSocket for the whole page → dispatch onto `bus`
  React.useEffect(() => {
    if (!token || !wsBase) return;

    let ws: WebSocket | null = null;
    let attempts = 0;
    let reconnectTimer: number | undefined;
    let heartbeat: number | undefined;

    const connect = () => {
      try {
        const url = buildWsUrl(wsBase, token);
        ws = new WebSocket(url);
        attempts += 1;

        ws.onopen = () => {
          setWsOpen(true);
          // heartbeat
          heartbeat = window.setInterval(() => {
            try {
              ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}');
            } catch {}
          }, 30000) as unknown as number;
        };

        ws.onmessage = (e: MessageEvent<string>) => {
          let msg: any = null;
          try {
            msg = JSON.parse(e.data);
          } catch {
            return;
          }
          if (!msg || typeof msg !== "object") return;

          // Fan-out to bus with small namespaced events
          if (msg.type === "trends.updated") {
            bus?.dispatchEvent(
              new CustomEvent("trends:updated", { detail: msg })
            );
          } else if (msg.type === "prices.updated") {
            bus?.dispatchEvent(
              new CustomEvent("prices:updated", { detail: msg })
            );
          } else if (msg.type === "alerts.created") {
            const a: Alert | null =
              msg.alert && typeof msg.alert === "object"
                ? {
                    id: String(msg.alert.id ?? Date.now()),
                    ts:
                      typeof msg.alert.ts === "string"
                        ? msg.alert.ts
                        : new Date().toISOString(),
                    title: String(msg.alert.title ?? "Alert"),
                    description: String(msg.alert.description ?? ""),
                    severity: (msg.alert.severity ??
                      "low") as Alert["severity"],
                    market: String(msg.alert.market ?? "SG"),
                    channel: String(msg.alert.channel ?? ""),
                  }
                : null;
            if (a) {
              setAlerts((prev) => [a, ...prev].slice(0, 50));
              bus?.dispatchEvent(
                new CustomEvent("alerts:created", { detail: a })
              );
            }
          } else if (msg.type === "watchlist.row_upserted") {
            // If you also want price refreshes tied to this
            bus?.dispatchEvent(new Event("prices:updated"));
          }
        };

        ws.onclose = () => {
          setWsOpen(false);
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }
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
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {}
    };
  }, [wsBase, token, bus]);

  // (Optional) Dev mock to preview alerts without backend push:
  // React.useEffect(() => {
  //   const t = setInterval(() => {
  //     const now = new Date();
  //     const demo: Alert = {
  //       id: `al-${now.getTime()}`,
  //       ts: now.toISOString(),
  //       title: Math.random() > 0.5 ? "Competitor X: posted an ad" : "Competitor Z: stock out",
  //       description:
  //         Math.random() > 0.5
  //           ? "Ad is about BUY 1 GET 1"
  //           : "SKU ‘Heel Balm 50g’ unavailable on Shopee",
  //       severity: Math.random() > 0.75 ? "high" : Math.random() > 0.4 ? "medium" : "low",
  //       market: Math.random() > 0.5 ? "SG" : "MY",
  //       channel: Math.random() > 0.5 ? "Lazada" : "Shopee",
  //     };
  //     setAlerts((prev) => [demo, ...prev].slice(0, 50));
  //     bus?.dispatchEvent(new CustomEvent("alerts:created", { detail: demo }));
  //   }, 7000);
  //   return () => clearInterval(t);
  // }, [bus]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Real-time alerts */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Real-time Alerts <LiveBadge />
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Examples: competitor ad posts, stockouts, price drops.
          <span
            className={`ml-2 text-xs ${
              wsOpen ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {wsOpen ? "live: connected" : "live: reconnecting"}
          </span>
        </p>
        <div className="flex max-h-80 flex-col gap-3 overflow-auto pr-2">
          {alerts.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-gray-500">
              Waiting for live alerts…
            </div>
          ) : (
            alerts.map((a) => (
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
            ))
          )}
        </div>
      </section>

      {/* Live Google Trends */}
      <TrendsTrends />

      {/* Competitor Prices series */}
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
