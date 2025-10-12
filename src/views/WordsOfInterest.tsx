import React from "react";
import { useAuth, useBus } from "../contexts";
import { fmtSgt } from "../utils";

// =============================
// Types (align to future API)
// =============================
export type KeywordRow = {
  id: number | string;
  slug: string; // the actual search term
  active?: 0 | 1 | boolean; // enabled for collection (not shown in UI)
  created_at?: string | number | null; // ISO or unix seconds
};

// What our API is expected to return for GET /trends/keywords
export type KeywordListResponse = {
  items: KeywordRow[];
};

// What our API will accept for POST /trends/keywords
export type CreateKeywordRequest = {
  slug: string;
};

// =============================
// Helpers
// =============================
const toBool = (v: any): boolean => (typeof v === "number" ? v === 1 : !!v);

const normalize = (r: KeywordRow): KeywordRow => ({
  ...r,
  slug: (r.slug || "").trim(),
  active: toBool(r.active ?? 1),
  created_at: r.created_at ?? null,
});

function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const show = (m: string, ms = 2000) => {
    setMsg(m);
    window.clearTimeout((show as any)._t);
    (show as any)._t = window.setTimeout(() => setMsg(null), ms);
  };
  const Toast = () =>
    msg ? (
      <div
        role="alert"
        className="fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-emerald-300 bg-emerald-600 px-4 py-2 text-white shadow-2xl"
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
      Authorization: `Bearer ${token}`,
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
  // Add (POST /trends/keywords)
  // -----------------------------
  const add = async () => {
    const clean = term.trim();
    if (!clean) return;

    // prevent dupes (case-insensitive)
    const exists = rows.some(
      (r) => r.slug.toLowerCase() === clean.toLowerCase()
    );
    if (exists) {
      show("Already in list");
      return;
    }

    // optimistic row
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: KeywordRow = normalize({
      id: tmpId,
      slug: clean,
      active: 1,
    });
    setRows((prev) => [optimistic, ...prev]);
    setTerm("");

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
      show("Added");
    } catch (e) {
      console.error(e);
      // revert optimistic
      setRows((prev) => prev.filter((r) => r.id !== tmpId));
      show("Add failed");
    }
  };

  // -----------------------------
  // Delete (DELETE /trends/keywords?id= or ?slug=)
  // -----------------------------
  const remove = async (row: KeywordRow) => {
    const idParam = encodeURIComponent(String(row.id ?? ""));
    const slugParam = encodeURIComponent(row.slug);

    // optimistic
    setRows((prev) => prev.filter((r) => r.id !== row.id));

    try {
      const res = await fetch(
        `${apiBase}/trends/keywords?${
          row.id ? `id=${idParam}` : `slug=${slugParam}`
        }`,
        { method: "DELETE", headers: headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bus?.dispatchEvent(new Event("keywords:changed"));
      show("Removed");
    } catch (e) {
      console.error(e);
      // restore
      setRows((prev) => [row, ...prev]);
      show("Delete failed");
    }
  };

  // -----------------------------
  // Bulk helpers (still handy)
  // -----------------------------
  // -----------------------------
  // Bulk helpers
  // -----------------------------
  const importLines = async (text: string) => {
    // prettier-ignore
    const lines = text.split(/\r?\n/) // <-- keep this regex on ONE line
    .map((s: string) => s.trim())
    .filter((s) => s.length > 0);

    if (lines.length === 0) return;

    for (const ln of lines) {
      setTerm(ln);
      // eslint-disable-next-line no-await-in-loop
      await add();
    }
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

  // =============================
  // Render
  // =============================
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Words of Interest</h2>
      <p className="mb-3 text-sm text-gray-500">
        Manage your own Google Trends terms. Choose the words of interests to
        track in your Live-Feed page
      </p>

      {/* Warning */}

      {/* Add form */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
        <input
          className="sm:col-span-10 rounded-xl border px-3 py-2 text-sm"
          placeholder="e.g. antifungal"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="sm:col-span-2 flex gap-2">
          <button
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium text-white ${
              term.trim() ? "bg-gray-900 hover:bg-black" : "bg-gray-300"
            }`}
            onClick={add}
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

      <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm leading-tight">
        Newly added words of interests added can take up to{" "}
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

      {/* Table (Term, Created) */}
      <div className="max-h-80 overflow-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2">Term</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={3}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td className="px-3 py-6 text-center text-rose-600" colSpan={3}>
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={3}>
                  No terms yet.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((r) => {
                const created = (() => {
                  const t = r.created_at;
                  if (!t) return "—";
                  if (typeof t === "number") return fmtSgt(t);
                  return fmtSgt(t);
                })();
                return (
                  <tr key={String(r.id)} className="border-t">
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
                When new keywords are added, backfilling takes longer. Once
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
