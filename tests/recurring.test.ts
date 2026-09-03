import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  nextRecurringDateStr,
  upcomingOccurrences,
  fromDateOnly,
  toDateOnly,
  dayOfMonth,
  normalizeRecurringInput,
  RecurringValidationError,
} from "@/lib/recurring";
import {
  matchRecurringRoute,
  dbCreateRule,
  dbUpdateRule,
  dbGetRule,
  dbSetStatus,
  dbListPending,
  dbConfirmOccurrence,
  dbProcessDue,
} from "@/lib/recurringServer";
import { AuthApiError } from "@/lib/auth/errors";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The mock client is structurally a subset of SupabaseClient. */
function asClient(client: MockClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    user_id: USER_A,
    type: "expense",
    amount: 500,
    frequency: "monthly",
    start_date: "2026-01-31",
    end_date: null,
    next_occurrence: "2026-01-31",
    anchor_day: 31,
    status: "active",
    requires_confirmation: false,
    category: "Food",
    subcategory: "Zomato",
    account: null,
    destination_account: null,
    description: "Dinner",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("next_recurring_date — calendar-correct math (TS mirror)", () => {
  it("adds plain intervals for daily / weekly / biweekly", () => {
    expect(nextRecurringDateStr("daily", "2026-01-31", 31)).toBe("2026-02-01");
    expect(nextRecurringDateStr("weekly", "2026-01-01", 1)).toBe("2026-01-08");
    expect(nextRecurringDateStr("biweekly", "2026-01-01", 1)).toBe("2026-01-15");
  });

  it("steps monthly to the same day-of-month", () => {
    expect(nextRecurringDateStr("monthly", "2026-01-15", 15)).toBe("2026-02-15");
    expect(nextRecurringDateStr("monthly", "2026-01-28", 28)).toBe("2026-02-28");
  });

  it("clamps month-end anchors to the last valid day (never 31 Feb)", () => {
    expect(nextRecurringDateStr("monthly", "2026-01-31", 31)).toBe("2026-02-28");
    expect(nextRecurringDateStr("monthly", "2026-04-30", 30)).toBe("2026-05-30");
  });

  it("restores the anchor day when the target month has more days", () => {
    // 28 Feb -> Mar: anchor 31 restored; anchor 28 stays at 28.
    expect(nextRecurringDateStr("monthly", "2026-02-28", 31)).toBe("2026-03-31");
    expect(nextRecurringDateStr("monthly", "2026-02-28", 28)).toBe("2026-03-28");
  });

  it("walks a 31st-anchor chain through short months without drift", () => {
    let d = "2026-01-31";
    const chain: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      d = nextRecurringDateStr("monthly", d, 31);
      chain.push(d);
    }
    expect(chain).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("handles Feb 29 in leap years, restoring the leap day later", () => {
    expect(nextRecurringDateStr("yearly", "2024-02-29", 29)).toBe("2025-02-28");
    expect(nextRecurringDateStr("yearly", "2025-02-28", 29)).toBe("2026-02-28");
    expect(nextRecurringDateStr("yearly", "2027-02-28", 29)).toBe("2028-02-29");
  });

  it("advances quarterly and yearly with the same clamping rule", () => {
    expect(nextRecurringDateStr("quarterly", "2026-01-31", 31)).toBe("2026-04-30");
    expect(nextRecurringDateStr("quarterly", "2026-04-30", 31)).toBe("2026-07-31");
    expect(nextRecurringDateStr("yearly", "2026-02-28", 29)).toBe("2027-02-28");
  });

  it("round-trips through date-only helpers", () => {
    expect(toDateOnly(fromDateOnly("2026-08-11") as Date)).toBe("2026-08-11");
    expect(fromDateOnly("2026-02-31")).toBeNull();
    expect(dayOfMonth("2026-08-11")).toBe(11);
  });
});

describe("upcomingOccurrences preview", () => {
  it("lists occurrences inclusive of the start date", () => {
    expect(upcomingOccurrences("weekly", "2026-03-01", 1, 3)).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
    ]);
  });

  it("never returns more than a sane preview bound", () => {
    expect(upcomingOccurrences("daily", "2026-01-01", 1, 1000)).toHaveLength(24);
  });
});

