import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { readBearer } from "@/lib/admin/server";
import { verifyActiveSession, createUserClient } from "@/lib/auth/supabaseServer";
import {
  dbConfirmOccurrence,
  dbCreateRule,
  dbDeleteRule,
  dbGetRule,
  dbListPending,
  dbListRules,
  dbProcessDue,
  dbSetStatus,
  dbSkipOccurrence,
  dbUpdateRule,
  matchRecurringRoute,
  parseListType,
} from "@/lib/recurringServer";
import { logger } from "@/lib/logger";
import { assertNotUnderMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

/**
 * /api/v1/recurring/* — recurring-transactions API.
 *
 * Auth: Bearer session JWT, validated by `verifyActiveSession` (invalid /
 * expired / suspended / password-invalidated sessions are rejected). All data
 * access flows through a user-scoped client, so RLS enforces row ownership at
 * the database level. Balance-affecting writes are SECURITY DEFINER RPCs.
 *
 * Routes (slug after /api/v1/recurring):
 *   GET    /                     list rules (optional ?type=expense|income|transfer)
 *   POST   /                     create a rule
 *   GET    /pending              pending confirmation occurrences
 *   POST   /pending/:id/confirm  confirm + generate a pending occurrence
 *   POST   /pending/:id/skip     skip a pending occurrence
 *   GET    /:id                  fetch one rule
 *   PATCH  /:id                  update a rule
 *   DELETE /:id                  delete a rule
 *   POST   /:id/status           change status { status: "paused" | "active" | "cancelled" }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    const route = matchRecurringRoute("GET", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "list") {
      return dbListRules(client, user.id, parseListType(new URL(req.url).searchParams.get("type")));
    }
    if (route.kind === "pending") {
      return dbListPending(client, user.id);
    }
    if (route.kind === "get") {
      return dbGetRule(client, user.id, route.id);
    }
    return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    await assertNotUnderMaintenance({ route: "/api/v1/recurring", method: "POST", userId: user.id });
    const route = matchRecurringRoute("POST", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "create") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const rule = await dbCreateRule(client, user.id, body);
      // Start generating immediately so a start date of today is honored.
      await dbProcessDue(client, user.id).catch(() => null);
      return json(rule, 201);
    }
    if (route.kind === "confirm") {
      return dbConfirmOccurrence(client, route.occurrenceId);
    }
    if (route.kind === "skip") {
      return dbSkipOccurrence(client, route.occurrenceId);
    }
    if (route.kind === "status") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      return dbSetStatus(client, user.id, route.id, body.status);
    }
    return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    await assertNotUnderMaintenance({ route: "/api/v1/recurring", method: "PATCH", userId: user.id });
    const route = matchRecurringRoute("PATCH", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    if (route.kind !== "update") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return dbUpdateRule(client, user.id, route.id, body);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    await assertNotUnderMaintenance({ route: "/api/v1/recurring", method: "DELETE", userId: user.id });
    const route = matchRecurringRoute("DELETE", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    if (route.kind !== "delete") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    return dbDeleteRule(client, user.id, route.id);
  });
}

async function authorize(req: Request): Promise<{ user: { id: string }; client: ReturnType<typeof createUserClient> }> {
  const token = readBearer(req);
  if (!token) throw new AuthApiError(401, "Authentication required.", "unauthorized");
  const user = await verifyActiveSession(token);
  if (!user) {
    logger.warn("recurring-api", "unauthorized", { ip: req.headers.get("x-forwarded-for") ?? undefined });
    throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
  }
  return { user: { id: user.id }, client: createUserClient(token) };
}
