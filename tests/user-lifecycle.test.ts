import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/admin/server";
import {
  requestUserPasswordReset,
  revokeUserSessions,
  updateUser,
} from "@/lib/admin/handlers/users";
import { createMockClient, type MockQueryOptions } from "./helpers/supabase-mock";
import { ALL_PERMISSIONS, type PermissionCode } from "@/lib/admin/permissions";
import type { AdminContext } from "@/lib/admin/server";
import {
  adminPasswordResetRateLimiter,
  passwordResetRateLimiter,
} from "@/lib/rateLimit";
import { requestPasswordReset } from "@/lib/auth/passwordReset";
import { createAnonClient } from "@/lib/auth/supabaseServer";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/supabaseServer")>();
  return { ...actual, createAnonClient: vi.fn(() => ({})) };
});

vi.mock("@/lib/auth/passwordReset", () => ({
  requestPasswordReset: vi.fn(),
}));

const requestPasswordResetMock = vi.mocked(requestPasswordReset);
const createAnonClientMock = vi.mocked(createAnonClient);

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const OLD_STAMP = "2026-01-01T00:00:00.000Z";

type Row = Record<string, unknown>;

function makeTables(): Record<string, Row[]> {
  return {
    profiles: [
      {
        id: ADMIN_ID,
        email: "admin@finsight.app",
        full_name: "Admin One",
        role: "admin",
        account_status: "active",
        password_changed_at: OLD_STAMP,
        monthly_budget: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: USER_ID,
        email: "user@example.com",
        full_name: "Jane User",
        role: "user",
        account_status: "active",
        password_changed_at: OLD_STAMP,
        monthly_budget: 0,
        created_at: "2026-01-03T00:00:00Z",
      },
    ],
    transactions: [],
    push_subscriptions: [],
    audit_logs: [],
  };
}

/**
 * Mirrors public.admin_revoke_sessions: stamps ONLY the explicitly targeted
 * row, monotonically, and returns the new marker. The target id always comes
 * from the RPC argument — never from any implicit caller identity.
 */
function makeRevokeRpc(tables: Record<string, Row[]>, calls: string[]) {
  return {
    admin_revoke_sessions: (args?: unknown) => {
      const pUserId = (args as { p_user_id?: string } | undefined)?.p_user_id ?? null;
      calls.push(pUserId as string);
      const row = (tables.profiles as Row[]).find((r) => r.id === pUserId);
      if (!row) return { data: null, error: null };
      const now = new Date().toISOString();
      const current = typeof row.password_changed_at === "string" ? row.password_changed_at : "";
      if (!current || current < now) row.password_changed_at = now;
      return { data: row.password_changed_at, error: null };
    },
  };
}

