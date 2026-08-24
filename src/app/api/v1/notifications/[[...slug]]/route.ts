import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { readBearer } from "@/lib/admin/server";
import { verifyActiveSession, createUserClient } from "@/lib/auth/supabaseServer";
import {
  dbListBroadcasts,
  dbMarkBroadcastRead,
  matchBroadcastRoute,
} from "@/lib/notificationsServer";
import { logger } from "@/lib/logger";
import { assertNotUnderMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

/**
 * /api/v1/notifications/* — the user-facing inbox for admin broadcasts.
 *
 * Auth: Bearer session JWT, validated by verifyActiveSession (invalid /
 * expired / suspended / password-invalidated sessions are rejected). All
 * data access flows through a user-scoped client, so the RLS policies on
 * admin_notifications + notification_reads enforce both audience targeting
 * and per-user read-marker ownership at the database level.
 *
 * Routes (slug after /api/v1/notifications):
 *   GET  /            list sent broadcasts (optional ?page=&pageSize=)
 *   POST /:id/read    mark one broadcast as read for this user
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    const route = matchBroadcastRoute("GET", slug ?? []);
    if (!route || route.kind !== "list") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    const sp = new URL(req.url).searchParams;
    return dbListBroadcasts(client, user.id, sp.get("page"), sp.get("pageSize"));
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    await assertNotUnderMaintenance({ route: "/api/v1/notifications", method: "POST", userId: user.id });
    const route = matchBroadcastRoute("POST", slug ?? []);
    if (!route || route.kind !== "read") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    return dbMarkBroadcastRead(client, user.id, route.id);
  });
}

async function authorize(req: Request): Promise<{ user: { id: string }; client: ReturnType<typeof createUserClient> }> {
  const token = readBearer(req);
  if (!token) throw new AuthApiError(401, "Authentication required.", "unauthorized");
  const user = await verifyActiveSession(token);
  if (!user) {
    logger.warn("notifications-api", "unauthorized", { ip: req.headers.get("x-forwarded-for") ?? undefined });
    throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
  }
  return { user: { id: user.id }, client: createUserClient(token) };
}
