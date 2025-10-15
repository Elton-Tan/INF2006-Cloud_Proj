// src/contexts.tsx
import React from "react";
import { CONFIG, COGNITO } from "./config";
import {
  startCognitoAuth,
  login,
  onAuthExpired,
  AUTH_UPDATED_EVENT,
} from "./cognitoAuth";

/** What the rest of the app consumes */
export type AuthCtx = {
  apiBase: string;
  wsBase: string;
  token: string | null;
  /** Bumps whenever a brand-new token is set (e.g., logout → login) */
  tokenVersion: number;
};

const AuthContext = React.createContext<AuthCtx | null>(null);
const BusContext = React.createContext<EventTarget | null>(null);

/** Access auth (never null thanks to safe fallback in provider) */
export const useAuth = (): AuthCtx => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("AuthContext missing");
  return ctx;
};

/** Lightweight event bus (optional) */
export const useBus = (): EventTarget | null => React.useContext(BusContext);

/** Build Authorization header only when token exists */
export function useAuthHeader(): Record<string, string> {
  const { token } = useAuth();
  return React.useMemo(() => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);
}

/** Top-level provider that initializes Cognito auth and exposes the context */
/** Top-level provider that initializes Cognito auth and exposes the context */
export function AppProviders({ children }: { children: React.ReactNode }) {
  // store only the parts that can be null initially
  const [auth, setAuth] = React.useState<{
    apiBase: string;
    wsBase: string;
    token: string | null;
  } | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [expired, setExpired] = React.useState(false);
  const [bus] = React.useState<EventTarget>(() => new EventTarget());
  const [tokenVersion, setTokenVersion] = React.useState(0);

  // --- 1) Bootstrap auth exactly once (guard StrictMode double-effect) ---
  const ensureAuthed = React.useCallback(async () => {
      const isLocal = window.location.hostname === "localhost";
      //ETHAN DELETE THIS 
      if (isLocal) {
        // 👇 Inject a mock token for dev testing
        setAuth({
          apiBase: CONFIG.API_BASE,
          wsBase: CONFIG.WS_BASE,
          token: "mock-dev-token", // use any dummy string
        });
        setExpired(false);
        setTokenVersion((v) => v + 1);
        setLoading(false);
        console.log("⚠️ Running in mock auth mode (localhost).");
        return;
      }



    const res = await startCognitoAuth(
      {
        domain: COGNITO.domain,
        clientId: COGNITO.clientId,
        redirectUri: COGNITO.redirectUri,
        scopes: COGNITO.scopes,
      },
      {
        persist: true,
        preferIdToken: false, // flip to true if your API expects id_token instead
        autoLoginIfNoTokens: false,
      }
    );

    // Strip ?code= if we just returned from Cognito
    const url = new URL(window.location.href);
    if (url.searchParams.has("code")) {
      const clean = `${url.origin}${url.pathname}${url.hash || ""}`;
      try {
        window.history.replaceState(null, "", clean);
      } catch {}
    }

    if (res.ready && res.token) {
      setAuth({
        apiBase: CONFIG.API_BASE,
        wsBase: CONFIG.WS_BASE,
        token: res.token,
      });
      setExpired(false);
      setTokenVersion((v) => v + 1);
    }
    setLoading(false);

    try {
      const parts = (res.token || "").split(".");
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      console.debug(
        "token_use:",
        payload.token_use,
        "exp:",
        new Date(payload.exp * 1000).toISOString()
      );
    } catch {}
  }, []);

  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void ensureAuthed();
  }, [ensureAuthed]);

  // --- 2) Keep React state in sync when background refresh/login updates storage ---
  React.useEffect(() => {
    const onUpdated = () => {
      try {
        const raw =
          sessionStorage.getItem("cognito.tokens.v1") ||
          localStorage.getItem("cognito.tokens.v1");
        if (!raw) return;
        const j = JSON.parse(raw);
        const tok: string | null = j?.access_token || j?.id_token || null;
        if (tok) {
          setAuth({
            apiBase: CONFIG.API_BASE,
            wsBase: CONFIG.WS_BASE,
            token: tok,
          });
          setExpired(false);
          setTokenVersion((v) => v + 1);
        }
      } catch {}
    };
    window.addEventListener(AUTH_UPDATED_EVENT, onUpdated as any);
    return () =>
      window.removeEventListener(AUTH_UPDATED_EVENT, onUpdated as any);
  }, []);

  // --- 3) Respond to explicit expiry events from auth module (no re-bootstrap here) ---
  React.useEffect(() => {
    const off = onAuthExpired(() => {
      // If a fresh token already exists in storage (edge case), use it.
      try {
        const raw =
          sessionStorage.getItem("cognito.tokens.v1") ||
          localStorage.getItem("cognito.tokens.v1");
        if (raw) {
          const j = JSON.parse(raw);
          const tok: string | null = j?.access_token || j?.id_token || null;
          if (tok) {
            setAuth({
              apiBase: CONFIG.API_BASE,
              wsBase: CONFIG.WS_BASE,
              token: tok,
            });
            setExpired(false);
            setTokenVersion((v) => v + 1);
            return; // recovered — don't show modal
          }
        }
      } catch {}
      // Truly expired: null token + show modal.
      setExpired(true);
      setAuth((prev) =>
        prev
          ? { ...prev, token: null }
          : { apiBase: CONFIG.API_BASE, wsBase: CONFIG.WS_BASE, token: null }
      );
    });
    return off;
  }, []);

  // --- 4) Hard-expiry poller: catches cases where the timer couldn't emit ---
  React.useEffect(() => {
    const tick = () => {
      try {
        const raw =
          sessionStorage.getItem("cognito.tokens.v1") ||
          localStorage.getItem("cognito.tokens.v1");
        if (!raw) return;
        const j = JSON.parse(raw);
        const exp = Number(j?.expires_at) || 0;
        const now = Math.floor(Date.now() / 1000);
        if (exp && exp <= now) {
          setExpired(true);
          setAuth((prev) =>
            prev
              ? { ...prev, token: null }
              : {
                  apiBase: CONFIG.API_BASE,
                  wsBase: CONFIG.WS_BASE,
                  token: null,
                }
          );
        }
      } catch {}
    };
    const id = window.setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  // --- 5) Cross-tab logout detection (storage cleared in another tab) ---
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cognito.tokens.v1" && e.newValue == null) {
        setExpired(true);
        setAuth((prev) =>
          prev
            ? { ...prev, token: null }
            : { apiBase: CONFIG.API_BASE, wsBase: CONFIG.WS_BASE, token: null }
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // --- UI scaffolding ---
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
          <div className="text-sm text-gray-600">Loading…</div>
        </div>
      </div>
    );
  }

  // Show login screen if never authed AND not an expired session
  if (!auth && !expired) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50 px-4">
        <div className="w-[min(420px,92vw)] rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h1 className="text-lg font-semibold">
              Welcome to SuanFix Intelligence
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Please sign in to continue.
            </p>
          </div>
          <button
            className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black"
            onClick={() =>
              login({
                domain: COGNITO.domain,
                clientId: COGNITO.clientId,
                redirectUri: COGNITO.redirectUri,
                scopes: COGNITO.scopes,
              })
            }
          >
            Login with AWS Cognito
          </button>
          <p className="mt-3 text-center text-xs text-gray-500">
            You’ll be redirected to a secure sign-in page.
          </p>
        </div>
      </div>
    );
  }

  // Provide a non-null value even during expiry so useAuth() never throws
  const safeAuth: AuthCtx = {
    apiBase: CONFIG.API_BASE,
    wsBase: CONFIG.WS_BASE,
    token: auth?.token ?? null,
    tokenVersion,
  };

  return (
    <AuthContext.Provider value={safeAuth}>
      <BusContext.Provider value={bus}>{children}</BusContext.Provider>
    </AuthContext.Provider>
  );
}
