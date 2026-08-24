import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000003";
const BROADCAST_ID = "00000000-0000-4000-8000-000000000050";

// Controllable app_status result shared by all mocks in this file.
let rpcResult: { data: unknown; error: unknown };

vi.mock("@/lib/auth/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/supabaseServer")>();
  return {
    ...actual,
    createAnonClient: vi.fn(() => ({
      rpc: (fn: string) => {
        expect(fn).toBe("app_status");
        return Promise.resolve(rpcResult);
      },
    })),
    verifyActiveSession: vi.fn(async () => ({ id: USER_ID, email: "user@example.com" })),
    createUserClient: vi.fn(() => ({})),
  };
});

vi.mock("@/lib/notificationsServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notificationsServer")>();
  return {
    ...actual,
    dbMarkBroadcastRead: vi.fn(async () => ({ ok: true })),
    dbListBroadcasts: vi.fn(async () => ({ items: [] })),
  };
});

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  const spy = () => vi.fn(() => ({ ok: true, retryAfterSeconds: 60 }));
  return {
    ...actual,
    aiUserLimiter: { check: spy() },
    aiIpLimiter: { check: spy() },
  };
});

import { createAnonClient, verifyActiveSession } from "@/lib/auth/supabaseServer";
import {
  assertNotUnderMaintenance,
  isUnderMaintenance,
  resetMaintenanceCacheForTests,
} from "@/lib/maintenance";
import { AuthApiError } from "@/lib/auth/errors";
import { logger } from "@/lib/logger";
import { dbMarkBroadcastRead, dbListBroadcasts } from "@/lib/notificationsServer";
import { aiUserLimiter } from "@/lib/rateLimit";
import { POST as notificationsPost, GET as notificationsGet } from "@/app/api/v1/notifications/[[...slug]]/route";
import { POST as insightsPost } from "@/app/api/v1/ai/insights/route";

function setMaintenance(active: boolean | "error") {
  if (active === "error") rpcResult = { data: null, error: { message: "boom" } };
  else rpcResult = { data: [{ maintenance: active, app_name: "FinSight" }], error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMaintenanceCacheForTests();
  setMaintenance(false);
});

describe("isUnderMaintenance", () => {
  it("reads true from the app_status rpc", async () => {
    setMaintenance(true);
    expect(await isUnderMaintenance()).toBe(true);
  });

  it("reads false when maintenance is off", async () => {
    expect(await isUnderMaintenance()).toBe(false);
  });

  it("fails open when the rpc errors", async () => {
    setMaintenance("error");
    expect(await isUnderMaintenance()).toBe(false);
  });

  it("caches the flag within the TTL window", async () => {
    setMaintenance(true);
    expect(await isUnderMaintenance()).toBe(true);
    setMaintenance(false); // source flips, but cache should still hold true
    expect(await isUnderMaintenance()).toBe(true);
    const anon = vi.mocked(createAnonClient);
    expect(anon).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the test reset hook clears the cache", async () => {
    setMaintenance(true);
    expect(await isUnderMaintenance()).toBe(true);
    setMaintenance(false);
    resetMaintenanceCacheForTests();
    expect(await isUnderMaintenance()).toBe(false);
    expect(vi.mocked(createAnonClient)).toHaveBeenCalledTimes(2);
  });
});

describe("assertNotUnderMaintenance", () => {
  it("throws 503/maintenance_mode while active and logs the blocked request", async () => {
    setMaintenance(true);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const err = await assertNotUnderMaintenance({
      route: "/api/v1/recurring",
      method: "POST",
      userId: USER_ID,
    }).then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(AuthApiError);
    const apiErr = err as AuthApiError;
    expect(apiErr.status).toBe(503);
    expect(apiErr.code).toBe("maintenance_mode");
    expect(warn).toHaveBeenCalledWith(
      "user-api",
      "maintenance_blocked",
      expect.objectContaining({ route: "/api/v1/recurring", method: "POST", userId: USER_ID })
    );
    warn.mockRestore();
  });

  it("resolves without logging when inactive", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await expect(
      assertNotUnderMaintenance({ route: "/api/v1/goals", method: "DELETE", userId: USER_ID })
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("route-level enforcement (notifications mark-read)", () => {
  function markReadRequest() {
    return new Request(`http://localhost/api/v1/notifications/${BROADCAST_ID}/read`, {
      method: "POST",
      headers: { Authorization: "Bearer valid-session-token" },
    });
  }

  function routeCtx() {
    return { params: Promise.resolve({ slug: [BROADCAST_ID, "read"] }) };
  }

  function bearerRequest(method: string, body?: string) {
    return new Request("http://localhost/api/v1/test", {
      method,
      headers: {
        Authorization: "Bearer valid-session-token",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
    });
  }

  it("rejects the mutation with 503 maintenance_mode and never touches the data layer", async () => {
    setMaintenance(true);
    const res = await notificationsPost(markReadRequest(), routeCtx());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("maintenance_mode");
    expect(body.error).toMatch(/maintenance/i);
    // Session was validated first...
    expect(verifyActiveSession).toHaveBeenCalledTimes(1);
    // ...but the write never happened.
    expect(dbMarkBroadcastRead).not.toHaveBeenCalled();
  });

  it("allows the same mutation once maintenance is off", async () => {
    const res = await notificationsPost(markReadRequest(), routeCtx());
    expect(res.status).toBe(200);
    expect(dbMarkBroadcastRead).toHaveBeenCalledWith(expect.anything(), USER_ID, BROADCAST_ID);
  });

  it("still rejects unauthenticated mutations regardless of the flag", async () => {
    const res = await notificationsPost(
      new Request(`http://localhost/api/v1/notifications/${BROADCAST_ID}/read`, { method: "POST" }),
      routeCtx()
    );
    expect(res.status).toBe(401);
    expect(dbMarkBroadcastRead).not.toHaveBeenCalled();
  });

  it("checks AUTH before maintenance: unauthenticated request gets 401 even while the flag is ON", async () => {
    setMaintenance(true);
    resetMaintenanceCacheForTests();
    // Warm the cache so a 503 would be guaranteed if the gate ran first.
    await isUnderMaintenance();
    const res = await notificationsPost(
      new Request(`http://localhost/api/v1/notifications/${BROADCAST_ID}/read`, { method: "POST" }),
      routeCtx()
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unauthorized");
  });

  it("keeps user READS available while the flag is ON", async () => {
    setMaintenance(true);
    const res = await notificationsGet(bearerRequest("GET"), {
      params: Promise.resolve({ slug: [] }),
    });
    expect(res.status).toBe(200);
    expect(dbListBroadcasts).toHaveBeenCalledWith(expect.anything(), USER_ID, null, null);
  });

  it("gates BEFORE rate limiting on ai/insights (auth → maintenance → limiter)", async () => {
    setMaintenance(true);
    const res = await insightsPost(bearerRequest("POST", JSON.stringify({})));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("maintenance_mode");
    expect(aiUserLimiter.check).not.toHaveBeenCalled();
  });
});