function makeCtx(
  client: ReturnType<typeof createMockClient>,
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

function req(method: string, body?: unknown): Request {
  return new Request("http://localhost", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
  message?: string
) {
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

function auditActions(client: ReturnType<typeof createMockClient>): string[] {
  return client.writes
    .filter((w) => w.table === "audit_logs" && w.kind === "insert")
    .map((w) => (w.payload as { action: string }).action);
}

beforeEach(() => {
  vi.clearAllMocks();
  requestPasswordResetMock.mockResolvedValue({ message: "ok" });
  adminPasswordResetRateLimiter.clear();
  passwordResetRateLimiter.clear();
});

describe("force logout (revokeUserSessions)", () => {
  function makeRevokeClient(overrides?: Partial<MockQueryOptions>) {
    const tables = makeTables();
    const rpcCalls: string[] = [];
    const client = createMockClient({
      tables,
      rpc: makeRevokeRpc(tables, rpcCalls),
      ...overrides,
    });
    return { client, tables, rpcCalls };
  }

  it("revokes sessions for the target user and audits the action", async () => {
    const { client, tables } = makeRevokeClient();
    const result = await revokeUserSessions(makeCtx(client), req("POST"), { id: USER_ID });

    expect(result).toEqual({ id: USER_ID, sessions_revoked: true });

    const userRow = tables.profiles!.find((r) => r.id === USER_ID)!;
    expect(userRow.password_changed_at).not.toBe(OLD_STAMP);

    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && w.kind === "insert"
    );
    expect(audit).toBeDefined();
    const payload = audit!.payload as Record<string, unknown>;
    expect(payload.action).toBe("user.sessions_revoke");
    expect(payload.target_user_id).toBe(USER_ID);
    expect(payload.target_email).toBe("user@example.com");
    expect(payload.metadata).toEqual({ mechanism: "password_changed_at" });
  });

  it("MANDATORY REGRESSION: changes the TARGET's marker, never the admin's own", async () => {
    const { client, tables, rpcCalls } = makeRevokeClient();

    await revokeUserSessions(makeCtx(client), req("POST"), { id: USER_ID });

    // The RPC received the target id explicitly...
    expect(rpcCalls).toEqual([USER_ID]);
    expect(rpcCalls).not.toContain(ADMIN_ID);

    // ...so only the target's session marker moved. The acting admin's own
    // marker (and therefore the admin's live session) must be untouched.
    const adminRow = tables.profiles!.find((r) => r.id === ADMIN_ID)!;
    const userRow = tables.profiles!.find((r) => r.id === USER_ID)!;
    expect(adminRow.password_changed_at).toBe(OLD_STAMP);
    expect(userRow.password_changed_at).not.toBe(OLD_STAMP);
    expect(new Date(String(userRow.password_changed_at)).getTime()).toBeGreaterThan(
      new Date(OLD_STAMP).getTime()
    );
  });

  it("rejects an invalid target UUID with 400 and executes nothing", async () => {
    const { client, rpcCalls } = makeRevokeClient();
    await expectApiError(
      revokeUserSessions(makeCtx(client), req("POST"), { id: "../etc/passwd" }),
      400,
      "bad_request"
    );
    expect(rpcCalls).toEqual([]);
    expect(client.writes.length).toBe(0);
  });

  it("returns 404 when the target user does not exist and never runs the RPC", async () => {
    const { client, rpcCalls } = makeRevokeClient();
    await expectApiError(
      revokeUserSessions(makeCtx(client), req("POST"), {
        id: "00000000-0000-4000-8000-000000000099",
      }),
      404,
      "not_found"
    );
    expect(rpcCalls).toEqual([]);
  });

  it("requires USER_SUSPEND and does not execute the RPC without it", async () => {
    const { client, rpcCalls } = makeRevokeClient();
    const ctx = makeCtx(client, ["USER_VIEW"]);
    await expectApiError(
      revokeUserSessions(ctx, req("POST"), { id: USER_ID }),
      403,
      "forbidden"
    );
    expect(rpcCalls).toEqual([]);
    expect(client.writes.length).toBe(0);
  });

  it("surfaces RPC failure as db_error", async () => {
    const client = createMockClient({ tables: makeTables() }); // rpc not mocked -> error
    await expectApiError(
      revokeUserSessions(makeCtx(client), req("POST"), { id: USER_ID }),
      502,
      "db_error"
    );
    const actions = auditActions(client);
    expect(actions).toEqual([]);
  });

  it("treats a NULL marker response as failure and skips the audit", async () => {
    const tables = makeTables();
    const client = createMockClient({
      tables,
      rpc: {
        admin_revoke_sessions: () => ({ data: null, error: null }),
      },
    });
    await expectApiError(
      revokeUserSessions(makeCtx(client), req("POST"), { id: USER_ID }),
      502,
      "db_error"
    );
    expect(auditActions(client)).toEqual([]);
  });

  it("throws audit_failed when the audit store is down, after the marker moved", async () => {
    const { client, tables } = makeRevokeClient();
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "audit store down" } }) };
      }
      return originalFrom(table);
    }) as typeof client.from;

    await expectApiError(
      revokeUserSessions(makeCtx(client), req("POST"), { id: USER_ID }),
      500,
      "audit_failed"
    );

    const userRow = tables.profiles!.find((r) => r.id === USER_ID)!;
    expect(userRow.password_changed_at).not.toBe(OLD_STAMP);
  });
});

