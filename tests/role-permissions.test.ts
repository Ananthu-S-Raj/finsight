import { describe, it, expect } from "vitest";
import { matchRoute } from "@/lib/admin/handlers";
import {
  getRolePermissions,
  grantRolePermission,
  revokeRolePermission,
} from "@/lib/admin/handlers/roles";
import { ApiError } from "@/lib/admin/server";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import type { AdminContext } from "@/lib/admin/server";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const ROLE_ID = "00000000-0000-4000-8000-000000000011"; // custom "editors" role
const SYSTEM_ROLE_ID = "00000000-0000-4000-8000-000000000012"; // seeded admin role
const PERM_ID = "00000000-0000-4000-8000-000000000021"; // USER_VIEW

function makeTables(): MockQueryOptions["tables"] {
  return {
    profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active", email: "admin@finsight.app" }],
    roles: [
      { id: ROLE_ID, name: "editors", description: "Custom role", is_system: false },
      { id: SYSTEM_ROLE_ID, name: "admin", description: "Seeded", is_system: true },
    ],
    permissions: [
      { id: PERM_ID, code: "USER_VIEW", description: "View users" },
      { id: "00000000-0000-4000-8000-000000000022", code: "USER_EDIT", description: "Edit users" },
    ],
    role_permissions: [
      { role_id: ROLE_ID, permission_id: "00000000-0000-4000-8000-000000000022" },
      { role_id: SYSTEM_ROLE_ID, permission_id: PERM_ID },
    ],
    audit_logs: [],
  };
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
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
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

function auditActions(client: MockClient): string[] {
  return client.writes
    .filter((w) => w.table === "audit_logs" && w.kind === "insert")
    .map((w) => (w.payload as { action: string }).action);
}

describe("role administration routes", () => {
  it("registers view/grant/revoke endpoints", () => {
    expect(matchRoute(["roles", ROLE_ID, "permissions"], "GET")).not.toBeNull();
    expect(matchRoute(["roles", ROLE_ID, "permissions"], "POST")).not.toBeNull();
    expect(
      matchRoute(["roles", ROLE_ID, "permissions", PERM_ID], "DELETE")
    ).not.toBeNull();
    expect(matchRoute(["roles", ROLE_ID], "DELETE")).toBeNull();
  });
});

describe("granting permissions", () => {
  it("grants with ROLE_MANAGE, persists the link, and audits", async () => {
    const client = createMockClient({ tables: makeTables() });
    const result = (await grantRolePermission(
      makeCtx(client),
      req("POST", { permission_id: "USER_VIEW" }),
      { id: ROLE_ID }
    )) as Record<string, unknown>;

    expect(result.granted).toBe(true);
    expect(
      client.tables.role_permissions.some(
        (l) => l.role_id === ROLE_ID && l.permission_id === PERM_ID
      )
    ).toBe(true);

    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === "role.permission.grant"
    );
    expect(audit).toBeDefined();
    const payload = audit!.payload as Record<string, unknown>;
    expect(payload.resource_type).toBe("role");
    expect(payload.resource_id).toBe(ROLE_ID);
    expect((payload.metadata as Record<string, unknown>).permission_code).toBe("USER_VIEW");
    expect((payload.metadata as Record<string, unknown>).role_name).toBe("editors");
  });

  it("rejects grants without ROLE_MANAGE and writes nothing", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client, ["USER_VIEW"]), req("POST", { permission_id: "USER_VIEW" }), { id: ROLE_ID }),
      403,
      "forbidden"
    );
    expect(client.writes.length).toBe(0);
    expect(client.tables.role_permissions.length).toBe(2);
  });

  it("rejects a duplicate grant with 409", async () => {
    const client = createMockClient({ tables: makeTables() });
    // USER_EDIT is already linked to the editors role in the fixture.
    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", { permission_id: "USER_EDIT" }), { id: ROLE_ID }),
      409,
      "already_granted"
    );
  });

  it("rejects granting to a system role server-side (403)", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", { permission_id: "USER_VIEW" }), { id: SYSTEM_ROLE_ID }),
      403,
      "system_role"
    );
    expect(client.writes.length).toBe(0);
  });

  it("404s when the role does not exist", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", { permission_id: "USER_VIEW" }), { id: "00000000-0000-4000-8000-000000000099" }),
      404,
      "not_found"
    );
  });

  it("404s when the permission does not exist", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", { permission_id: "NOT_A_PERMISSION" }), { id: ROLE_ID }),
      404,
      "not_found"
    );
  });

  it("400s on a malformed role uuid and never reaches the database", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", { permission_id: "USER_VIEW" }), { id: "../etc/passwd" }),
      400,
      "bad_request"
    );
    expect(client.writes.length).toBe(0);
  });

  it("400s when the request body carries no permission reference", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", {}), { id: ROLE_ID }),
      400,
      "bad_request"
    );
  });

  it("surfaces audit failure as audit_failed even though the row was written", async () => {
    const client = createMockClient({ tables: makeTables() });
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "audit store down" } }) };
      }
      return originalFrom(table);
    }) as typeof client.from;

    await expectApiError(
      grantRolePermission(makeCtx(client), req("POST", { permission_id: "USER_VIEW" }), { id: ROLE_ID }),
      500,
      "audit_failed"
    );
  });
});

