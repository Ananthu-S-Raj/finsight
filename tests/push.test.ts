import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const eq = vi.fn(() => ({ data: [], error: null }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update, eq }));

vi.mock("@/lib/supabaseClient", () => ({ supabase: { from } }));

const { currentPermission, supportsPush, syncPushPrefs, isValidVapidKey, getVapidIssue } = await import("@/lib/push");

describe("push guards", () => {
  beforeEach(() => {
    (globalThis as any).window = undefined;
  });

  it("is unsupported in SSR", () => {
    expect(supportsPush()).toBe(false);
    expect(currentPermission()).toBe("unsupported");
  });

  it("detects when the Notification API is missing", async () => {
    vi.stubGlobal("window", {});
    expect(supportsPush()).toBe(false);
    expect(currentPermission()).toBe("unsupported");
  });
});

describe("isValidVapidKey", () => {
  const valid65Byte = "A".repeat(87); // decodes to a 65-byte (P-256) key

  it("rejects a missing / undefined key", () => {
    expect(isValidVapidKey(undefined)).toBe(false);
    expect(isValidVapidKey("")).toBe(false);
  });

  it("rejects the placeholder 'generated-vapid-public-key'", () => {
    expect(isValidVapidKey("generated-vapid-public-key")).toBe(false);
    expect(isValidVapidKey("generated-vapid-anything")).toBe(false);
  });

  it("rejects malformed keys that do not decode to 65 bytes", () => {
    expect(isValidVapidKey("A".repeat(10))).toBe(false);
    expect(isValidVapidKey("!!!not-base64!!!")).toBe(false);
  });

  it("accepts a real 65-byte URL-safe base64 key", () => {
    expect(isValidVapidKey(valid65Byte)).toBe(true);
  });
});

describe("getVapidIssue", () => {
  const prev = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prev;
  });

  it("classifies a missing key", () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    expect(getVapidIssue()).toBe("missing");
  });

  it("classifies the placeholder/malformed key as invalid", () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "generated-vapid-public-key";
    expect(getVapidIssue()).toBe("invalid");
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(10);
    expect(getVapidIssue()).toBe("invalid");
  });

  it("classifies a real key as ok", () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "A".repeat(87);
    expect(getVapidIssue()).toBe("ok");
  });
});

describe("syncPushPrefs", () => {
  beforeEach(() => {
    from.mockClear();
    update.mockClear();
    eq.mockClear();
    vi.stubGlobal(
      "localStorage",
      new (class {
        private m = new Map<string, string>();
        getItem(k: string) {
          return this.m.get(k) ?? null;
        }
        setItem(k: string, v: string) {
          this.m.set(k, String(v));
        }
        clear() {
          this.m.clear();
        }
      })()
    );
  });

  it("sends prefs to every subscription for the user", async () => {
    const prefs = {
      push: true,
      budgetAlerts: false,
      dailyReminders: true,
      cardReminders: true,
      loanReminders: true,
      savingsNotifications: true,
      billReminders: true,
      goalReminders: true,
    };
    await syncPushPrefs("user-1", prefs);
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(update).toHaveBeenCalledWith({ prefs });
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("does not throw when the prefs column is missing", async () => {
    update.mockImplementationOnce(() => {
      throw new Error("column push_subscriptions.prefs does not exist");
    });
    await expect(
      syncPushPrefs("user-1", {
        push: true,
        budgetAlerts: true,
        dailyReminders: true,
        cardReminders: true,
        loanReminders: true,
        savingsNotifications: true,
        billReminders: true,
        goalReminders: true,
      })
    ).resolves.toBeUndefined();
  });
});
