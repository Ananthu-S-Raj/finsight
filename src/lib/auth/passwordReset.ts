import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePassword } from "./passwordPolicy";
import { AuthApiError } from "./errors";
import { getBaseUrl } from "./supabaseServer";

/**
 * Password reset / change logic.
 *
 * Token engine: Supabase's built-in password-recovery flow is used as the
 * existing auth + email infrastructure. The recovery email link carries the
 * recovery token to `/reset-password?token=...`; this module validates it
 * with `verifyOtp({ type: "recovery" })`, updates the password via the
 * existing auth service, and records a SHA-256 hash of the token in
 * `password_reset_tokens` for single-use/audit tracking.
 *
 * Raw tokens are never stored anywhere.
 */

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const ADMIN_RESET_AUDIT_ACTION = "ADMIN_PASSWORD_RESET_COMPLETED";
export const ADMIN_CHANGE_AUDIT_ACTION = "ADMIN_PASSWORD_CHANGE_COMPLETED";

export const GENERIC_RESET_MESSAGE =
  "If an account exists with this email, a password reset link has been sent.";

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type RequestInfo = { email: string; ip?: string | null; userAgent?: string | null };

/**
 * Step 1 — request a reset link. Always returns the same generic message,
 * whether or not the email exists (no account enumeration). The record-keeping
 * RPC and the Supabase reset email are both fired regardless of existence so
 * responses (and timing) stay uniform.
 */
export async function requestPasswordReset(
  client: SupabaseClient,
  { email, ip = null, userAgent = null }: RequestInfo
): Promise<{ message: string }> {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new AuthApiError(400, "Email is required.", "bad_request");
  }

  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  // Record a pending request row (only created when the email maps to a real
  // account). Errors are ignored — the response must not depend on it.
  await client
    .rpc("request_password_reset", {
      p_email: normalized,
      p_expires_at: expiresAt,
      p_ip: ip,
      p_user_agent: userAgent,
    })
    .then(() => null, () => null);

  // Supabase sends the recovery email. It does not reveal whether the email
  // exists, so this is safe to always call.
  await client.auth
    .resetPasswordForEmail(normalized, { redirectTo: `${getBaseUrl()}/reset-password` })
    .catch(() => null);

  return { message: GENERIC_RESET_MESSAGE };
}

type CompleteInfo = {
  token: string;
  newPassword: string;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Step 2 — consume the recovery token and set a new password.
 * Rejects: weak passwords, invalid/expired/used tokens, and tokens that were
 * not issued by this application.
 */
export async function completePasswordReset(
  client: SupabaseClient,
  { token, newPassword, ip = null, userAgent = null }: CompleteInfo
): Promise<{ message: string; userId: string; email: string | null }> {
  const tokenValue = String(token ?? "").trim();
  if (!tokenValue) {
    throw new AuthApiError(400, "Missing password reset token.", "bad_request");
  }

  const weak = validatePassword(newPassword);
  if (weak) {
    throw new AuthApiError(400, weak, "weak_password");
  }

  // Supabase validates the token itself: expired / already-used / invalid
  // tokens are rejected here.
  const { data, error } = await client.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenValue,
  });
  if (error || !data?.user) {
    throw new AuthApiError(
      400,
      "This reset link is invalid or has expired.",
      "invalid_token"
    );
  }

  const userId = data.user.id as string;
  const email = (data.user.email as string | null) ?? null;
  const tokenHash = await sha256Hex(tokenValue);

  // Bind the token to a request row issued by this app. Returns false when
  // there is no matching pending request (not issued by us), when it already
  // has been used, or when it has passed the 30-minute window.
  const bound = await client.rpc("mark_password_reset_token_used", {
    p_user_id: userId,
    p_token_hash: tokenHash,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (bound.error || bound.data !== true) {
    throw new AuthApiError(
      400,
      "This reset link is invalid, has expired, or has already been used.",
      "invalid_token"
    );
  }

  // Update the password through the existing auth service (recovery session).
  const { error: updateError } = await client.auth.updateUser({ password: newPassword });
  if (updateError) {
    throw new AuthApiError(500, "Could not update your password. Please try again.", "update_failed");
  }

  // Invalidate every session issued before this moment (JWT iat guard).
  await client.rpc("set_password_changed_at").then(() => null, () => null);

  await maybeAuditAdminReset(client, { userId, email, tokenHash, ip, userAgent });

  return { message: "Password reset successful.", userId, email };
}

async function maybeAuditAdminReset(
  client: SupabaseClient,
  ctx: { userId: string; email: string | null; tokenHash: string; ip: string | null; userAgent: string | null }
): Promise<void> {
  const { data: profile, error } = await client
    .from("profiles")
    .select("role")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error || !profile || profile.role !== "admin") return;

  const { error: auditError } = await client.from("audit_logs").insert({
    actor_id: ctx.userId,
    actor_email: ctx.email,
    action: ADMIN_RESET_AUDIT_ACTION,
    resource_type: "auth",
    resource_id: ctx.userId,
    target_user_id: ctx.userId,
    target_email: ctx.email,
    metadata: {
      method: "reset",
      token_hash_prefix: ctx.tokenHash.slice(0, 8),
      token_ttl_minutes: RESET_TOKEN_TTL_MS / 60000,
    },
    ip: ctx.ip,
    user_agent: ctx.userAgent,
    result: "success",
  });
  if (auditError) {
    throw new AuthApiError(500, "Password updated, but the audit record could not be saved.", "audit_failed");
  }
}

