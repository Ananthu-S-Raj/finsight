import { AuthApiError, json, runApi } from "@/lib/auth/errors";
import { readBearer } from "@/lib/admin/server";
import { verifyActiveSession, createUserClient } from "@/lib/auth/supabaseServer";
import {
  dbCancelBill,
  dbCreateBill,
  dbDeleteBill,
  dbGetBill,
  dbListBills,
  dbListPayments,
  dbListReminders,
  dbMarkPaid,
  dbUpdateBill,
  matchBillRoute,
  parseListStatus,
} from "@/lib/billsServer";
import { logger } from "@/lib/logger";
import { assertNotUnderMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

/**
 * /api/v1/bills/* — bills API.
 *
 * Auth: Bearer session JWT, validated by `verifyActiveSession` (invalid /
 * expired / suspended / password-invalidated sessions are rejected). All data
 * access flows through a user-scoped client, so RLS enforces row ownership at
 * the database level. Marking a bill paid is a SECURITY DEFINER RPC.
 *
 * Routes (slug after /api/v1/bills):
 *   GET    /                list bills (optional ?status=)
 *   POST   /                create a bill
 *   GET    /payments        payment history
 *   GET    /reminders       fired reminders (optional ?since=ISO timestamp)
 *   POST   /:id/paid        mark paid { create_expense: boolean }
 *   POST   /:id/cancel      cancel a bill
 *   GET    /:id             fetch one bill
 *   PATCH  /:id             update a bill
 *   DELETE /:id             delete a bill (blocked when it has payment history)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    const route = matchBillRoute("GET", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "list") {
      return dbListBills(client, user.id, parseListStatus(new URL(req.url).searchParams.get("status")));
    }
    if (route.kind === "payments") {
      return dbListPayments(client, user.id);
    }
    if (route.kind === "reminders") {
      return dbListReminders(
        client,
        user.id,
        new URL(req.url).searchParams.get("since") ?? undefined
      );
    }
    if (route.kind === "get") {
      return dbGetBill(client, user.id, route.id);
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
    await assertNotUnderMaintenance({ route: "/api/v1/bills", method: "POST", userId: user.id });
    const route = matchBillRoute("POST", slug ?? []);
    if (!route) return json({ error: "Not found.", code: "not_found", status: 404 }, 404);

    if (route.kind === "create") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const bill = await dbCreateBill(client, user.id, body);
      return json(bill, 201);
    }
    if (route.kind === "paid") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      return dbMarkPaid(client, user.id, route.id, Boolean(body.create_expense));
    }
    if (route.kind === "cancel") {
      return dbCancelBill(client, user.id, route.id);
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
    await assertNotUnderMaintenance({ route: "/api/v1/bills", method: "PATCH", userId: user.id });
    const route = matchBillRoute("PATCH", slug ?? []);
    if (!route || route.kind !== "update") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return dbUpdateBill(client, user.id, route.id, body);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
): Promise<Response> {
  const { slug } = await params;
  return runApi(async () => {
    const { user, client } = await authorize(req);
    await assertNotUnderMaintenance({ route: "/api/v1/bills", method: "DELETE", userId: user.id });
    const route = matchBillRoute("DELETE", slug ?? []);
    if (!route || route.kind !== "delete") {
      return json({ error: "Not found.", code: "not_found", status: 404 }, 404);
    }
    return dbDeleteBill(client, user.id, route.id);
  });
}

async function authorize(req: Request): Promise<{ user: { id: string }; client: ReturnType<typeof createUserClient> }> {
  const token = readBearer(req);
  if (!token) throw new AuthApiError(401, "Authentication required.", "unauthorized");
  const user = await verifyActiveSession(token);
  if (!user) {
    logger.warn("bills-api", "unauthorized", { ip: req.headers.get("x-forwarded-for") ?? undefined });
    throw new AuthApiError(401, "Session is invalid, expired, or this account is not active.", "unauthorized");
  }
  return { user: { id: user.id }, client: createUserClient(token) };
}
