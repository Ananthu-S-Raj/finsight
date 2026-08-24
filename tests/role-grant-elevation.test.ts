// @vitest-environment node
import { describe, it, expect } from "vitest";
import { grantRolePermission } from "@/lib/admin/handlers/roles";
import { ApiError } from "@/lib/admin/server";
import type { PermissionCode } from "@/lib/admin/permissions";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import type { AdminContext } from "@/lib/admin/server";

/**
 * G-08 privilege-elevation guard: an administrator may grant a permission
 * to a (custom) role only if they hold that permission themselves. The
 * check must run against the ACTOR'S EFFECTIVE permission set as resolved
 * by loadPermissions() during authentication (ctx.permissions — fail-closed),
 * never against a second RBAC implementation.
 *
 * Required semantics under test:
 * - ROLE_MANAGE still gates the endpoint first (403 forbidden without it).
 * - Unknown roles/permissions keep their existing 404s.
 * - System-role protection keeps precedence over the elevation guard.
 * - A denied elevation performs ZERO role_permissions mutation and ZERO
 *   audit writes.
 * - Successful grants keep the awaited, fatal audit behaviour.
 */

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const ROLE_ID = "00000000-0000-4000-8000-000000000011"; // custom "editors" role
const SYSTEM_ROLE_ID = "00000000-0000-4000-8000-000000000012"; // seeded admin role

const PERM_IDS: Record<string, string> = {
  USER_VIEW: "00000000-0000-4000-8000-000000000021",
  USER_EDIT: "00000000-0000-4000-8000-000000000022",
  REPORT_VIEW: "00000000-0000-4000-8000-000000000023",
  AUDIT_LOG_VIEW: "00000000-0000-4000-8000-000000000024",
  TRANSACTION_VIEW: "00000000-0000-4000-8000-000000000025",
};

function makeTables(): MockQueryOptions["tables"] {
  return {
    profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active", email: "admin@finsight.app" }],
    roles: [
      { id: ROLE_ID, name: "editors", description: "Custom role", is_system: false },
      { id: SYSTEM_ROLE_ID, name: "admin", description: "Seeded", is_system: true },
    ],
    permissions: Object.entries(PERM_IDS).map(([code, id]) => ({ id, code, description: code })),
    // The editors role already holds USER_EDIT (duplicate-grant fixture).
    role_permissions: [
      { role_id: ROLE_ID, permission_id: PERM_IDS.USER_EDIT },
      { role_id: SYSTEM_ROLE_ID, permission_id: PERM_IDS.USER_VIEW },
    ],
    audit_logs: [],
  };
}

function makeCtx(client: MockClient, permissions: PermissionCode[]): AdminContext {
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

function req(body?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
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
    expect((err as ApiError).status).toBe(status);
    if (code !== undefined) expect((err as ApiError).code).toBe(code);
  }
}

function grantWrites(client: MockClient): number {
  return client.writes.filter((w) => w.table === "role_permissions").length;
}

function auditRows(client: MockClient): unknown[] {
  return client.writes.filter((w) => w.table === "audit_logs");
}

