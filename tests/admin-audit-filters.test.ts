import { describe, it, expect, beforeEach } from "vitest";
import { listAuditLogs } from "@/lib/admin/handlers/audit";
import { ApiError } from "@/lib/admin/server";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN2_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const USER2_ID = "00000000-0000-4000-8000-000000000004";

function auditRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: overrides.id,
    actor_id: ADMIN_ID,
    actor_email: "admin@finsight.app",
    action: "user.update",
    resource_type: "user",
    target_user_id: null,
    target_email: null,
    result: "success",
    created_at: "2026-08-10T10:00:00Z",
    ...overrides,
  };
}

const LOGS = [
  auditRow({
    id: "a1",
    action: "user.suspend",
    resource_type: "user",
    resource_id: USER_ID,
    target_user_id: USER_ID,
    target_email: "user1@example.com",
    created_at: "2026-08-01T10:00:00Z",
  }),
  auditRow({
    id: "a2",
    action: "transaction.delete",
    resource_type: "transaction",
    resource_id: "00000000-0000-4000-8000-000000000010",
    created_at: "2026-08-15T12:00:00Z",
  }),
  auditRow({
    id: "a3",
    actor_id: ADMIN2_ID,
    actor_email: "admin2@finsight.app",
    action: "user.suspend",
    resource_type: "user",
    resource_id: USER2_ID,
    target_user_id: USER2_ID,
    target_email: "user2@example.com",
    created_at: "2026-08-20T09:00:00Z",
  }),
  auditRow({
    id: "a4",
    action: "settings.update",
    resource_type: "app_settings",
    resource_id: null,
    created_at: "2026-08-22T23:59:00Z",
  }),
];

function makeCtx(client: MockClient): AdminContext {
  return {
    userId: ADMIN_ID,
    email: "admin@finsight.app",
    role: "admin",
    permissions: [...ALL_PERMISSIONS] as PermissionCode[],
    token: "valid-token",
    ip: "127.0.0.1",
    userAgent: "vitest",
    client: client as never,
  };
}

function makeClient(): MockClient {
  const opts: MockQueryOptions = { tables: { audit_logs: LOGS.map((r) => ({ ...r })) } };
  return createMockClient(opts);
}

async function run(params: Record<string, string>) {
  const client = makeClient();
  const result = await listAuditLogs(makeCtx(client), new Request("http://localhost"), params);
  const ids = (result as { items: Array<{ id: string }> }).items.map((i) => i.id);
  return { ids, total: (result as { total: number }).total, client };
}

async function expectBadRequest(runner: Promise<unknown>, messagePart: string) {
  try {
    await runner;
    expect.unreachable("expected ApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe("bad_request");
    expect(apiErr.message).toContain(messagePart);
  }
}

beforeEach(() => {});

describe("listAuditLogs filters", () => {
  it("returns every entry when no filters are given", async () => {
    const { ids, total } = await run({});
    expect(ids).toEqual(["a4", "a3", "a2", "a1"]);
    expect(total).toBe(4);
  });

  it("filters by action", async () => {
    const { ids } = await run({ action: "user.suspend" });
    expect(ids).toEqual(["a3", "a1"]);
  });

  it("keeps filtering by target user (userId param)", async () => {
    const { ids } = await run({ userId: USER_ID });
    expect(ids).toEqual(["a1"]);
  });

  it("filters by actor UUID", async () => {
    const { ids } = await run({ actorId: ADMIN2_ID });
    expect(ids).toEqual(["a3"]);
  });

  it("rejects a malformed actorId with bad_request", async () => {
    await expectBadRequest(run({ actorId: "not-a-uuid" }), "actorId");
  });

  it("expands a date-only dateFrom to the inclusive start of day", async () => {
    const { ids } = await run({ dateFrom: "2026-08-15" });
    // a2 happened at 12:00 on the 15th — must be included.
    expect(ids).toEqual(["a4", "a3", "a2"]);
  });

  it("expands a date-only dateTo to the inclusive end of day", async () => {
    const { ids } = await run({ dateTo: "2026-08-15" });
    expect(ids).toEqual(["a2", "a1"]);
  });

  it("supports an explicit ISO timestamp for dateFrom", async () => {
    const { ids } = await run({ dateFrom: "2026-08-15T12:00:00Z" });
    expect(ids).toEqual(["a4", "a3", "a2"]);
  });

  it("applies date range boundaries inclusively", async () => {
    const { ids } = await run({ dateFrom: "2026-08-02", dateTo: "2026-08-15" });
    expect(ids).toEqual(["a2"]);
  });

  it("rejects a non-ISO date with bad_request", async () => {
    await expectBadRequest(run({ dateFrom: "08/15/2026" }), "dateFrom");
    await expectBadRequest(run({ dateTo: "yesterday" }), "dateTo");
  });

  it("combines action and actor filters", async () => {
    const { ids } = await run({ action: "user.suspend", actorId: ADMIN2_ID });
    expect(ids).toEqual(["a3"]);
  });

  it("combines search with the new filters", async () => {
    const { ids } = await run({ search: "admin2@", dateFrom: "2026-08-20", dateTo: "2026-08-20" });
    expect(ids).toEqual(["a3"]);
  });

  it("still paginates over filtered results", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    const page1 = (await listAuditLogs(ctx, new Request("http://localhost"), {
      action: "user.suspend",
      page: "2",
      pageSize: "1",
    })) as { items: Array<{ id: string }>; total: number; pages: number };
    expect(page1.items.map((i) => i.id)).toEqual(["a1"]);
    expect(page1.total).toBe(2);
    expect(page1.pages).toBe(2);
  });
});

describe("listAuditLogs resource filters", () => {
  it("filters by a known resourceType", async () => {
    const { ids } = await run({ resourceType: "transaction" });
    expect(ids).toEqual(["a2"]);
  });

  it("filters by resourceId", async () => {
    const { ids } = await run({ resourceId: USER_ID });
    expect(ids).toEqual(["a1"]);
  });

  it("combines resourceType with resourceId", async () => {
    const { ids } = await run({ resourceType: "user", resourceId: USER2_ID });
    expect(ids).toEqual(["a3"]);
  });

  it("returns nothing when the pair does not match", async () => {
    const { ids, total } = await run({ resourceType: "transaction", resourceId: USER_ID });
    expect(ids).toEqual([]);
    expect(total).toBe(0);
  });

  it("rejects an unknown resourceType with the allowed vocabulary", async () => {
    await expectBadRequest(run({ resourceType: "secrets" }), "resourceType");
    try {
      await run({ resourceType: "secrets" });
    } catch (err) {
      const msg = (err as ApiError).message;
      for (const known of ["user", "transaction", "app_settings", "push_subscription"]) {
        expect(msg).toContain(known);
      }
      expect(msg).not.toContain("secrets");
    }
  });

  it("rejects a malformed resourceId with bad_request", async () => {
    await expectBadRequest(run({ resourceId: "../../etc" }), "resourceId");
  });

  it("composes resource filters with action and date range", async () => {
    const { ids } = await run({
      resourceType: "user",
      action: "user.suspend",
      dateFrom: "2026-08-15",
    });
    expect(ids).toEqual(["a3"]);
  });

  it("treats an absent resource filter exactly as before", async () => {
    const { ids, total } = await run({});
    expect(ids).toEqual(["a4", "a3", "a2", "a1"]);
    expect(total).toBe(4);
  });
});
