import { loadAIConfig } from "@/lib/ai/config";
import { generateInsights, type TransactionRow } from "@/lib/ai/service";
import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { createUserClient, verifyActiveSession } from "@/lib/auth/supabaseServer";
import { aiIpLimiter, aiUserLimiter } from "@/lib/rateLimit";
import { getIp, readBearer } from "@/lib/admin/server";
import { assertNotUnderMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/**
 * POST /api/v1/ai/insights
 * Requires: Authorization: Bearer <session jwt>
 * Optional body: { "month": "2026-08" }
 *
 * Aggregates the caller's own transactions into a privacy-filtered month
 * summary and asks the configured AI provider for a plain-language overview.
 * Only aggregated numbers and category names leave the server.
 *
 * Success:  { "available": true, "insights": "...", "provider": "openai",
 *             "model": "gpt-4o-mini", "latency_ms": 1234 }
 * Fallback: { "available": false, "message": "...", "code": "..." }  (HTTP 200)
 */
export async function POST(req: Request): Promise<Response> {
  return runApi(async () => {
    const token = readBearer(req);
    if (!token) {
      throw new AuthApiError(401, "Authentication required.", "unauthorized");
    }

    const user = await verifyActiveSession(token);
    if (!user) {
      throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
    }

    await assertNotUnderMaintenance({ route: "/api/v1/ai/insights", method: "POST", userId: user.id });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const month =
      typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month)
        ? body.month
        : currentMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new AuthApiError(400, "Invalid month. Expected YYYY-MM.", "bad_request");
    }

    const ip = getIp(req) ?? "unknown";
    const userCheck = aiUserLimiter.check(`ai:${user.id}`);
    if (!userCheck.ok) {
      throw new AuthApiError(
        429,
        `Too many AI requests. Try again in ${userCheck.retryAfterSeconds}s.`,
        "rate_limited",
      );
    }
    const ipCheck = aiIpLimiter.check(`ai:ip:${ip}`);
    if (!ipCheck.ok) {
      throw new AuthApiError(
        429,
        `Too many AI requests. Try again in ${ipCheck.retryAfterSeconds}s.`,
        "rate_limited",
      );
    }

    const client = createUserClient(token);

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("monthly_budget")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      throw new AuthApiError(502, "Could not read account data.", "db_error");
    }
    const budget =
      profile && typeof profile.monthly_budget === "number" ? profile.monthly_budget : null;

    const { data: txns, error: txError } = await client
      .from("transactions")
      .select("id,type,amount,category,created_at")
      .gte("created_at", `${month}-01T00:00:00.000Z`)
      .lt("created_at", nextMonth(month))
      .order("created_at", { ascending: false })
      .limit(500);
    if (txError) {
      throw new AuthApiError(502, "Could not read transactions.", "db_error");
    }

    const aiConfig = loadAIConfig();
    if (!aiConfig.enabled) {
      return json({
        available: false,
        message: "AI insights are disabled on this deployment.",
        code: "not_configured",
      });
    }

    const result = await generateInsights((txns ?? []) as TransactionRow[], { month, budget });

    if (!result.available) {
      return json({ available: false, message: result.message, code: result.code });
    }

    return json({
      available: true,
      insights: result.insights,
      provider: result.provider,
      model: result.model,
      latency_ms: result.latencyMs,
    });
  });
}
