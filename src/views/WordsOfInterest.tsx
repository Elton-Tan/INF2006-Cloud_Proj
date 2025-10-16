import React from "react";
import { useAuth, useBus } from "../contexts";
import { fmtSgt } from "../utils";

// =============================
// Types (align to API)
// =============================
export type KeywordRow = {
  id?: number | string; // optional if backend doesn't return
  slug: string; // the actual search term
  active?: 0 | 1 | boolean; // enabled (not shown in UI)
  created_at?: string | number | null; // ISO or unix seconds
};

export type KeywordListResponse = { items: KeywordRow[] };

export type CreateKeywordRequest = { slug: string };

// Add this near your types
type ApiKeywordRow = Partial<KeywordRow> & {
  keyword?: string; // backend name
  created_at?: number | string | null; // can be number or string
};

// =============================
// Helpers
// =============================
const toBool = (v: any): boolean => (typeof v === "number" ? v === 1 : !!v);

const toUnixSeconds = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    // numeric string?
    if (/^\d+(\.\d+)?$/.test(v)) return Math.trunc(Number(v));
    // ISO/RFC date string?
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return Math.trunc(ms / 1000);
  }
  return null;
};

const normalize = (raw: ApiKeywordRow): KeywordRow => {
  const slugRaw = (raw.slug ?? raw.keyword ?? "").toString().trim();
  return {
    id: (raw.id ?? slugRaw) as any,
    slug: slugRaw,
    active: toBool(raw.active ?? 1),
    created_at: toUnixSeconds(raw.created_at),
  };
};

// ---- new: recency helpers
const THREE_DAYS_S = 3 * 24 * 60 * 60;
const isNewlyCreated = (createdAt?: number | string | null) => {
  if (createdAt == null) return false;
  const t =
    typeof createdAt === "number"
      ? Math.trunc(createdAt)
      : Math.trunc(Number(createdAt));
  if (!Number.isFinite(t)) return false;
  const nowS = Math.trunc(Date.now() / 1000);
  return nowS - t < THREE_DAYS_S;
};

