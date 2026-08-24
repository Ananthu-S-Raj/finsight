import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { readBearer } from "@/lib/admin/server";
import { verifyActiveSession, createUserClient } from "@/lib/auth/supabaseServer";
import { dbListCategories } from "@/lib/categoriesServer";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * /api/v1/categories — the canonical, admin-managed category list.
 *
 * GET / — list all categories (pickers filter to enabled top-level expense
 * categories client-side).
 */
export async function GET(req: Request): Promise<Response> {
  return runApi(async () => {
    const { client } = await authorize(req);
    return dbListCategories(client);
  });
}

async function authorize(req: Request): Promise<{ user: { id: string }; client: ReturnType<typeof createUserClient> }> {
  const token = readBearer(req);
  if (!token) throw new AuthApiError(401, "Authentication required.", "unauthorized");
  const user = await verifyActiveSession(token);
  if (!user) {
    logger.warn("categories-api", "unauthorized", { ip: req.headers.get("x-forwarded-for") ?? undefined });
    throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
  }
  return { user: { id: user.id }, client: createUserClient(token) };
}
