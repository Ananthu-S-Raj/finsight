/**
 * Minimal, dependency-free JWT payload decoding + session-freshness helpers.
 * Works in both the browser (atob) and Node (Buffer).
 *
 * Only ever reads the unverified payload: it is used to compare the token's
 * issued-at claim (iat) against `profiles.password_changed_at`. Real token
 * validation is performed by Supabase auth.
 */

export type JwtPayload = {
  sub?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
};

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") {
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    try {
      return atob(padded);
    } catch {
      return "";
    }
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  return "";
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  if (typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const json = base64UrlDecode(parts[1]);
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as JwtPayload) : null;
  } catch {
    return null;
  }
}

/** True when the JWT was issued strictly before `timestampMs`. A session
 *  issued before the password was changed is treated as stale. */
export function jwtIssuedBefore(token: string, timestampMs: number | null | undefined): boolean {
  if (!timestampMs) return false;
  const payload = decodeJwtPayload(token);
  const iat = payload?.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return false;
  return iat * 1000 < timestampMs;
}
