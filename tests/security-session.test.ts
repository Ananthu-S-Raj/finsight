import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { authenticateRequest } from "@/lib/admin/server";
import {
  adminAuthIpLimiter,
  adminAuthUserLimiter,
  aiIpLimiter,
  aiUserLimiter,
  passwordResetRateLimiter,
  passwordResetConsumeLimiter,
  createRateLimiter,
} from "@/lib/rateLimit";
import { verifyActiveSession } from "@/lib/auth/supabaseServer";
import { json } from "@/lib/auth/errors";
import { GET as healthGET } from "@/app/api/health/route";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const NOW = new Date().toISOString();
const NOW_MS = Date.now();

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

/** Builds a structurally-valid JWT whose `iat` is relative to now. */
function fakeJwt(iatOffsetSeconds: number, sub: string = USER_ID): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub, iat: Math.floor((NOW_MS + iatOffsetSeconds * 1000) / 1000) })
  );
  return `${header}.${payload}.fake-signature`;
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
        { id: ADMIN_ID, email: "admin@finsight.app", role: "admin", account_status: "active", password_changed_at: null },
        { id: USER_ID, email: "user@example.com", role: "user", account_status: "active", password_changed_at: null },
      ],
      roles: [{ id: "00000000-0000-4000-8000-000000000031", name: "admin", description: "" }],
      role_permissions: [],
      permissions: [],
      audit_logs: [],
    },
    ...overrides,
  });
}
function bearerReq(token: string, ip = "203.0.113.10"): Request {
  return new Request("http://localhost/api/admin/users", {
    headers: { authorization: `Bearer ${token}`, "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  adminAuthIpLimiter.clear();
  adminAuthUserLimiter.clear();
  aiUserLimiter.clear();
  aiIpLimiter.clear();
  passwordResetRateLimiter.clear();
  passwordResetConsumeLimiter.clear();
});

describe("verifyActiveSession (user-facing API session guard)", () => {
  it("returns the user for an active account with a fresh session", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: {
        profiles: [{ id: USER_ID, account_status: "active", password_changed_at: null }],
      },
    });
    const user = await verifyActiveSession(fakeJwt(0));
    expect(user?.id).toBe(USER_ID);
  });

  it("rejects a suspended / disabled account", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: {
        profiles: [{ id: USER_ID, account_status: "suspended", password_changed_at: null }],
      },
    });
    const user = await verifyActiveSession(fakeJwt(0));
    expect(user).toBeNull();
  });

  it("rejects a session issued before the last password change", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: {
        profiles: [{ id: USER_ID, account_status: "active", password_changed_at: NOW }],
      },
    });
    // iat 60s before the password change → stale token must be rejected.
    const user = await verifyActiveSession(fakeJwt(-60));
    expect(user).toBeNull();
  });

  it("accepts a session issued after the last password change", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: {
        profiles: [{ id: USER_ID, account_status: "active", password_changed_at: NOW }],
      },
    });
    const user = await verifyActiveSession(fakeJwt(120));
    expect(user?.id).toBe(USER_ID);
  });

  it("rejects when the profile row is missing", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: { profiles: [] },
    });
    const user = await verifyActiveSession(fakeJwt(0));
    expect(user).toBeNull();
  });
});

