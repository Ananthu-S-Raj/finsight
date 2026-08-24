import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { jwtIssuedBefore } from "../jwt";
import { logger } from "../logger";
import { adminAuthIpLimiter, adminAuthUserLimiter } from "../rateLimit";

/**
 * Server-side authorization core for the FinSight Admin Console.
 *
 * Security model:
 *   1. The client sends `Authorization: Bearer <session jwt>`.
 *   2. This module creates a Supabase client scoped to that JWT and asks the
 *      auth service to verify it (`auth.getUser`). Invalid/expired → 401.
 *   3. The acting user's role is read from `profiles.role` (own row, RLS-safe).
 *      Anything other than `admin` → 403. Data access then flows through RLS +
 *      `is_admin()`-gated functions, so the database enforces the boundary too.
 *
 * Frontend checks are NOT a security boundary. Every admin route handler goes
 * through `authenticateRequest` before touching any data.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AdminContext = {
  userId: string;
  email: string | null;
  role: string;
  permissions: string[];
  token: string;
  ip: string | null;
  userAgent: string | null;
  client: SupabaseClient;
};

export function createUserScopedClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match ? match[1] : null;
}

export function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function verifySession(
  client: SupabaseClient,
  token: string
): Promise<{ id: string; email: string | null } | null> {
  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

/** Read the session-invalidation marker. Null when unknown/missing. */
export async function loadPasswordChangedAt(
  client: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select("password_changed_at")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data || !data.password_changed_at) return null;
    return (data.password_changed_at as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the permission codes granted to a role from the RBAC matrix.
 *
 * TRUE FAIL-CLOSED: any failure to read roles/role_permissions (missing role
 * row, query error, unreadable grants, or a legitimately empty grant set)
 * yields []. requirePermission() then rejects protected endpoints with 403.
 * A database or RLS error must never be interpreted as "this administrator
 * may do everything".
 *
 * Bootstrap note: migration 20260807000000_admin.sql seeds every permission
 * and explicitly grants them all to the `admin` role, so a correctly
 * provisioned admin always has a non-empty matrix. An empty result therefore
 * means either misconfiguration or deliberate revocation — both of which
 * must fail closed rather than escalate.
 */
export async function loadPermissions(
  client: SupabaseClient,
  role: string
): Promise<string[]> {
  try {
    const { data: roleRow, error: roleError } = await client
      .from("roles")
      .select("id")
      .eq("name", role)
      .maybeSingle();
    if (roleError || !roleRow) return [];
    const { data, error } = await client
      .from("role_permissions")
      .select("permissions(code)")
      .eq("role_id", roleRow.id as string);
    if (error || !data) return [];
    const codes = data
      .map((row) => {
        const maybePerm = row.permissions as unknown;
        if (
          typeof maybePerm === "object" &&
          maybePerm !== null &&
          "code" in maybePerm &&
          typeof (maybePerm as { code: unknown }).code === "string"
        ) {
          return (maybePerm as { code: string }).code;
        }
        return undefined;
      })
      .filter((code): code is string => Boolean(code));
    return codes;
  } catch {
    return [];
  }
}

export type AuthResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; error: ApiError };

/** Window (ms) within which repeated ADMIN_LOGIN audit rows are suppressed. */
const ADMIN_LOGIN_AUDIT_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_LOGIN_AUDIT_ACTION = "ADMIN_LOGIN";

