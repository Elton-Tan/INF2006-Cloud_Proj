import React from "react";

export function useJson<T>(url: string) {
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

export function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const show = (m: string, ms = 2200) => {
    setMsg(m);
    window.clearTimeout((show as any)._t);
    (show as any)._t = window.setTimeout(() => setMsg(null), ms);
  };

  const Toast = () =>
    msg ? (
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
    ) : null;

  return { show, Toast };
}