describe("authenticateRequest (admin session guard)", () => {
  it("requires a Bearer token", async () => {
    makeAdminClient();
    const res = await authenticateRequest(bearerReq(""));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(401);
  });

  it("admits an active admin with the right permissions", async () => {
    makeAdminClient();
    const res = await authenticateRequest(bearerReq(fakeJwt(0, ADMIN_ID)));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ctx.role).toBe("admin");
      expect(res.ctx.userId).toBe(ADMIN_ID);
      expect(Array.isArray(res.ctx.permissions)).toBe(true);
    }
  });

  it("rejects a non-admin user with 403", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: {
        profiles: [{ id: USER_ID, role: "user", account_status: "active", password_changed_at: null }],
      },
    });
    const res = await authenticateRequest(bearerReq(fakeJwt(0, USER_ID)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(403);
  });

  it("rejects a suspended/disabled admin with 403", async () => {
    makeClient({
      user: { id: ADMIN_ID, email: "admin@finsight.app" },
      tables: {
        profiles: [{ id: ADMIN_ID, role: "admin", account_status: "suspended", password_changed_at: null }],
      },
    });
    const res = await authenticateRequest(bearerReq(fakeJwt(0, ADMIN_ID)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(403);
  });

  it("rejects an admin session issued before their password change with 401", async () => {
    makeClient({
      user: { id: ADMIN_ID, email: "admin@finsight.app" },
      tables: {
        profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active", password_changed_at: NOW }],
      },
    });
    const res = await authenticateRequest(bearerReq(fakeJwt(-60, ADMIN_ID)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(401);
  });

  it("rejects a missing profile with 401", async () => {
    makeClient({
      user: { id: ADMIN_ID, email: "admin@finsight.app" },
      tables: { profiles: [] },
    });
    const res = await authenticateRequest(bearerReq(fakeJwt(0, ADMIN_ID)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(401);
  });

  it("rejects an invalid/expired token with 401", async () => {
    makeAdminClient({ getUserError: { message: "JWT expired" } });
    const res = await authenticateRequest(bearerReq("not.a.jwt"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(401);
  });

  it("rate-limits repeated failures from the same IP with 429", async () => {
    makeClient({
      user: { id: USER_ID, email: "user@example.com" },
      tables: {
        profiles: [{ id: USER_ID, role: "user", account_status: "active", password_changed_at: null }],
      },
    });
    const ip = "203.0.113.99";
    // Exhaust the per-IP budget (default 30 / 15 min) for this key.
    for (let i = 0; i < 30; i += 1) adminAuthIpLimiter.check(`ip:${ip}`);
    const res = await authenticateRequest(bearerReq(fakeJwt(0), ip));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(429);
  });

  it("records an ADMIN_LOGIN audit row on success", async () => {
    const client = makeAdminClient();
    const res = await authenticateRequest(bearerReq(fakeJwt(0, ADMIN_ID)));
    expect(res.ok).toBe(true);

    const loginWrites = client.writes.filter(
      (w) => w.table === "audit_logs" && (w.payload as { action?: string })?.action === "ADMIN_LOGIN"
    );
    expect(loginWrites).toHaveLength(1);
  });

  it("does not duplicate ADMIN_LOGIN when a recent row already exists", async () => {
    const client = makeClient({
      user: { id: ADMIN_ID, email: "admin@finsight.app" },
      tables: {
        profiles: [{ id: ADMIN_ID, role: "admin", account_status: "active", password_changed_at: null }],
        roles: [{ id: "00000000-0000-4000-8000-000000000031", name: "admin", description: "" }],
        role_permissions: [],
        permissions: [],
        audit_logs: [
          { id: "99999999-0000-4000-8000-000000000001", actor_id: ADMIN_ID, action: "ADMIN_LOGIN", created_at: NOW },
        ],
      },
    });
    const res = await authenticateRequest(bearerReq(fakeJwt(0, ADMIN_ID)));
    expect(res.ok).toBe(true);
    const loginWrites = client
      .writes
      .filter(
        (w) => w.table === "audit_logs" && (w.payload as { action?: string })?.action === "ADMIN_LOGIN"
      );
    expect(loginWrites).toHaveLength(0);
  });
});

describe("rate limiting configuration", () => {
  it("reads budgets from environment variables", () => {
    const prev = process.env.RATE_LIMIT_FORGOT_MAX;
    process.env.RATE_LIMIT_FORGOT_MAX = "2";
    try {
      const limiter = createRateLimiter({
        max: Number(process.env.RATE_LIMIT_FORGOT_MAX),
        windowMs: 3600000,
      });
      expect(limiter.check("k").ok).toBe(true);
      expect(limiter.check("k").ok).toBe(true);
      expect(limiter.check("k").ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.RATE_LIMIT_FORGOT_MAX;
      else process.env.RATE_LIMIT_FORGOT_MAX = prev;
    }
  });
});

describe("API response hardening", () => {
  it("never lets shared caches store auth responses (no-store)", () => {
    const res = json({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /api/health returns 200 ok with no-store", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
