import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  goalDaysRemaining,
  goalHealth,
  goalNotificationId,
  goalProgressPercent,
  goalRemaining,
  goalSummary,
  normalizeContributionAmount,
  normalizeGoalInput,
  requiredContribution,
  GoalValidationError,
  type Goal,
} from "@/lib/goals";
import {
  matchGoalRoute,
  dbGetGoal,
  dbCreateGoal,
  dbUpdateGoal,
  dbSetGoalStatus,
  dbDeleteGoal,
  dbContributeToGoal,
  dbRemoveContribution,
  dbListContributions,
  dbListReminders,
} from "@/lib/goalsServer";
import { AuthApiError } from "@/lib/auth/errors";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import type { SupabaseClient } from "@supabase/supabase-js";

function asClient(client: MockClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GOAL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_GOAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONTRIBUTION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const TODAY = new Date("2026-08-11T12:00:00Z");

function makeGoal(overrides: Record<string, unknown> = {}): Goal {
  return {
    id: GOAL_ID,
    user_id: USER_A,
    name: "Emergency fund",
    description: null,
    target_amount: 10_000,
    current_amount: 0,
    target_date: "2026-12-31",
    category: null,
    category_id: null,
    icon: "target",
    theme: "accent",
    status: "active",
    reminder_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const VALID_INPUT = {
  name: "MacBook",
  target_amount: 150_000,
  current_amount: 20_000,
  target_date: "2027-01-31",
  description: null,
  category: "Shopping",
  category_id: null,
  icon: "target",
  theme: "indigo",
  reminder_enabled: true,
};

describe("normalizeGoalInput — validation", () => {
  it("accepts a valid goal and rounds amounts to paise", () => {
    const out = normalizeGoalInput({ ...VALID_INPUT, target_amount: 150_000.999 });
    expect(out.target_amount).toBe(150_001);
    expect(out.current_amount).toBe(20_000);
    expect(out.icon).toBe("target");
    expect(out.theme).toBe("indigo");
  });

  it("passes a valid category_id through for the goal", () => {
    const out = normalizeGoalInput({
      ...VALID_INPUT,
      category: "Shopping",
      category_id: "12345678-1234-4234-8234-123456789abc",
    });
    expect(out.category_id).toBe("12345678-1234-4234-8234-123456789abc");
  });

  it("defaults icon, theme and reminders when absent", () => {
    const out = normalizeGoalInput({ ...VALID_INPUT, icon: undefined, theme: undefined, reminder_enabled: undefined });
    expect(out.icon).toBe("target");
    expect(out.theme).toBe("accent");
    expect(out.reminder_enabled).toBe(true);
  });

  it("rejects unknown icons/themes instead of letting them through", () => {
    expect(normalizeGoalInput({ ...VALID_INPUT, icon: "rocket", theme: "pink" }).icon).toBe("target");
    expect(normalizeGoalInput({ ...VALID_INPUT, icon: "rocket", theme: "pink" }).theme).toBe("accent");
  });

  const rejects = (patch: Record<string, unknown>, code: string) => {
    expect(() => normalizeGoalInput({ ...VALID_INPUT, ...patch })).toThrow(
      expect.objectContaining({ code })
    );
  };

  it("rejects bad names, amounts and dates", () => {
    rejects({ name: "" }, "invalid_name");
    rejects({ name: "x".repeat(81) }, "invalid_name");
    rejects({ target_amount: 0 }, "invalid_target_amount");
    rejects({ target_amount: -5 }, "invalid_target_amount");
    rejects({ target_amount: 100_000_000 }, "invalid_target_amount");
    rejects({ current_amount: -1 }, "invalid_current_amount");
    rejects({ target_date: "2026-02-31" }, "invalid_target_date");
    rejects({ target_date: "" }, "invalid_target_date");
    rejects({ category_id: "not-a-uuid" }, "invalid_category");
  });

  it("throws a typed error usable by the API layer", () => {
    try {
      normalizeGoalInput({ ...VALID_INPUT, target_amount: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(GoalValidationError);
    }
  });
});

describe("normalizeContributionAmount — validation", () => {
  it("accepts positive amounts and rounds to paise", () => {
    expect(normalizeContributionAmount("500.129")).toBe(500.13);
    expect(normalizeContributionAmount(100)).toBe(100);
  });

  it("rejects zero, negative and non-finite amounts", () => {
    for (const bad of [0, -1, "abc", NaN, Infinity]) {
      expect(() => normalizeContributionAmount(bad)).toThrow(
        expect.objectContaining({ code: "invalid_amount" })
      );
    }
  });
});

describe("goal math — progress, remaining, deadline", () => {
  it("caps progress at 100 and never reports negative remaining", () => {
    const over = makeGoal({ current_amount: 12_000 });
    expect(goalProgressPercent(over)).toBe(100);
    expect(goalRemaining(over)).toBe(0);
    const partial = makeGoal({ current_amount: 2_500 });
    expect(goalProgressPercent(partial)).toBe(25);
    expect(goalRemaining(partial)).toBe(7_500);
  });

  it("computes whole-day countdowns (negative once past)", () => {
    expect(goalDaysRemaining(makeGoal({ target_date: "2026-08-11" }), TODAY)).toBe(0);
    expect(goalDaysRemaining(makeGoal({ target_date: "2026-08-15" }), TODAY)).toBe(4);
    expect(goalDaysRemaining(makeGoal({ target_date: "2026-08-01" }), TODAY)).toBe(-10);
  });
});

describe("goalHealth — derived deadline health", () => {
  it("is completed whenever current >= target", () => {
    const h = goalHealth(makeGoal({ current_amount: 10_000, target_date: "2026-08-01" }), TODAY);
    expect(h.status).toBe("completed");
  });

  it("is overdue when the date has passed without reaching the target", () => {
    const h = goalHealth(makeGoal({ current_amount: 5_000, target_date: "2026-08-01" }), TODAY);
    expect(h.status).toBe("overdue");
  });

  it("judges against the even-contribution baseline", () => {
    // created 2026-01-01 -> target 2026-12-31: 364 days total; 222 elapsed on
    // 2026-08-11, so expected = target * 222/364.
    const baseline = Math.round((10_000 * 222) / 364 * 100) / 100;
    const onTrack = goalHealth(makeGoal({ current_amount: baseline }), TODAY);
    expect(onTrack.status).toBe("on_track");
    expect(onTrack.expected).toBe(baseline);
    const atRisk = goalHealth(makeGoal({ current_amount: baseline - 1 }), TODAY);
    expect(atRisk.status).toBe("at_risk");
  });
});

describe("requiredContribution — pace planning", () => {
  it("returns 0/0 once nothing remains", () => {
    expect(requiredContribution(makeGoal({ current_amount: 10_000 }), TODAY)).toEqual({
      monthly: 0,
      weekly: 0,
    });
  });

  it("requires the full remaining amount when the deadline is today", () => {
    const g = makeGoal({ current_amount: 5_000, target_date: "2026-08-11" });
    expect(requiredContribution(g, TODAY)).toEqual({ monthly: 5_000, weekly: 5_000 });
  });

  it("spreads the remainder over the remaining months, rounded up", () => {
    // 30 days left -> 1 month / 4 weeks
    const g = makeGoal({ current_amount: 5_000, target_date: "2026-09-10" });
    const r = requiredContribution(g, TODAY);
    expect(r.monthly).toBe(5_000);
    expect(r.weekly).toBe(1_250);
  });
});

describe("goalSummary — dashboard aggregates", () => {
  it("excludes cancelled goals and counts derived-completed ones", () => {
    const goals = [
      makeGoal({ id: "a", current_amount: 0, status: "active" }),
      makeGoal({ id: "b", current_amount: 8_000, status: "active" }),
      makeGoal({ id: "c", current_amount: 10_000, status: "completed" }),
      makeGoal({ id: "d", current_amount: 2_000, status: "cancelled" }),
    ];
    const s = goalSummary(goals);
    expect(s.activeCount).toBe(2);
    expect(s.completedCount).toBe(1);
    expect(s.totalProgress).toBe(18_000);
    expect(s.totalTarget).toBe(30_000);
    expect(s.overallPercent).toBe(60);
  });
});

describe("goalNotificationId — stable dedupe ids", () => {
  it("is stable per (goal, kind, anchor) and scoped by kind + anchor", () => {
    expect(goalNotificationId(GOAL_ID, "deadline", "2026-12-31")).toBe(
      goalNotificationId(GOAL_ID, "deadline", "2026-12-31")
    );
    expect(goalNotificationId(GOAL_ID, "deadline", "2026-12-31")).not.toBe(
      goalNotificationId(GOAL_ID, "completion", "2026-12-31")
    );
    expect(goalNotificationId(GOAL_ID, "deadline", "2026-12-31")).not.toBe(
      goalNotificationId(GOAL_ID, "deadline", "2026-12-30")
    );
    expect(goalNotificationId(GOAL_ID, "behind", "2026-08-10")).toBe(
      `goal-behind-${GOAL_ID}-2026-08-10`
    );
  });
});

describe("matchGoalRoute — goals URL routing", () => {
  it("routes list, create and reminders", () => {
    expect(matchGoalRoute("GET", [])).toEqual({ kind: "list" });
    expect(matchGoalRoute("POST", [])).toEqual({ kind: "create" });
    expect(matchGoalRoute("GET", ["reminders"])).toEqual({ kind: "reminders" });
  });

  it("routes per-goal operations", () => {
    expect(matchGoalRoute("GET", ["abc"])).toEqual({ kind: "get", id: "abc" });
    expect(matchGoalRoute("PATCH", ["abc"])).toEqual({ kind: "update", id: "abc" });
    expect(matchGoalRoute("DELETE", ["abc"])).toEqual({ kind: "delete", id: "abc" });
    expect(matchGoalRoute("POST", ["abc", "contribute"])).toEqual({ kind: "contribute", id: "abc" });
    expect(matchGoalRoute("GET", ["abc", "contributions"])).toEqual({ kind: "contributions", id: "abc" });
    expect(matchGoalRoute("DELETE", ["abc", "contributions", "cid"])).toEqual({
      kind: "remove_contribution",
      id: "abc",
      contributionId: "cid",
    });
    expect(matchGoalRoute("POST", ["abc", "status"])).toEqual({ kind: "set_status", id: "abc" });
  });

  it("keeps literal segments ahead of resource ids and rejects unknowns", () => {
    expect(matchGoalRoute("GET", ["reminders"])).toEqual({ kind: "reminders" });
    expect(matchGoalRoute("GET", ["reminders", "extra"])).toBeNull();
    expect(matchGoalRoute("PUT", [])).toBeNull();
    expect(matchGoalRoute("POST", ["a", "b"])).toBeNull();
  });
});

describe("server db operations — isolation & ledger behaviour", () => {
  it("dbCreateGoal inserts a user-owned goal", async () => {
    const client = createMockClient({ tables: { financial_goals: [] } });
    const goal = await dbCreateGoal(asClient(client), USER_A, VALID_INPUT);
    expect(goal.name).toBe("MacBook");
    expect(goal.user_id).toBe(USER_A);
    expect(goal.status).toBe("active");
    expect(client.tables.financial_goals).toHaveLength(1);
  });

  it("dbGetGoal returns 404 for another user's goal", async () => {
    const client = createMockClient({
      tables: { financial_goals: [makeGoal({ id: OTHER_GOAL_ID, user_id: USER_B })] },
    });
    await expect(dbGetGoal(asClient(client), USER_A, OTHER_GOAL_ID)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("dbGetGoal rejects malformed ids before touching the database", async () => {
    const client = createMockClient({ tables: { financial_goals: [] } });
    await expect(dbGetGoal(asClient(client), USER_A, "not-a-uuid")).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
  });

  it("dbUpdateGoal ignores current_amount (ledger is the source of truth)", async () => {
    const client = createMockClient({
      tables: { financial_goals: [makeGoal({ current_amount: 0 })] },
    });
    const goal = await dbUpdateGoal(asClient(client), USER_A, GOAL_ID, {
      name: "Renamed",
      current_amount: 9_999,
    });
    expect(goal.name).toBe("Renamed");
    expect(goal.current_amount).toBe(0);
  });

  it("dbUpdateGoal rejects editing a cancelled goal", async () => {
    const client = createMockClient({
      tables: { financial_goals: [makeGoal({ status: "cancelled" })] },
    });
    await expect(
      dbUpdateGoal(asClient(client), USER_A, GOAL_ID, { name: "Nope" })
    ).rejects.toMatchObject({ status: 400, code: "goal_closed" });
  });

  it("dbSetGoalStatus allows only sanctioned transitions", async () => {
    const paused = createMockClient({ tables: { financial_goals: [makeGoal({ status: "paused" })] } });
    await expect(dbSetGoalStatus(asClient(paused), USER_A, GOAL_ID, "active")).resolves.toMatchObject({
      status: "active",
    });

    const cancelled = createMockClient({ tables: { financial_goals: [makeGoal({ status: "cancelled" })] } });
    await expect(
      dbSetGoalStatus(asClient(cancelled), USER_A, GOAL_ID, "active")
    ).rejects.toMatchObject({ status: 400, code: "invalid_transition" });

    const completed = createMockClient({ tables: { financial_goals: [makeGoal({ status: "completed" })] } });
    await expect(
      dbSetGoalStatus(asClient(completed), USER_A, GOAL_ID, "cancelled")
    ).rejects.toMatchObject({ status: 400, code: "invalid_transition" });
  });

  it("dbDeleteGoal is blocked when contribution history exists", async () => {
    const client = createMockClient({
      tables: {
        financial_goals: [makeGoal()],
        goal_contributions: [{ id: CONTRIBUTION_ID, goal_id: GOAL_ID, user_id: USER_A }],
      },
    });
    await expect(dbDeleteGoal(asClient(client), USER_A, GOAL_ID)).rejects.toMatchObject({
      status: 409,
      code: "in_use",
    });
  });

  it("dbDeleteGoal succeeds when there is no history", async () => {
    const client = createMockClient({
      tables: { financial_goals: [makeGoal()], goal_contributions: [] },
    });
    await expect(dbDeleteGoal(asClient(client), USER_A, GOAL_ID)).resolves.toEqual({
      deleted: true,
    });
    expect(client.tables.financial_goals).toHaveLength(0);
  });

  it("dbContributeToGoal maps RPC failures to typed errors", async () => {
    const notFound = createMockClient({
      tables: {},
      rpc: { contribute_to_goal: () => ({ data: null, error: { message: "goal_not_found", code: "P0001" } }) },
    });
    await expect(dbContributeToGoal(asClient(notFound), USER_A, OTHER_GOAL_ID, { amount: 100 })).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });

    const cancelled = createMockClient({
      tables: {},
      rpc: { contribute_to_goal: () => ({ data: null, error: { message: "goal_cancelled", code: "P0001" } }) },
    });
    await expect(dbContributeToGoal(asClient(cancelled), USER_A, GOAL_ID, { amount: 100 })).rejects.toMatchObject({
      status: 400,
      code: "goal_closed",
    });
  });

  it("dbContributeToGoal normalizes the RPC result", async () => {
    const client = createMockClient({
      tables: {},
      rpc: {
        contribute_to_goal: () => ({
          data: { goal_id: GOAL_ID, current_amount: "1500.00", target_amount: "10000.00", status: "active" },
          error: null,
        }),
      },
    });
    const result = await dbContributeToGoal(asClient(client), USER_A, GOAL_ID, { amount: 1500, note: "First" });
    expect(result.goal_id).toBe(GOAL_ID);
    expect(result.current_amount).toBe(1500);
    expect(result.target_amount).toBe(10000);
    expect(result.status).toBe("active");
  });

  it("dbRemoveContribution normalizes the RPC result and rejects bad ids", async () => {
    const client = createMockClient({
      tables: {},
      rpc: {
        remove_goal_contribution: () => ({
          data: { goal_id: GOAL_ID, current_amount: "0.00", target_amount: "10000.00", status: "active" },
          error: null,
        }),
      },
    });
    const result = await dbRemoveContribution(asClient(client), USER_A, GOAL_ID, CONTRIBUTION_ID);
    expect(result.current_amount).toBe(0);

    await expect(
      dbRemoveContribution(asClient(client), USER_A, GOAL_ID, "not-a-uuid")
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("dbListContributions returns only rows for that goal", async () => {
    const client = createMockClient({
      tables: {
        goal_contributions: [
          { id: CONTRIBUTION_ID, goal_id: GOAL_ID, user_id: USER_A, amount: 500, note: null, created_at: "2026-02-01T00:00:00Z" },
          { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", goal_id: OTHER_GOAL_ID, user_id: USER_A, amount: 100, note: null, created_at: "2026-01-01T00:00:00Z" },
        ],
      },
    });
    const rows = await dbListContributions(asClient(client), USER_A, GOAL_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].goal_id).toBe(GOAL_ID);
  });

  it("dbListReminders joins goal info and honours the since filter", async () => {
    const client = createMockClient({
      tables: {
        goal_reminders: [
          {
            id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
            goal_id: GOAL_ID,
            user_id: USER_A,
            kind: "deadline",
            days_before: 7,
            target_date: "2026-12-31",
            fired_at: "2026-12-24T07:00:00Z",
          },
        ],
        financial_goals: [makeGoal()],
      },
    });
    const reminders = await dbListReminders(asClient(client), USER_A, "2026-01-01T00:00:00Z");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].goal_name).toBe("Emergency fund");
    expect(reminders[0].target_amount).toBe(10_000);
    expect(reminders[0].current_amount).toBe(0);
  });
});

describe("goals migration — database guarantees", () => {
  const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sql = readFileSync(resolve(MIGRATIONS_DIR, "20260813000000_financial_goals.sql"), "utf8");

  it("is part of the shipped migration set", () => {
    expect(migrations).toContain("20260813000000_financial_goals.sql");
  });

  it("defines user-owned goals with a status gate and reminder flag", () => {
    expect(sql).toContain("create table if not exists public.financial_goals");
    expect(sql).toMatch(/check \(status in \('active', 'completed', 'paused', 'cancelled'\)\)/);
    expect(sql).toMatch(/reminder_enabled boolean not null default true/);
    expect(sql).toMatch(/target_amount numeric\(12,2\) not null/);
    expect(sql).toMatch(/target_date date not null/);
  });

  it("enables RLS and keeps contributions append-only via RESTRICT", () => {
    expect(sql).toContain("alter table public.financial_goals enable row level security");
    expect(sql).toContain("alter table public.goal_contributions enable row level security");
    expect(sql).toContain("alter table public.goal_reminders enable row level security");
    expect(sql).toMatch(/references public\.financial_goals\(id\) on delete restrict/);
  });

  it("dedupes reminders at the database level", () => {
    expect(sql).toMatch(/unique \(goal_id, target_date, kind\)/);
  });

  it("recomputes current_amount from the ledger inside the RPC", () => {
    expect(sql).toContain("create or replace function public._goal_total");
    expect(sql).toContain("coalesce(sum(amount), 0)");
    expect(sql).toContain("create or replace function public.contribute_to_goal");
    expect(sql).toContain("create or replace function public.remove_goal_contribution");
  });

  it("auto-completes goals that reach their target", () => {
    expect(sql).toMatch(/when v_total >= v_goal\.target_amount then 'completed'/);
  });

  it("reminder generation cannot run for arbitrary users from a client", () => {
    expect(sql).toContain("create or replace function public.generate_all_goal_reminders");
    expect(sql).toContain("if auth.uid() is not null then");
    expect(sql).toContain("raise exception 'unauthorized'");
  });

  it("exposes a minimal grant surface", () => {
    expect(sql).toContain("revoke all on function public.contribute_to_goal");
    expect(sql).toContain("grant execute on function public.contribute_to_goal(uuid, numeric, text) to authenticated, service_role");
    expect(sql).toContain("grant execute on function public.generate_goal_reminders(uuid) to authenticated, service_role");
    expect(sql).toContain("grant execute on function public.generate_all_goal_reminders() to service_role");
  });
});
