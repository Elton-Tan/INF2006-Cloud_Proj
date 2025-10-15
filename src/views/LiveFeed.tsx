import React from "react";
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

/* -------------------------- Time helpers (SGT) -------------------------- */
const SGT_TZ = "Asia/Singapore";
const GRACE_HOUR_SGT = 9;

function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function hourInTz(d: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(d)
  );
}
function makeFreshDailySgtPredicate(graceHour = GRACE_HOUR_SGT) {
  const now = new Date();
  const todaySgt = ymdInTz(now, SGT_TZ);
  const hourSgt = hourInTz(now, SGT_TZ);

  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterdaySgt = ymdInTz(y, SGT_TZ);

  const acceptable = new Set<string>(
    hourSgt < graceHour ? [yesterdaySgt] : [todaySgt, yesterdaySgt]
  );
  return (d?: string | null) => !!d && acceptable.has(d);
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

  // Pick distinct HSL colors for the current set of products
  const colorMap = React.useMemo<Record<string, string>>(() => {
    const n = Math.max(1, products.length);
    const map: Record<string, string> = {};
    products.forEach((p, i) => {
      const hue = Math.round((360 * i) / n); // spread around the wheel
      map[p] = `hsl(${hue} 70% 45%)`; // good contrast
    });
    return map;
  }, [products]);

  React.useEffect(() => {
    if (!token) return;
    void load();
  }, [token, load]);

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
                  stroke={colorMap[p]}
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
function TrendsTrends() {
  const { apiBase, token } = useAuth();
  const bus = useBus();

  // ---------- Types ----------
  type CatalogItem = {
    slug: string;
    total_rows: number;
    first_day: string;
    last_day: string;
  };
  type SeriesRowLong = {
    period: string;
    slug: string;
    interest: number | null;
  };
  type SeriesRowWide = {
    period: string;
    [slug: string]: number | string | null;
  };
  type SeriesResp = {
    geo: string;
    granularity: "day";
    start: string; // YYYY-MM-DD
    end: string; // last historical YYYY-MM-DD
    slugs: string[];
    rows: SeriesRowLong[];
    forecast?: { included: boolean; days: number };
  };

  // ---------- SGT helpers ----------
  const todaySgt = React.useMemo(() => ymdInTz(new Date(), SGT_TZ), []);
  const yesterdaySgt = React.useMemo(() => {
    const y = new Date();
    y.setUTCDate(y.getUTCDate() - 1);
    return ymdInTz(y, SGT_TZ);
  }, []);
  const isFreshDailySGT = React.useMemo(() => makeFreshDailySgtPredicate(), []);

  // ---------- State ----------
  const [catalog, setCatalog] = React.useState<CatalogItem[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [openDD, setOpenDD] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<SeriesResp | null>(null);

  const headers = React.useCallback(() => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  // ---------- Colors ----------
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

  // ---------- Normalize API end for SGT ----------
  const normalizeEndForSGT = React.useCallback(
    (endISO?: string | null) => {
      if (!endISO) return undefined as string | undefined;
      const hour = hourInTz(new Date(), SGT_TZ);
      if (endISO === todaySgt && hour < GRACE_HOUR_SGT) return yesterdaySgt;
      if (endISO > todaySgt) return yesterdaySgt;
      return endISO;
    },
    [todaySgt, yesterdaySgt]
  );

  // ---------- Latest day label ----------
  const latestDay = React.useMemo(() => {
    const nowHour = hourInTz(new Date(), SGT_TZ);
    const meta = catalog.filter((c) => selected.includes(c.slug));
    if (meta.length === 0) return "—";
    let maxDay = meta.map((c) => c.last_day).reduce((a, b) => (a > b ? a : b));
    if (nowHour < GRACE_HOUR_SGT && maxDay === todaySgt) maxDay = yesterdaySgt;
    if (maxDay > todaySgt) maxDay = todaySgt;
    return maxDay;
  }, [catalog, selected, todaySgt, yesterdaySgt]);

  // ---------- Load catalog (fresh only) ----------
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
        const all: CatalogItem[] = (j.slugs || []) as CatalogItem[];
        const ready = all.filter((c) => isFreshDailySGT(c.last_day));
        setCatalog(ready);
        setSelected((prev) => {
          const prevReady = prev.filter((s) => ready.some((c) => c.slug === s));
          return prevReady.length
            ? prevReady
            : ready.slice(0, 3).map((s) => s.slug);
        });
      } catch (e) {
        console.error(e);
        if (!abort) setError("Failed to load keywords");
      }
    })();
    return () => {
      abort = true;
    };
  }, [apiBase, headers, token, isFreshDailySGT]);

  // ---------- Fetch series ----------
  const fetchSeries = React.useCallback(async () => {
    if (!token || selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${apiBase}/trends/daily`);
      url.searchParams.set("mode", "series");
      url.searchParams.set("slugs", selected.join(","));
      url.searchParams.set("g", "day");
      url.searchParams.set("window", "week");
      url.searchParams.set("include_forecast", "true");
      url.searchParams.set("forecast_days", "7");

      const res = await fetch(url.toString(), { headers: headers() });
      if (!res.ok) throw new Error(`series HTTP ${res.status}`);
      const j = (await res.json()) as SeriesResp;

      const endAligned = normalizeEndForSGT(j.end);
      if (!endAligned) {
        setData(null);
        setError("Series missing end date.");
        return;
      }
      j.end = endAligned;

      // Pivot long -> wide
      const byDay = new Map<string, SeriesRowWide>();
      for (const r of j.rows || []) {
        const p = String(r.period);
        const s = String((r as any).slug);
        const v =
          typeof (r as any).interest === "number" ? (r as any).interest : null;
        const row = byDay.get(p) ?? { period: p };
        (row as any)[s] = v;
        byDay.set(p, row);
      }
      (j as any).rows = Array.from(byDay.values()).sort((a, b) =>
        String(a.period) < String(b.period) ? -1 : 1
      );

      setData(j);
    } catch (e) {
      console.error(e);
      setError("Failed to load trend series");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, headers, selected, token, normalizeEndForSGT]);

  React.useEffect(() => {
    if (!token || selected.length === 0) return;
    void fetchSeries();
  }, [token, selected, fetchSeries]);

  // pubsub refresh
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

  // ---------- Chart prep (categorical axis) ----------
  const rowsWide: SeriesRowWide[] = React.useMemo(
    () => (data?.rows as unknown as SeriesRowWide[]) ?? [],
    [data?.rows]
  );
  const slugs: string[] = React.useMemo(() => data?.slugs ?? [], [data?.slugs]); // <-- removes TS warning
  const endHist = data?.end ?? ""; // "YYYY-MM-DD"
  const lastPeriod = rowsWide.at(-1)?.period ?? "";
  const futureStart = endHist
    ? new Date(new Date(endHist + "T00:00:00Z").getTime() + 86400000)
        .toISOString()
        .slice(0, 10)
    : "";

  // Only draw a dot on future points (string compare is fine w/ ISO dates)
  type DotRenderer = (props: any) => React.ReactElement<SVGElement>;
  const ForecastDot =
    (endISO: string): DotRenderer =>
    (props: any) => {
      const { cx, cy, payload, value, stroke } = props;
      const isFuture =
        typeof payload?.period === "string" && payload.period > endISO;
      if (!isFuture || value == null) return (<g />) as any;
      return (
        <circle
          cx={cx}
          cy={cy}
          r={3.5}
          fill="white"
          stroke={stroke}
          strokeWidth={2}
        />
      ) as any;
    };

  const awaitingToday = React.useMemo(
    () => latestDay !== "—" && latestDay < todaySgt,
    [latestDay, todaySgt]
  );

  // ---------- Render ----------
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Interest in Words for Past 7-Days <LiveBadge />
        </h2>

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
                  <span>Select all (fresh)</span>
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
                {catalog.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-gray-500">
                    No keywords are fresh enough yet (SGT grace window).
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mb-1 text-sm text-gray-500">
        Data gathered from Google Trends (latest day: <b>{latestDay}</b>).
      </p>

      {awaitingToday && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Today’s SGT data isn’t available yet. Showing the most recent complete
          day.
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
        <span className="inline-block h-3 w-6 rounded bg-black/5 ring-1 ring-black/10" />
        <span>Forecast window</span>
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
        ) : rowsWide.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No data.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rowsWide}
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

              {/* Shade tomorrow..last point if forecast included */}
              {Boolean(data?.forecast?.included) &&
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

              {/* One line per slug; dot only shows for future buckets */}
              {slugs.map((s) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  name={s}
                  stroke={colorMap[s]}
                  strokeWidth={2}
                  isAnimationActive={false}
                  dot={ForecastDot(endHist)}
                  activeDot={{ r: 5 }}
                  connectNulls
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
  const { apiBase, token, wsBase } = useAuth();
  const bus = useBus();

  const [alerts, setAlerts] = React.useState<Alert[]>([]);
  const [wsOpen, setWsOpen] = React.useState<boolean>(false);

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

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Real-time alerts */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Real-time Alerts (In-Progress) <LiveBadge />
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
              This visualisation is currently in working progress and is
              currently unavailable
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
