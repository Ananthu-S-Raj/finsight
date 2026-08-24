import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ApiError,
  authenticateRequest,
  handleRoute,
  readJsonBody,
} from "@/lib/admin/server";
import { matchRoute } from "@/lib/admin/handlers";
import {
  deleteTransaction,
  correctTransaction,
  flagTransaction,
  unflagTransaction,
} from "@/lib/admin/handlers/transactions";
import { updateUser } from "@/lib/admin/handlers/users";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/admin/handlers/categories";
import {
  createNotification,
  sendNotification,
  updateNotification,
} from "@/lib/admin/handlers/notifications";
import { updateSettings } from "@/lib/admin/handlers/settings";
import { overview } from "@/lib/admin/handlers/overview";
import { deletePushSubscription } from "@/lib/admin/handlers/push";
import { sanitizeText } from "@/lib/admin/handlers/helpers";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN2_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const TX_ID = "00000000-0000-4000-8000-000000000010";
const ROLE_ADMIN_ID = "00000000-0000-4000-8000-000000000031";
const ROLE_USER_ID = "00000000-0000-4000-8000-000000000032";

function permissionId(i: number): string {
  return `00000000-0000-4000-8000-${String(400000000000 + i).padStart(12, "0")}`;
}

function makeClient(opts: MockQueryOptions = {}): MockClient {
  const client = createMockClient(opts);
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);
  return client;
}

function makeAdminClient(overrides?: Partial<MockQueryOptions>): MockClient {
  return makeClient({
    user: { id: ADMIN_ID, email: "admin@finsight.app" },
    tables: {
      profiles: [
        { id: ADMIN_ID, email: "admin@finsight.app", full_name: "Admin One", role: "admin", account_status: "active", monthly_budget: 0, created_at: "2026-01-01T00:00:00Z", last_active_at: "2026-08-01T00:00:00Z" },
        { id: ADMIN2_ID, email: "admin2@finsight.app", full_name: "Admin Two", role: "admin", account_status: "active", monthly_budget: 0, created_at: "2026-01-02T00:00:00Z" },
        { id: USER_ID, email: "user@example.com", full_name: "Jane User", role: "user", account_status: "active", monthly_budget: 0, created_at: "2026-01-03T00:00:00Z" },
      ],
      transactions: [
        { id: TX_ID, user_id: USER_ID, type: "expense", category: "Food", amount: 120, note: "lunch", created_at: "2026-08-01T10:00:00Z", flagged: false },
      ],
      categories: [
        { id: "00000000-0000-4000-8000-000000000021", name: "Food", type: "expense", parent_id: null, is_default: true, is_disabled: false, sort_order: 1 },
      ],
      push_subscriptions: [],
      admin_notifications: [],
      audit_logs: [],
      app_settings: [
        { key: "general", value: { app_name: "FinSight", maintenance_mode: false } },
      ],
      roles: [
        { id: ROLE_ADMIN_ID, name: "admin", description: "", is_system: true },
        { id: ROLE_USER_ID, name: "user", description: "", is_system: true },
      ],
      permissions: ALL_PERMISSIONS.map((code, i) => ({
        id: permissionId(i),
        code,
        description: "",
      })),
      role_permissions: ALL_PERMISSIONS.map((code, i) => ({
        role_id: ROLE_ADMIN_ID,
        permission_id: permissionId(i),
      })),
    },
    rpc: {
      admin_auth_infos: (args: unknown) => {
        const ids = (args as { ids: string[] }).ids ?? [];
        return {
          data: ids.map((id) => ({
            user_id: id,
            email_confirmed_at: "2026-01-01T00:00:00Z",
            auth_created_at: "2026-01-01T00:00:00Z",
            last_sign_in_at: "2026-08-01T00:00:00Z",
          })),
          error: null,
        };
      },
      admin_user_stats: () => ({
        data: { total: 3, active: 3, disabled: 0, suspended: 0, admins: 2, verified: 3, unverified: 0 },
        error: null,
      }),
      admin_finance_stats: () => ({
        data: { transactions: 1, income: 0, expenses: 120, savings: 0, active_budgets: 0, credit_cards: 0, loans: 0, borrow_lend_entries: 0 },
        error: null,
      }),
      app_status: () => ({ data: [{ maintenance: false, app_name: "FinSight" }], error: null }),
    },
    ...overrides,
  });
}

function makeCtx(client: MockClient, permissions: PermissionCode[] = [...ALL_PERMISSIONS]): AdminContext {
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

function req(method: string, body?: unknown): Request {
  return new Request("http://localhost", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined || method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
  });
}

