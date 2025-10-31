// src/cognitoAuth.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    __cog_code_exchange_done?: boolean;
  }
}

/* ------------------------------------------
   Toggle silent refresh (for testing/production):
   false => NO auto refresh; session ends at exp
   true  => auto refresh when possible (uses RT)
------------------------------------------- */
const ENABLE_AUTO_REFRESH = false;

/* ---------- Types ---------- */

export type Cfg = {
  domain: string; // "<your-domain>.auth.<region>.amazoncognito.com"
  clientId: string; // App client WITHOUT secret
  redirectUri: string; // e.g. window.location.origin + "/"
  scopes?: string[]; // default ["openid","email","profile"]
  useIdToken?: boolean; // legacy hint; start()'s preferIdToken takes precedence
};

type TokenSet = {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch seconds for the CHOSEN token (id vs access)
};

type StartOpts = {
  persist?: boolean; // store in localStorage (else sessionStorage)
  preferIdToken?: boolean; // true => use id_token for Authorization
  autoLoginIfNoTokens?: boolean; // default true
};

export type StartResult = {
  token: string | null;
  ready: boolean;
  getAuthHeader(): Record<string, string>;
};

/* ---------- Storage keys ---------- */

const STORAGE_KEY = "cognito.tokens.v1";
const PKCE_VERIFIER_KEY = "cognito.pkce.verifier";
const PERSIST_KEY = "__persist_login";

/* ---------- Small utils ---------- */

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(digest);
}

function b64url(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return toBase64Url(bytes);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseQuery(): Record<string, string> {
  const u = new URL(window.location.href);
  const out: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (out[k] = v));
  return out;
}

function jwtExpSeconds(tok: string): number {
  try {
    const [, b64] = tok.split(".");
    const json = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

/* ---------- Token persistence ---------- */

function readStored(): TokenSet | null {
  try {
    const raw =
      sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as TokenSet;
    if (!v.id_token || !v.access_token || !v.expires_at) return null;
    return v;
  } catch {
    return null;
  }
}

function writeStored(t: TokenSet, persist = false) {
  const raw = JSON.stringify(t);
  try {
    (persist ? localStorage : sessionStorage).setItem(STORAGE_KEY, raw);
    if (!persist) localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function clearStored() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/* ---------- Events ---------- */

export const AUTH_EXPIRED_EVENT = "cognito.auth.expired";
export const AUTH_UPDATED_EVENT = "cognito.auth.updated";

function emitAuthExpired() {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  } catch {}
}

function emitAuthUpdated() {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_UPDATED_EVENT));
  } catch {}
}

/* ---------- Network helpers ---------- */

async function exchangeCode(
  cfg: Cfg,
  code: string,
  codeVerifier: string,
  preferIdToken: boolean
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
  });
  const r = await fetch(`https://${cfg.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("token_exchange_failed");
  const json = await r.json();

  const chosen = preferIdToken ? json.id_token : json.access_token;
  const exp = jwtExpSeconds(chosen) || nowSec() + (json.expires_in ?? 3600);

  return {
    id_token: json.id_token,
    access_token: json.access_token,
    refresh_token: ENABLE_AUTO_REFRESH ? json.refresh_token : undefined,
    expires_at: exp,
  };
}

async function refresh(
  cfg: Cfg,
  refreshToken: string,
  preferIdToken: boolean
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    refresh_token: refreshToken,
  });
  const r = await fetch(`https://${cfg.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("refresh_failed");
  const json = await r.json();

  const chosen = preferIdToken ? json.id_token : json.access_token;
  const exp = jwtExpSeconds(chosen) || nowSec() + (json.expires_in ?? 3600);

  return {
    id_token: json.id_token,
    access_token: json.access_token,
    refresh_token: ENABLE_AUTO_REFRESH ? refreshToken : undefined,
    expires_at: exp,
  };
}

/* ---------- Timers (expiry + optional refresh) ---------- */

let refreshTimer: number | null = null;
let expiryAlarm: number | null = null;

function stopTimers() {
  try {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    if (expiryAlarm) window.clearTimeout(expiryAlarm);
  } catch {}
  refreshTimer = null;
  expiryAlarm = null;
}

function isExpiredOrNear(t: TokenSet | null, skewSec = 0) {
  return !t || t.expires_at <= nowSec() + skewSec;
}

/** Fire AUTH_EXPIRED exactly at token expiry (no refresh). */
function armExpiryAlarm(expiresAtSec: number, skewSec = 0) {
  try {
    if (expiryAlarm) window.clearTimeout(expiryAlarm);
  } catch {}
  const ms = Math.max(0, (expiresAtSec - nowSec() - skewSec) * 1000);
  expiryAlarm = window.setTimeout(() => {
    clearStored();
    emitAuthExpired();
  }, ms);
}

/** Silent refresh path (only if ENABLE_AUTO_REFRESH=true). */
function armRefreshTimer(
  cfg: Cfg,
  persist: boolean,
  preferIdToken: boolean,
  skewSec = 60
) {
  const tokens = readStored();
  if (!tokens) return;

  try {
    if (refreshTimer) window.clearTimeout(refreshTimer);
  } catch {}
  const msUntil = Math.max(
    5_000,
    (tokens.expires_at - nowSec() - skewSec) * 1000
  );

  refreshTimer = window.setTimeout(async () => {
    try {
      const cur = readStored();
      if (!ENABLE_AUTO_REFRESH || !cur?.refresh_token)
        throw new Error("no_refresh");
      const next = await refresh(cfg, cur.refresh_token, preferIdToken);
      writeStored(next, persist);
      emitAuthUpdated();
      armRefreshTimer(cfg, persist, preferIdToken, skewSec); // re-arm
    } catch {
      clearStored();
      emitAuthExpired();
    }
  }, msUntil);
}