describe("admin-initiated password reset (requestUserPasswordReset)", () => {
  function makeResetClient(overrides?: Partial<MockQueryOptions>) {
    return createMockClient({ tables: makeTables(), ...overrides });
  }

  it("requests a reset for the correct target user through the shared engine", async () => {
    const client = makeResetClient();
    const result = await requestUserPasswordReset(makeCtx(client), req("POST"), {
      id: USER_ID,
    });

    expect(result).toEqual({
      id: USER_ID,
      message: "A password reset link has been sent to the user's email address.",
    });

    expect(createAnonClientMock).toHaveBeenCalledTimes(1);
    expect(requestPasswordResetMock).toHaveBeenCalledTimes(1);
    const [anonClient, info] = requestPasswordResetMock.mock.calls[0];
    expect(anonClient).toBeDefined();
    expect((info as { email: string }).email).toBe("user@example.com");

    const actions = auditActions(client);
    expect(actions).toEqual(["user.password_reset.request"]);
    const audit = client.writes.find((w) => w.table === "audit_logs")!;
    const payload = audit.payload as Record<string, unknown>;
    expect(payload.target_user_id).toBe(USER_ID);
    expect(payload.target_email).toBe("user@example.com");
  });

  it("never exposes tokens or passwords in the response", async () => {
    const client = makeResetClient();
    const result = (await requestUserPasswordReset(makeCtx(client), req("POST"), {
      id: USER_ID,
    })) as Record<string, unknown>;
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("password=");
    expect(Object.keys(result)).toEqual(["id", "message"]);
  });

  it("rejects an invalid target UUID with 400 without invoking the engine", async () => {
    const client = makeResetClient();
    await expectApiError(
      requestUserPasswordReset(makeCtx(client), req("POST"), { id: "not-a-uuid" }),
      400,
      "bad_request"
    );
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target user does not exist", async () => {
    const client = makeResetClient({
      tables: {
        ...makeTables(),
        profiles: (makeTables().profiles as Row[]).filter((r) => r.id !== USER_ID),
      },
    });
    await expectApiError(
      requestUserPasswordReset(makeCtx(client), req("POST"), { id: USER_ID }),
      404,
      "not_found"
    );
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });

  it("requires USER_EDIT", async () => {
    const client = makeResetClient();
    const ctx = makeCtx(client, ["USER_VIEW", "USER_SUSPEND"]);
    await expectApiError(
      requestUserPasswordReset(ctx, req("POST"), { id: USER_ID }),
      403,
      "forbidden"
    );
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });

  it("maps engine/provider failures to a generic 502 and skips the audit", async () => {
    const client = makeResetClient();
    requestPasswordResetMock.mockRejectedValueOnce(new Error("smtp down"));

    await expectApiError(
      requestUserPasswordReset(makeCtx(client), req("POST"), { id: USER_ID }),
      502,
      "reset_failed"
    );
    expect(auditActions(client)).toEqual([]);
  });

  it("uses a rate limiter instance independent from the public forgot-password limiter", () => {
    // Exhaust the PUBLIC limiter completely (5 allowed, 6th is refused)...
    let exhausted = false;
    for (let i = 0; i < 6; i += 1) exhausted = !passwordResetRateLimiter.check("shared-key").ok;
    expect(exhausted).toBe(true);

    // ...the admin limiter is untouched by that traffic.
    expect(adminPasswordResetRateLimiter.check("shared-key").ok).toBe(true);

    // And vice versa: saturating the admin budget leaves the public one alone.
    adminPasswordResetRateLimiter.clear();
    let adminExhausted = false;
    for (let i = 0; i < 11; i += 1) adminExhausted = !adminPasswordResetRateLimiter.check("shared-key").ok;
    expect(adminExhausted).toBe(true);

    passwordResetRateLimiter.clear();
    expect(passwordResetRateLimiter.check("shared-key").ok).toBe(true);
  });

  it("enforces its own budget across repeated requests", async () => {
    const client = makeResetClient();
    const ctx = makeCtx(client);
    for (let i = 0; i < 10; i += 1) {
      await requestUserPasswordReset(ctx, req("POST"), { id: USER_ID });
    }
    await expectApiError(
      requestUserPasswordReset(ctx, req("POST"), { id: USER_ID }),
      429,
      "rate_limited"
    );
  });
});

describe("lifecycle audit actions (updateUser)", () => {
  function makeUpdateClient(statusForUser = "active") {
    const tables = makeTables();
    (tables.profiles!.find((r) => r.id === USER_ID) as Row).account_status = statusForUser;
    return createMockClient({ tables });
  }

  it("audits a suspend-only update as user.suspend", async () => {
    const client = makeUpdateClient();
    const result = await updateUser(makeCtx(client), req("PATCH", { account_status: "suspended" }), {
      id: USER_ID,
    });
    expect(result).toMatchObject({ account_status: "suspended" });
    expect(auditActions(client)).toEqual(["user.suspend"]);
  });

  it("audits a disable-only update as user.disable", async () => {
    const client = makeUpdateClient();
    await updateUser(makeCtx(client), req("PATCH", { account_status: "disabled" }), {
      id: USER_ID,
    });
    expect(auditActions(client)).toEqual(["user.disable"]);
  });

  it("audits an activation of a suspended account as user.activate", async () => {
    const client = makeUpdateClient("suspended");
    await updateUser(makeCtx(client), req("PATCH", { account_status: "active" }), {
      id: USER_ID,
    });
    expect(auditActions(client)).toEqual(["user.activate"]);
  });

  it("keeps user.update for mixed changes", async () => {
    const client = makeUpdateClient();
    await updateUser(
      makeCtx(client),
      req("PATCH", { full_name: "Renamed Jane", account_status: "suspended" }),
      { id: USER_ID }
    );
    const actions = auditActions(client);
    expect(actions).toEqual(["user.update"]);

    const payload = (
      client.writes.find((w) => w.table === "audit_logs")! .payload
    ) as Record<string, unknown>;
    expect(payload.metadata).toEqual({ account_status: "suspended" });
  });

  it("keeps user.update for profile-only changes", async () => {
    const client = makeUpdateClient();
    await updateUser(makeCtx(client), req("PATCH", { full_name: "Renamed" }), { id: USER_ID });
    expect(auditActions(client)).toEqual(["user.update"]);
  });

  it("keeps every mutation audited exactly once", async () => {
    const client = makeUpdateClient();
    await updateUser(makeCtx(client), req("PATCH", { account_status: "suspended" }), {
      id: USER_ID,
    });
    expect(client.writes.filter((w) => w.table === "audit_logs")).toHaveLength(1);
  });

  it("remains fatal when the lifecycle audit cannot be written", async () => {
    const client = makeUpdateClient();
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "audit_logs") {
        return { insert: () => Promise.resolve({ error: { message: "audit store down" } }) };
      }
      return originalFrom(table);
    }) as typeof client.from;

    await expectApiError(
      updateUser(makeCtx(client), req("PATCH", { account_status: "suspended" }), {
        id: USER_ID,
      }),
      500,
      "audit_failed"
    );
  });
});
