// src/components/AgentMonitoring.tsx
import React from "react";
import { CONFIG } from "../config";
import { useAuth } from "../contexts";
import ModalPortal from "./ModalPortal";

/* ---------------- types ---------------- */

type StepStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type StepInfo = {
  status: StepStatus;
  message?: string;
  progress?: number;
  s3_keys?: string[];
  error_code?: string;
};
type JobStatus = {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: string;
  ended_at?: string;
  steps: Record<string, StepInfo>;
  errors: Array<{ step: string; message: string }>;
};

type AgentPermission = {
  id: number; // always 1
  monitoring: boolean; // enable/disable agent monitoring
  allows_action: boolean; // allow agent to act remotely
};

const ORDER: Array<keyof JobStatus["steps"]> = [
  "trends_fetch",
  "prices_fetch",
  "watchlist_refresh",
  "social_listening",
];

const STEP_NAME: Record<string, string> = {
  trends_fetch: "Trends",
  prices_fetch: "Prices",
  watchlist_refresh: "Watchlist",
  social_listening: "Social",
};

const LS_JOB = "agentMonitoring.job";
const LS_ENABLED = "agentMonitoring.enabled";
const LS_LAST_ACTION_CHECKED = "agentMonitoring.lastActionChecked";

/* ---------------- helpers ---------------- */

function toneClass(kind: "info" | "ok" | "fail") {
  if (kind === "ok") return "text-green-700";
  if (kind === "fail") return "text-red-700";
  return "text-gray-800";
}