describe("revoking permissions", () => {
  it("revokes with ROLE_MANAGE, removes the link, and audits", async () => {
    const tables = makeTables();
    tables!.role_permissions!.push({ role_id: ROLE_ID, permission_id: PERM_ID });
    const client = createMockClient({ tables });

    const result = (await revokeRolePermission(makeCtx(client), req("DELETE"), {
      id: ROLE_ID,
      permissionId: PERM_ID,
    })) as Record<string, unknown>;

    expect(result.revoked).toBe(true);
    expect(
      client.tables.role_permissions.some(
        (l) => l.role_id === ROLE_ID && l.permission_id === PERM_ID
      )
    ).toBe(false);
    expect(auditActions(client)).toContain("role.permission.revoke");
  });

  it("accepts a permission code instead of a uuid", async () => {
    const tables = makeTables();
    tables!.role_permissions!.push({ role_id: ROLE_ID, permission_id: PERM_ID });
    const client = createMockClient({ tables });

    const result = (await revokeRolePermission(makeCtx(client), req("DELETE"), {
      id: ROLE_ID,
      permissionId: "user_view",
    })) as Record<string, unknown>;
    expect(result.revoked).toBe(true);
    expect(
      client.tables.role_permissions.some((l) => l.permission_id === PERM_ID && l.role_id === ROLE_ID)
    ).toBe(false);
  });

  it("rejects revokes without ROLE_MANAGE and changes nothing", async () => {
    const tables = makeTables();
    tables!.role_permissions!.push({ role_id: ROLE_ID, permission_id: PERM_ID });
    const client = createMockClient({ tables });

    await expectApiError(
      revokeRolePermission(makeCtx(client, []), req("DELETE"), { id: ROLE_ID, permissionId: PERM_ID }),
      403,
      "forbidden"
    );
    expect(client.tables.role_permissions.length).toBe(3);
    expect(client.writes.length).toBe(0);
  });

  it("404s when revoking a permission that is not granted", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      revokeRolePermission(makeCtx(client), req("DELETE"), { id: ROLE_ID, permissionId: PERM_ID }),
      404,
      "not_granted"
    );
    expect(client.writes.length).toBe(0);
  });

  it("rejects revoking from a system role server-side (403)", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      revokeRolePermission(makeCtx(client), req("DELETE"), { id: SYSTEM_ROLE_ID, permissionId: PERM_ID }),
      403,
      "system_role"
    );
    expect(client.tables.role_permissions.length).toBe(2);
    expect(client.writes.length).toBe(0);
  });

  it("surfaces audit failure on revoke as audit_failed", async () => {
    const tables = makeTables();
    tables!.role_permissions!.push({ role_id: ROLE_ID, permission_id: PERM_ID });
    const client = createMockClient({ tables });
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "audit store down" } }) };
      }
      return originalFrom(table);
    }) as typeof client.from;

    await expectApiError(
      revokeRolePermission(makeCtx(client), req("DELETE"), { id: ROLE_ID, permissionId: PERM_ID }),
      500,
      "audit_failed"
    );
  });
});

describe("viewing one role's permissions", () => {
  it("returns the role with its resolved permission codes", async () => {
    const client = createMockClient({ tables: makeTables() });
    const result = (await getRolePermissions(makeCtx(client), req("GET"), { id: ROLE_ID })) as {
      role: { name: string };
      permissions: Array<{ code: string }>;
    };
    expect(result.role.name).toBe("editors");
    expect(result.permissions.map((p) => p.code)).toEqual(["USER_EDIT"]);
  });

  it("requires ROLE_MANAGE even for reads", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(getRolePermissions(makeCtx(client, []), req("GET"), { id: ROLE_ID }), 403, "forbidden");
  });

  it("404s for an unknown role id", async () => {
    const client = createMockClient({ tables: makeTables() });
    await expectApiError(
      getRolePermissions(makeCtx(client), req("GET"), { id: "00000000-0000-4000-8000-000000000098" }),
      404,
      "not_found"
    );
  });
});
