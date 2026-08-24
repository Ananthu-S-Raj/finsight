import { changePassword } from "@/lib/auth/passwordReset";
import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { createAnonClient, verifyActiveSession } from "@/lib/auth/supabaseServer";
import { readBearer } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/change-password
 * Requires: Authorization: Bearer <session jwt>
 * { "current_password": "...", "new_password": "..." }
 *
 * Success: { "message": "Password changed successfully." }
 * The current session stays signed in; the new password takes effect
 * immediately.
 */
export async function POST(req: Request): Promise<Response> {
  return runApi(async () => {
    const token = readBearer(req);
    if (!token) {
      throw new AuthApiError(401, "Authentication required.", "unauthorized");
    }

    // Password changes require an active session: the token must be valid and
    // unexpired, the account must not be suspended/disabled, and the session
    // must not predate the account's last password change/reset.
    const user = await verifyActiveSession(token);
    if (!user) {
      throw new AuthApiError(
        401,
        "Session is invalid, expired, or this account is not active. Please sign in again.",
        "unauthorized"
      );
    }
    if (!user.email) {
      throw new AuthApiError(400, "Cannot change the password without an email on this account.", "bad_request");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const result = await changePassword(createAnonClient(), {
      email: user.email,
      currentPassword: typeof body.current_password === "string" ? body.current_password : "",
      newPassword: typeof body.new_password === "string" ? body.new_password : "",
    });

    return json({ message: result.message });
  });
}