describe("G-08 grant elevation guard", () => {
  it("1. actor with ROLE_MANAGE + requested permission grants successfully and audits", async () => {
    const client = createMockClient({ tables: makeTables() });
    const result = (await grantRolePermission(
      makeCtx(client, ["ROLE_MANAGE", "USER_VIEW"]),
      req({ permission_id: "USER_VIEW" }),
      { id: ROLE_ID }
    )) as Record<string, unknown>;

    expect(result.granted).toBe(true);
    expect(grantWrites(client)).toBe(1);
    const audit = auditRows(client)[0] as { payload: Record<string, unknown> } | undefined;
    expect(audit).toBeDefined();
    expect((audit!.payload.action)).toBe("role.permission.grant");
    expect((audit!.payload.metadata as Record<string, unknown>).permission_code).toBe("USER_VIEW");
  });

  it("2. actor with ROLE_MANAGE but WITHOUT the permission gets 403 permission_escalation", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["ROLE_MANAGE"]), req({ permission_id: "USER_VIEW" }), { id: ROLE_ID }),
      403,
      "permission_escalation"
    );
  });

  it("3. a denied elevation performs ZERO database writes of any kind", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["ROLE_MANAGE"]), req({ permission_id: "REPORT_VIEW" }), { id: ROLE_ID }),
      403,
      "permission_escalation"
    );
    expect(client.writes.length).toBe(0);
    // And the matrix itself is untouched.
    expect(client.tables.role_permissions.length).toBe(2);
    expect(
      client.tables.role_permissions.some(
        (l) => l.role_id === ROLE_ID && l.permission_id === PERM_IDS.REPORT_VIEW
      )
    ).toBe(false);
  });

  it("4. a denied elevation creates ZERO audit rows", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["ROLE_MANAGE"]), req({ permission_id: "AUDIT_LOG_VIEW" }), { id: ROLE_ID }),
      403,
      "permission_escalation"
    );
    expect(auditRows(client).length).toBe(0);
  });

  it("5. actor WITHOUT ROLE_MANAGE still hits the existing 403 first (even for held permissions)", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["USER_VIEW"]), req({ permission_id: "USER_VIEW" }), { id: ROLE_ID }),
      403,
      "forbidden"
    );
    expect(client.writes.length).toBe(0);
  });

  it("6. nonexistent permission keeps its existing 404 not_found", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["ROLE_MANAGE"]), req({ permission_id: "NOT_A_PERMISSION" }), { id: ROLE_ID }),
      404,
      "not_found"
    );
    expect(client.writes.length).toBe(0);
  });

  it("7. nonexistent role keeps its existing 404 not_found", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(
        makeCtx(client, ["ROLE_MANAGE", "USER_VIEW"]),
        req({ permission_id: "USER_VIEW" }),
        { id: "00000000-0000-4000-8000-000000000099" }
      ),
      404,
      "not_found"
    );
  });

  it("8. system role stays protected even when the actor holds the requested permission", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(
        makeCtx(client, ["ROLE_MANAGE", "TRANSACTION_VIEW"]),
        req({ permission_id: "TRANSACTION_VIEW" }),
        { id: SYSTEM_ROLE_ID }
      ),
      403,
      "system_role"
    );
    expect(client.writes.length).toBe(0);
  });

  it("8b. system-role protection PRECEDES the elevation guard in the failure order", async () => {
    // Actor lacks USER_VIEW yet the error is system_role, not escalation.
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["ROLE_MANAGE"]), req({ permission_id: "USER_VIEW" }), { id: SYSTEM_ROLE_ID }),
      403,
      "system_role"
    );
  });

  it("9. duplicate grant by an actor who holds the permission keeps the existing 409", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(
        makeCtx(client, ["ROLE_MANAGE", "USER_EDIT"]),
        req({ permission_id: "USER_EDIT" }),
        { id: ROLE_ID }
      ),
      409,
      "already_granted"
    );
  });

  it("10. audit failure on a legitimate grant still surfaces as audit_failed", async () => {
    const client = createMockClient({ tables: makeTables() });
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "audit store down" } }) };
      }
      return originalFrom(table);
    }) as typeof client.from;

    await expectApiError(
      grantRolePermission(
        makeCtx(client, ["ROLE_MANAGE", "USER_VIEW"]),
        req({ permission_id: "USER_VIEW" }),
        { id: ROLE_ID }
      ),
      500,
      "audit_failed"
    );
  });
});

describe("G-08 permission matrix examples", () => {
  it("an actor holding ROLE_MANAGE + USER_VIEW can grant USER_VIEW but nothing else probed", async () => {
    for (const code of ["USER_VIEW", "USER_EDIT", "REPORT_VIEW", "AUDIT_LOG_VIEW", "TRANSACTION_VIEW"] as const) {
      const client = createMockClient({ tables: makeTables() });
      const actor = makeCtx(client, ["ROLE_MANAGE", "USER_VIEW"]);
      if (code === "USER_VIEW") {
        const result = (await grantRolePermission(actor, req({ permission_id: code }), { id: ROLE_ID })) as {
          granted: boolean;
        };
        expect(result.granted).toBe(true);
      } else {
        await expectApiError(
          grantRolePermission(actor, req({ permission_id: code }), { id: ROLE_ID }),
          403,
          "permission_escalation"
        );
        expect(client.writes.length).toBe(0);
      }
    }
  });

  it("an actor holding each corresponding permission can grant exactly that permission", async () => {
    for (const code of ["USER_EDIT", "REPORT_VIEW", "AUDIT_LOG_VIEW", "TRANSACTION_VIEW"] as const) {
      const tables = makeTables();
      // Remove the duplicate fixture so USER_EDIT is grantable.
      tables!.role_permissions = tables!.role_permissions!.filter(
        (l) => !(l.role_id === ROLE_ID && l.permission_id === PERM_IDS[code])
      );
      const client = createMockClient({ tables });
      const result = (await grantRolePermission(
        makeCtx(client, ["ROLE_MANAGE", code]),
        req({ permission_id: code }),
        { id: ROLE_ID }
      )) as { granted: boolean };
      expect(result.granted).toBe(true);
      expect(
        client.tables.role_permissions.some(
          (l) => l.role_id === ROLE_ID && l.permission_id === PERM_IDS[code]
        )
      ).toBe(true);
    }
  });

  it("the guard consults the actor's effective set, not the global permission table", async () => {
    // An empty effective set fails closed even though every permission exists.
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, []), req({ permission_id: "USER_VIEW" }), { id: ROLE_ID }),
      403,
      "forbidden"
    );
  });
});