/** Read the last successful admin-login audit timestamp for a user. */
async function lastAdminLoginAt(client: SupabaseClient, userId: string): Promise<number | null> {
  try {
    const { data, error } = await client
      .from("audit_logs")
      .select("created_at")
      .eq("actor_id", userId)
      .eq("action", ADMIN_LOGIN_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.created_at) return null;
    const ms = new Date(data.created_at as string).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

async function recordAdminLogin(ctx: AdminContext): Promise<void> {
  const last = await lastAdminLoginAt(ctx.client, ctx.userId);
  if (last !== null && Date.now() - last < ADMIN_LOGIN_AUDIT_WINDOW_MS) return;
  await ctx.client.from("audit_logs").insert({
    actor_id: ctx.userId,
    actor_email: ctx.email,
    action: ADMIN_LOGIN_AUDIT_ACTION,
    resource_type: "auth",
    resource_id: ctx.userId,
    target_user_id: ctx.userId,
    target_email: ctx.email,
    metadata: { session_started: true },
    ip: ctx.ip,
    user_agent: ctx.userAgent,
    result: "success",
  });
}

/** Log a denied admin access attempt (structured log + best-effort audit). */
function logAuthDenial(ctx: { ip: string | null; userAgent: string | null }, reason: string, detail?: Record<string, unknown>) {
  logger.warn("admin-auth", "access_denied", {
    reason,
    ip: ctx.ip ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
    ...detail,
  });
}

/** Verify the JWT and confirm the admin role — server-side, before any data access. */
export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const ip = getIp(req);
  const userAgent = req.headers.get("user-agent");
  const hasAuthHeader = Boolean(req.headers.get("authorization"));

  const deny = (status: number, message: string, code: string, reason: string, extra?: Record<string, unknown>): AuthResult => {
    logAuthDenial({ ip, userAgent }, reason, { hasAuthHeader, ...extra });
    return { ok: false, error: new ApiError(status, message, code) };
  };

  const token = readBearer(req);
  if (!token) {
    logger.warn("admin-auth", "missing_token", { hasAuthHeader, path: new URL(req.url).pathname });
    return deny(401, "Authentication required.", "unauthorized", "missing_token");
  }

  const client = createUserScopedClient(token);
  const session = await verifySession(client, token);
  if (!session) {
    logger.warn("admin-auth", "invalid_session", { path: new URL(req.url).pathname });
    // Throttle invalid/expired-token abuse per IP (and per claimed user id if
    // the token's sub can be read).
    const key = `ip:${ip ?? "unknown"}`;
    const ipOk = adminAuthIpLimiter.check(key);
    if (!ipOk.ok) {
      return { ok: false, error: new ApiError(429, "Too many admin auth attempts. Please try again later.", "rate_limited") };
    }
    return deny(401, "Session is invalid or has expired.", "unauthorized", "invalid_session");
  }

  const ipOk = adminAuthIpLimiter.check(`ip:${ip ?? "unknown"}`);
  const userOk = adminAuthUserLimiter.check(`user:${session.id}`);
  if (!ipOk.ok || !userOk.ok) {
    return {
      ok: false,
      error: new ApiError(429, "Too many admin auth attempts. Please try again later.", "rate_limited"),
    };
  }

  const profile = await loadProfile(client, session.id);
  if (!profile) {
    logger.warn("admin-auth", "profile_missing", { userId: session.id, path: new URL(req.url).pathname });
    return deny(401, "Session is invalid or has expired.", "unauthorized", "profile_missing", { userId: session.id });
  }

  if (profile.account_status !== "active") {
    logger.warn("admin-auth", "account_not_active", { userId: session.id, accountStatus: profile.account_status, path: new URL(req.url).pathname });
    return deny(
      403,
      "Forbidden: this account is suspended or disabled.",
      "forbidden",
      "account_not_active",
      { userId: session.id, accountStatus: profile.account_status }
    );
  }

  const role = profile.role;
  if (role !== "admin") {
    logger.warn("admin-auth", "not_admin", { userId: session.id, role, path: new URL(req.url).pathname });
    return deny(403, "Forbidden: administrator role required.", "forbidden", "not_admin", { userId: session.id });
  }

  // Admin password hardening: reject any admin session issued before the
  // account's last password change (e.g. after a password reset).
  const passwordChangedAt = await loadPasswordChangedAt(client, session.id);
  const changedAtMs = passwordChangedAt ? new Date(passwordChangedAt).getTime() : null;
  if (changedAtMs !== null && Number.isFinite(changedAtMs) && jwtIssuedBefore(token, changedAtMs)) {
    return deny(
      401,
      "This session was invalidated by a recent password change. Please log in again.",
      "unauthorized",
      "stale_session",
      { userId: session.id }
    );
  }

  const permissions = await loadPermissions(client, role);

  const ctx: AdminContext = {
    userId: session.id,
    email: session.email,
    role,
    permissions,
    token,
    ip,
    userAgent,
    client,
  };

  // Audit successful admin access (throttled to ~one row per 10-minute window
  // so the log stays useful instead of recording every request).
  await recordAdminLogin(ctx).catch(() => null);

  return { ok: true, ctx };
}

/** Load role + account status in a single query. Null when the profile is missing. */
async function loadProfile(
  client: SupabaseClient,
  userId: string
): Promise<{ role: string | null; account_status: string | null } | null> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select("role, account_status")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      role: (data.role as string) ?? null,
      account_status: (data.account_status as string) ?? null,
    };
  } catch {
    return null;
  }
}

export function requirePermission(ctx: AdminContext, code: string) {
  if (!ctx.permissions.includes(code)) {
    throw new ApiError(403, `Forbidden: missing ${code} permission.`, "forbidden");
  }
}

export type AuditEntry = {
  action: string;
  resource_type: string;
  resource_id?: string | null;
  target_user_id?: string | null;
  target_email?: string | null;
  metadata?: Record<string, unknown>;
  result?: "success" | "denied" | "error";
  reason?: string | null;
};

/** Append an audit event. Throws if the audit cannot be recorded, so a
 *  successful admin mutation is never left silently unaudited. */
export async function writeAudit(ctx: AdminContext, entry: AuditEntry) {
  const { error } = await ctx.client.from("audit_logs").insert({
    actor_id: ctx.userId,
    actor_email: ctx.email,
    action: entry.action,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id ?? null,
    target_user_id: entry.target_user_id ?? null,
    target_email: entry.target_email ?? null,
    metadata: entry.metadata ?? {},
    ip: ctx.ip,
    user_agent: ctx.userAgent,
    result: entry.result ?? "success",
    reason: entry.reason ?? null,
  });
  if (error) {
    throw new ApiError(500, "The action completed but its audit record could not be saved.", "audit_failed");
  }
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new ApiError(400, "Invalid JSON body.", "bad_request");
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Authenticated responses must never be cached by shared caches/CDNs —
      // a misconfigured edge could otherwise serve one user's data to another.
      "Cache-Control": "no-store",
    },
  });
}

export async function handleRoute(
  fn: () => Promise<unknown>,
  status = 200
): Promise<Response> {
  try {
    return json(await fn(), status);
  } catch (err) {
    if (err instanceof ApiError) {
      return json({ error: err.message, code: err.code, status: err.status }, err.status);
    }
    // Never leak stack traces, SQL errors or internal paths to the client.
    logger.error("admin-api", "unhandled_error", logger.err(err));
    return json({ error: "An unexpected error occurred.", code: "internal", status: 500 }, 500);
  }
}

export type RouteParams = { [key: string]: string | undefined };

export type Handler = (
  ctx: AdminContext,
  req: Request,
  params: RouteParams
) => Promise<unknown>;