type ChangeInfo = {
  email: string;
  currentPassword: string;
  newPassword: string;
};

/**
 * Authenticated password change. The current password is verified by signing
 * in, then the new password is applied via the existing auth service. The
 * acting (current) session stays valid.
 */
export async function changePassword(
  anonClient: SupabaseClient,
  { email, currentPassword, newPassword }: ChangeInfo
): Promise<{ message: string }> {
  if (typeof email !== "string" || !email) {
    throw new AuthApiError(400, "Cannot verify the current password without an email.", "bad_request");
  }
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new AuthApiError(400, "Current password is required.", "bad_request");
  }
  if (typeof newPassword !== "string" || newPassword.length === 0) {
    throw new AuthApiError(400, "New password is required.", "bad_request");
  }
  const weak = validatePassword(newPassword);
  if (weak) {
    throw new AuthApiError(400, weak, "weak_password");
  }
  if (currentPassword === newPassword) {
    throw new AuthApiError(
      400,
      "New password must be different from the current password.",
      "same_password"
    );
  }

  const { error: signError } = await anonClient.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signError) {
    throw new AuthApiError(401, "Current password is incorrect.", "bad_credentials");
  }

  const { error: updateError } = await anonClient.auth.updateUser({ password: newPassword });
  if (updateError) {
    throw new AuthApiError(500, "Could not update your password. Please try again.", "update_failed");
  }

  // Invalidate every session issued before this moment (JWT iat guard).
  // The acting browser re-authenticates with the new password right after,
  // so the current device stays signed in while all other sessions die.
  await anonClient.rpc("set_password_changed_at").then(() => null, () => null);

  await maybeAuditAdminChange(anonClient);
  return { message: "Password changed successfully." };
}

async function maybeAuditAdminChange(client: SupabaseClient): Promise<void> {
  const { data: user, error } = await client.auth.getUser().catch(() => ({ data: null, error: { message: "unavailable" } }));
  if (error || !user?.user) return;

  const profile = await client.from("profiles").select("role").eq("id", user.user.id).maybeSingle();
  if (profile.error || !profile.data || profile.data.role !== "admin") return;

  await client.from("audit_logs").insert({
    actor_id: user.user.id,
    actor_email: user.user.email ?? null,
    action: ADMIN_CHANGE_AUDIT_ACTION,
    resource_type: "auth",
    resource_id: user.user.id,
    target_user_id: user.user.id,
    target_email: user.user.email ?? null,
    metadata: { method: "change" },
    result: "success",
  });
}
