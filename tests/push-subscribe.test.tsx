// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = { id: string; subscription: { endpoint?: string } };

const rows: Row[] = [];
const insertMock = vi.fn(async () => ({ error: null }));
const selectMock = vi.fn(() => ({ eq: vi.fn(async () => ({ data: rows, error: null })) }));
const getSessionMock = vi.fn(async () => ({ data: { session: null }, error: null }));
let insertResult: { error: { code?: string; message?: string } | null } = { error: null };
const fromMock = vi.fn((table: string) =>
  table === "push_subscriptions"
    ? {
        insert: (v: { subscription?: { endpoint?: string } }) => {
          insertMock(v);
          // Simulate a raced persist: another tab wins the insert and the row
          // exists when we re-check after a 23505 duplicate-endpoint error.
          if (insertResult.error?.code === "23505") {
            rows.push({ id: "race-" + rows.length, subscription: { endpoint: v?.subscription?.endpoint } });
          }
          return Promise.resolve(insertResult);
        },
        select: selectMock,
        update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
        delete: () => ({ eq: vi.fn(async () => ({ error: null })) }),
      }
    : { select, insert: insertMock }
);

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: fromMock, auth: { getSession: getSessionMock } },
}));

const {
  subscribeForPush,
  isSubscribed,
  supportsPush,
  sendTestNotification,
  SW_READY_TIMEOUT_MS,
} = await import("@/lib/push");

function stubBrowser(opts: {
  subscription: { endpoint: string } | null;
  subscribeThrows?: boolean;
  permission?: "granted" | "denied" | "default";
}) {
  const subscription = opts.subscription
    ? {
        ...opts.subscription,
        toJSON: () => opts.subscription,
        unsubscribe: vi.fn(async () => true),
      }
    : null;
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async () => {
      if (opts.subscribeThrows) throw new Error("push service rejected");
      return subscription;
    }),
  };
  const reg = { pushManager };
  const sw = { serviceWorker: { ready: Promise.resolve(reg) } };
  vi.stubGlobal("navigator", { ...navigator, ...sw });
  vi.stubGlobal(
    "PushManager",
    class {}
  );
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "granted";
      static requestPermission = vi.fn(async () => opts.permission ?? "granted");
    }
  );
  return { getSubscription: pushManager.getSubscription };
}

