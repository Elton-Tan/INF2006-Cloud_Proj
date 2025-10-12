import React from "react";
import { useAuth, useBus } from "../contexts";
import { useToast } from "../hooks";
import { Availability, ApiWatchRow, SnapshotRow } from "../types";
import { CONFIG } from "../config";
import { buildWsUrl, fmtSgt } from "../utils";

// Keep this view self-contained but lean.

export default function Snapshotter() {
  const { apiBase: API_BASE, token: AUTH_TOKEN, wsBase: WS_BASE } = useAuth();
  const bus = useBus();
  const { show, Toast } = useToast();

  const PENDING_KEY = "watchlist.pending.v2";
  const PENDING_TTL_MS = 5 * 60 * 1000;

  function isLazadaPdp(raw?: string | null): boolean {
    const s = (raw ?? "").trim();
    if (!s) return false;

    // helper to test a URL instance
    const looksLike = (u: URL) => {
      const host = u.hostname.replace(/^www\.|^m\./i, "");
      // no leading \. — match root or subdomain
      const hostOk =
        /(^|\.)lazada\.(sg|co\.id|com\.my|com\.ph|co\.th|vn)$/i.test(host);
      if (!hostOk) return false;
      const p = u.pathname.toLowerCase();
      return p.includes("/products/") || /-i\d+\.html$/.test(p);
    };

    try {
      return looksLike(new URL(s));
    } catch {
      // allow no-protocol paste
      try {
        return looksLike(new URL(`https://${s}`));
      } catch {
        return false;
      }
    }
  }

  const [inputUrl, setInputUrl] = React.useState<string>("");
  const isValidPdp = React.useMemo(() => isLazadaPdp(inputUrl), [inputUrl]);
  const [rows, setRows] = React.useState<SnapshotRow[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [wsOpen, setWsOpen] = React.useState<boolean>(false);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmUrl, setConfirmUrl] = React.useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);

  type PendingEntry = { url: string; ts: number };
  const [pending, setPending] = React.useState<Record<string, PendingEntry>>(
    () => {
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
    }
  );
  React.useEffect(() => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {}
  }, [pending]);

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (AUTH_TOKEN) h.Authorization = `Bearer ${AUTH_TOKEN}`;
    return h;
  };
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
  const removeByUrl = (list: SnapshotRow[], url: string): SnapshotRow[] =>
    list.filter((x) => canonicalUrl(x.url) !== canonicalUrl(url));

  const dedupeByUrl = (list: ApiWatchRow[]): ApiWatchRow[] => {
    const byUrl = new Map<string, ApiWatchRow>();
    const isNewer = (a: ApiWatchRow, b?: ApiWatchRow): boolean => {
      if (!b) return true;
      const au = toUnix(a.updated_at) ?? 0,
        bu = toUnix(b.updated_at) ?? 0;
      return au !== bu ? au > bu : Number(a.id) > Number(b.id);
    };
    for (const r of list) {
      const k = canonicalUrl(r.url);
      const prev = byUrl.get(k);
      if (isNewer(r, prev)) byUrl.set(k, r);
    }
    return Array.from(byUrl.values());
  };

  const load = async () => {
    if (!AUTH_TOKEN) {
      setError("Your session has expired. Please sign in again.");
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(`${API_BASE}/watchlist`, { headers: headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiWatchRow[];
      let next: SnapshotRow[] = [];
      for (const r of dedupeByUrl(data))
        next = upsertByUrl(next, mapApiToUi(r));

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
  React.useEffect(() => {
    void load();
  }, []);

  const deleteByUrl = async (targetUrl: string) => {
    if (!AUTH_TOKEN) {
      setError("Your session has expired. Please sign in again.");
      setLoading(false);
      return;
    }
    setConfirmBusy(true);
    try {
      const r = await fetch(
        `${API_BASE}/watchlist?url=${encodeURIComponent(targetUrl)}`,
        {
          method: "DELETE",
          headers: headers(),
        }
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

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object";
  const isLiveUpsert = (v: unknown): v is LiveUpsert =>
    isRecord(v) &&
    v.type === "watchlist.row_upserted" &&
    isRecord(v.row) &&
    typeof v.row.url === "string";
  const isLiveFailed = (v: unknown): v is LiveFailed =>
    isRecord(v) &&
    v.type === "watchlist.job_failed" &&
    typeof (v as any).url === "string";
  const parseLiveMsg = (raw: string): LiveMsg | null => {
    try {
      const d = JSON.parse(raw);
      return isLiveUpsert(d) || isLiveFailed(d) ? d : null;
    } catch {
      return null;
    }
  };
  const mapLiveToUi = (r: LiveUpsert["row"]): SnapshotRow => ({
    url: r.url,
    product: r.product ?? undefined,
    price: r.price ?? undefined,
    availability: r.stock_status?.toLowerCase().includes("out")
      ? "out_of_stock"
      : r.stock_status?.toLowerCase().includes("in")
      ? "in_stock"
      : "unknown",
    imageUrl: r.image_url ?? null,
    status: "ok",
    updated_at: typeof r.updated_at === "number" ? r.updated_at : undefined,
  });

  React.useEffect(() => {
    if (!AUTH_TOKEN) return;

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
          if (!msg) return;
          if (msg.type === "watchlist.row_upserted") {
            const uiRow = mapLiveToUi(msg.row);
            if (
              typeof uiRow.updated_at === "number" &&
              uiRow.updated_at > 1e12
            ) {
              uiRow.updated_at = Math.floor(uiRow.updated_at / 1000);
            }
            const c = canonicalUrl(msg.row.url);
            setRows((prev) => upsertByUrl(prev, uiRow));
            setPending((p) => {
              const out: Record<string, PendingEntry> = {};
              Object.entries(p).forEach(([tid, ent]) => {
                if (canonicalUrl(ent.url) !== c) out[tid] = ent;
              });
              return out;
            });
            bus?.dispatchEvent(new Event("watchlist:changed"));
          }
          if (msg.type === "watchlist.job_failed") {
            setRows((prev) =>
              upsertByUrl(prev, { url: msg.url, status: "error" })
            );
            setPending((p) => {
              const out: Record<string, PendingEntry> = {};
              Object.entries(p).forEach(([tid, ent]) => {
                if (canonicalUrl(ent.url) !== canonicalUrl(msg.url))
                  out[tid] = ent;
              });
              return out;
            });
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
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {}
    };
  }, [WS_BASE, AUTH_TOKEN, bus]);
  const addUrl = async () => {
    if (!AUTH_TOKEN) {
      setError("Your session has expired. Please sign in again.");
      setLoading(false);
      return;
    }
    const clean = inputUrl.trim();
    if (!clean) return;

    if (!isValidPdp) {
      show("Only Lazada product URLs are supported for now.");
      return;
    }

    const key = canonicalUrl(clean);

    const exists = rows.some(
      (x) =>
        canonicalUrl(x.url) === key &&
        (x.status === "ok" || x.status === "adding")
    );
    if (exists) {
      show("Product already in watchlist.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/watchlist`, { headers: headers() });
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

    try {
      const res = await fetch(`${API_BASE}/enqueue`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ url: clean }),
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
  };

  const selectedRow = React.useMemo(() => {
    if (!confirmUrl) return null;
    const key = canonicalUrl(confirmUrl);
    return rows.find((r) => canonicalUrl(r.url) === key) ?? null;
  }, [confirmUrl, rows]);
  const confirmDisplayText =
    selectedRow?.product?.trim() ||
    canonicalUrl(selectedRow?.url || confirmUrl || "");

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Snapshotter</h2>
      <p className="mb-3 text-sm text-gray-500">
        Enter a Lazada Product URL to add to the queue. Currently accepts only
        Lazada Products URL
      </p>

      <div className="mb-3">
        {/* Red alert shown when user typed something and it's NOT a Lazada PDP */}
        {inputUrl.trim() && !isValidPdp && (
          <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Only Lazada product URLs are supported for now.
          </div>
        )}

        <div className="flex gap-2">
          <input
            className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 ${
              inputUrl.trim() && !isValidPdp
                ? "border-rose-400 ring-rose-200"
                : "focus:ring-gray-200"
            }`}
            placeholder="https://www.lazada.sg/products/..."
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            aria-invalid={!!(inputUrl.trim() && !isValidPdp)}
            aria-describedby={
              inputUrl.trim() && !isValidPdp ? "pdp-help" : undefined
            }
          />
          <button
            className={`rounded-xl px-4 py-2 text-sm font-medium text-white ${
              isValidPdp
                ? "bg-gray-900 hover:bg-black"
                : "bg-gray-300 cursor-not-allowed"
            }`}
            onClick={addUrl}
            disabled={!isValidPdp}
            title={
              !isValidPdp ? "Only Lazada product URLs are supported" : "Add"
            }
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

        {/* Hidden accessibility helper text ID referenced by aria-describedby */}
        {inputUrl.trim() && !isValidPdp && (
          <p id="pdp-help" className="sr-only">
            Only Lazada product URLs are supported for now.
          </p>
        )}
      </div>

      <div className="mb-2 text-xs">
        Live:&nbsp;
        <span className={wsOpen ? "text-emerald-600" : "text-amber-600"}>
          {wsOpen ? "connected" : "reconnecting"}
        </span>
      </div>

      <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm leading-tight">
        Please exercise restrain in adding new urls when testing. The project is
        currently built with
        <b className="font-semibold"> Free Credits.</b> Unnecessary addition
        will incur more costs.{" "}
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
                <td className="px-3 py-6 text-center text-gray-500" colSpan={7}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td className="px-3 py-6 text-center text-rose-600" colSpan={7}>
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={7}>
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
                action is IRREVERSIBLE.
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
