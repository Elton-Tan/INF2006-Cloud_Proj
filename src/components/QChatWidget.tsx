// src/components/QChatWidget.tsx
import React from "react";
import { CONFIG } from "../config";
import { useAuth } from "../contexts";

type AgentPermission = {
  id: number;
  monitoring: boolean;
  allows_action: boolean;
};

export default function QChatWidget() {
  const { token } = useAuth();

  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryCount, setRetryCount] = React.useState(0);

  // Gate
  const [monitoring, setMonitoring] = React.useState(false);
  const [permLoaded, setPermLoaded] = React.useState(false);

  const API_BASE = React.useMemo(
    () => (CONFIG.API_BASE || "").replace(/\/+$/, ""),
    []
  );
  const permissionEndpoint = `${API_BASE}/agent/permission?id=1`;
  const mintEndpoint = `${API_BASE}/agent/mint`;

  const fetchJSON = async (
    url: string,
    init: RequestInit = {},
    withAuth = false,
    signal?: AbortSignal
  ) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (withAuth && token) headers.Authorization = `Bearer ${token}`;
    if (init.body && !headers["Content-Type"])
      headers["Content-Type"] = "application/json";

    const resp = await fetch(url, {
      ...init,
      headers,
      credentials: "omit",
      signal,
    });
    const text = await resp.text();
    const data = text ? JSON.parse(text) : {};
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Unauthorized. Please sign in again.");
    }
    if (!resp.ok) {
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }
    return data;
  };

  const parsePermission = (r: any): AgentPermission | null => {
    const raw =
      (r && r.item) ??
      (Array.isArray(r?.items)
        ? r.items.find((x: any) => Number(x?.id) === 1) ?? r.items[0]
        : undefined) ??
      r;
    if (!raw || typeof raw !== "object") return null;
    return {
      id: Number(raw.id ?? 1),
      monitoring: Boolean(raw.monitoring),
      allows_action: Boolean(raw.allows_action),
    };
  };

  async function loadPermission(signal?: AbortSignal) {
    try {
      const r = await fetchJSON(
        permissionEndpoint,
        { method: "GET" },
        true, // include Authorization if we have it
        signal
      );
      const perm = parsePermission(r);
      setMonitoring(Boolean(perm?.monitoring));
    } catch {
      // Hide on error
      setMonitoring(false);
    } finally {
      setPermLoaded(true);
    }
  }

  async function mintUrl(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      // Re-check permission right before mint (auth too)
      const r = await fetchJSON(
        permissionEndpoint,
        { method: "GET" },
        true,
        signal
      );
      const perm = parsePermission(r);
      const enabled = Boolean(perm?.monitoring);
      setMonitoring(enabled);
      if (!enabled) {
        setUrl(null);
        throw new Error("Agent monitoring is disabled.");
      }

      const data = await fetchJSON(
        mintEndpoint,
        { method: "GET" },
        true,
        signal
      );
      const u = (data as any)?.url;
      if (!u) throw new Error("Mint succeeded but no URL returned");
      setUrl(u);
    } catch (e: any) {
      setUrl(null);
      setError(e?.message || "Failed to mint anonymous URL");
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  React.useEffect(() => {
    const ctrl = new AbortController();
    loadPermission(ctrl.signal);
    return () => ctrl.abort();
  }, []);

  // Instant updates via event
  React.useEffect(() => {
    const onPermEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d?.monitoring === "boolean") {
        // Trust the event immediately
        setMonitoring(d.monitoring);
        setPermLoaded(true); // <- make bubble appear/disappear right away
        if (!d.monitoring) {
          setOpen(false);
          setUrl(null);
          setError(null);
          setRetryCount(0);
        }
      }
    };
    window.addEventListener(
      "agent.permission.updated",
      onPermEvent as EventListener
    );
    return () =>
      window.removeEventListener(
        "agent.permission.updated",
        onPermEvent as EventListener
      );
  }, []);

  // Gate: hide fully when disabled or not yet loaded
  if (!permLoaded || !monitoring) return null;

  const onToggle = async () => {
    // sanity re-check
    await loadPermission();
    if (!monitoring) return;
    if (!open && !url) await mintUrl();
    setOpen((v) => !v);
  };

  const handleFrameError = async () => {
    if (retryCount >= 1) return;
    setRetryCount((c) => c + 1);
    await mintUrl();
  };

  const handleRefresh = async () => {
    setRetryCount(0);
    await loadPermission();
    if (monitoring) await mintUrl();
  };

  return (
    <>
      <button
        aria-label="Open Amazon Q"
        onClick={onToggle}
        disabled={loading}
        className="fixed bottom-5 right-5 z-[1000] grid h-14 w-14 place-items-center rounded-full bg-gray-900 text-white shadow-2xl hover:bg-gray-800 disabled:opacity-60"
        title="Chat with Q"
      >
        Q
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[999] bg-black/20"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="fixed bottom-24 right-5 z-[1001] h-[70vh] w-[420px] max-w-[95vw] overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <span className="font-medium">Amazon Q</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefresh}
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                >
                  Refresh
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>

            {loading && (
              <div className="p-3 text-sm text-gray-600">
                Starting Amazon Q…
              </div>
            )}
            {error && (
              <div className="p-3 text-sm text-red-600">
                {error}
                <div className="mt-2">
                  <button
                    onClick={handleRefresh}
                    className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {!loading && !error && url && (
              <>
                <div className="px-3 py-1 text-[10px] text-gray-500 truncate" />
                <iframe
                  title="Amazon Q"
                  src={url}
                  className="h-[calc(70vh-56px)] w-full"
                  style={{ minWidth: 450 }}
                  allow="clipboard-read; clipboard-write"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onError={handleFrameError}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
