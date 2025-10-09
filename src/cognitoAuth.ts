// src/cognitoAuth.ts
type Cfg = {
  domain: string; // e.g. "<your-domain>.auth.us-east-1.amazoncognito.com"
  clientId: string; // Cognito app client WITHOUT secret
  redirectUri: string; // window.location.origin + "/"
  scopes?: string[]; // default ["openid","email","profile"]
  useIdToken?: boolean; // true = return id_token for API/WS (your setup)
};

type TokenSet = {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch seconds
};

const STORAGE_KEY = "cognito.tokens.v1";
const PKCE_VERIFIER_KEY = "cognito.pkce.verifier";

function toBase64Url(bytes: Uint8Array) {
  // Avoids the spread operator (…); compatible with lower targets
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

// Make b64url accept either ArrayBuffer or Uint8Array safely
function b64url(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return toBase64Url(bytes);
}

async function sha256(str: string) {
  const enc = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(digest);
}

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
    if (!persist) localStorage.removeItem(STORAGE_KEY); // ensure single source
  } catch {}
}

function clearStored() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
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

async function exchangeCode(
  cfg: Cfg,
  code: string,
  codeVerifier: string
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
  const expires_at = nowSec() + (json.expires_in ?? 3600);
  return {
    id_token: json.id_token,
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at,
  };
}

async function refresh(cfg: Cfg, refreshToken: string): Promise<TokenSet> {
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
  // refresh may omit refresh_token; reuse the old one
  const expires_at = nowSec() + (json.expires_in ?? 3600);
  return {
    id_token: json.id_token,
    access_token: json.access_token,
    refresh_token: refreshToken,
    expires_at,
  };
}

export function login(cfg: Cfg, persist = false) {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = b64url(random); // ✅ Uint8Array accepted now
  sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);

  return sha256Bytes(codeVerifier).then((hash) => {
    const codeChallenge = b64url(hash); // ✅ Uint8Array accepted
    const scopes = (cfg.scopes ?? ["openid", "email", "profile"]).join(" ");
    const authorize = new URL(`https://${cfg.domain}/oauth2/authorize`);
    authorize.searchParams.set("client_id", cfg.clientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("redirect_uri", cfg.redirectUri);
    authorize.searchParams.set("scope", scopes);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("code_challenge", codeChallenge);
    window.location.assign(authorize.toString());
  });
}

export function logout(cfg: Cfg) {
  clearStored();
  const u = new URL(`https://${cfg.domain}/logout`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("logout_uri", cfg.redirectUri);
  window.location.assign(u.toString());
}

type StartOpts = { persist?: boolean; preferIdToken?: boolean };
type StartResult = {
  token: string | null;
  ready: boolean;
  getAuthHeader(): Record<string, string>;
};

let refreshTimer: number | null = null;

export async function startCognitoAuth(
  cfg: Cfg,
  opts: StartOpts = {}
): Promise<StartResult> {
  const preferId = opts.preferIdToken ?? true;

  // 1) Handle redirect back with ?code=...
  const qp = parseQuery();
  if (qp.code) {
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) || "";
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    try {
      const toks = await exchangeCode(cfg, qp.code, verifier);
      writeStored(toks, !!opts.persist);
      // wipe query string to keep URL clean
      const clean = new URL(window.location.href);
      clean.search = "";
      window.history.replaceState({}, "", clean.toString());
    } catch {
      clearStored();
    }
  }

  // 2) Try cache
  let tokens = readStored();

  // 3) Refresh if near expiry
  if (tokens && tokens.expires_at <= nowSec() + 60) {
    if (tokens.refresh_token) {
      try {
        tokens = await refresh(cfg, tokens.refresh_token);
        writeStored(tokens, !!opts.persist);
      } catch {
        clearStored();
        tokens = null;
      }
    } else {
      clearStored();
      tokens = null;
    }
  }

  // 4) If no tokens, kick off login
  if (!tokens) {
    await login(cfg, !!opts.persist);
    return { token: null, ready: false, getAuthHeader: () => ({}) };
  }

  // 5) Schedule background refresh
  if (refreshTimer) window.clearTimeout(refreshTimer);
  const msUntil = Math.max(5_000, (tokens.expires_at - nowSec() - 60) * 1000);
  refreshTimer = window.setTimeout(async () => {
    try {
      const cur = readStored();
      if (!cur?.refresh_token) throw new Error("no_refresh");
      const next = await refresh(cfg, cur.refresh_token);
      writeStored(next, !!opts.persist);
    } catch {
      clearStored();
      login(cfg, !!opts.persist);
    }
  }, msUntil);

  const token = preferId ? tokens.id_token : tokens.access_token;
  return {
    token,
    ready: true,
    getAuthHeader() {
      return { Authorization: `Bearer ${token}` };
    },
  };
}
