// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/admin/server";
import {
  createMockClient,
  type MockClient,
  type MockQueryOptions,
} from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";
import { matchRoute, adminRoutes } from "@/lib/admin/handlers";
import { deleteNotification } from "@/lib/admin/handlers/notifications";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const NOTIF_ID = "00000000-0000-4000-8000-000000000042";

function notifTables(status = "sent"): MockQueryOptions["tables"] {
  return {
    profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active" }],
    push_subscriptions: [],
    admin_notifications: [
      {
        id: NOTIF_ID,
        title: "Maintenance window",
        body: "We will be brief.",
        audience: "users",
        channel: "inapp",
        target_user_ids: null,
        status,
        error: null,
        created_by: ADMIN_ID,
        created_at: "2026-08-20T10:00:00Z",
        sent_at: status === "sent" ? "2026-08-20T11:00:00Z" : null,
      },
    ],
    audit_logs: [],
  };
}

function makeCtx(
  client: MockClient,
  permissions: PermissionCode[] = [...ALL_PERMISSIONS]
): AdminContext {
  return {
    userId: ADMIN_ID,
    email: "admin@finsight.app",
    role: "admin",
    permissions,
    token: "valid-token",
    ip: "127.0.0.1",
    userAgent: "vitest",
    client: client as never,
  };
}

/** Wraps the mock so audit inserts always fail — exercises writeAudit's
 *  throw-on-failure contract without touching the shared helper. */
function ctxWithFailingAudit(client: MockClient): AdminContext {
  const base = makeCtx(client);
  const failingQuery = {
    insert() {
      return failingQuery;
    },
    select() {
      return failingQuery;
    },
    then(res: (v: unknown) => unknown) {
      return Promise.resolve({ data: null, error: { message: "audit store down" } }).then(res);
    },
  };
  const scoped = {
    from(table: string) {
      if (table === "audit_logs") return failingQuery;
      return (base.client as unknown as MockClient).from(table);
    },
  };
  return { ...base, client: scoped as never };
}

