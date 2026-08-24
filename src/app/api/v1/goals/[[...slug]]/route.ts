import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { readBearer } from "@/lib/admin/server";
import { verifyActiveSession, createUserClient } from "@/lib/auth/supabaseServer";
import {
  dbContributeToGoal,
  dbCreateGoal,
  dbDeleteGoal,
  dbGetGoal,
  dbListContributions,
  dbListGoals,
  dbListReminders,
  dbRemoveContribution,
  dbSetGoalStatus,
  dbUpdateGoal,
  matchGoalRoute,
  parseGoalListStatus,
} from "@/lib/goalsServer";
import { logger } from "@/lib/logger";
import { assertNotUnderMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

/**
 * /api/v1/goals/* — financial goals API.
 *
 * Auth: Bearer session JWT, validated by `verifyActiveSession` (invalid /
 * expired / suspended / password-invalidated sessions are rejected). All data
 * access flows through a user-scoped client, so RLS enforces row ownership at
 * the database level. Contributions go through SECURITY DEFINER RPCs so the
 * goal ledger stays the single source of truth for progress.
 *
 * Routes (slug after /api/v1/goals):
 *   GET    /                         list goals (optional ?status=)
 *   POST   /                         create a goal
 *   GET    /reminders                fired reminders (optional ?since=ISO)
 *   GET    /:id                      fetch one goal
 *   PATCH  /:id                      update a goal
 *   DELETE /:id                      delete a goal (blocked with history)
 *   POST   /:id/contribute           add a contribution { amount, note }
 *   GET    /:id/contributions        contribution history
 *   DELETE /:id/contributions/:cid   remove one contribution (correction)
 *   POST   /:id/status               set status { status: active|paused|cancelled }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    const route = matchGoalRoute("GET", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "list") {
      return dbListGoals(
        client,
        user.id,
        parseGoalListStatus(new URL(req.url).searchParams.get("status"))
      );
    }
    if (route.kind === "reminders") {
      return dbListReminders(
        client,
        user.id,
        new URL(req.url).searchParams.get("since") ?? undefined
      );
    }
    if (route.kind === "get") {
      return dbGetGoal(client, user.id, route.id);
    }
    if (route.kind === "contributions") {
      return dbListContributions(client, user.id, route.id);
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
    await assertNotUnderMaintenance({ route: "/api/v1/goals", method: "POST", userId: user.id });
    const route = matchGoalRoute("POST", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "create") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const goal = await dbCreateGoal(client, user.id, body);
      return json(goal, 201);
    }
    if (route.kind === "contribute") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      return dbContributeToGoal(client, user.id, route.id, body);
    }
    if (route.kind === "set_status") {
      const body = (await req.json().catch(() => ({}))) as { status?: string };
      const status = body.status as "active" | "paused" | "completed" | "cancelled";
      return dbSetGoalStatus(client, user.id, route.id, status);
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
    await assertNotUnderMaintenance({ route: "/api/v1/goals", method: "PATCH", userId: user.id });
    const route = matchGoalRoute("PATCH", slug ?? []);
    if (!route || route.kind !== "update") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return dbUpdateGoal(client, user.id, route.id, body);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    await assertNotUnderMaintenance({ route: "/api/v1/goals", method: "DELETE", userId: user.id });
    const route = matchGoalRoute("DELETE", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "delete") {
      return dbDeleteGoal(client, user.id, route.id);
    }
    if (route.kind === "remove_contribution") {
      return dbRemoveContribution(client, user.id, route.id, route.contributionId);
    }
    return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
  });
}

async function authorize(req: Request): Promise<{ user: { id: string }; client: ReturnType<typeof createUserClient> }> {
  const token = readBearer(req);
  if (!token) throw new AuthApiError(401, "Authentication required.", "unauthorized");
  const user = await verifyActiveSession(token);
  if (!user) {
    logger.warn("goals-api", "unauthorized", { ip: req.headers.get("x-forwarded-for") ?? undefined });
    throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
  }
  return { user: { id: user.id }, client: createUserClient(token) };
}