async function expectApiError(promise: Promise<unknown>, status: number, code?: string, message?: string) {
  try {
    await promise;
    expect.unreachable("expected ApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    if (status !== undefined) expect((err as ApiError).status).toBe(status);
    if (code !== undefined) expect((err as ApiError).code).toBe(code);
    if (message !== undefined) expect((err as ApiError).message).toContain(message);
  }
}

describe("admin authorization core", () => {
  it("rejects requests without a bearer token", async () => {
    const client = makeAdminClient();
    const result = await authenticateRequest(new Request("http://localhost"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(401);
      expect(result.error.code).toBe("unauthorized");
    }
    expect(client.writes.length).toBe(0);
  });

  it("rejects invalid or expired tokens", async () => {
    makeAdminClient({ getUserError: { message: "invalid token" } });
    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: "Bearer expired-token" } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(401);
  });

  it("rejects a valid session for a non-admin user (403)", async () => {
    makeAdminClient({ user: { id: USER_ID, email: "user@example.com" } });
    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: "Bearer user-token" } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(403);
      expect(result.error.code).toBe("forbidden");
    }
  });

  it("admits an administrator and loads permissions", async () => {
    const client = makeAdminClient();
    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: "Bearer admin-token" } })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe(ADMIN_ID);
      expect(result.ctx.role).toBe("admin");
      expect(result.ctx.permissions).toEqual(ALL_PERMISSIONS);
    }
  });

  it("fails closed with zero permissions when the RBAC matrix is unreadable (empty roles table)", async () => {
    makeAdminClient({
      tables: {
        profiles: [
          { id: ADMIN_ID, role: "admin", account_status: "active" },
          { id: ADMIN2_ID, role: "admin", account_status: "active" },
        ],
        roles: [],
        permissions: [],
        role_permissions: [],
        transactions: [],
        categories: [],
        push_subscriptions: [],
        admin_notifications: [],
        audit_logs: [],
        app_settings: [],
      },
    });
    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: "Bearer admin-token" } })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Matrix failure must yield zero permissions — never a full grant.
      expect(result.ctx.permissions).toEqual([]);
      expect(result.ctx.permissions).not.toEqual(ALL_PERMISSIONS);
    }
  });

  it("a protected endpoint returns 403 after matrix failure", async () => {
    makeAdminClient({ tables: { profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active" }] } });
    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: "Bearer admin-token" } })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expectApiError(
      matchRoute(["users"], "GET")!.handler(result.ctx, req("GET"), {}),
      403,
      "forbidden"
    );
  });

  it("an explicitly empty grant set for the admin role fails closed (no bootstrap escalation)", async () => {
    makeAdminClient({
      tables: {
        profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active" }],
        roles: [{ id: ROLE_ADMIN_ID, name: "admin", description: "", is_system: true }],
        permissions: ALL_PERMISSIONS.map((code, i) => ({ id: permissionId(i), code, description: "" })),
        role_permissions: [], // deliberately revoked
        transactions: [],
        categories: [],
        push_subscriptions: [],
        admin_notifications: [],
        audit_logs: [],
        app_settings: [],
      },
    });
    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: "Bearer admin-token" } })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.permissions).toEqual([]);
      expect(result.ctx.permissions).not.toEqual(ALL_PERMISSIONS);
    }
  });
});

describe("route dispatch", () => {
  it("matches routes and extracts params", () => {
    const match = matchRoute(["users", USER_ID], "PATCH");
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe(USER_ID);
  });

  it("returns null for unknown routes", () => {
    expect(matchRoute(["nope"], "GET")).toBeNull();
    expect(matchRoute(["users"], "DELETE")).toBeNull();
    expect(matchRoute(["users", USER_ID, "extra"], "GET")).toBeNull();
  });

  it("does not collide users/:id with transactions/:id", () => {
    const users = matchRoute(["users", USER_ID], "GET");
    const txs = matchRoute(["transactions", TX_ID], "PATCH");
    expect(users?.params.id).toBe(USER_ID);
    expect(txs?.params.id).toBe(TX_ID);
  });
});

describe("permission gating", () => {
  it("blocks user listing without USER_VIEW", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, []);
    await expectApiError(
      matchRoute(["users"], "GET")!.handler(ctx, req("GET", { page: "1" }), {}),
      403,
      "forbidden"
    );
  });

  it("blocks transaction deletion without TRANSACTION_DELETE", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, ["TRANSACTION_VIEW", "TRANSACTION_EDIT"]);
    await expectApiError(
      deleteTransaction(ctx, req("DELETE", { confirm: "DELETE" }), { id: TX_ID }),
      403,
      "forbidden"
    );
  });

  it("blocks settings changes without SYSTEM_SETTINGS", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, []);
    await expectApiError(
      updateSettings(ctx, req("PATCH", { app_name: "x" }), { group: "general" }),
      403,
      "forbidden"
    );
  });
});

