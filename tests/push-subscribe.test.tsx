// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = { id: string; subscription: { endpoint?: string } };

const rows: Row[] = [];
const insertMock = vi.fn(async () => ({ error: null }));
const selectMock = vi.fn(() => ({ eq: vi.fn(async () => ({ data: rows, error: null })) }));
const fromMock = vi.fn((table: string) =>
  table === "push_subscriptions"
    ? {
        insert: (v: unknown) => {
          insertMock(v);
          return Promise.resolve({ error: null });
        },
        select: selectMock,
        update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
        delete: () => ({ eq: vi.fn(async () => ({ error: null })) }),
      }
    : { select, insert: insertMock }
);

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: fromMock },
}));

const {
  subscribeForPush,
  isSubscribed,
  supportsPush,
} = await import("@/lib/push");

function stubBrowser(opts: {
  subscription: { endpoint: string } | null;
  subscribeThrows?: boolean;
}) {
  const subscription = opts.subscription ? { ...opts.subscription, toJSON: () => opts.subscription } : null;
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
      static requestPermission = vi.fn(async () => "granted");
    }
  );
  return { getSubscription: pushManager.getSubscription };
}

beforeEach(() => {
  rows.length = 0;
  insertMock.mockClear();
  selectMock.mockClear();
  fromMock.mockClear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

describe("subscribeForPush — VAPID + failure classification", () => {
  it("reports unsupported when the browser lacks push APIs", async () => {
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: false, reason: "unsupported" });
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

  it("registers successfully when the key is valid and the push service accepts", async () => {
    stubBrowser({ subscription: { endpoint: "https://push.example/a" } });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    const result = await subscribeForPush("u1");
    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ user_id: "u1" });
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