// Minimal JWT exp decoder (seconds since epoch)
function decodeExpSec(jwt?: string | null): number {
  if (!jwt) return 0;
  try {
    const [, b64] = jwt.split(".");
    const json = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

// Centralized fetch with optional auth + 401/403 handling
async function fetchJSON(url: string, opts: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";

  const resp = await fetch(url, { ...opts, headers, credentials: "omit" });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};

  if (resp.status === 401 || resp.status === 403) {
    try {
      window.dispatchEvent(new CustomEvent("cognito.auth.expired"));
    } catch {}
    throw new Error("Unauthorized — session expired. Please sign in again.");
  }
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        active
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-gray-200 bg-gray-50 text-gray-600"
      }`}
      title={
        active ? "Agent monitoring is active" : "Agent monitoring is inactive"
      }
    >
      <span
        className={`h-2 w-2 rounded-full ${
          active ? "bg-green-500" : "bg-gray-400"
        }`}
        aria-hidden
      />
      {active ? "Agent-Monitoring Active" : "Agent-Monitoring Inactive"}
    </span>
  );
}

/* ---------------- component ---------------- */

export default function AgentMonitoring() {
  const { token } = useAuth();

  // keep a live ref so effects/handlers don’t capture stale tokens
  const tokenRef = React.useRef<string | null>(token || null);
  React.useEffect(() => {
    tokenRef.current = token || null;
  }, [token]);

  // permission state (source of truth from DB)
  const [perm, setPerm] = React.useState<AgentPermission | null>(null);

  // UI / modal state
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);

  // ops state
  const [loadingPerm, setLoadingPerm] = React.useState(true);
  const [savingPerm, setSavingPerm] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // job state
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<JobStatus | null>(null);
  const [finalSnapshot, setFinalSnapshot] = React.useState<JobStatus | null>(
    null
  );

  // visual “enabled” flag mirrors perm.monitoring for the pill/button
  const enabled = !!perm?.monitoring;

  /**
   * Success timeline (manual close):
   * 0 = off
   * 1 = "Reviewing…"
   * 2 = "Agent is consolidating the data..." (hold ~3s)
   * 3 = "All OK"  (Close button appears; manual close only)
   */
  const [scriptPhase, setScriptPhase] = React.useState<0 | 1 | 2 | 3>(0);
  const tRef = React.useRef<number | null>(null);
  const clearTimer = () => {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = null;
  };

  // checkbox state inside the enable modal (persisted for convenience)
  const [allowRemote, setAllowRemote] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_LAST_ACTION_CHECKED) === "true";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(LS_LAST_ACTION_CHECKED, String(allowRemote));
    } catch {}
  }, [allowRemote]);

  // restore persisted job id / enabled (legacy)
  React.useEffect(() => {
    try {
      const rawJob = localStorage.getItem(LS_JOB);
      if (rawJob) {
        const s = JSON.parse(rawJob);
        if (s?.jobId) setJobId(s.jobId);
      }
    } catch {}
    try {
      const rawEnabled = localStorage.getItem(LS_ENABLED);
      if (rawEnabled != null) {
        // DB is source of truth; kept to avoid UX flash only
      }
    } catch {}
  }, []);

  // persist job id (just for UX)
  React.useEffect(() => {
    try {
      if (jobId) localStorage.setItem(LS_JOB, JSON.stringify({ jobId }));
      else localStorage.removeItem(LS_JOB);
    } catch {}
  }, [jobId]);

  // lock body when any modal opens
  const anyModalOpen = confirmOpen || disableOpen || logOpen;
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    if (anyModalOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anyModalOpen]);

  /* ---------- permissions ---------- */

  const loadPermission = React.useCallback(async () => {
    setLoadingPerm(true);
    setError(null);
    try {
      const r = await fetchJSON(
        `${CONFIG.API_BASE}/agent/permission?id=1`,
        { method: "GET" },
        tokenRef.current || undefined
      );

      // Accept any of these shapes:
      // 1) { item: { id, monitoring, allows_action } }
      // 2) { items: [ { id, monitoring, allows_action }, ... ] }
      // 3) { id, monitoring, allows_action }
      const raw =
        (r && r.item) ??
        (Array.isArray(r?.items) ? r.items[0] : undefined) ??
        r;

      if (!raw || typeof raw !== "object") {
        throw new Error("Malformed permission response");
      }

      const normalized: AgentPermission = {
        id: Number((raw as any).id ?? 1),
        monitoring: Boolean((raw as any).monitoring),
        allows_action: Boolean((raw as any).allows_action),
      };

      setPerm(normalized);
      setAllowRemote(normalized.allows_action);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoadingPerm(false);
    }
  }, []);

  React.useEffect(() => {
    loadPermission();
  }, [loadPermission]);

  // update-only helper (forces Lambda's UPDATE path)
  async function updatePermission(
    monitoring: boolean,
    allows_action: boolean,
    token?: string
  ) {
    return fetchJSON(
      `${CONFIG.API_BASE}/agent/permission`,
      {
        method: "POST",
        body: JSON.stringify({
          id: 1, // ← IMPORTANT: force UPDATE branch in your Lambda
          monitoring,
          allows_action,
        }),
      },
      token
    );
  }

  /* ---------- start: update DB → start job ---------- */

  const startMonitoring = async () => {
    const t = tokenRef.current;

    if (!t) {
      alert("You must be signed in to start monitoring.");
      return;
    }
    // guard: don’t kick off with a near-expiry token
    const now = Math.floor(Date.now() / 1000);
    const exp = decodeExpSec(t);
    if (exp && exp - now < 30) {
      window.dispatchEvent(new CustomEvent("cognito.auth.expired"));
      alert("Session expired — please sign in again.");
      return;
    }

    setSavingPerm(true);
    try {
      // 1) UPDATE singleton row id=1
      await updatePermission(true, !!allowRemote, t);

      // reflect immediately in UI
      setPerm({ id: 1, monitoring: true, allows_action: !!allowRemote });
      window.dispatchEvent(
        new CustomEvent("agent.permission.updated", {
          detail: { monitoring: true },
        })
      );
      setConfirmOpen(false);
    } catch (e: any) {
      setSavingPerm(false);
      alert(`Failed to enable permission: ${e?.message || e}`);
      return;
    }

    // 2) Start job
    setStarting(true);
    try {
      clearTimer();
      setJob(null);
      setFinalSnapshot(null);
      setScriptPhase(0);

      const r = await fetchJSON(
        `${CONFIG.API_BASE}/agent/monitoring/start`,
        { method: "POST", body: JSON.stringify({}) },
        t
      );

      setJobId(r.job_id);
      setLogOpen(true);
    } catch (e: any) {
      alert(`Failed to start monitoring job: ${e?.message || e}`);
      // Optional: rollback permission if start failed
      // await updatePermission(false, false, t);
    } finally {
      setStarting(false);
      setSavingPerm(false);
    }
  };

  /* ---------- disable: cancel job (if running) → update DB ---------- */

  const disableMonitoring = async () => {
    setDisableOpen(false);

    // 1) Cancel job if needed
    if (jobId && (job?.status === "running" || job?.status === "queued")) {
      setCancelling(true);
      try {
        await fetchJSON(
          `${CONFIG.API_BASE}/agent/monitoring/cancel`,
          { method: "POST", body: JSON.stringify({ job_id: jobId }) },
          tokenRef.current || undefined
        );
      } catch (e: any) {
        alert(`Failed to cancel run: ${e?.message || e}`);
      } finally {
        setCancelling(false);
      }
    }

    // 2) UPDATE singleton row id=1 to off/no-actions
    setSavingPerm(true);
    try {
      await updatePermission(false, false, tokenRef.current || undefined);
      setPerm({ id: 1, monitoring: false, allows_action: false });
      window.dispatchEvent(
        new CustomEvent("agent.permission.updated", {
          detail: { monitoring: false },
        })
      );
    } catch (e: any) {
      alert(`Failed to disable monitoring: ${e?.message || e}`);
    } finally {
      setSavingPerm(false);
    }
  };

  /* ---------- status poll ---------- */

  React.useEffect(() => {
    if (!jobId || !tokenRef.current) return;
    let stopped = false;
    const done = (s: string) =>
      s === "succeeded" || s === "failed" || s === "cancelled";

    const tick = async () => {
      try {
        const r: JobStatus = await fetchJSON(
          `${
            CONFIG.API_BASE
          }/agent/monitoring/status?job_id=${encodeURIComponent(jobId)}`,
          { method: "GET" },
          tokenRef.current!
        );
        if (stopped) return;

        setJob(r);

        if (!done(r.status)) {
          setTimeout(tick, 1200);
        } else {
          if (r.status === "succeeded" && !finalSnapshot) {
            setFinalSnapshot(r);
            setScriptPhase(1); // enter "Reviewing…" immediately
          }
        }
      } catch {
        if (!stopped) setTimeout(tick, 2000);
      }
    };

    tick();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /* ---------- success timeline ---------- */

  const steps = (finalSnapshot ?? job)?.steps || {};
  const allSucceeded =
    ORDER.length > 0 && ORDER.every((k) => steps[k]?.status === "succeeded");

  // 1 -> 2 immediately
  React.useEffect(() => {
    if (allSucceeded && scriptPhase === 1) setScriptPhase(2);
  }, [allSucceeded, scriptPhase]);

  // 2 -> 3 after 3s
  React.useEffect(() => {
    if (!(allSucceeded && scriptPhase === 2)) return;
    clearTimer();
    tRef.current = window.setTimeout(() => {
      setScriptPhase((p) => (p === 2 ? 3 : p));
    }, 3000);
    return clearTimer;
  }, [allSucceeded, scriptPhase]);

  // reset timeline if success disappears
  React.useEffect(() => {
    if (!allSucceeded && scriptPhase !== 0) {
      clearTimer();
      setScriptPhase(0);
    }
  }, [allSucceeded, scriptPhase]);

  // Build sequential log lines
  type LogLine = { id: string; text: string; kind: "info" | "ok" | "fail" };
  const lines: LogLine[] = [];

  ORDER.forEach((key) => {
    const s = steps[key]?.status as StepStatus | undefined;
    const name = STEP_NAME[key] || key;

    if (!s || s === "queued" || s === "running") {
      lines.push({
        id: `${key}-retr`,
        text: `Retrieving ${name} data…`,
        kind: "info",
      });
    } else if (s === "succeeded") {
      lines.push({
        id: `${key}-retr`,
        text: `Retrieving ${name} data…`,
        kind: "info",
      });
      lines.push({ id: `${key}-ok`, text: `${name} OK`, kind: "ok" });
    } else if (s === "failed") {
      lines.push({
        id: `${key}-retr`,
        text: `Retrieving ${name} data…`,
        kind: "info",
      });
      lines.push({ id: `${key}-fail`, text: `${name} FAILED`, kind: "fail" });
    } else if (s === "cancelled") {
      lines.push({
        id: `${key}-retr`,
        text: `Retrieving ${name} data…`,
        kind: "info",
      });
      lines.push({
        id: `${key}-fail`,
        text: `${name} CANCELLED`,
        kind: "fail",
      });
    }
  });

  if (allSucceeded) {
    if (scriptPhase >= 1) {
      lines.push({
        id: "review-1",
        text: "Consolidating live data with static data…",
        kind: "info",
      });
    }
    if (scriptPhase >= 2) {
      lines.push({
        id: "review-2",
        text: "Agent is re-reviewing its new knowledge base…",
        kind: "info",
      });
    }
    if (scriptPhase >= 3) {
      lines.push({
        id: "review-3",
        text: "All OK — your dashboard is now monitored. You may close this window.",
        kind: "ok",
      });
    }
  }

  // auto-scroll the log panel
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const overall =
    (finalSnapshot ?? job)?.status ??
    (jobId ? "queued" : enabled ? "idle" : "idle");
  const canCancel =
    ((finalSnapshot ?? job)?.status === "running" ||
      (finalSnapshot ?? job)?.status === "queued") &&
    !!jobId;
  const canClose =
    overall === "failed" ||
    overall === "cancelled" ||
    (allSucceeded && scriptPhase >= 3) ||
    (overall === "idle" && !jobId);

  const clearLog = () => {
    clearTimer();
    setJob(null);
    setFinalSnapshot(null);
    setScriptPhase(0);
  };

  return (
    <>
      {/* Header controls */}
      <div className="flex items-center gap-2">
        <StatusPill active={enabled} />
        {loadingPerm && (
          <span className="text-xs text-gray-600">Loading permission…</span>
        )}
        {error && (
          <span className={toneClass("fail") + " text-xs"}>Error: {error}</span>
        )}

        {!enabled ? (
          <button
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
            disabled={loadingPerm || savingPerm}
            title="Enable agent monitoring"
          >
            Enable monitoring
          </button>
        ) : (
          <button
            onClick={() => setDisableOpen(true)}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
            disabled={savingPerm}
            title="Disable agent monitoring"
          >
            Disable monitoring
          </button>
        )}
      </div>

      {/* Current state line */}
      <div className="mt-2 text-xs text-gray-600">
        {perm ? (
          <>
            <span>Monitoring: {perm.monitoring ? "On" : "Off"}</span>
            <span className="mx-2">•</span>
            <span>
              Allow remote actions: {perm.allows_action ? "Yes" : "No"}
            </span>
          </>
        ) : (
          <span className="text-gray-500">No data loaded yet.</span>
        )}
      </div>

      {/* Enable modal with a single checkbox */}
      {confirmOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/40" />
          <div className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">Enable monitoring?</div>
            <p className="mb-4 text-sm text-gray-600">
              You’ll enable the agent to review and keep your dashboard updated.
              You can also allow the agent to act remotely on your behalf.
            </p>

            <label className="flex items-start gap-2 mb-4">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={allowRemote}
                onChange={(e) => setAllowRemote(e.target.checked)}
              />
              <span className="text-sm text-gray-800">
                Allow agent to act remotely
                <span className="block text-xs text-gray-500">
                  If unchecked, the agent will not execute any actions.
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                disabled={savingPerm || starting}
              >
                Cancel
              </button>
              <button
                onClick={startMonitoring}
                disabled={savingPerm || starting}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {savingPerm || starting ? "Saving…" : "OK"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Disable confirm modal */}
      {disableOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/40" />
          <div className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">
              Disable monitoring?
            </div>
            <p className="mb-4 text-sm text-gray-600">
              This will turn off monitoring and disallow any remote actions. If
              a job is currently running, a cancel request will be sent first.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisableOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                disabled={savingPerm || cancelling}
              >
                Keep enabled
              </button>
              <button
                onClick={disableMonitoring}
                disabled={savingPerm || cancelling}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {savingPerm || cancelling ? "Stopping…" : "Yes, disable"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Log Modal */}
      {logOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/40" />
          <div className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 w-[96vw] max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="p-5 pb-3 border-b flex items-center justify-between">
              <div className="text-lg font-semibold">
                Agent Monitoring{" "}
                {(finalSnapshot ?? job)?.job_id
                  ? `• ${(finalSnapshot ?? job)!.job_id}`
                  : ""}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border px-2 py-0.5 text-xs text-gray-700 bg-gray-50 border-gray-200">
                  Overall: {(finalSnapshot ?? job)?.status ?? "idle"}
                </span>
                {canClose && (
                  <button
                    onClick={() => setLogOpen(false)}
                    className="rounded-lg px-2 py-1 text-sm hover:bg-gray-100"
                    title="Close"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>

            <div
              ref={scrollerRef}
              className="px-5 py-4 overflow-y-auto"
              style={{ maxHeight: "calc(85vh - 9rem)" }}
            >
              <ul className="space-y-1 text-sm">
                {lines.map((ln) => (
                  <li key={ln.id} className={toneClass(ln.kind)}>
                    {ln.text}
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-5 pb-5 pt-3 border-t flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {(finalSnapshot ?? job)?.started_at &&
                  `Started ${(finalSnapshot ?? job)!.started_at}`}
                {(finalSnapshot ?? job)?.ended_at &&
                  ` • Ended ${(finalSnapshot ?? job)!.ended_at}`}
              </div>
              <div className="flex items-center gap-2">
                {canCancel && (
                  <button
                    onClick={() => setDisableOpen(true)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                  >
                    Cancel run
                  </button>
                )}
                <button
                  onClick={clearLog}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                  disabled={!job && !finalSnapshot && scriptPhase === 0}
                  title={
                    !job && !finalSnapshot && scriptPhase === 0
                      ? "No log to clear"
                      : "Clear current log view"
                  }
                >
                  Clear log
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
