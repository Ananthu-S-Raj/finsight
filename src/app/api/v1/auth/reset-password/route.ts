import { createAnonClient } from "@/lib/auth/supabaseServer";
import { completePasswordReset } from "@/lib/auth/passwordReset";
import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { passwordResetConsumeLimiter } from "@/lib/rateLimit";
import { getIp } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/reset-password
 * { "token": "...", "new_password": "..." }
 *
 * Success: { "message": "Password reset successful." }
 * Failure: weak password, invalid / expired / already-used token.
 */
export async function POST(req: Request): Promise<Response> {
  return runApi(async () => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    if (!token || !newPassword) {
      throw new AuthApiError(400, "Token and new_password are required.", "bad_request");
    }

    const ip = getIp(req) ?? "unknown";
    const consumeResult = passwordResetConsumeLimiter.check(`consume-ip:${ip}`);
    if (!consumeResult.ok) {
      return json(
        {
          error: "Too many reset attempts. Please try again later.",
          code: "rate_limited",
          status: 429,
          retryAfterSeconds: consumeResult.retryAfterSeconds,
        },
        429
      );
    }

    const result = await completePasswordReset(createAnonClient(), {
      token,
      newPassword,
      ip,
      userAgent: req.headers.get("user-agent"),
    });

    return json({ message: "Password reset successful." }, 200);
  });
}
