import React from "react";
import { CONFIG, COGNITO } from "./config";
import { startCognitoAuth, login } from "./cognitoAuth";

export type AuthCtx = { apiBase: string; wsBase: string; token: string };

const AuthContext = React.createContext<AuthCtx | null>(null);
const BusContext = React.createContext<EventTarget | null>(null);

export const useAuth = (): AuthCtx => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("AuthContext missing");
  return ctx;
};
export const useBus = (): EventTarget | null => React.useContext(BusContext);

function readStoredToken(): string | null {
  try {
    const raw =
      sessionStorage.getItem("cognito.tokens.v1") ||
      localStorage.getItem("cognito.tokens.v1");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj?.id_token || obj?.access_token || null;
  } catch {
    return null;
  }
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<AuthCtx | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [bus] = React.useState<EventTarget>(() => new EventTarget());

  const ensureAuthed = React.useCallback(async () => {
    const url = new URL(window.location.href);
    const hasCode = url.searchParams.has("code");

    const stored = readStoredToken();
    if (stored && !auth) {
      setAuth({
        apiBase: CONFIG.API_BASE,
        wsBase: CONFIG.WS_BASE,
        token: stored,
      });
      setLoading(false);
      return;
    }

    if (hasCode) {
      const res = await startCognitoAuth(
        {
          domain: COGNITO.domain,
          clientId: COGNITO.clientId,
          redirectUri: COGNITO.redirectUri,
          scopes: COGNITO.scopes,
        },
        { persist: true, preferIdToken: COGNITO.useIdToken }
      );
      if (res.ready && res.token) {
        setAuth({
          apiBase: CONFIG.API_BASE,
          wsBase: CONFIG.WS_BASE,
          token: res.token,
        });
      }
      const clean = `${url.origin}${url.pathname}${url.hash || ""}`;
      window.history.replaceState(null, "", clean);
      setLoading(false);
      return;
    }

    setLoading(false);
  }, [auth]);

  const ranRef = React.useRef(false);
  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void ensureAuthed();
  }, [ensureAuthed]);

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

  if (!auth) {
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

  return (
    <AuthContext.Provider value={auth}>
      <BusContext.Provider value={bus}>{children}</BusContext.Provider>
    </AuthContext.Provider>
  );
}
