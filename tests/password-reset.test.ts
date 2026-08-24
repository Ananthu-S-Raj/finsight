import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthApiError } from "@/lib/auth/errors";
import {
  ADMIN_CHANGE_AUDIT_ACTION,
  ADMIN_RESET_AUDIT_ACTION,
  GENERIC_RESET_MESSAGE,
  RESET_TOKEN_TTL_MS,
  changePassword,
  completePasswordReset,
  requestPasswordReset,
  sha256Hex,
} from "@/lib/auth/passwordReset";
import { validatePassword } from "@/lib/auth/passwordPolicy";
import { createRateLimiter, passwordResetConsumeLimiter, passwordResetRateLimiter } from "@/lib/rateLimit";
import { jwtIssuedBefore } from "@/lib/jwt";
import { authenticateRequest } from "@/lib/admin/server";
import { createMockClient, type MockClient, type MockQueryOptions } from "./helpers/supabase-mock";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

import { POST as forgotPasswordPOST } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resetPasswordPOST } from "@/app/api/v1/auth/reset-password/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const USER_EMAIL = "user@example.com";
const ADMIN_EMAIL = "admin@finsight.app";
const NEW_PASSWORD = "Str0ngPass!23";

const NOW = new Date("2026-08-10T10:00:00Z").getTime();
const EXPIRES_AT = new Date(NOW + RESET_TOKEN_TTL_MS).toISOString();

function baseProfiles(): Record<string, unknown>[] {
  return [
    { id: USER_ID, email: USER_EMAIL, full_name: "Jane User", role: "user", account_status: "active" },
    { id: ADMIN_ID, email: ADMIN_EMAIL, full_name: "Admin One", role: "admin", account_status: "active" },
  ];
}

function makeClient(opts: MockQueryOptions = {}): MockClient {
  return createMockClient({
    user: { id: USER_ID, email: USER_EMAIL },
    tables: { profiles: baseProfiles(), audit_logs: [] },
    rpc: {
      request_password_reset: () => ({ data: true, error: null }),
      mark_password_reset_token_used: () => ({ data: true, error: null }),
      set_password_changed_at: () => ({ data: EXPIRES_AT, error: null }),
    },
    ...opts,
  });
}

