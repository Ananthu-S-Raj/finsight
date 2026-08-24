import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { readBearer } from "@/lib/admin/server";
import { verifyActiveSession, createUserClient } from "@/lib/auth/supabaseServer";
import { parseSearchParams } from "@/lib/transactions";
import { dbListTransactions } from "@/lib/transactionsServer";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * /api/v1/transactions — paginated, filtered transaction list.
 *
 * Auth: Bearer session JWT (see `verifyActiveSession`). Data flows through a
 * user-scoped client so RLS enforces row ownership.
 *
 * Query params (all optional):
 *   search=swiggy  free-text, multiple space-separated terms
 *   range=[2026-01-01,2026-02-01)  half-open date range (or [2026-01-01 open)
 *   type=expense   one of the transaction types
 *   category=Food  exact category name
 *   min=100        minimum amount
 *   max=500        maximum amount
 *   order=date|amount  sort field
 *   direction=asc|desc sort direction
 *   limit=N        page size (default 25, max 100)
 *   after=<cursor> opaque pagination cursor from a previous response
 */
export async function GET(req: Request): Promise<Response> {
  return runApi(async () => {
    const { user, client } = await authorize(req);
    const url = new URL(req.url);
    const parsed = parseSearchParams(url.searchParams);
    if (!parsed.valid) {
      return json({ error: "Invalid pagination cursor.", code: "bad_request", status: 400 }, 400);
    }
    return dbListTransactions(client, user.id, parsed.filters, parsed.cursor, parsed.limit);
  });
}

async function authorize(req: Request): Promise<{ user: { id: string }; client: ReturnType<typeof createUserClient> }> {
  const token = readBearer(req);
  if (!token) throw new AuthApiError(401, "Authentication required.", "unauthorized");
  const user = await verifyActiveSession(token);
  if (!user) {
    logger.warn("transactions-api", "unauthorized", { ip: req.headers.get("x-forwarded-for") ?? undefined });
    throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
  }
  return { user: { id: user.id }, client: createUserClient(token) };
}