describe("last-administrator protection", () => {
  it("refuses to demote the only active admin", async () => {
    const client = makeAdminClient({
      tables: {
        profiles: [
          { id: ADMIN_ID, role: "admin", account_status: "active", email: "admin@finsight.app" },
        ],
        // WS-B validates roles against the live table; keep the seeded rows
        // so this test exercises last-admin logic, not role validation.
        roles: [
          { id: ROLE_ADMIN_ID, name: "admin", description: "", is_system: true },
          { id: ROLE_USER_ID, name: "user", description: "", is_system: true },
        ],
      },
    });
    const ctx = makeCtx(client);
    await expectApiError(
      updateUser(ctx, req("PATCH", { role: "user" }), { id: ADMIN_ID }),
      409,
      "last_admin",
      "At least one active administrator must remain."
    );
  });

  it("refuses to suspend the only active admin", async () => {
    const client = makeAdminClient({
      tables: {
        profiles: [
          { id: ADMIN_ID, role: "admin", account_status: "active", email: "admin@finsight.app" },
        ],
      },
    });
    const ctx = makeCtx(client);
    await expectApiError(
      updateUser(ctx, req("PATCH", { account_status: "suspended" }), { id: ADMIN_ID }),
      409,
      "last_admin",
      "At least one active administrator must remain."
    );
  });

  it("allows demotion when another active admin exists, and audits it", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    const result = await updateUser(ctx, req("PATCH", { role: "user" }), { id: ADMIN_ID });
    expect(result).toEqual({ id: ADMIN_ID, role: "user" });

    const audit = client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
    expect(audit.length).toBe(1);
    const payload = audit[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("user.update");
    expect(payload.target_user_id).toBe(ADMIN_ID);
    expect(payload.metadata).toEqual({ role: "user" });
  });
});

describe("role & status validation", () => {
  it("rejects invalid role values", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      updateUser(ctx, req("PATCH", { role: "superuser" }), { id: USER_ID }),
      400,
      "bad_request"
    );
  });

  it("rejects invalid account status values", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      updateUser(ctx, req("PATCH", { account_status: "banned" }), { id: USER_ID }),
      400,
      "bad_request"
    );
  });

  it("requires role change to carry ROLE_MANAGE", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, ["USER_EDIT"]);
    await expectApiError(
      updateUser(ctx, req("PATCH", { role: "admin" }), { id: USER_ID }),
      403,
      "forbidden"
    );
  });

  it("rejects demotion of a non-existent user with 404", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      updateUser(ctx, req("PATCH", { role: "user" }), { id: "00000000-0000-4000-8000-000000000099" }),
      404,
      "not_found"
    );
  });
});

describe("transaction mutations", () => {
  it("requires DELETE confirmation", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      deleteTransaction(ctx, req("DELETE", { confirm: "yes please" }), { id: TX_ID }),
      400,
      "confirmation_required"
    );
  });

  it("deletes with confirmation and audits the actor and target", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    const result = await deleteTransaction(ctx, req("DELETE", { confirm: "DELETE" }), { id: TX_ID });
    expect(result).toEqual({ id: TX_ID, deleted: true });

    const audit = client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
    expect(audit.length).toBe(1);
    const payload = audit[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("transaction.delete");
    expect(payload.actor_id).toBe(ADMIN_ID);
    expect(payload.target_user_id).toBe(USER_ID);
    expect(client.tables.transactions.length).toBe(0);
  });

  it("rejects invalid amount in corrections", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      correctTransaction(ctx, req("PATCH", { amount: -5 }), { id: TX_ID }),
      400,
      "bad_request"
    );
  });

  it("flags a transaction and audits the reason", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    const result = (await flagTransaction(ctx, req("POST", { reason: "Possible duplicate" }), { id: TX_ID })) as { flagged: boolean };
    expect(result.flagged).toBe(true);
    const tx = client.tables.transactions[0] as Record<string, unknown>;
    expect(tx.flagged).toBe(true);
    expect(tx.flag_reason).toBe("Possible duplicate");
    const audit = client.writes.find((w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "transaction.flag");
    expect(audit).toBeDefined();
  });

  it("requires a flag reason", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      flagTransaction(ctx, req("POST", { reason: "" }), { id: TX_ID }),
      400,
      "bad_request"
    );
  });
});

