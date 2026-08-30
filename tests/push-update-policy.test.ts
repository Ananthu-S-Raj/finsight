import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression tests for the push preference UPDATE path:
//   - the migration adds a user-scoped UPDATE policy (previously missing, so
//     syncPushPrefs() updates were silently dropped by RLS), and
//   - syncPushPrefs() persists the full set of notification opt-outs to the
//     caller's own rows only.
const POLICY_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260903000001_push_subscription_update_policy.sql"
);

const sql = readFileSync(POLICY_MIGRATION, "utf8");

const updateCall = vi.fn();
const eqCall = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn((table: string) =>
  table === "push_subscriptions"
    ? {
        update: (payload: unknown) => {
          updateCall(payload);
          return { eq: eqCall };
        },
      }
    : {}
);

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

const { syncPushPrefs } = await import("@/lib/push");

describe("push_subscriptions update policy (20260903000001)", () => {
  it("adds a user-scoped UPDATE policy", () => {
    expect(sql).toMatch(/create policy "push: update own"\s+on public\.push_subscriptions/);
    expect(sql).toMatch(/for update/);
  });

  it("a user can update ONLY their own row — using and with check both scope to auth.uid() = user_id", () => {
    expect(sql).toMatch(/using \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/with check \(auth\.uid\(\) = user_id\)/);
  });

  it("cannot reach another user's row — the policy has no role bypass and no user_id injection", () => {
    // Keyed entirely to auth.uid(): nothing lets a caller target or rewrite
    // user_id to another account, and the drop-before-create is idempotent.
    expect(sql).toMatch(/drop policy if exists "push: update own" on public\.push_subscriptions/);
    expect(sql).not.toMatch(/to (authenticated|service_role|public)/i);
    // Both the USING and WITH CHECK clauses pin rows to the caller.
    expect(sql).toMatch(/for update\s+using \(auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) = user_id\)/);
  });

  it("does not weaken or recreate the existing read/insert/delete/admin policies", () => {
    // This migration only introduces the update policy.
    expect(sql).not.toMatch(/push: read own|push: insert own|push: delete own/);
    expect(sql).not.toMatch(/push: admin (read|delete|update)/);
    expect(sql).not.toMatch(/grant /i);
  });
});

describe("syncPushPrefs — persists the five opt-outs via the caller-scoped UPDATE path", () => {
  const PREFS = {
    budgetAlerts: false,
    dailyReminders: true,
    cardReminders: false,
    savingsNotifications: true,
    billReminders: false,
  };

  beforeEach(() => {
    updateCall.mockClear();
    eqCall.mockClear();
    eqCall.mockResolvedValue({ error: null });
  });

  it("writes the full notification preference set to push_subscriptions", async () => {
    await syncPushPrefs("user-1", PREFS);

    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(updateCall.mock.calls[0][0]).toEqual({ prefs: PREFS });
    expect(updateCall.mock.calls[0][0].prefs).toMatchObject({
      budgetAlerts: false,
      dailyReminders: true,
      cardReminders: false,
      savingsNotifications: true,
      billReminders: false,
    });
  });

  it("scopes the update to the caller's own rows (user_id = caller)", async () => {
    await syncPushPrefs("user-1", PREFS);
    expect(eqCall).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("cannot update another user's subscription — the only filter allowed is the caller's own id", async () => {
    await syncPushPrefs("user-1", PREFS);
    for (const [column, value] of eqCall.mock.calls as [string, string][]) {
      expect(column).toBe("user_id");
      expect(value).toBe("user-1");
    }
    // Switching caller still only ever filters to that caller's own id.
    await syncPushPrefs("user-2", PREFS);
    expect(eqCall).toHaveBeenLastCalledWith("user_id", "user-2");
    // The RLS `with check (auth.uid() = user_id)` backstops this client-side
    // scoping server-side: an update can never smuggle in another user_id.
  });

  it("swallows persistence errors — prefs are a refinement, non-fatal", async () => {
    eqCall.mockRejectedValue(new Error("permission denied for table push_subscriptions"));
    await expect(syncPushPrefs("user-1", PREFS)).resolves.toBeUndefined();
  });
});