beforeEach(() => {
  rows.length = 0;
  insertMock.mockClear();
  selectMock.mockClear();
  fromMock.mockClear();
  getSessionMock.mockClear();
  insertResult = { error: null };
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

describe("subscribeForPush — VAPID + failure classification", () => {
  it("reports unsupported when the browser lacks push APIs", async () => {
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("reports denied when the browser rejects notification permission (no subscription attempted)", async () => {
    stubBrowser({ subscription: null, permission: "denied" });
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "denied" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports default (not denied) when the permission prompt is dismissed", async () => {
    stubBrowser({ subscription: null, permission: "default" });
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "default" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports no-worker when the service worker never becomes ready (bounded wait, no hang)", async () => {
    stubBrowser({ subscription: null });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87); // valid key
    // Replace the ready promise with one that never settles — the real API
    // never rejects, so a broken registration would previously spin forever.
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: { ready: new Promise(() => {}) },
    });
    vi.useFakeTimers();
    try {
      const resultPromise = subscribeForPush("u1");
      await vi.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS + 50);
      expect(await resultPromise).toEqual({ ok: false, reason: "no-worker" });
      expect(insertMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports missing-vapid when no public key is configured", async () => {
    stubBrowser({ subscription: null });
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "missing-vapid" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports invalid-vapid for the placeholder / malformed key (no subscription attempt)", async () => {
    stubBrowser({ subscription: null });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "generated-vapid-public-key";
    expect(await subscribeForPush("u1")).toEqual({ ok: false, reason: "invalid-vapid" });

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "not-base64!!!";
    expect(await subscribeForPush("u1")).toEqual({ ok: false, reason: "invalid-vapid" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports a generic error reason when the push service rejects subscription", async () => {
    stubBrowser({ subscription: null, subscribeThrows: true });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87); // valid 65-byte key
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("drops a stale browser subscription before subscribing fresh (self-heal of InvalidStateError)", async () => {
    // A browser holds a subscription under a different VAPID key whose server
    // row is gone. subscribe() would otherwise throw InvalidStateError forever;
    // the flow must unsubscribe the stale one and persist the fresh one.
    const staleUnsubscribe = vi.fn(async () => true);
    const subscribe = vi.fn(async () => ({
      endpoint: "https://push.example/fresh",
      toJSON: () => ({ endpoint: "https://push.example/fresh" }),
    }));
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn(async () => ({
              endpoint: "https://push.example/stale",
              toJSON: () => ({ endpoint: "https://push.example/stale" }),
              unsubscribe: staleUnsubscribe,
            })),
            subscribe,
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "granted";
        static requestPermission = vi.fn(async () => "granted");
      }
    );
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);

    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: true });
    expect(staleUnsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0].applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        subscription: expect.objectContaining({ endpoint: "https://push.example/fresh" }),
      })
    );
  });

  it("treats an existing persisted subscription as success without re-subscribing", async () => {
    // The not-stored browser sub from a previous key was already reconciled to
    // a stored row (or a second call happened) — no duplicate subscribe/insert.
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: true });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("registers successfully when the key is valid and the push service accepts", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ user_id: "u1" });
  });

  it("reuses a stored server row for the same endpoint — no duplicate insert", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: true });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("treats a duplicate-endpoint insert (23505) as success when the row exists", async () => {
    // The browser still has a valid subscription whose server row was cleaned
    // up (e.g. removed after a 410). The first check finds nothing, the insert
    // hits the unique endpoint index, and the re-check confirms the endpoint
    // is now stored — that is a successful registration, not a failure.
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    insertResult = { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("reports save-failed when the subscription cannot be persisted to Supabase", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    insertResult = { error: { message: "permission denied for table push_subscriptions" } };
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "save-failed" });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe("isSubscribed — reflects server-side registration, not just a browser sub", () => {
  it("returns true only when a matching server row exists", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    expect(await isSubscribed("u1")).toBe(true);
  });

  it("returns false when the browser sub is not persisted server-side", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/other" } });
    expect(await isSubscribed("u1")).toBe(false);
  });

  it("returns false when there is no browser subscription", async () => {
    stubBrowser({ subscription: null });
    expect(await isSubscribed("u1")).toBe(false);
  });
});

describe("sendTestNotification", () => {
  const fetchMock = vi.fn();

  function stubFetchOk() {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sent: 1, removed: 0, total: 1 }),
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });

  it("reports unsupported when the browser lacks push APIs", async () => {
    expect(await sendTestNotification("u1")).toEqual({ ok: false, sent: 0, reason: "unsupported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when this device is not registered server-side", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
    const result = await sendTestNotification("u1");
    expect(result).toEqual({ ok: false, sent: 0, reason: "not-subscribed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without a session token", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    const result = await sendTestNotification("u1");
    expect(result).toEqual({ ok: false, sent: 0, reason: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the test-notification Edge Function with the user's bearer token", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok-123" } }, error: null });
    stubFetchOk();

    const result = await sendTestNotification("u1");
    expect(result).toEqual({ ok: true, sent: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.functions.supabase.co/test-notification");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-123");
  });

  it("classifies a server-side VAPID misconfiguration as missing-vapid", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "vapid_not_configured" }) });

    const result = await sendTestNotification("u1");
    expect(result).toEqual({ ok: false, sent: 0, reason: "missing-vapid" });
  });

  it("reports a generic error when the request fails", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    rows.push({ id: "r1", subscription: { endpoint: "https://push.example/a" } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await sendTestNotification("u1");
    expect(result).toEqual({ ok: false, sent: 0, reason: "error" });
  });
});