// =============================
// Tiny toast with variants
// =============================
type ToastVariant = "success" | "error" | "info";
function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [variant, setVariant] = React.useState<ToastVariant>("success");

  const show = (m: string, opts?: { ms?: number; variant?: ToastVariant }) => {
    const ms = opts?.ms ?? 2200;
    const v = opts?.variant ?? "success";
    setVariant(v);
    setMsg(m);
    window.clearTimeout((show as any)._t);
    (show as any)._t = window.setTimeout(() => setMsg(null), ms);
  };

  const Toast = () =>
    msg ? (
      <div
        role="alert"
        className={[
          "fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-4 py-2 text-white shadow-2xl",
          variant === "success" && "border-emerald-300 bg-emerald-600",
          variant === "error" && "border-rose-300 bg-rose-600",
          variant === "info" && "border-sky-300 bg-sky-600",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="text-sm font-medium">{msg}</div>
      </div>
    ) : null;

  return { show, Toast };
}

// =============================
// View — Words of Interest
// =============================
export default function WordsOfInterest() {
  const { apiBase, token } = useAuth();
  const bus = useBus();
  const { show, Toast } = useToast();

  // Inputs
  const [term, setTerm] = React.useState("");

  // Data
  const [rows, setRows] = React.useState<KeywordRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Modal
  const [infoOpen, setInfoOpen] = React.useState(false);

  // Local cache key (so UI still renders while API is down)
  const CACHE_KEY = "trends.keywords.cache.v1";

  const headers = React.useCallback(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token]
  );

  // -----------------------------
  // Load list (GET /trends/keywords)
  // -----------------------------
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/trends/keywords`, {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as KeywordListResponse | KeywordRow[];
      const items = Array.isArray(data) ? data : data.items;
      const normalized = (items || []).map(normalize);
      setRows(normalized);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(normalized));
      } catch {}
    } catch (e: any) {
      console.error(e);
      setError(
        "This visualisation is currently work-in-progress and is unavailable"
      );
      // try local cache
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) setRows((JSON.parse(raw) as KeywordRow[]).map(normalize));
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [apiBase, headers]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // -----------------------------
  // Add one (programmatic) — avoids setState race for bulk
  // -----------------------------
  const addSlug = React.useCallback(
    async (slugRaw: string): Promise<boolean> => {
      const clean = slugRaw.trim();
      if (!clean) return false;

      // prevent dupes (case-insensitive)
      const exists = rows.some(
        (r) => r.slug.toLowerCase() === clean.toLowerCase()
      );
      if (exists) return false;

      // optimistic row
      const tmpId = `tmp-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const optimistic: KeywordRow = normalize({
        id: tmpId,
        slug: clean,
        active: 1,
        // ensure Note shows immediately if within 3 days
        created_at: Math.trunc(Date.now() / 1000),
      });
      setRows((prev) => [optimistic, ...prev]);

      try {
        const res = await fetch(`${apiBase}/trends/keywords`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ slug: clean } satisfies CreateKeywordRequest),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = normalize(await res.json());
        setRows((prev) => prev.map((r) => (r.id === tmpId ? saved : r)));
        bus?.dispatchEvent(new Event("keywords:changed"));
        return true;
      } catch (e) {
        console.error(e);
        // revert optimistic
        setRows((prev) => prev.filter((r) => r.id !== tmpId));
        return false;
      }
    },
    [apiBase, headers, rows, bus]
  );

  // -----------------------------
  // Add from input button (calls programmatic add)
  // -----------------------------
  const addFromInput = async () => {
    const ok = await addSlug(term);
    if (ok) {
      setTerm("");
      show("Added", { variant: "success" });
    } else {
      // ---- red background for failure
      show("Add failed or duplicate", { variant: "error" });
    }
  };

  // -----------------------------
  // Delete (DELETE /trends/keywords?id= or ?slug=)
  // -----------------------------
  const remove = async (row: KeywordRow) => {
    const idParam = row.id != null ? encodeURIComponent(String(row.id)) : "";
    const slugParam = encodeURIComponent(row.slug);

    // optimistic
    setRows((prev) => prev.filter((r) => r !== row));

    try {
      const q = row.id != null ? `id=${idParam}` : `slug=${slugParam}`;
      const res = await fetch(`${apiBase}/trends/keywords?${q}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bus?.dispatchEvent(new Event("keywords:changed"));
      show("Removed", { variant: "success" });
    } catch (e) {
      console.error(e);
      // restore
      setRows((prev) => [row, ...prev]);
      show("Delete failed", { variant: "error" });
    }
  };

  // -----------------------------
  // Bulk import (.txt, one per line)
  // -----------------------------
  const importLines = async (text: string) => {
    // Keep regex on ONE line to avoid unterminated literal issues.
    // prettier-ignore
    const rawLines = text.split(/\r?\n/).map((s: string) => s.trim()).filter((s) => s.length > 0);

    if (rawLines.length === 0) {
      show("No terms found in file", { variant: "info" });
      return;
    }

    // Case-insensitive dedupe (within file) and exclude ones already present
    const inFileSet = new Set<string>();
    const presentSet = new Set(rows.map((r) => r.slug.toLowerCase()));
    const toAdd: string[] = [];
    for (const s of rawLines) {
      const lower = s.toLowerCase();
      if (!inFileSet.has(lower) && !presentSet.has(lower)) {
        inFileSet.add(lower);
        toAdd.push(s);
      }
    }
    if (toAdd.length === 0) {
      show("All terms were already in the list", { variant: "info" });
      return;
    }

    // Add sequentially to keep backend polite; show a tiny progress.
    let ok = 0;
    for (const s of toAdd) {
      // eslint-disable-next-line no-await-in-loop
      const added = await addSlug(s);
      if (added) ok += 1;
    }
    show(
      `Imported ${ok}/${toAdd.length} new term${toAdd.length === 1 ? "" : "s"}`,
      { variant: "success" }
    );
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keywords-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- sort earliest first; null created_at last
  const sortedRows = React.useMemo(() => {
    const asNum = (x: any) => {
      if (x == null) return null;
      if (typeof x === "number") return Math.trunc(x);
      if (typeof x === "string" && /^\d+(\.\d+)?$/.test(x))
        return Math.trunc(Number(x));
      return null;
    };
    return [...rows].sort((a, b) => {
      const aa = asNum(a.created_at);
      const bb = asNum(b.created_at);
      if (aa == null && bb == null) return 0;
      if (aa == null) return 1; // nulls last
      if (bb == null) return -1; // nulls last
      return aa - bb; // ascending (earliest first)
    });
  }, [rows]);

  // =============================
  // Render
  // =============================
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Words of Interest</h2>
      <p className="mb-3 text-sm text-gray-500">
        Manage your own Google Trends terms. Choose the words of interest to
        track in your Live-Feed page.
      </p>

      {/* Add form */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
        <input
          className="sm:col-span-10 rounded-xl border px-3 py-2 text-sm"
          placeholder="e.g. antifungal"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && term.trim()) void addFromInput();
          }}
        />
        <div className="sm:col-span-2 flex gap-2">
          <button
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium text-white ${
              term.trim() ? "bg-gray-900 hover:bg-black" : "bg-gray-300"
            }`}
            onClick={addFromInput}
            disabled={!term.trim()}
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
      </div>

      {/* Bulk actions */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-1 hover:bg-gray-50">
          <input
            type="file"
            accept="text/plain"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              await importLines(text);
              (e.target as HTMLInputElement).value = ""; // reset
            }}
          />
          <span>Import .txt (one term per line)</span>
        </label>
        <button
          className="rounded-xl border px-2 py-1 hover:bg-gray-50"
          onClick={exportJson}
        >
          Export JSON
        </button>
        <span className="text-gray-400">•</span>
        <span className="text-gray-500">{rows.length} terms</span>
      </div>

      {/* Notice */}
      <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm leading-tight">
        Newly added words of interest can take up to{" "}
        <b className="font-semibold">3 days</b> to appear in the Live-Feed page,
        even if they are shown here.{" "}
        <button
          className="underline underline-offset-2 hover:text-amber-900"
          onClick={() => setInfoOpen(true)}
        >
          Learn why
        </button>
        .
      </div>

      {/* Table (Term, Created, Note) */}
      <div className="max-h-80 overflow-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2">Term</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td className="px-3 py-6 text-center text-rose-600" colSpan={4}>
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && sortedRows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>
                  No terms yet.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              sortedRows.map((r) => {
                const created = (() => {
                  const t = r.created_at;
                  if (!t) return "—";
                  const n = typeof t === "string" ? Number(t) : t;
                  return Number.isFinite(n) ? fmtSgt(n as number) : "—";
                })();

                const showNewNote = isNewlyCreated(r.created_at);

                return (
                  <tr key={String(r.id ?? r.slug)} className="border-t">
                    <td className="px-3 py-2">
                      <div
                        className="max-w-xs truncate font-medium"
                        title={r.slug}
                      >
                        {r.slug}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {created}
                    </td>
                    <td className="px-3 py-2">
                      {showNewNote ? (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                          title="Keyword may not show on the graph yet as it is newly created"
                        >
                          New
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        onClick={() => remove(r)}
                        title="Remove"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Info modal */}
      {infoOpen && (
        <>
          <div className="fixed inset-0 z-[10000] bg-black/40" />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 z-[10001] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-amber-300 bg-white shadow-2xl"
          >
            <div className="rounded-t-2xl border-b bg-amber-500/90 p-3 text-white">
              <div className="text-sm font-semibold">
                Why is there a lag before new terms appear in the graph?
              </div>
            </div>
            <div className="p-4 text-sm text-gray-800">
              <p className="mb-3">
                Our forecast model trains on roughly one year of history per
                keyword. To respect Google Trends rate limits, we backfill the
                history in batches.
              </p>
              <p>
                When new keywords are added, backfilling takes longer since the
                past 1 year of data for the keywords needs to be gathered. Once
                enough history is gathered, the term will automatically appear
                in the graph and be included in future daily updates.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-3">
              <button
                className="rounded-md bg-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-200"
                onClick={() => setInfoOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      <Toast />
    </section>
  );
}

export {};
