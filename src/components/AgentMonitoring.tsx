// src/components/AgentMonitoring.tsx
import React from "react";
import { CONFIG } from "../config";
import { useAuth } from "../contexts";
import ModalPortal from "./ModalPortal";

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

function toneClass(kind: "info" | "ok" | "fail") {
  if (kind === "ok") return "text-green-700";
  if (kind === "fail") return "text-red-700";
  return "text-gray-800";
}

async function fetchJSON(url: string, opts: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";

  const resp = await fetch(url, { ...opts, headers });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
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

export default function AgentMonitoring() {
  const { token } = useAuth();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);

  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<JobStatus | null>(null);
  const [finalSnapshot, setFinalSnapshot] = React.useState<JobStatus | null>(
    null
  );
  const [enabled, setEnabled] = React.useState<boolean>(false);

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

  // restore persisted state
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
      if (rawEnabled != null) setEnabled(rawEnabled === "true");
    } catch {}
  }, []);

  // persist state
  React.useEffect(() => {
    try {
      if (jobId) localStorage.setItem(LS_JOB, JSON.stringify({ jobId }));
      else localStorage.removeItem(LS_JOB);
    } catch {}
  }, [jobId]);

  React.useEffect(() => {
    try {
      localStorage.setItem(LS_ENABLED, String(enabled));
    } catch {}
  }, [enabled]);

  // lock body when any modal opens
  const anyModalOpen = confirmOpen || disableOpen || logOpen;
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    if (anyModalOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anyModalOpen]);

  // start a run; also mark monitoring Enabled
  const startMonitoring = async () => {
    if (!token) {
      alert("You must be signed in to start monitoring.");
      return;
    }
    setStarting(true);
    try {
      // HARD RESET to prevent stale "OK" flash
      clearTimer();
      setJob(null);
      setFinalSnapshot(null);
      setScriptPhase(0);

      const r = await fetchJSON(
        `${CONFIG.API_BASE}/agent/monitoring/start`,
        { method: "POST", body: JSON.stringify({}) },
        token
      );

      setEnabled(true);
      setJobId(r.job_id);
      setLogOpen(true);
      setConfirmOpen(false);
    } catch (e: any) {
      alert(`Failed to start: ${e.message || e}`);
    } finally {
      setStarting(false);
    }
  };

  // request cancel (only affects an in-flight job), and Disables monitoring
  const disableMonitoring = async () => {
    setDisableOpen(false);
    setEnabled(false);
    if (!jobId || !token) return;
    const state = job?.status ?? "idle";
    if (state === "running" || state === "queued") {
      setCancelling(true);
      try {
        await fetchJSON(
          `${CONFIG.API_BASE}/agent/monitoring/cancel`,
          { method: "POST", body: JSON.stringify({ job_id: jobId }) },
          token
        );
      } catch (e: any) {
        alert(`Failed to cancel run: ${e.message || e}`);
      } finally {
        setCancelling(false);
      }
    }
  };

  // poll current job only while we have a jobId
  React.useEffect(() => {
    if (!jobId || !token) return;
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
          token
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
  }, [jobId, token]);

  // Only render job info if it belongs to the CURRENT run
  const liveJob = job && jobId && job.job_id === jobId ? job : null;
  const snapJob =
    finalSnapshot && jobId && finalSnapshot.job_id === jobId
      ? finalSnapshot
      : null;
  const effectiveJob: JobStatus | null = snapJob ?? liveJob;

  const steps = effectiveJob?.steps || {};
  const allSucceeded =
    ORDER.length > 0 && ORDER.every((k) => steps[k]?.status === "succeeded");

  /* ---- CHAINED TIMELINE (manual close) ----
     1 -> (immediately) 2 (Consolidating…), hold 3s, then 3 (All OK).
     No auto-close; Close button appears at phase 3.
  */

  // 1 -> 2 (immediately show consolidating)
  React.useEffect(() => {
    if (allSucceeded && scriptPhase === 1) {
      setScriptPhase(2);
    }
  }, [allSucceeded, scriptPhase]);

  // 2 -> 3 after 3000ms (keep "consolidating" visible for ~3s)
  React.useEffect(() => {
    if (!(allSucceeded && scriptPhase === 2)) return;
    clearTimer();
    tRef.current = window.setTimeout(() => {
      setScriptPhase((p) => (p === 2 ? 3 : p));
    }, 3000);
    return clearTimer;
  }, [allSucceeded, scriptPhase]);

  // If success state disappears (new run/cancel/fail), reset timeline + timer
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
        id: `review-1`,
        text: `Consolidating live data with static data…`,
        kind: "info",
      });
    }
    if (scriptPhase >= 2) {
      lines.push({
        id: `review-2`,
        text: `Agent is re-reviewing it's new knowledge base…`,
        kind: "info",
      });
    }
    if (scriptPhase >= 3) {
      lines.push({
        id: `review-3`,
        text: `All OK — your dashboard is now monitored. You may close this window.`,
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
    effectiveJob?.status ?? (jobId ? "queued" : enabled ? "idle" : "idle");

  const canCancel =
    (effectiveJob?.status === "running" || effectiveJob?.status === "queued") &&
    !!jobId;

  // Close allowed only on failure/cancel/idle OR after All OK (phase 3)
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
        {!enabled ? (
          <button
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            title="Start agent monitoring"
          >
            Enable monitoring
          </button>
        ) : (
          <button
            onClick={() => setDisableOpen(true)}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            title="Disable agent monitoring"
          >
            Disable monitoring
          </button>
        )}
      </div>

      {/* Enable confirm */}
      {confirmOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/40" />
          <div className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">Enable monitoring?</div>
            <p className="mb-4 text-sm text-gray-600">
              You will be giving the agent permission to review and access the
              information of your dashboard. The agent may also choose to
              execute actions on your behalf. Do you wish to proceed?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={startMonitoring}
                disabled={starting}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {starting ? "Starting…" : "Yes, enable"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Disable confirm */}
      {disableOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/40" />
          <div className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">
              Disable monitoring?
            </div>
            <p className="mb-4 text-sm text-gray-600">
              This will stop keeping the agent active. If a job is running, a
              cancel request will be sent.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisableOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Keep enabled
              </button>
              <button
                onClick={disableMonitoring}
                disabled={cancelling}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {cancelling ? "Stopping…" : "Yes, disable"}
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
                {effectiveJob?.job_id ? `• ${effectiveJob.job_id}` : ""}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border px-2 py-0.5 text-xs text-gray-700 bg-gray-50 border-gray-200">
                  Overall: {effectiveJob?.status ?? "idle"}
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
                {effectiveJob?.started_at &&
                  `Started ${effectiveJob.started_at}`}
                {effectiveJob?.ended_at && ` • Ended ${effectiveJob.ended_at}`}
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
                  disabled={!effectiveJob && scriptPhase === 0}
                  title={
                    !effectiveJob && scriptPhase === 0
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
