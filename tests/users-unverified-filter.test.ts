// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";
import { listUsers } from "@/lib/admin/handlers/users";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Unverified-only filter (`?verified=false`, G-07): the verification state
 * lives in auth.users and reaches the API exclusively through the
 * admin_auth_infos SECURITY DEFINER rpc. The handler must filter on that
 * real state server-side while preserving search/status/sort/pagination
 * semantics exactly. Absent or invalid values must not silently change the
 * result set.
 */
describe("listUsers verified filter", () => {
  const PROFILES = [
    { id: "u1", email: "a@x.io", full_name: "Ada One", role: "admin", account_status: "active", monthly_budget: 0, created_at: "2026-01-01T00:00:00Z", last_login_at: null, last_active_at: null },
    { id: "u2", email: "b@x.io", full_name: "Bob Two", role: "user", account_status: "active", monthly_budget: 0, created_at: "2026-01-02T00:00:00Z", last_login_at: null, last_active_at: null },
    { id: "u3", email: "c@x.io", full_name: "Cara Three", role: "user", account_status: "suspended", monthly_budget: 0, created_at: "2026-01-03T00:00:00Z", last_login_at: null, last_active_at: null },
    { id: "u4", email: "d@x.io", full_name: "Dee Four", role: "user", account_status: "active", monthly_budget: 0, created_at: "2026-01-04T00:00:00Z", last_login_at: null, last_active_at: null },
  ];

  // u1 confirmed, u2 unconfirmed, u3 confirmed, u4 unknown to the rpc
  // (unknown ⇒ treated as unverified, matching the console's display rule).
  function authInfos(): MockQueryOptions["rpc"] {
    return {
      admin_auth_infos: () => ({
        data: [
          { user_id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z", auth_created_at: null, last_sign_in_at: null },
          { user_id: "u2", email_confirmed_at: null, auth_created_at: null, last_sign_in_at: null },
          { user_id: "u3", email_confirmed_at: "2026-01-03T00:00:00Z", auth_created_at: null, last_sign_in_at: null },
        ],
        error: null,
      }),
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

  function client(): MockClient {
    return createMockClient({
      tables: { profiles: PROFILES.map((p) => ({ ...p })), audit_logs: [] },
      rpc: authInfos(),
    });
  }

  it("returns only users whose email_confirmed_at is null when verified=false", async () => {
    const c = client();
    const res = (await listUsers(makeCtx(c), new Request("http://x"), {
      verified: "false",
      page: "1",
      pageSize: "10",
    })) as { items: Array<{ id: string; email_confirmed_at: string | null }> };
    // Default sort remains created_at desc → u4 before u2.
    expect(res.items.map((i) => i.id)).toEqual(["u4", "u2"]);
    for (const item of res.items) expect(item.email_confirmed_at).toBeNull();
  });

  it("treats users missing from the rpc response as unverified (display-consistent)", async () => {
    const c = createMockClient({
      tables: { profiles: PROFILES.map((p) => ({ ...p })), audit_logs: [] },
      rpc: { admin_auth_infos: () => ({ data: [], error: null }) },
    });
    const res = (await listUsers(makeCtx(c), new Request("http://x"), {
      verified: "false",
      page: "1",
      pageSize: "10",
    })) as { items: Array<{ id: string }>; total: number };
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(4);
  });

  it("combines with the account-status filter", async () => {
    const c = client();
    const res = (await listUsers(makeCtx(c), new Request("http://x"), {
      verified: "false",
      status: "suspended",
      page: "1",
      pageSize: "10",
    })) as { items: unknown[]; total: number };
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("keeps exact pagination over the filtered set", async () => {
    const c = client();
    const res = (await listUsers(makeCtx(c), new Request("http://x"), {
      verified: "false",
      sort: "full_name",
      order: "asc",
      page: "2",
      pageSize: "1",
    })) as { items: Array<{ id: string }>; total: number; pages: number };
    expect(res.total).toBe(2);
    expect(res.pages).toBe(2);
    // Ascending full_name over {u2 Bob, u4 Dee} → page 2 is Dee.
    expect(res.items.map((i) => i.id)).toEqual(["u4"]);
  });

  it("rejects unsupported verified values with 400 instead of ignoring them", async () => {
    const c = client();
    for (const value of ["true", "banana"]) {
      await expect(
        listUsers(makeCtx(c), new Request("http://x"), { verified: value })
      ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
  });

  it("leaves default behavior untouched when the param is absent", async () => {
    const c = client();
    const res = (await listUsers(makeCtx(c), new Request("http://x"), {})) as {
      items: Array<{ id: string }>;
      total: number;
    };
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(4);
  });

  it("still requires USER_VIEW", async () => {
    const c = client();
    await expect(
      listUsers(makeCtx(c, ALL_PERMISSIONS.filter((p) => p !== "USER_VIEW")), new Request("http://x"), {})
    ).rejects.toMatchObject({ status: 403 });
  });

  it("exports nothing sensitive beyond the existing projection", async () => {
    const c = client();
    const res = (await listUsers(makeCtx(c), new Request("http://x"), {
      verified: "false",
    })) as { items: Array<Record<string, unknown>> };
    for (const row of res.items) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "account_status",
          "created_at",
          "email",
          "email_confirmed_at",
          "full_name",
          "id",
          "last_active_at",
          "last_login_at",
          "last_sign_in_at",
          "monthly_budget",
          "role",
        ].sort()
      );
    }
  });
});