describe("transaction unflag", () => {
  function flaggedClient(): MockClient {
    return makeAdminClient({
      tables: {
        profiles: [
          { id: ADMIN_ID, email: "admin@finsight.app", full_name: "Admin One", role: "admin", account_status: "active", monthly_budget: 0, created_at: "2026-01-01T00:00:00Z" },
          { id: USER_ID, email: "user@example.com", full_name: "Jane User", role: "user", account_status: "active", monthly_budget: 0, created_at: "2026-01-03T00:00:00Z" },
        ],
        transactions: [
          { id: TX_ID, user_id: USER_ID, type: "expense", category: "Food", amount: 120, note: "lunch", created_at: "2026-08-01T10:00:00Z", flagged: true, flag_reason: "Possible duplicate" },
        ],
        categories: [],
        push_subscriptions: [],
        admin_notifications: [],
        audit_logs: [],
        app_settings: [{ key: "general", value: { app_name: "FinSight" } }],
        roles: [
          { id: ROLE_ADMIN_ID, name: "admin", description: "", is_system: true },
          { id: ROLE_USER_ID, name: "user", description: "", is_system: true },
        ],
        permissions: ALL_PERMISSIONS.map((code, i) => ({ id: permissionId(i), code, description: "" })),
        role_permissions: ALL_PERMISSIONS.map((code, i) => ({ role_id: ROLE_ADMIN_ID, permission_id: permissionId(i) })),
      },
    });
  }

  it("clears the flag and reason, and audits with previous state", async () => {
    const client = flaggedClient();
    const ctx = makeCtx(client);
    const result = (await unflagTransaction(ctx, req("POST"), { id: TX_ID })) as { id: string; flagged: boolean };
    expect(result).toEqual({ id: TX_ID, flagged: false });

    const tx = client.tables.transactions[0] as Record<string, unknown>;
    expect(tx.flagged).toBe(false);
    expect(tx.flag_reason).toBeNull();

    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "transaction.unflag"
    );
    expect(audit).toBeDefined();
    const payload = audit!.payload as Record<string, unknown>;
    expect(payload.actor_id).toBe(ADMIN_ID);
    expect(payload.target_user_id).toBe(USER_ID);
    expect(payload.resource_id).toBe(TX_ID);
    expect(payload.resource_type).toBe("transaction");
    expect(payload.metadata).toMatchObject({ previous_flagged: true, previous_reason: "Possible duplicate" });
  });

  it("rejects an invalid transaction UUID with bad_request", async () => {
    const client = flaggedClient();
    const ctx = makeCtx(client);
    await expectApiError(unflagTransaction(ctx, req("POST"), { id: "../etc/passwd" }), 400, "bad_request");
    expect(client.writes.length).toBe(0);
  });

  it("404s when the transaction does not exist and writes nothing", async () => {
    const client = flaggedClient();
    const ctx = makeCtx(client);
    await expectApiError(
      unflagTransaction(ctx, req("POST"), { id: "00000000-0000-4000-8000-000000000099" }),
      404,
      "not_found"
    );
    expect(client.writes.length).toBe(0);
  });

  it("requires TRANSACTION_EDIT and mutates nothing without it", async () => {
    const client = flaggedClient();
    const ctx = makeCtx(client, ALL_PERMISSIONS.filter((p) => p !== "TRANSACTION_EDIT"));
    await expectApiError(unflagTransaction(ctx, req("POST"), { id: TX_ID }), 403, "forbidden");
    const tx = client.tables.transactions[0] as Record<string, unknown>;
    expect(tx.flagged).toBe(true); // untouched
    expect(client.writes.length).toBe(0); // no audit either
  });

  it("is idempotent on an already-unflagged row but still audits the action", async () => {
    const client = makeAdminClient(); // fixture TX is not flagged
    const ctx = makeCtx(client);
    const result = (await unflagTransaction(ctx, req("POST"), { id: TX_ID })) as { id: string; flagged: boolean };
    expect(result).toEqual({ id: TX_ID, flagged: false });

    const tx = client.tables.transactions[0] as Record<string, unknown>;
    expect(tx.flagged).toBe(false);
    expect(client.writes.some(
      (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "transaction.unflag"
    )).toBe(true);
  });

  it("surfaces audit persistence failure as audit_failed after the update landed", async () => {
    const client = flaggedClient();
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "audit store down" } }) };
      }
      return originalFrom(table);
    }) as typeof client.from;

    await expectApiError(unflagTransaction(makeCtx(client), req("POST"), { id: TX_ID }), 500, "audit_failed");
  });

  it("registers POST transactions/:id/unflag in the route table", () => {
    const match = matchRoute(["transactions", TX_ID, "unflag"], "POST");
    expect(match).not.toBeNull();
    expect(match!.params.id).toBe(TX_ID);
  });
});

