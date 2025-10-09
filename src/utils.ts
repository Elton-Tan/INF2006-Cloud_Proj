import { COGNITO } from "./config";

export const fmtSgt = (t?: number | string | null): string => {
  if (t == null) return "—";
  const d = typeof t === "number" ? new Date(t * 1000) : new Date(String(t));
  return d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    hour12: false,
  });
};

export const trunc = (s: string, n = 48) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

export const buildWsUrl = (baseHttpsUrl: string, token: string) => {
  const u = new URL(baseHttpsUrl);
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.searchParams.set("token", token);
  return u.toString();
};

export function doLogout() {
  try {
    sessionStorage.clear();
    localStorage.removeItem("cognito.tokens.v1");
    localStorage.removeItem("cognito.pkce.verifier");
  } catch {}
  try {
    const url = new URL(`https://${COGNITO.domain}/logout`);
    url.searchParams.set("client_id", COGNITO.clientId);
    url.searchParams.set("logout_uri", COGNITO.redirectUri);
    window.location.href = url.toString();
  } catch {
    window.location.assign(COGNITO.redirectUri);
  }
}