function fakeJwt(iatSeconds: number, sub: string): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub, iat: iatSeconds, exp: iatSeconds + 3600 })}.sig`;
}

async function expectAuthApiError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
  messageContains?: string
) {
  try {
    await promise;
    expect.unreachable("expected AuthApiError");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthApiError);
    expect((err as AuthApiError).status).toBe(status);
    if (code !== undefined) expect((err as AuthApiError).code).toBe(code);
    if (messageContains !== undefined) expect((err as AuthApiError).message).toContain(messageContains);
  }
}

beforeEach(() => {
  passwordResetRateLimiter.clear();
  passwordResetConsumeLimiter.clear();
  vi.clearAllMocks();
});

describe("password policy", () => {
  it("accepts a compliant password", () => {
    expect(validatePassword("Abcdef12")).toBeNull();
  });

  it("rejects fewer than 8 characters", () => {
    expect(validatePassword("Abc12")).toContain("8 characters");
  });

  it("rejects missing uppercase, lowercase, and number", () => {
    expect(validatePassword("abcdefgh")).toContain("uppercase");
    expect(validatePassword("ABCDEFGH")).toContain("lowercase");
    expect(validatePassword("Abcdefgh")).toContain("number");
  });

  it("rejects empty / non-string passwords", () => {
    expect(validatePassword("")).toBe("Password is required.");
    expect(validatePassword(undefined)).toBe("Password is required.");
  });
});

describe("forgot-password (request password reset)", () => {
  it("sends a reset email for an existing user and returns the generic message", async () => {
    const client = makeClient();
    const result = await requestPasswordReset(client as never, { email: USER_EMAIL, ip: "127.0.0.1" });

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });

    const emailCall = client.authCalls.find((c) => c.method === "resetPasswordForEmail");
    expect(emailCall).toBeDefined();
    const { email, options } = emailCall!.args as { email: string; options: { redirectTo: string } };
    expect(email).toBe(USER_EMAIL);
    expect(options.redirectTo).toContain("/reset-password");
  });

  it("returns the exact same response for an unknown email (no enumeration)", async () => {
    const knownClient = makeClient();
    const known = await requestPasswordReset(knownClient as never, { email: USER_EMAIL });

    const unknownClient = makeClient({
      rpc: { request_password_reset: () => ({ data: false, error: null }) },
    });
    const unknown = await requestPasswordReset(unknownClient as never, { email: "nobody@example.com" });

    expect(known.message).toBe(GENERIC_RESET_MESSAGE);
    expect(unknown.message).toBe(known.message);
    // The email-send is still invoked so timing/behavior is uniform.
    const unknownEmailCall = unknownClient.authCalls.find((c) => c.method === "resetPasswordForEmail");
    expect(unknownEmailCall).toBeDefined();
  });

  it("normalizes the email and rejects missing emails", async () => {
    const client = makeClient();
    await requestPasswordReset(client as never, { email: "  User@Example.COM " });
    const call = client.authCalls.find((c) => c.method === "resetPasswordForEmail");
    const { email } = call!.args as { email: string };
    expect(email).toBe("user@example.com");

    await expectAuthApiError(requestPasswordReset(client as never, { email: "" }), 400, "bad_request");
  });
});

describe("reset-password (complete password reset)", () => {
  it("rejects a weak new password", async () => {
    const client = makeClient();
    await expectAuthApiError(
      completePasswordReset(client as never, { token: "tok", newPassword: "short" }),
      400,
      "weak_password"
    );
  });

  it("rejects a missing token", async () => {
    const client = makeClient();
    await expectAuthApiError(
      completePasswordReset(client as never, { token: "", newPassword: NEW_PASSWORD }),
      400,
      "bad_request"
    );
  });

  it("rejects an invalid token (Supabase rejects the recovery code)", async () => {
    const client = makeClient({
      auth: { verifyOtp: () => ({ data: null, error: { message: "Token has expired or is invalid" } }) },
    });
    await expectAuthApiError(
      completePasswordReset(client as never, { token: "bad-token", newPassword: NEW_PASSWORD }),
      400,
      "invalid_token",
      "invalid or has expired"
    );
  });

  it("rejects an expired / already-used token (our single-use guard fails)", async () => {
    const client = makeClient({
      rpc: { mark_password_reset_token_used: () => ({ data: false, error: null }) },
    });
    await expectAuthApiError(
      completePasswordReset(client as never, { token: "used-token", newPassword: NEW_PASSWORD }),
      400,
      "invalid_token",
      "invalid, has expired, or has already been used"
    );
  });

  it("completes the reset, stores only the token hash, and invalidates old sessions", async () => {
    const rpcArgs: Array<{ name: string; args: unknown }> = [];
    const client = makeClient({
      rpc: {
        mark_password_reset_token_used: (args) => {
          rpcArgs.push({ name: "mark_password_reset_token_used", args });
          return { data: true, error: null };
        },
        set_password_changed_at: (args) => {
          rpcArgs.push({ name: "set_password_changed_at", args });
          return { data: EXPIRES_AT, error: null };
        },
      },
    });

    const result = await completePasswordReset(client as never, {
      token: "raw-token-value",
      newPassword: NEW_PASSWORD,
      ip: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(result.message).toBe("Password reset successful.");
    expect(result.userId).toBe(USER_ID);

    // Raw token must never be persisted — only its SHA-256 hash.
    const used = rpcArgs.find((r) => r.name === "mark_password_reset_token_used");
    const usedArgs = used!.args as { p_token_hash: string; p_user_id: string };
    expect(usedArgs.p_token_hash).toBe(await sha256Hex("raw-token-value"));
    expect(usedArgs.p_token_hash).not.toContain("raw-token-value");

    const updateCall = client.authCalls.find((c) => c.method === "updateUser");
    expect(updateCall).toBeDefined();
    expect((updateCall!.args as { password: string }).password).toBe(NEW_PASSWORD);
    expect(rpcArgs.some((r) => r.name === "set_password_changed_at")).toBe(true);
  });

  it("creates an ADMIN_PASSWORD_RESET_COMPLETED audit for an admin reset", async () => {
    const client = makeClient({ user: { id: ADMIN_ID, email: ADMIN_EMAIL } });

    await completePasswordReset(client as never, {
      token: "admin-token",
      newPassword: NEW_PASSWORD,
      ip: "203.0.113.9",
      userAgent: "vitest-admin",
    });

    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === ADMIN_RESET_AUDIT_ACTION
    );
    expect(audit).toBeDefined();
    const payload = audit!.payload as Record<string, unknown>;
    expect(payload.actor_id).toBe(ADMIN_ID);
    expect(payload.actor_email).toBe(ADMIN_EMAIL);
    expect(payload.target_user_id).toBe(ADMIN_ID);
    expect(payload.ip).toBe("203.0.113.9");
    expect(payload.user_agent).toBe("vitest-admin");
    expect(payload.result).toBe("success");
    expect((payload.metadata as Record<string, unknown>).method).toBe("reset");
  });

  it("does NOT create an admin audit when a regular user resets their password", async () => {
    const client = makeClient();
    await completePasswordReset(client as never, { token: "user-token", newPassword: NEW_PASSWORD });
    const audits = client.writes.filter((w) => w.table === "audit_logs");
    expect(audits.length).toBe(0);
  });
});

describe("change-password (authenticated)", () => {
  it("rejects when the current password is wrong", async () => {
    const client = makeClient({
      auth: {
        signInWithPassword: () => ({ data: null, error: { message: "Invalid login credentials" } }),
      },
    });
    await expectAuthApiError(
      changePassword(client as never, { email: USER_EMAIL, currentPassword: "WrongPass1", newPassword: NEW_PASSWORD }),
      401,
      "bad_credentials",
      "Current password is incorrect"
    );
  });

  it("rejects a weak new password and a same-password change", async () => {
    const client = makeClient();
    await expectAuthApiError(
      changePassword(client as never, { email: USER_EMAIL, currentPassword: "OldPass1!", newPassword: "weak" }),
      400,
      "weak_password"
    );
    await expectAuthApiError(
      changePassword(client as never, { email: USER_EMAIL, currentPassword: "OldPass1!", newPassword: "OldPass1!" }),
      400,
      "same_password"
    );
  });

  it("completes the change and stamps password_changed_at to invalidate old sessions", async () => {
    const rpcCalls: string[] = [];
    const client = makeClient({
      rpc: {
        set_password_changed_at: () => {
          rpcCalls.push("set_password_changed_at");
          return { data: EXPIRES_AT, error: null };
        },
      },
    });

    const result = await changePassword(client as never, {
      email: USER_EMAIL,
      currentPassword: "OldPass1!",
      newPassword: NEW_PASSWORD,
    });
    expect(result.message).toBe("Password changed successfully.");
    expect(rpcCalls).toContain("set_password_changed_at");

    const signIn = client.authCalls.find((c) => c.method === "signInWithPassword");
    expect(signIn).toBeDefined();
    const updateCall = client.authCalls.find((c) => c.method === "updateUser");
    expect((updateCall!.args as { password: string }).password).toBe(NEW_PASSWORD);
  });

  it("creates an ADMIN_PASSWORD_CHANGE_COMPLETED audit for an admin", async () => {
    const client = makeClient({ user: { id: ADMIN_ID, email: ADMIN_EMAIL } });
    await changePassword(client as never, {
      email: ADMIN_EMAIL,
      currentPassword: "OldAdmin1!",
      newPassword: NEW_PASSWORD,
    });
    const audit = client.writes.find(
      (w) => w.table === "audit_logs" && (w.payload as { action: string }).action === ADMIN_CHANGE_AUDIT_ACTION
    );
    expect(audit).toBeDefined();
    expect((audit!.payload as Record<string, unknown>).actor_id).toBe(ADMIN_ID);
  });
});

describe("session invalidation after password change/reset", () => {
  it("treats JWTs issued before the change as stale, and newer ones as valid", () => {
    const changedAtMs = NOW;
    const oldToken = fakeJwt(Math.floor((NOW - 60_000) / 1000), USER_ID);
    const newToken = fakeJwt(Math.floor((NOW + 60_000) / 1000), USER_ID);

    expect(jwtIssuedBefore(oldToken, changedAtMs)).toBe(true);
    expect(jwtIssuedBefore(newToken, changedAtMs)).toBe(false);
    expect(jwtIssuedBefore("not-a-jwt", changedAtMs)).toBe(false);
  });

  it("rejects an admin session issued before the password change (server-side)", async () => {
    const changedAtIso = new Date(NOW + 60_000).toISOString();
    const oldToken = fakeJwt(Math.floor(NOW / 1000), ADMIN_ID);
    const client = createMockClient({
      user: { id: ADMIN_ID, email: ADMIN_EMAIL },
      tables: {
        profiles: [
          { id: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", account_status: "active", password_changed_at: changedAtIso },
        ],
        roles: [],
        permissions: [],
        role_permissions: [],
      },
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: `Bearer ${oldToken}` } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(401);
      expect(result.error.message).toContain("invalidated");
    }
  });

  it("admits an admin session issued after the password change", async () => {
    const changedAtIso = new Date(NOW - 60_000).toISOString();
    const freshToken = fakeJwt(Math.floor(NOW / 1000), ADMIN_ID);
    const client = createMockClient({
      user: { id: ADMIN_ID, email: ADMIN_EMAIL },
      tables: {
        profiles: [
          { id: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", account_status: "active", password_changed_at: changedAtIso },
        ],
        roles: [{ id: "00000000-0000-4000-8000-000000000031", name: "admin", is_system: true }],
        permissions: [],
        role_permissions: [],
      },
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const result = await authenticateRequest(
      new Request("http://localhost", { headers: { Authorization: `Bearer ${freshToken}` } })
    );
    expect(result.ok).toBe(true);
  });
});

describe("rate limiting", () => {
  it("allows 5 requests/hour and blocks the 6th with retry-after (per key)", () => {
    const limiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("key", now).ok).toBe(true);
    }
    const sixth = limiter.check("key", now);
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    // A different key is unaffected (per-IP and per-email are separate).
    expect(limiter.check("other-key", now).ok).toBe(true);
  });

  it("expires after the window elapses", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    const now = 1_000_000;
    limiter.check("k", now);
    limiter.check("k", now);
    expect(limiter.check("k", now).ok).toBe(false);
    expect(limiter.check("k", now + 60_001).ok).toBe(true);
  });
});

describe("HTTP endpoints", () => {
  function makeRouteClient(opts: MockQueryOptions = {}): MockClient {
    const client = makeClient(opts);
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);
    return client;
  }

  it("POST /api/v1/auth/forgot-password → 200 generic message + email", async () => {
    const client = makeRouteClient();
    const res = await forgotPasswordPOST(
      new Request("http://localhost/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
        body: JSON.stringify({ email: USER_EMAIL }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe(GENERIC_RESET_MESSAGE);
    const emailCall = client.authCalls.find((c) => c.method === "resetPasswordForEmail");
    expect(emailCall).toBeDefined();
  });

  it("POST /api/v1/auth/forgot-password → 429 after 5 requests/hour from one IP", async () => {
    makeRouteClient();
    const makeReq = () =>
      new Request("http://localhost/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.7" },
        body: JSON.stringify({ email: USER_EMAIL }),
      });
    for (let i = 0; i < 5; i++) {
      expect((await forgotPasswordPOST(makeReq())).status).toBe(200);
    }
    const sixth = await forgotPasswordPOST(makeReq());
    expect(sixth.status).toBe(429);
    const body = await sixth.json();
    expect(body.code).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("POST /api/v1/auth/forgot-password → 429 after 5 requests/hour for one email", async () => {
    makeRouteClient();
    const makeReq = (ip: string) =>
      new Request("http://localhost/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: "victim@example.com" }),
      });
    for (let i = 0; i < 5; i++) {
      expect((await forgotPasswordPOST(makeReq(`10.0.0.${i}`))).status).toBe(200);
    }
    expect((await forgotPasswordPOST(makeReq("10.0.0.99"))).status).toBe(429);
  });

  it("POST /api/v1/auth/reset-password → 200 on a valid token, updating the password", async () => {
    const client = makeRouteClient();
    const res = await resetPasswordPOST(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "valid-token", new_password: NEW_PASSWORD }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Password reset successful.");
    const updateCall = client.authCalls.find((c) => c.method === "updateUser");
    expect(updateCall).toBeDefined();
  });

  it("POST /api/v1/auth/reset-password → 400 on an invalid token", async () => {
    makeRouteClient({
      auth: { verifyOtp: () => ({ data: null, error: { message: "invalid" } }) },
    });
    const res = await resetPasswordPOST(
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "bad-token", new_password: NEW_PASSWORD }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_token");
  });

  it("POST /api/v1/auth/reset-password → 429 after 10 attempts per IP", async () => {
    makeRouteClient();
    const makeReq = () =>
      new Request("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.42" },
        body: JSON.stringify({ token: "t", new_password: NEW_PASSWORD }),
      });
    for (let i = 0; i < 10; i++) {
      expect((await resetPasswordPOST(makeReq())).status).toBe(200);
    }
    expect((await resetPasswordPOST(makeReq())).status).toBe(429);
  });
});
