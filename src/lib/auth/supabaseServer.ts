import { createClient } from "@supabase/supabase-js";
import { jwtIssuedBefore } from "@/lib/jwt";

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL as string;
}

export function supabaseAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string;
}

/** Anon-key client for the public auth endpoints. No session is persisted;
 * recovery sessions are created on the fly by verifyOtp/signIn.
 */
export function createAnonClient() {
  return createClient(supabaseUrl() || "http://localhost", supabaseAnonKey() || "anon", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client scoped to a user's session token. RLS enforces that only the token's
 * owner can read their own rows — the service role is never used here.
 */
export function createUserClient(token: string) {
  return createClient(supabaseUrl() || "http://localhost", supabaseAnonKey() || "anon", {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Returns the session user for a Bearer token, or null when invalid/expired. */
export async function verifySession(token: string) {
  const { data, error } = await createAnonClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Verifies a Bearer session for a user-facing API call and rejects sessions
 * that must not be honored:
 *   - invalid / expired tokens (Supabase);
 *   - accounts that are suspended or disabled (account_status != 'active');
 *   - sessions issued before the account's last password change/reset
 *     (JWT `iat` guard) — old tokens die immediately, not at natural expiry.
 *
 * Returns the session user, or null. The freshness check mirrors the admin
 * session guard so non-admin endpoints are protected equally.
 */
export async function verifyActiveSession(token: string) {
  const user = await verifySession(token);
  if (!user) return null;

  const client = createUserClient(token);
  const { data, error } = await client
    .from("profiles")
    .select("account_status, password_changed_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  if (data.account_status && data.account_status !== "active") return null;

  const changedAtRaw = data.password_changed_at as string | null | undefined;
  if (changedAtRaw) {
    const changedAtMs = new Date(changedAtRaw).getTime();
    if (Number.isFinite(changedAtMs) && jwtIssuedBefore(token, changedAtMs)) {
      return null;
    }
  }

  return user;
}

/** Public base URL used to build the reset-password redirect. */
export function getBaseUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  const render = process.env.RENDER_EXTERNAL_URL;
  if (render) return render.replace(/\/+$/, "");
  return "http://localhost:3000";
}