describe("content sanitization", () => {
  it("strips HTML/script markup from notification content", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    const result = await createNotification(
      ctx,
      req("POST", { title: "<script>alert(1)</script>Urgent", body: "Hello <b>world</b>" }),
      {}
    );
    const row = client.tables.admin_notifications[0] as Record<string, unknown>;
    expect(row.title).toBe("Urgent");
    expect(row.body).toBe("Hello world");
    expect(String(row.body)).not.toContain("<");
  });

  it("sanitizes category names", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    const result = (await createCategory(ctx, req("POST", { name: "Pets <img src=x> " }), {})) as Record<string, unknown>;
    expect(result.name).toBe("Pets");
  });

  it("audits category.create with the sanitized payload", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await createCategory(ctx, req("POST", { name: "Pets", type: "expense" }), {});
    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "category.create"
    );
    expect(audit).toBeDefined();
    expect((audit!.payload as Record<string, unknown>).actor_id).toBe(ADMIN_ID);
  });

  it("audits category.update and category.delete (or disable fallback)", async () => {
    const catId = "00000000-0000-4000-8000-000000000021";

    const updClient = makeAdminClient();
    await updateCategory(makeCtx(updClient), req("PATCH", { name: "Groceries+" }), { id: catId });
    expect(
      updClient.writes.find(
        (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "category.update"
      )
    ).toBeDefined();

    const delClient = makeAdminClient({ tables: { categories: [{ id: catId, name: "Food", is_default: true, is_disabled: false }] } });
    // The hard-delete path is guarded by an explicit typed confirmation.
    await expectApiError(
      deleteCategory(makeCtx(delClient), req("DELETE", {}), { id: catId }),
      400,
      "confirmation_required"
    );
    await deleteCategory(makeCtx(delClient), req("DELETE", { confirm: "DELETE" }), { id: catId });
    const delActions = delClient.writes
      .filter((w) => w.table === "audit_logs")
      .map((w) => (w.payload as { action: string }).action);
    // Default/in-use categories fall back to a soft disable; either way an
    // audit row must exist and it must never be a bare hard delete.
    expect(delActions.some((a) => a === "category.disable" || a === "category.delete")).toBe(true);
  });

  it("requires notification title and body", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      createNotification(ctx, req("POST", { title: "", body: "x" }), {}),
      400,
      "bad_request"
    );
  });

  it("rejects selected-audience notifications without recipients", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      createNotification(ctx, req("POST", { title: "Hi", body: "There", audience: "selected", target_user_ids: [] }), {}),
      400,
      "bad_request"
    );
  });

  it("rejects unknown settings keys", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);
    await expectApiError(
      updateSettings(ctx, req("PATCH", { api_key: "supersecret" }), { group: "general" }),
      400,
      "bad_request"
    );
  });
});

describe("error envelope", () => {
  it("maps ApiError to its status and code", async () => {
    const res = await handleRoute(async () => {
      throw new ApiError(403, "nope", "forbidden");
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "nope", code: "forbidden", status: 403 });
  });

  it("masks unexpected internal errors as 500 without leaking internals", async () => {
    const res = await handleRoute(async () => {
      throw new Error("secret connection string");
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.code).toBe("internal");
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await handleRoute(async () => {
      return readJsonBody(new Request("http://localhost", { method: "POST", body: "{not json" }));
    });
    expect(res.status).toBe(400);
  });
});

describe("audit completeness", () => {
  it("every mutation records an audit row", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);

    await updateUser(ctx, req("PATCH", { full_name: "Renamed" }), { id: USER_ID });
    await correctTransaction(ctx, req("PATCH", { note: "updated note" }), { id: TX_ID });
    await createNotification(ctx, req("POST", { title: "T", body: "B" }), {});
    await updateSettings(ctx, req("PATCH", { maintenance_mode: true }), { group: "general" });

    const auditRows = client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
    const actions = auditRows.map((w) => (w.payload as { action: string }).action).sort();
    expect(actions).toEqual(
      ["notification.create", "maintenance.toggle", "transaction.correct", "user.update"].sort()
    );

    for (const row of auditRows) {
      const payload = row.payload as Record<string, unknown>;
      expect(payload.actor_id).toBe(ADMIN_ID);
      expect(payload.ip).toBe("127.0.0.1");
    }
  });
});