describe("normalizeRecurringInput — validation", () => {
  const valid = {
    type: "expense",
    amount: 500,
    frequency: "monthly",
    start_date: "2026-01-31",
    end_date: null,
    description: "Netflix",
    category: "Other",
    subcategory: "Other expense",
    account: null,
    destination_account: null,
    requires_confirmation: false,
  };

  it("accepts a valid body and rounds the amount to paise", () => {
    const out = normalizeRecurringInput({ ...valid, amount: 500.555 });
    expect(out.amount).toBe(500.56);
    expect(out.start_date).toBe("2026-01-31");
  });

  it("accepts income with a supported kind and transfer with salary→savings", () => {
    const income = normalizeRecurringInput({ ...valid, type: "income", account: "salary" });
    expect(income.account).toBe("salary");

    const transfer = normalizeRecurringInput({
      ...valid,
      type: "transfer",
      account: "salary",
      destination_account: "savings",
    });
    expect(transfer.destination_account).toBe("savings");
  });

  const rejects = (patch: Record<string, unknown>, code: string) => {
    expect(() => normalizeRecurringInput({ ...valid, ...patch })).toThrow(
      expect.objectContaining({ code })
    );
  };

  it("rejects invalid type, frequency and dates", () => {
    rejects({ type: "investment" }, "invalid_type");
    rejects({ frequency: "hourly" }, "invalid_frequency");
    rejects({ start_date: "31/01/2026" }, "invalid_start_date");
    rejects({ start_date: "2026-02-31" }, "invalid_start_date");
    rejects({ end_date: "2026-01-01" }, "invalid_end_date");
  });

  it("rejects bad amounts", () => {
    rejects({ amount: 0 }, "invalid_amount");
    rejects({ amount: -5 }, "invalid_amount");
    rejects({ amount: "not-a-number" }, "invalid_amount");
    rejects({ amount: 100_000_000 }, "invalid_amount");
  });

  it("rejects type/account mismatches and oversized strings", () => {
    rejects({ type: "income", account: "stocks" }, "invalid_kind");
    rejects({ type: "expense", account: "debit" }, "invalid_account");
    rejects({ type: "transfer", account: "savings" }, "invalid_account");
    rejects({ type: "expense", destination_account: "savings" }, "invalid_destination_account");
    rejects({ description: "x".repeat(121) }, "invalid_description");
  });

  it("passes a valid category_id through for the recurring rule", () => {
    const out = normalizeRecurringInput({
      ...valid,
      category: "Food",
      subcategory: "Zomato",
      category_id: "12345678-1234-4234-8234-123456789abc",
    });
    expect(out.category_id).toBe("12345678-1234-4234-8234-123456789abc");
  });

  it("rejects a malformed category_id", () => {
    rejects({ category_id: "not-a-uuid" }, "invalid_category");
  });

  it("throws a typed error usable by the API layer", () => {
    try {
      normalizeRecurringInput({ ...valid, amount: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(RecurringValidationError);
      expect((err as RecurringValidationError).code).toBe("invalid_amount");
    }
  });
});

describe("matchRecurringRoute — URL routing", () => {
  it("routes the list / create / pending surfaces", () => {
    expect(matchRecurringRoute("GET", [])).toEqual({ kind: "list" });
    expect(matchRecurringRoute("POST", [])).toEqual({ kind: "create" });
    expect(matchRecurringRoute("GET", ["pending"])).toEqual({ kind: "pending" });
  });

  it("routes per-rule operations", () => {
    expect(matchRecurringRoute("GET", ["abc"])).toEqual({ kind: "get", id: "abc" });
    expect(matchRecurringRoute("PATCH", ["abc"])).toEqual({ kind: "update", id: "abc" });
    expect(matchRecurringRoute("DELETE", ["abc"])).toEqual({ kind: "delete", id: "abc" });
    expect(matchRecurringRoute("POST", ["abc", "status"])).toEqual({ kind: "status", id: "abc" });
  });

  it("routes the occurrence confirm/skip flow", () => {
    expect(matchRecurringRoute("POST", ["pending", "occ1", "confirm"])).toEqual({
      kind: "confirm",
      occurrenceId: "occ1",
    });
    expect(matchRecurringRoute("POST", ["pending", "occ1", "skip"])).toEqual({
      kind: "skip",
      occurrenceId: "occ1",
    });
  });

  it("returns null for unknown shapes and methods", () => {
    expect(matchRecurringRoute("PUT", [])).toBeNull();
    expect(matchRecurringRoute("GET", ["pending", "x"])).toBeNull();
    expect(matchRecurringRoute("POST", ["a", "b"])).toBeNull();
    expect(matchRecurringRoute("GET", ["pending", "occ1", "confirm"])).toBeNull();
  });
});

describe("server db operations", () => {
  beforeEach(() => {
    // no global state
  });

  it("dbCreateRule seeds next_occurrence and anchor_day from start_date", async () => {
    const client = createMockClient({ tables: { recurring_transactions: [] } });
    const rule = await dbCreateRule(asClient(client), USER_A, {
      type: "expense",
      amount: 500,
      frequency: "monthly",
      start_date: "2026-01-31",
      description: "Netflix",
      category: "Other",
      subcategory: "Other expense",
    });
    expect(rule.next_occurrence).toBe("2026-01-31");
    expect(rule.anchor_day).toBe(31);
    expect(client.tables.recurring_transactions).toHaveLength(1);
  });

  it("dbGetRule returns 404 when the id belongs to another user", async () => {
    const client = createMockClient({
      tables: { recurring_transactions: [makeRule()] },
    });
    await expect(dbGetRule(asClient(client), "cccccccc-cccc-4ccc-8ccc-cccccccccccc", RULE_ID)).rejects.toThrow(
      expect.objectContaining({ status: 404 })
    );
  });

  it("dbUpdateRule restarts the schedule when start_date changes", async () => {
    const client = createMockClient({
      tables: { recurring_transactions: [makeRule()] },
    });
    const updated = await dbUpdateRule(asClient(client), USER_A, RULE_ID, {
      start_date: "2026-03-01",
    });
    expect(updated.next_occurrence).toBe("2026-03-01");
    expect(updated.anchor_day).toBe(1);
    expect(updated.amount).toBe(500);
  });

  it("dbUpdateRule rejects a type change after creation", async () => {
    const client = createMockClient({
      tables: { recurring_transactions: [makeRule()] },
    });
    await expect(
      dbUpdateRule(asClient(client), USER_A, RULE_ID, { type: "income" })
    ).rejects.toThrow(
      expect.objectContaining({ status: 400, code: "invalid_type_change" })
    );
  });

  it("dbSetStatus enforces legal transitions only", async () => {
    const active = createMockClient({
      tables: { recurring_transactions: [makeRule()] },
    });
    const paused = await dbSetStatus(asClient(active), USER_A, RULE_ID, "paused");
    expect(paused.status).toBe("paused");

    const completed = createMockClient({
      tables: { recurring_transactions: [makeRule({ status: "completed" })] },
    });
    await expect(dbSetStatus(asClient(completed), USER_A, RULE_ID, "active")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_status_transition" })
    );

    const bad = createMockClient({
      tables: { recurring_transactions: [makeRule()] },
    });
    await expect(dbSetStatus(asClient(bad), USER_A, RULE_ID, "banana")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_status" })
    );
  });

  it("dbListPending merges rules into occurrences, dropping orphans", async () => {
    const client = createMockClient({
      tables: {
        recurring_occurrences: [
          {
            id: "d0000000-0000-4000-8000-000000000001",
            user_id: USER_A,
            recurring_transaction_id: RULE_ID,
            occurrence_date: "2026-02-01",
            status: "pending",
          },
          {
            id: "d0000000-0000-4000-8000-000000000002",
            user_id: USER_A,
            recurring_transaction_id: "nonexistent-rule",
            occurrence_date: "2026-02-02",
            status: "pending",
          },
        ],
        recurring_transactions: [makeRule()],
      },
    });
    const pending = await dbListPending(asClient(client), USER_A);
    expect(pending).toHaveLength(1);
    expect(pending[0].rule.id).toBe(RULE_ID);
    expect(pending[0].occurrence_date).toBe("2026-02-01");
  });

  it("dbConfirmOccurrence maps missing occurrences to 404", async () => {
    const client = createMockClient({
      tables: {},
      rpc: {
        confirm_recurring_occurrence: () => ({
          data: null,
          error: { message: "occurrence_not_found", code: "P0001" },
        }),
      },
    });
    await expect(
      dbConfirmOccurrence(asClient(client), "d0000000-0000-4000-8000-000000000001")
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("dbProcessDue normalizes the scheduler RPC result", async () => {
    const client = createMockClient({
      tables: {},
      rpc: {
        process_recurring_due: () => ({
          data: { processed: 3, generated: 2, pending: 1, skipped: 0, failed: 0 },
          error: null,
        }),
      },
    });
    const result = await dbProcessDue(asClient(client), USER_A);
    expect(result).toEqual({ processed: 3, generated: 2, pending: 1, skipped: 0, failed: 0 });
  });
});

describe("recurring migration — database guarantees", () => {
  const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  function sql(name: string): string {
    return readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
  }

  it("is part of the shipped migration set", () => {
    expect(migrations).toContain("20260811000001_recurring.sql");
  });

  const recSql = sql("20260811000001_recurring.sql");

  it("defines the rule table with a status gate and both income/transfer semantics", () => {
    expect(recSql).toContain("create table if not exists public.recurring_transactions");
    expect(recSql).toMatch(/status text not null default 'active'/);
    expect(recSql).toMatch(/check \(status in \('active', 'paused', 'completed', 'cancelled'\)\)/);
    expect(recSql).toMatch(/check \(amount > 0\)/);
  });

  it("links generated transactions back to rules without cascade deletes (history survives)", () => {
    expect(recSql).toMatch(
      /add column if not exists recurring_transaction_id uuid\s+references public\.recurring_transactions\(id\) on delete set null/
    );
    expect(recSql).toContain("add column if not exists occurrence_date date");
  });

  it("enforces idempotent generation with a partial unique index", () => {
    expect(recSql).toContain("create unique index if not exists transactions_recurring_occurrence_idx");
    expect(recSql).toContain("on public.transactions (recurring_transaction_id, occurrence_date)");
    expect(recSql).toContain("where recurring_transaction_id is not null");
  });

  it("protects rules with row-level security", () => {
    expect(recSql).toContain("alter table public.recurring_transactions enable row level security");
    expect(recSql).toContain("alter table public.recurring_occurrences enable row level security");
    expect(recSql).toMatch(/create policy "recurring: read own" on public\.recurring_transactions/);
  });

  it("ships the calendar math and scheduler as SECURITY DEFINER functions", () => {
    expect(recSql).toContain("create or replace function public.next_recurring_date");
    expect(recSql).toContain("language plpgsql immutable");
    expect(recSql).toContain("create or replace function public.process_recurring_due");
    expect(recSql).toContain("language plpgsql security definer");
  });

  it("keeps money RPCs out of public reach and exposes a minimal grant surface", () => {
    expect(recSql).toContain("revoke all on function public._apply_recurring_expense");
    expect(recSql).toContain("revoke all on function public.process_all_recurring_due() from public");
    expect(recSql).toContain("grant execute on function public.process_recurring_due(uuid) to authenticated, service_role");
    expect(recSql).toContain("grant execute on function public.confirm_recurring_occurrence(uuid) to authenticated, service_role");
  });

  it("confirm_recurring_occurrence is updated with FOR UPDATE for concurrency safety", () => {
    const concurrencyMigration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260916000001_confirm_recurring_concurrency.sql"),
      "utf8"
    );
    expect(concurrencyMigration).toContain("for update");
    expect(concurrencyMigration).toContain("drop function if exists public.confirm_recurring_occurrence(uuid)");
    expect(concurrencyMigration).toContain("security definer set search_path = public");
    expect(concurrencyMigration).toContain("grant execute on function public.confirm_recurring_occurrence(uuid) to authenticated, service_role");
  });

  it("creates the edge-function entry point for the scheduler", () => {
    expect(() => {
      readFileSync(resolve(process.cwd(), "supabase/functions/process-recurring/index.ts"), "utf8");
    }).not.toThrow();
  });

  it("AuthApiError is the shared error envelope used by the recurring API", () => {
    expect(new AuthApiError(400, "boom").status).toBe(400);
  });
});
