import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError } from "@/lib/admin/server";
import { updateUser } from "@/lib/admin/handlers/users";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";

/**
 * WS-B — live role validation in updateUser (replaces ALLOWED_ROLES).
 *
 * Pins that assignment validation consults public.roles instead of the
 * hard-coded ["user","admin"] allowlist, while authorization ordering,
 * audit behaviour, and failure semantics stay exactly as before.
 */

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN2_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";

function baseTables() {
  return {
    profiles: [
      { id: ADMIN_ID, email: "admin@finsight.app", full_name: "Admin One", role: "admin", account_status: "active", monthly_budget: 0, created_at: "2026-01-01T00:00:00Z" },
      { id: ADMIN2_ID, email: "admin2@finsight.app", full_name: "Admin Two", role: "admin", account_status: "active", monthly_budget: 0, created_at: "2026-01-02T00:00:00Z" },
      { id: USER_ID, email: "user@example.com", full_name: "Jane User", role: "user", account_status: "active", monthly_budget: 0, created_at: "2026-01-03T00:00:00Z" },
    ],
    roles: [
      { id: "00000000-0000-4000-8000-000000000031", name: "admin", description: "", is_system: true },
      { id: "00000000-0000-4000-8000-000000000032", name: "user", description: "", is_system: true },
    ],
    audit_logs: [] as Record<string, unknown>[],
  };
}

function makeClient(opts: MockQueryOptions = {}): MockClient {
  return createMockClient({
    user: { id: ADMIN_ID, email: "admin@finsight.app" },
    tables: baseTables(),
    rpc: {
      admin_auth_infos: (args: unknown) => ({
        data: ((args as { ids?: string[] }).ids ?? []).map((id) => ({
          user_id: id,
          email_confirmed_at: "2026-01-01T00:00:00Z",
          auth_created_at: "2026-01-01T00:00:00Z",
          last_sign_in_at: "2026-08-01T00:00:00Z",
        })),
        error: null,
      }),
    },
    ...opts,
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
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function expectApiError(promise: Promise<unknown>, status: number, code?: string, message?: string) {
  try {
    await promise;
    expect.unreachable("expected ApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    if (code !== undefined) expect((err as ApiError).code).toBe(code);
    if (message !== undefined) expect((err as ApiError).message).toContain(message);
  }
}

const auditRows = (client: MockClient) =>
  client.writes.filter((w) => w.table === "audit_logs" && w.kind === "insert");
const profileUpdates = (client: MockClient) =>
  client.writes.filter((w) => w.table === "profiles" && w.kind === "update");

describe("WS-B: updateUser role validation against the live roles table", () => {
  it("accepts role='admin' through the existing path (update + awaited audit)", async () => {
    const client = makeClient();
    const result = await updateUser(makeCtx(client), req("PATCH", { role: "admin" }), { id: USER_ID });
    expect(result).toEqual({ id: USER_ID, role: "admin" });

    const updates = profileUpdates(client);
    expect(updates.length).toBe(1);

    const audit = auditRows(client);
    expect(audit.length).toBe(1);
    const payload = audit[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("user.update");
    expect(payload.metadata).toEqual({ role: "admin" });
  });

  it("accepts role='user' through the existing path", async () => {
    const client = makeClient();
    const result = await updateUser(makeCtx(client), req("PATCH", { role: "user" }), { id: ADMIN_ID });
    expect(result).toEqual({ id: ADMIN_ID, role: "user" });

    const payload = auditRows(client)[0].payload as Record<string, unknown>;
    expect(payload.action).toBe("user.update");
    expect(payload.metadata).toEqual({ role: "user" });
  });

  it("rejects a nonexistent role with no mutation and no audit row", async () => {
    const client = makeClient();
    await expectApiError(
      updateUser(makeCtx(client), req("PATCH", { role: "does_not_exist" }), { id: USER_ID }),
      400,
      "bad_request",
      "does not exist"
    );
    expect(client.writes.length).toBe(0);
  });

  it("recognizes any role that exists in the roles table (validation is live)", async () => {
    const client = makeClient({
      tables: {
        ...baseTables(),
        roles: [
          ...baseTables().roles,
          { id: "00000000-0000-4000-8000-000000000033", name: "custom_example", description: "", is_system: false },
        ],
      },
    });
    const result = await updateUser(
      makeCtx(client),
      req("PATCH", { role: "custom_example" }),
      { id: USER_ID }
    );
    expect(result).toEqual({ id: USER_ID, role: "custom_example" });
    expect(profileUpdates(client).length).toBe(1);
    const payload = auditRows(client)[0].payload as Record<string, unknown>;
    expect(payload.metadata).toEqual({ role: "custom_example" });
  });

  it("fails closed when the roles lookup errors (no fallback, no mutation)", async () => {
    const client = makeClient();
    const realFrom = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "roles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, count: 0, error: { message: "roles unavailable" } }),
            }),
          }),
        };
      }
      return realFrom(table);
    };

    await expectApiError(
      updateUser(makeCtx(client), req("PATCH", { role: "admin" }), { id: USER_ID }),
      502,
      "db_error"
    );
    expect(client.writes.length).toBe(0);
  });

  it("keeps authorization ordering: ROLE_MANAGE is required before any roles lookup", async () => {
    const client = makeClient();
    let rolesLookups = 0;
    const realFrom = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "roles") rolesLookups += 1;
      return realFrom(table);
    };

    await expectApiError(
      updateUser(makeCtx(client, ["USER_EDIT"]), req("PATCH", { role: "admin" }), { id: USER_ID }),
      403,
      "forbidden"
    );
    expect(rolesLookups).toBe(0);
    expect(client.writes.length).toBe(0);
  });
});

describe("WS-B static scope pins", () => {
  it("removes the hard-coded allowlist from the assignment path", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/admin/handlers/users.ts"), "utf8");
    expect(src).not.toMatch(/ALLOWED_ROLES\.includes\(role\)/);
  });

  it("leaves the WS-A migration untouched (guard trigger + FK markers intact)", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260822180000_system_role_hardening.sql"),
      "utf8"
    );
    expect(sql).toContain("guard_roles_system_rows");
    expect(sql).toMatch(/references public\.roles\(name\)/i);
    expect(sql).toMatch(/on delete restrict/i);
  });
});
