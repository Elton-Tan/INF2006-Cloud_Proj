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
  const [permLoaded, setPermLoaded] = React.useState(false);
  const [monitoring, setMonitoring] = React.useState(false);
  const [iframeReady, setIframeReady] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);

  const Q_URL = React.useMemo(
    () => String((CONFIG as any)?.Q_URL ?? "").replace(/\/+$/, "/"),
    []
  );

  const API_BASE = React.useMemo(
    () => (CONFIG.API_BASE || "").replace(/\/+$/, ""),
    []
  );
  const permissionEndpoint = `${API_BASE}/agent/permission?id=1`;

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
    if (resp.status === 401 || resp.status === 403)
      throw new Error("Unauthorized.");
    if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
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
        true,
        signal
      );
      const perm = parsePermission(r);
      setMonitoring(Boolean(perm?.monitoring));
    } catch {
      setMonitoring(false);
    } finally {
      setPermLoaded(true);
    }
  }

  React.useEffect(() => {
    const ctrl = new AbortController();
    loadPermission(ctrl.signal);
    return () => ctrl.abort();
  }, []);

  React.useEffect(() => {
    const onPermEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d?.monitoring === "boolean") {
        setMonitoring(d.monitoring);
        setPermLoaded(true);
        if (!d.monitoring) setOpen(false);
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

  if (!permLoaded || !monitoring) return null;

  const onToggle = async () => {
    await loadPermission();
    if (!monitoring) return;
    setIframeReady(false);
    setBlocked(false);
    setOpen((v) => !v);
    setTimeout(() => {
      setBlocked((prev) => !iframeReady && !prev);
    }, 1500);
  };

  const handleRefresh = async () => {
    await loadPermission();
    if (open) {
      setOpen(false);
      setTimeout(() => setOpen(true), 0);
      setIframeReady(false);
      setBlocked(false);
    }
  };

  return (
    <>
      <button
        aria-label="Open Amazon Q"
        onClick={onToggle}
        className="fixed bottom-5 right-5 z-[1000] grid h-14 w-14 place-items-center rounded-full bg-gray-900 text-white shadow-2xl hover:bg-gray-800"
        title="Chat with Q"
      >
        Q
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[999] bg-black/20"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          {/* CHANGED: h-[70vh] -> h-[88vh] */}
          <div className="fixed bottom-24 right-5 z-[1001] h-[88vh] w-[420px] max-w-[95vw] overflow-hidden rounded-2xl bg-white shadow-2xl">
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

            {!Q_URL ? (
              <div className="p-3 text-sm text-red-600">
                Missing <code>CONFIG.Q_URL</code>. Please set your deployed
                Amazon Q URL.
              </div>
            ) : (
              <>
                {!iframeReady && !blocked && (
                  <div className="p-3 text-sm text-gray-600">
                    Loading Amazon Q…
                  </div>
                )}

                {/* CHANGED: h-[calc(70vh-56px)] -> h-[calc(88vh-56px)] */}
                <iframe
                  key={Q_URL}
                  title="Amazon Q"
                  src={Q_URL}
                  className="h-[calc(88vh-56px)] w-full"
                  style={{ minWidth: 420 }}
                  allow="clipboard-read; clipboard-write"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onLoad={() => setIframeReady(true)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