function req(method: string, body?: unknown): Request {
  return new Request("http://localhost", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectApiError(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
    expect.unreachable("expected ApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    if (status !== undefined) expect((err as ApiError).status).toBe(status);
    if (code !== undefined) expect((err as ApiError).code).toBe(code);
  }
}

describe("notification deletion (G-04)", () => {
  it("deletes a sent notification with explicit confirmation and audits once", async () => {
    const client = createMockClient({ tables: notifTables("sent") });
    const result = (await deleteNotification(
      makeCtx(client),
      req("DELETE", { confirm: "DELETE" }),
      { id: NOTIF_ID }
    )) as Record<string, unknown>;
    expect(result.deleted).toBe(true);
    // Row is gone.
    expect(client.tables.admin_notifications).toHaveLength(0);

    // Exactly one awaited audit row for this action.
    const audits = client.writes.filter(
      (w) => w.table === "audit_logs" && w.kind === "insert"
    );
    expect(audits).toHaveLength(1);
    const payload = audits[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("notification.delete");
    expect(payload.resource_type).toBe("notification");
    expect(payload.resource_id).toBe(NOTIF_ID);
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.previous_status).toBe("sent");
    expect(meta.title).toBe("Maintenance window");
    expect(meta.audience).toBe("users");
    expect(meta.channel).toBe("inapp");
  });

  it("deletes a cancelled notification (terminal state)", async () => {
    const client = createMockClient({ tables: notifTables("cancelled") });
    const result = (await deleteNotification(
      makeCtx(client),
      req("DELETE", { confirm: "DELETE" }),
      { id: NOTIF_ID }
    )) as Record<string, unknown>;
    expect(result.deleted).toBe(true);
    expect(client.tables.admin_notifications).toHaveLength(0);
    const meta = (
      client.writes.find((w) => w.table === "audit_logs")!.payload as Record<string, unknown>
    ).metadata as Record<string, unknown>;
    expect(meta.previous_status).toBe("cancelled");
  });

  it("rejects deleting a draft (409 bad_state) without mutating", async () => {
    const client = createMockClient({ tables: notifTables("draft") });
    await expectApiError(
      deleteNotification(makeCtx(client), req("DELETE", { confirm: "DELETE" }), { id: NOTIF_ID }),
      409,
      "bad_state"
    );
    expect(client.tables.admin_notifications).toHaveLength(1);
    expect(client.writes.length).toBe(0);
  });

  it("rejects non-terminal in-flight states ('sending', 'failed') without mutating", async () => {
    for (const status of ["sending", "failed"]) {
      const client = createMockClient({ tables: notifTables(status) });
      await expectApiError(
        deleteNotification(makeCtx(client), req("DELETE", { confirm: "DELETE" }), { id: NOTIF_ID }),
        409,
        "bad_state"
      );
      expect(client.tables.admin_notifications).toHaveLength(1);
      expect(client.writes.length).toBe(0);
    }
  });

  it("rejects an invalid UUID with 400 before any query", async () => {
    const client = createMockClient({ tables: notifTables() });
    await expectApiError(
      deleteNotification(makeCtx(client), req("DELETE", { confirm: "DELETE" }), { id: "not-a-uuid" }),
      400
    );
    expect(client.writes.length).toBe(0);
  });

  it("returns 404 for a missing notification and writes nothing", async () => {
    const client = createMockClient({ tables: notifTables() });
    await expectApiError(
      deleteNotification(
        makeCtx(client),
        req("DELETE", { confirm: "DELETE" }),
        { id: "00000000-0000-4000-8000-000000000099" }
      ),
      404,
      "not_found"
    );
    expect(client.writes.length).toBe(0);
  });

  it("blocks deletion without NOTIFICATION_MANAGE (403) with no mutation and no audit", async () => {
    const client = createMockClient({ tables: notifTables() });
    await expectApiError(
      deleteNotification(makeCtx(client, ["USER_VIEW"]), req("DELETE", { confirm: "DELETE" }), {
        id: NOTIF_ID,
      }),
      403,
      "forbidden"
    );
    expect(client.tables.admin_notifications).toHaveLength(1);
    expect(client.writes.length).toBe(0);
  });

  it("requires the explicit destructive confirmation (missing/wrong → 400) with no mutation", async () => {
    for (const body of [undefined, {}, { confirm: "delete" }, { confirm: "YES" }]) {
      const client = createMockClient({ tables: notifTables() });
      await expectApiError(
        deleteNotification(makeCtx(client), req("DELETE", body), { id: NOTIF_ID }),
        400,
        "confirmation_required"
      );
      expect(client.tables.admin_notifications).toHaveLength(1);
      expect(client.writes.length).toBe(0);
    }
  });

  it("surfaces audit_failed when the audit insert fails — after the row was removed", async () => {
    const client = createMockClient({ tables: notifTables("sent") });
    await expectApiError(
      deleteNotification(ctxWithFailingAudit(client), req("DELETE", { confirm: "DELETE" }), {
        id: NOTIF_ID,
      }),
      500,
      "audit_failed"
    );
    // The mutation itself went through; only the audit record failed.
    expect(client.tables.admin_notifications).toHaveLength(0);
    const del = client.writes.find((w) => w.table === "admin_notifications" && w.kind === "delete");
    expect(del).toBeDefined();
  });

  it("registers the DELETE notifications/:id route", () => {
    expect(matchRoute(["notifications", NOTIF_ID], "DELETE")).not.toBeNull();
    expect(
      adminRoutes.some(
        (r) =>
          r.method === "DELETE" &&
          r.segments.length === 2 &&
          r.segments[0] === "notifications" &&
          r.segments[1] === ":id"
      )
    ).toBe(true);
  });
});