describe("settings/maintenance audit consistency", () => {
  it("audits a maintenance_mode flip via the settings API as maintenance.toggle, not settings.update", async () => {
    const client = makeAdminClient(); // general.maintenance_mode starts false
    const ctx = makeCtx(client);

    await updateSettings(ctx, req("PATCH", { maintenance_mode: true }), { group: "general" });

    const rows = client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("maintenance.toggle");
    expect(payload.resource_type).toBe("system");
    expect(payload.metadata).toEqual({ enabled: true });
  });

  it("does not emit maintenance.toggle when the value did not change", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);

    await updateSettings(ctx, req("PATCH", { maintenance_mode: false }), { group: "general" });

    const rows = client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("settings.update");
    expect((payload.metadata as { keys: string[] }).keys).toEqual(["maintenance_mode"]);
  });

  it("splits a mixed patch: maintenance.toggle plus settings.update for the remaining keys", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client);

    await updateSettings(
      ctx,
      req("PATCH", { app_name: "FinSight v2", maintenance_mode: true }),
      { group: "general" }
    );

    const rows = client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
    expect(rows).toHaveLength(2);
    const byAction = Object.fromEntries(
      rows.map((r) => [(r.payload as { action: string }).action, r.payload as Record<string, unknown>])
    );
    expect(byAction["maintenance.toggle"].metadata).toEqual({ enabled: true });
    expect((byAction["settings.update"].metadata as { keys: string[] }).keys).toEqual(["app_name"]);
  });
});

describe("sanity: helper sanitization standalone", () => {
  it("sanitizeText removes markup and truncates", () => {
    expect(sanitizeText("<script>x</script>abc", 100)).toBe("abc");
    expect(sanitizeText("a\tb\rc", 100)).toBe("a b c");
    expect(sanitizeText("aaaaaaaaaa", 3)).toBe("aaa");
  });
});

describe("cross-tenant access patterns", () => {
  it("listUsers is scoped by role and does not leak other users' auth fields without RPC", async () => {
    const client = makeAdminClient({ rpc: {} });
    const ctx = makeCtx(client);
    const match = matchRoute(["users"], "GET")!;
    const result = (await match.handler(ctx, req("GET"), {})) as {
      items: Array<{ email: string | null; email_confirmed_at: string | null }>;
    };
    expect(result.items.length).toBe(3);
    // admin_auth_infos is unavailable → sensitive auth fields stay null (fail closed).
    for (const item of result.items) expect(item.email_confirmed_at).toBeNull();
  });
});

describe("REPORT_VIEW enforcement on overview", () => {
  it("allows overview for an admin holding REPORT_VIEW", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, [...ALL_PERMISSIONS]);
    const result = (await overview(ctx, req("GET"), {})) as Record<string, unknown>;
    expect(result).toHaveProperty("users");
    expect(result).toHaveProperty("finance");
    expect(result).toHaveProperty("health");
  });

  it("blocks overview with 403 when REPORT_VIEW is missing", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, ALL_PERMISSIONS.filter((p) => p !== "REPORT_VIEW"));
    await expectApiError(overview(ctx, req("GET"), {}), 403, "forbidden");
  });

  it("blocks overview with 403 when the matrix failed closed to zero permissions", async () => {
    const client = makeAdminClient();
    const ctx = makeCtx(client, []);
    await expectApiError(overview(ctx, req("GET"), {}), 403, "forbidden");
  });
});

