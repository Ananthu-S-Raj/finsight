import { createAnonClient } from "@/lib/auth/supabaseServer";
import {
  GENERIC_RESET_MESSAGE,
  requestPasswordReset,
} from "@/lib/auth/passwordReset";
import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { passwordResetRateLimiter } from "@/lib/rateLimit";
import { getIp } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/forgot-password
 * { "email": "user@example.com" }
 *
 * Always returns the same generic message — whether or not the account
 * exists — to prevent email enumeration. Rate limited per IP and per email.
 */
export async function POST(req: Request): Promise<Response> {
  return runApi(async () => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      throw new AuthApiError(400, "Email is required.", "bad_request");
    }

    const ip = getIp(req) ?? "unknown";
    const userAgent = req.headers.get("user-agent");

    const ipResult = passwordResetRateLimiter.check(`ip:${ip}`);
    const emailResult = passwordResetRateLimiter.check(`email:${email}`);
    if (!ipResult.ok || !emailResult.ok) {
      const retry = Math.max(ipResult.retryAfterSeconds, emailResult.retryAfterSeconds);
      return json(
        {
          error: "Too many password reset requests. Please try again later.",
          code: "rate_limited",
          status: 429,
          retryAfterSeconds: retry,
        },
        429
      );
    }

    await requestPasswordReset(createAnonClient(), { email, ip, userAgent });
    return json({ message: GENERIC_RESET_MESSAGE });
  });
}