/* ---------- Public API: login / logout ---------- */

export function login(cfg: Cfg, persist = false) {
  // Generate PKCE verifier and store in BOTH storages for robustness
  const random = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = b64url(random);
  try {
    sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
  } catch {}

  return sha256Bytes(codeVerifier).then((hash) => {
    const codeChallenge = b64url(hash);
    const scopes = (cfg.scopes ?? ["openid", "email", "profile"]).join(" ");
    const authorize = new URL(`https://${cfg.domain}/oauth2/authorize`);
    authorize.searchParams.set("client_id", cfg.clientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("redirect_uri", cfg.redirectUri);
    authorize.searchParams.set("scope", scopes);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("code_challenge", codeChallenge);
    try {
      sessionStorage.setItem(PERSIST_KEY, persist ? "1" : "0");
    } catch {}
    window.location.assign(authorize.toString());
  });
}

export function logout(cfg: Cfg) {
  // Clear local tokens and timers
  stopTimers();
  clearStored();

  const u = new URL(`https://${cfg.domain}/logout`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("logout_uri", cfg.redirectUri);
  window.location.assign(u.toString());
}

/* ---------- Public bootstrap ---------- */

export async function startCognitoAuth(
  cfg: Cfg,
  opts: StartOpts = {}
): Promise<StartResult> {
  const preferId = opts.preferIdToken ?? cfg.useIdToken ?? false;
  const autoLogin = opts.autoLoginIfNoTokens ?? true;

  // 1) Handle redirect with ?code=... (guard duplicate exchanges)
  const qp = parseQuery();
  if (qp.code) {
    if (window.__cog_code_exchange_done) {
      const clean = new URL(window.location.href);
      clean.search = "";
      try {
        window.history.replaceState({}, "", clean.toString());
      } catch {}
    } else {
      window.__cog_code_exchange_done = true;
      const verifier =
        sessionStorage.getItem(PKCE_VERIFIER_KEY) ||
        localStorage.getItem(PKCE_VERIFIER_KEY) ||
        "";
      try {
        sessionStorage.removeItem(PKCE_VERIFIER_KEY);
        localStorage.removeItem(PKCE_VERIFIER_KEY);
      } catch {}

      try {
        const toks = await exchangeCode(cfg, qp.code, verifier, preferId);
        const persist =
          sessionStorage.getItem(PERSIST_KEY) === "1" || !!opts.persist;

        writeStored(toks, persist);

        // Optional scrub: if auto refresh is disabled, ensure no RT lingers in storage
        if (!ENABLE_AUTO_REFRESH) {
          try {
            const raw =
              sessionStorage.getItem(STORAGE_KEY) ||
              localStorage.getItem(STORAGE_KEY);
            if (raw) {
              const t = JSON.parse(raw);
              delete t.refresh_token;
              const s = JSON.stringify(t);
              sessionStorage.setItem(STORAGE_KEY, s);
              localStorage.setItem(STORAGE_KEY, s);
            }
          } catch {}
        }

        // Arm the right timer
        stopTimers();
        if (ENABLE_AUTO_REFRESH) armRefreshTimer(cfg, persist, preferId, 60);
        else armExpiryAlarm(toks.expires_at, 0);

        emitAuthUpdated();

        // scrub query string
        const clean = new URL(window.location.href);
        clean.search = "";
        try {
          window.history.replaceState({}, "", clean.toString());
        } catch {}
      } catch {
        clearStored();
        stopTimers();
        emitAuthExpired();
      }
    }
  }

  // 2) Cached tokens
  let tokens = readStored();

  // 3) Refresh if near expiry OR arm expiry alarm
  const skew = ENABLE_AUTO_REFRESH ? 60 : 0;
  if (isExpiredOrNear(tokens, skew)) {
    if (ENABLE_AUTO_REFRESH && tokens?.refresh_token) {
      try {
        tokens = await refresh(cfg, tokens.refresh_token, preferId);
        writeStored(tokens, !!opts.persist);
        stopTimers();
        armRefreshTimer(cfg, !!opts.persist, preferId, 60);
        emitAuthUpdated();
      } catch {
        clearStored();
        stopTimers();
        tokens = null;
        emitAuthExpired();
      }
    } else {
      clearStored();
      stopTimers();
      tokens = null;
      emitAuthExpired();
    }
  } else {
    // still valid — arm appropriate timer
    stopTimers();
    if (tokens) {
      if (ENABLE_AUTO_REFRESH)
        armRefreshTimer(cfg, !!opts.persist, preferId, 60);
      else armExpiryAlarm(tokens.expires_at, 0);
    }
  }

  // 4) If no tokens: optionally auto-login (first visit) else not ready
  if (!tokens) {
    if (autoLogin) await login(cfg, !!opts.persist);
    return { token: null, ready: false, getAuthHeader: () => ({}) };
  }

  // 5) Visibility recheck: if tab wakes up after expiry, fire event
  const visHandler = () => {
    const t = readStored();
    if (!t || isExpiredOrNear(t, 0)) {
      clearStored();
      stopTimers();
      emitAuthExpired();
    }
  };
  document.removeEventListener("visibilitychange", visHandler as any);
  document.addEventListener("visibilitychange", visHandler as any);

  const token =
    opts.preferIdToken ?? cfg.useIdToken ?? false
      ? tokens.id_token
      : tokens.access_token;

  return {
    token,
    ready: true,
    getAuthHeader() {
      return { Authorization: `Bearer ${token}` };
    },
  };
}

/* ---------- Subscription helper ---------- */

export function onAuthExpired(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

export function decodeExpSec(jwt?: string | null): number {
  if (!jwt) return 0;
  try {
    const [, b64] = jwt.split(".");
    const json = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}