describe("overview broadcast counter (sent_last_7_days)", () => {
  // Fixed wall clock so the 7-day window boundary is exact. The handler
  // computes `new Date(Date.now() - 7*86400000).toISOString()` and filters
  // with gte — UTC-based, inclusive of the boundary instant.
  const NOW = new Date("2026-08-22T12:00:00.000Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

  function notifRows(): Record<string, unknown>[] {
    return [
      { id: "n1", status: "sent", created_at: daysAgo(1) },
      { id: "n2", status: "sent", created_at: daysAgo(6) },
      { id: "n3", status: "sent", created_at: daysAgo(7) }, // exactly at the boundary → included (gte)
      { id: "n4", status: "sent", created_at: new Date(NOW.getTime() - 7 * 86400000 - 1).toISOString() }, // older → excluded
      { id: "n5", status: "draft", created_at: daysAgo(1) },
      { id: "n6", status: "cancelled", created_at: daysAgo(1) },
      { id: "n7", status: "failed", created_at: daysAgo(1) },
    ];
  }

  function broadcastClient(): MockClient {
    return makeClient({
      user: { id: ADMIN_ID, email: "admin@finsight.app" },
      tables: {
        profiles: [],
        transactions: [],
        categories: [],
        push_subscriptions: [],
        admin_notifications: notifRows(),
        audit_logs: [],
        app_settings: [{ key: "general", value: { app_name: "FinSight" } }],
        roles: [],
        permissions: [],
        role_permissions: [],
      },
      rpc: {
        admin_user_stats: () => ({
          data: { total: 0, active: 0, disabled: 0, suspended: 0, admins: 0, verified: 0, unverified: 0 },
          error: null,
        }),
        admin_finance_stats: () => ({
          data: { transactions: 0, income: 0, expenses: 0, savings: 0, active_budgets: 0 },
          error: null,
        }),
        app_status: () => ({ data: [{ maintenance: false, app_name: "FinSight" }], error: null }),
      },
    });
  }

  it("counts every sent notification in the trailing 7 days, not just one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const ctx = makeCtx(broadcastClient(), [...ALL_PERMISSIONS]);
      const result = (await overview(ctx, req("GET"), {})) as {
        notifications: { sent_last_7_days: number };
      };
      // Old implementation used limit(1) + .length → this would be 1.
      expect(result.notifications.sent_last_7_days).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes a notification created exactly 7 days ago (gte is inclusive)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const client = broadcastClient();
      const ctx = makeCtx(client, [...ALL_PERMISSIONS]);
      const result = (await overview(ctx, req("GET"), {})) as {
        notifications: { sent_last_7_days: number };
      };
      // n1, n2, n3 — n3 sits precisely on the boundary.
      expect(result.notifications.sent_last_7_days).toBeGreaterThanOrEqual(3);
      expect(result.notifications.sent_last_7_days).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores non-sent broadcasts regardless of age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const client = broadcastClient();
      const rows = client.tables.admin_notifications as Record<string, unknown>[];
      expect(rows.some((r) => r.status !== "sent")).toBe(true); // fixture sanity
      const ctx = makeCtx(client, [...ALL_PERMISSIONS]);
      const result = (await overview(ctx, req("GET"), {})) as {
        notifications: { sent_last_7_days: number };
      };
      expect(result.notifications.sent_last_7_days).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the rest of the payload intact while counting broadcasts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const ctx = makeCtx(broadcastClient(), [...ALL_PERMISSIONS]);
      const result = (await overview(ctx, req("GET"), {})) as Record<string, unknown>;
      expect(result).toHaveProperty("users");
      expect(result).toHaveProperty("finance");
      expect((result.health as Record<string, unknown>).database).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("push subscription deletion permission mapping", () => {
  const SUB_ID = "00000000-0000-4000-8000-000000000020";

  function subTables(): MockQueryOptions["tables"] {
    return {
      profiles: [
        { id: ADMIN_ID, role: "admin", account_status: "active", email: "admin@finsight.app" },
        { id: USER_ID, role: "user", account_status: "active" },
      ],
      transactions: [],
      categories: [],
      push_subscriptions: [
        {
          id: SUB_ID,
          user_id: USER_ID,
          subscription: { endpoint: "https://push.example.com/send/abc123" },
          prefs: {},
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
      admin_notifications: [],
      audit_logs: [],
      app_settings: [{ key: "general", value: { maintenance_mode: false } }],
      roles: [
        { id: ROLE_ADMIN_ID, name: "admin", description: "", is_system: true },
        { id: ROLE_USER_ID, name: "user", description: "", is_system: true },
      ],
      permissions: ALL_PERMISSIONS.map((code, i) => ({ id: permissionId(i), code, description: "" })),
      role_permissions: ALL_PERMISSIONS.map((code, i) => ({
        role_id: ROLE_ADMIN_ID,
        permission_id: permissionId(i),
      })),
    };
  }

  it("deletes with USER_EDIT and audits push.delete", async () => {
    const client = makeAdminClient({ tables: subTables() });
    const ctx = makeCtx(client, ["USER_VIEW", "USER_EDIT"]);
    const result = (await deletePushSubscription(ctx, req("DELETE", { confirm: "DELETE" }), { id: SUB_ID })) as Record<string, unknown>;
    expect(result.deleted).toBe(true);
    expect(client.tables.push_subscriptions.length).toBe(0);
    const audit = client.writes.find((w) => w.table === "audit_logs" && w.kind === "insert");
    expect(audit).toBeDefined();
    expect((audit!.payload as { action: string }).action).toBe("push.delete");
    expect((audit!.payload as { target_user_id: string }).target_user_id).toBe(USER_ID);
  });

  it("no longer accepts USER_SUSPEND alone for push deletion", async () => {
    const client = makeAdminClient({ tables: subTables() });
    const ctx = makeCtx(client, ["USER_VIEW", "USER_SUSPEND"]);
    await expectApiError(
      deletePushSubscription(ctx, req("DELETE", { confirm: "DELETE" }), { id: SUB_ID }),
      403,
      "forbidden"
    );
    expect(client.tables.push_subscriptions.length).toBe(1);
  });

  it("refuses push deletion without any permissions", async () => {
    const client = makeAdminClient({ tables: subTables() });
    const ctx = makeCtx(client, []);
    await expectApiError(
      deletePushSubscription(ctx, req("DELETE", { confirm: "DELETE" }), { id: SUB_ID }),
      403,
      "forbidden"
    );
  });
});

describe("notification draft editing & send semantics", () => {
  const NOTIF_ID = "00000000-0000-4000-8000-000000000042";

  function notifTables(): MockQueryOptions["tables"] {
    return {
      profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active", email: "admin@finsight.app" }],
      transactions: [],
      categories: [],
      push_subscriptions: [],
      admin_notifications: [
        {
          id: NOTIF_ID,
          title: "Original title",
          body: "Original body",
          audience: "all",
          channel: "both",
          target_user_ids: [],
          status: "draft",
          error: null,
          created_by: ADMIN_ID,
          created_at: "2026-08-20T10:00:00Z",
          sent_at: null,
        },
      ],
      audit_logs: [],
      app_settings: [],
    };
  }

  it("edits a draft and audits notification.update", async () => {
    const client = makeAdminClient({ tables: notifTables() });
    const ctx = makeCtx(client);
    const result = (await updateNotification(
      ctx,
      req("PATCH", { title: "Edited title", body: "Edited body", audience: "users", channel: "inapp" }),
      { id: NOTIF_ID }
    )) as Record<string, unknown>;
    expect(result.title).toBe("Edited title");
    expect(result.audience).toBe("users");
    const row = client.tables.admin_notifications[0] as Record<string, unknown>;
    expect(row.title).toBe("Edited title");
    expect(row.status).toBe("draft");
    const audit = client.writes.find((w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "notification.update");
    expect(audit).toBeDefined();
  });

  it("refuses to edit a notification that is not a draft (409)", async () => {
    const tables = notifTables();
    (tables!.admin_notifications![0] as Record<string, unknown>).status = "sent";
    const client = makeAdminClient({ tables });
    await expectApiError(
      updateNotification(makeCtx(client), req("PATCH", { title: "X", body: "Y" }), { id: NOTIF_ID }),
      409,
      "bad_state"
    );
    // Content is frozen once out of draft.
    const row = client.tables.admin_notifications[0] as Record<string, unknown>;
    expect(row.title).toBe("Original title");
  });

  it("404s when editing a missing notification and writes nothing", async () => {
    const client = makeAdminClient({ tables: notifTables() });
    await expectApiError(
      updateNotification(makeCtx(client), req("PATCH", { title: "X", body: "Y" }), { id: TX_ID }),
      404,
      "not_found"
    );
    expect(client.writes.length).toBe(0);
  });

  it("validates edited content (missing body -> 400)", async () => {
    const client = makeAdminClient({ tables: notifTables() });
    await expectApiError(
      updateNotification(makeCtx(client), req("PATCH", { title: "X", body: "" }), { id: NOTIF_ID }),
      400,
      "bad_request"
    );
  });

  it("blocks editing without NOTIFICATION_MANAGE (403)", async () => {
    const client = makeAdminClient({ tables: notifTables() });
    await expectApiError(
      updateNotification(makeCtx(client, []), req("PATCH", { title: "X", body: "Y" }), { id: NOTIF_ID }),
      403,
      "forbidden"
    );
  });

  it("refuses push-only broadcasts before any mutation (409 push_not_configured)", async () => {
    const tables = notifTables();
    (tables!.admin_notifications![0] as Record<string, unknown>).channel = "push";
    const client = makeAdminClient({ tables });
    const before = JSON.stringify(client.tables.admin_notifications);
    await expectApiError(
      sendNotification(makeCtx(client), req("POST"), { id: NOTIF_ID }),
      409,
      "push_not_configured"
    );
    // Nothing was flipped to sent and no delivery was claimed.
    expect(JSON.stringify(client.tables.admin_notifications)).toBe(before);
    expect(client.writes.length).toBe(0);
  });

  it("marks in-app broadcasts delivered and records truthful dispatch metadata", async () => {
    const tables = notifTables();
    (tables!.admin_notifications![0] as Record<string, unknown>).channel = "inapp";
    const client = makeAdminClient({ tables });
    const result = (await sendNotification(makeCtx(client), req("POST"), { id: NOTIF_ID })) as Record<string, unknown>;
    expect(result.status).toBe("sent");
    const audit = client.writes.find((w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "notification.send");
    expect(audit).toBeDefined();
    const meta = (audit!.payload as { metadata: Record<string, unknown> }).metadata;
    expect(meta.dispatch).toBe("in_app_delivered");
    expect(meta.push_dispatch).toBeUndefined();
  });

  it("discloses the unconfigured push leg when sending 'both'", async () => {
    const client = makeAdminClient({ tables: notifTables() });
    const result = (await sendNotification(makeCtx(client), req("POST"), { id: NOTIF_ID })) as Record<string, unknown>;
    expect(result.status).toBe("sent");
    const audit = client.writes.find((w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "notification.send");
    const meta = (audit!.payload as { metadata: Record<string, unknown> }).metadata;
    expect(meta.dispatch).toBe("in_app_delivered");
    expect(meta.push_dispatch).toBe("not_configured");
  });
});
