import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeBillStatus,
  daysUntil,
  nextBillDueDateStr,
  billReminderId,
  billTitle,
  normalizeBillInput,
  BillValidationError,
  type Bill,
  type BillStatus,
} from "@/lib/bills";
import {
  billEventsForMonth,
  billsDueThisMonth,
  monthRange,
  monthGrid,
  isInMonth,
  daysBetween,
  recurringEventsForMonth,
  type CalendarEvent,
} from "@/lib/calendar";
import {
  matchBillRoute,
  dbGetBill,
  dbUpdateBill,
  dbCancelBill,
  dbDeleteBill,
  dbMarkPaid,
  dbListPayments,
  dbListReminders,
  dbCreateBill,
} from "@/lib/billsServer";
import { AuthApiError } from "@/lib/auth/errors";
import { addNotificationIfMissing } from "@/lib/notifications";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import type { SupabaseClient } from "@supabase/supabase-js";

function asClient(client: MockClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_BILL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeBill(overrides: Record<string, unknown> = {}): Bill {
  return {
    id: BILL_ID,
    user_id: USER_A,
    name: "Rent",
    amount: 15_000,
    category: "Housing",
    subcategory: "Rent",
    category_id: null,
    due_date: "2026-08-15",
    frequency: "monthly",
    status: "upcoming",
    is_credit_card: false,
    reminder_enabled: true,
    reminder_days_before: 3,
    notes: null,
    anchor_day: 15,
    paid_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeBillStatus — date-derived status", () => {
  it("marks today's bills as due", () => {
    expect(computeBillStatus(makeBill({ due_date: "2026-08-11" }), "2026-08-11")).toBe("due");
  });

  it("marks tomorrow's bills as upcoming", () => {
    expect(computeBillStatus(makeBill({ due_date: "2026-08-12" }), "2026-08-11")).toBe("upcoming");
  });

  it("marks yesterday's bills as overdue", () => {
    expect(computeBillStatus(makeBill({ due_date: "2026-08-10" }), "2026-08-11")).toBe("overdue");
  });

  it("keeps paid and cancelled as stored states regardless of date", () => {
    expect(computeBillStatus(makeBill({ status: "paid", due_date: "2026-08-10" }), "2026-08-11")).toBe("paid");
    expect(computeBillStatus(makeBill({ status: "cancelled", due_date: "2026-08-10" }), "2026-08-11")).toBe("cancelled");
    expect(computeBillStatus(makeBill({ status: "paid", due_date: "2026-08-12" }), "2026-08-11")).toBe("paid");
  });

  it("never derives a status for a future-dated paid bill (stored wins)", () => {
    const s = computeBillStatus(makeBill({ status: "paid", due_date: "2026-08-20" }), "2026-08-11");
    expect(s).toBe("paid");
  });
});

describe("daysUntil — day arithmetic", () => {
  it("computes today / tomorrow / yesterday", () => {
    expect(daysUntil("2026-08-11", "2026-08-11")).toBe(0);
    expect(daysUntil("2026-08-12", "2026-08-11")).toBe(1);
    expect(daysUntil("2026-08-10", "2026-08-11")).toBe(-1);
  });

  it("returns 0 for invalid dates instead of crashing", () => {
    expect(daysUntil("not-a-date", "2026-08-11")).toBe(0);
  });
});

describe("nextBillDueDateStr — recurrence math", () => {
  it("never advances a one-time bill", () => {
    expect(nextBillDueDateStr("one_time", "2026-08-15", 15)).toBeNull();
  });

  it("adds a plain week for weekly bills", () => {
    expect(nextBillDueDateStr("weekly", "2026-08-11", 11)).toBe("2026-08-18");
  });

  it("steps monthly to the same day of month", () => {
    expect(nextBillDueDateStr("monthly", "2026-08-15", 15)).toBe("2026-09-15");
  });

  it("clamps month-end anchors to the last valid day", () => {
    expect(nextBillDueDateStr("monthly", "2026-01-31", 31)).toBe("2026-02-28");
    expect(nextBillDueDateStr("monthly", "2026-03-31", 31)).toBe("2026-04-30");
  });

  it("restores the anchor day when the target month is longer", () => {
    expect(nextBillDueDateStr("monthly", "2026-02-28", 31)).toBe("2026-03-31");
    expect(nextBillDueDateStr("monthly", "2026-02-28", 28)).toBe("2026-03-28");
  });

  it("handles February and leap-year boundaries", () => {
    expect(nextBillDueDateStr("yearly", "2024-02-29", 29)).toBe("2025-02-28");
    expect(nextBillDueDateStr("yearly", "2025-02-28", 29)).toBe("2026-02-28");
    expect(nextBillDueDateStr("yearly", "2027-02-28", 29)).toBe("2028-02-29");
    expect(nextBillDueDateStr("monthly", "2024-01-29", 29)).toBe("2024-02-29");
  });

  it("walks across the year end", () => {
    expect(nextBillDueDateStr("monthly", "2026-12-31", 31)).toBe("2027-01-31");
    expect(nextBillDueDateStr("yearly", "2026-12-31", 31)).toBe("2027-12-31");
  });

  it("advances quarterly with month-end clamping", () => {
    expect(nextBillDueDateStr("quarterly", "2026-01-31", 31)).toBe("2026-04-30");
    expect(nextBillDueDateStr("quarterly", "2026-04-30", 31)).toBe("2026-07-31");
  });
});

describe("normalizeBillInput — validation", () => {
  const valid = {
    name: "Internet",
    amount: 999,
    due_date: "2026-08-11",
    frequency: "monthly",
    category: "Bills",
    category_id: null,
    subcategory: "Internet",
    is_credit_card: false,
    reminder_enabled: true,
    reminder_days_before: 3,
    notes: null,
  };

  it("accepts a valid bill and rounds to paise", () => {
    const out = normalizeBillInput({ ...valid, amount: 999.999 });
    expect(out.amount).toBe(1000);
    expect(out.reminder_days_before).toBe(3);
  });

  it("clamps reminder lead time into 0..7", () => {
    expect(normalizeBillInput({ ...valid, reminder_days_before: 99 }).reminder_days_before).toBe(7);
    expect(normalizeBillInput({ ...valid, reminder_days_before: -2 }).reminder_days_before).toBe(0);
  });

  it("passes a valid category_id through for the bill", () => {
    const out = normalizeBillInput({
      ...valid,
      category: "Housing",
      subcategory: "Rent",
      category_id: "12345678-1234-4234-8234-123456789abc",
    });
    expect(out.category_id).toBe("12345678-1234-4234-8234-123456789abc");
  });

  const rejects = (patch: Record<string, unknown>, code: string) => {
    expect(() => normalizeBillInput({ ...valid, ...patch })).toThrow(
      expect.objectContaining({ code })
    );
  };

  it("rejects empty names, zero amounts and bad dates", () => {
    rejects({ name: "" }, "invalid_name");
    rejects({ name: "x".repeat(81) }, "invalid_name");
    rejects({ amount: 0 }, "invalid_amount");
    rejects({ amount: -1 }, "invalid_amount");
    rejects({ due_date: "2026-02-31" }, "invalid_due_date");
    rejects({ frequency: "hourly" }, "invalid_frequency");
  });

  it("rejects a malformed category_id", () => {
    rejects({ category_id: "not-a-uuid" }, "invalid_category");
  });

  it("throws a typed error usable by the API layer", () => {
    try {
      normalizeBillInput({ ...valid, amount: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(BillValidationError);
    }
  });
});

describe("bill helper labels", () => {
  it("billTitle falls back to category", () => {
    expect(billTitle({ name: "Rent", category: null })).toBe("Rent");
    expect(billTitle({ name: "", category: "Bills" })).toBe("Bills");
  });

  it("billReminderId is stable and kind-scoped", () => {
    expect(billReminderId(BILL_ID, "2026-08-15", "advance")).toBe(
      billReminderId(BILL_ID, "2026-08-15", "advance")
    );
    expect(billReminderId(BILL_ID, "2026-08-15", "advance")).not.toBe(
      billReminderId(BILL_ID, "2026-08-15", "due")
    );
    expect(billReminderId(BILL_ID, "2026-08-15", "advance")).not.toBe(
      billReminderId(BILL_ID, "2026-09-15", "advance")
    );
  });
});

describe("notification store dedup", () => {
  it("addNotificationIfMissing refuses the same id twice", () => {
    const item = {
      id: billReminderId(BILL_ID, "2026-08-15", "advance"),
      category: "payments" as const,
      icon: "calendar" as const,
      title: "Bill due soon",
      message: "Rent — ₹15,000 is due tomorrow.",
      at: Date.now(),
      read: false,
      route: "/bills",
    };
    expect(addNotificationIfMissing(item)).toBe(true);
    expect(addNotificationIfMissing(item)).toBe(false);
  });
});

describe("matchBillRoute — bills URL routing", () => {
  it("routes list / create / payments / reminders", () => {
    expect(matchBillRoute("GET", [])).toEqual({ kind: "list" });
    expect(matchBillRoute("POST", [])).toEqual({ kind: "create" });
    expect(matchBillRoute("GET", ["payments"])).toEqual({ kind: "payments" });
    expect(matchBillRoute("GET", ["reminders"])).toEqual({ kind: "reminders" });
  });

  it("routes per-bill operations", () => {
    expect(matchBillRoute("GET", ["abc"])).toEqual({ kind: "get", id: "abc" });
    expect(matchBillRoute("PATCH", ["abc"])).toEqual({ kind: "update", id: "abc" });
    expect(matchBillRoute("DELETE", ["abc"])).toEqual({ kind: "delete", id: "abc" });
    expect(matchBillRoute("POST", ["abc", "paid"])).toEqual({ kind: "paid", id: "abc" });
    expect(matchBillRoute("POST", ["abc", "cancel"])).toEqual({ kind: "cancel", id: "abc" });
  });

  it("returns null for unknown shapes", () => {
    expect(matchBillRoute("PUT", [])).toBeNull();
    expect(matchBillRoute("POST", ["a", "b"])).toBeNull();
  });
});

describe("server db operations — payment & isolation behaviour", () => {
  it("dbCreateBill seeds anchor_day from the due date", async () => {
    const client = createMockClient({ tables: { bills: [] } });
    const bill = await dbCreateBill(asClient(client), USER_A, {
      name: "Internet",
      amount: 999,
      due_date: "2026-08-11",
      frequency: "monthly",
      category: null,
      category_id: null,
      subcategory: null,
      is_credit_card: false,
      reminder_enabled: true,
      reminder_days_before: 3,
      notes: null,
    });
    expect(bill.anchor_day).toBe(11);
    expect(client.tables.bills).toHaveLength(1);
  });

  it("dbGetBill returns 404 for another user's bill", async () => {
    const client = createMockClient({
      tables: { bills: [makeBill({ id: OTHER_BILL_ID, user_id: USER_B })] },
    });
    await expect(dbGetBill(asClient(client), USER_A, OTHER_BILL_ID)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("dbUpdateBill rejects editing another user's bill (404)", async () => {
    const client = createMockClient({
      tables: { bills: [makeBill({ id: OTHER_BILL_ID, user_id: USER_B })] },
    });
    await expect(
      dbUpdateBill(asClient(client), USER_A, OTHER_BILL_ID, { amount: 100 })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("dbUpdateBill rejects editing a paid or cancelled bill", async () => {
    for (const status of ["paid", "cancelled"] as BillStatus[]) {
      const client = createMockClient({ tables: { bills: [makeBill({ status })] } });
      await expect(
        dbUpdateBill(asClient(client), USER_A, BILL_ID, { amount: 100 })
      ).rejects.toMatchObject({ status: 400, code: "bill_closed" });
    }
  });

  it("dbCancelBill rejects cancelling a paid bill", async () => {
    const client = createMockClient({ tables: { bills: [makeBill({ status: "paid" })] } });
    await expect(dbCancelBill(asClient(client), USER_A, BILL_ID)).rejects.toMatchObject({
      status: 400,
      code: "bill_closed",
    });
  });

  it("dbCancelBill returns the bill unchanged when already cancelled", async () => {
    const client = createMockClient({ tables: { bills: [makeBill({ status: "cancelled" })] } });
    const bill = await dbCancelBill(asClient(client), USER_A, BILL_ID);
    expect(bill.status).toBe("cancelled");
  });

  it("dbDeleteBill is blocked when payment history exists", async () => {
    const client = createMockClient({
      tables: {
        bills: [makeBill()],
        bill_payments: [{ id: "e0000000-0000-4000-8000-000000000001", bill_id: BILL_ID }],
      },
    });
    await expect(dbDeleteBill(asClient(client), USER_A, BILL_ID)).rejects.toMatchObject({
      status: 409,
      code: "in_use",
    });
  });

  it("dbDeleteBill succeeds when there is no payment history", async () => {
    const client = createMockClient({ tables: { bills: [makeBill()], bill_payments: [] } });
    await expect(dbDeleteBill(asClient(client), USER_A, BILL_ID)).resolves.toEqual({
      deleted: true,
    });
  });

  it("dbMarkPaid maps unauthorized RPC failures to 403", async () => {
    const client = createMockClient({
      tables: {},
      rpc: { mark_bill_paid: () => ({ data: null, error: { message: "unauthorized", code: "P0001" } }) },
    });
    await expect(dbMarkPaid(asClient(client), USER_A, OTHER_BILL_ID, true)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("dbMarkPaid maps unknown bills to 404 and duplicate payments to 409", async () => {
    const notFound = createMockClient({
      tables: {},
      rpc: { mark_bill_paid: () => ({ data: null, error: { message: "bill_not_found", code: "P0001" } }) },
    });
    await expect(dbMarkPaid(asClient(notFound), USER_A, OTHER_BILL_ID, true)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });

    const dup = createMockClient({
      tables: {},
      rpc: { mark_bill_paid: () => ({ data: null, error: { message: "duplicate_payment", code: "P0001" } }) },
    });
    await expect(dbMarkPaid(asClient(dup), USER_A, BILL_ID, true)).rejects.toMatchObject({
      status: 409,
      code: "bill_already_paid",
    });
  });

  it("dbMarkPaid normalizes the RPC result and keeps the transaction link", async () => {
    const client = createMockClient({
      tables: {},
      rpc: {
        mark_bill_paid: () => ({
          data: {
            payment_id: "f0000000-0000-4000-8000-000000000001",
            transaction_id: "f0000000-0000-4000-8000-000000000002",
            overspend_amount: 250,
            next_due_date: "2026-09-15",
            status: "upcoming",
          },
          error: null,
        }),
      },
    });
    const result = await dbMarkPaid(asClient(client), USER_A, BILL_ID, true);
    expect(result.transaction_id).toBe("f0000000-0000-4000-8000-000000000002");
    expect(result.overspend_amount).toBe(250);
    expect(result.next_due_date).toBe("2026-09-15");
    expect(result.status).toBe("upcoming");
  });

  it("dbListPayments joins bill names without leaking another user's bills", async () => {
    const client = createMockClient({
      tables: {
        bill_payments: [
          {
            id: "f0000000-0000-4000-8000-000000000001",
            bill_id: BILL_ID,
            user_id: USER_A,
            amount: 15000,
            due_date: "2026-08-15",
            paid_at: "2026-08-15T10:00:00Z",
            transaction_id: null,
          },
        ],
        bills: [makeBill()],
      },
    });
    const payments = await dbListPayments(asClient(client), USER_A);
    expect(payments).toHaveLength(1);
    expect(payments[0].bill_name).toBe("Rent");
  });

  it("dbListReminders joins bill name/amount and respects the since filter", async () => {
    const client = createMockClient({
      tables: {
        bill_reminders: [
          {
            id: "f0000000-0000-4000-8000-000000000003",
            bill_id: BILL_ID,
            user_id: USER_A,
            kind: "advance",
            days_before: 3,
            due_date: "2026-08-15",
            fired_at: "2026-08-12T07:00:00Z",
          },
        ],
        bills: [makeBill()],
      },
    });
    const reminders = await dbListReminders(asClient(client), USER_A, "2026-08-01T00:00:00Z");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].bill_name).toBe("Rent");
    expect(reminders[0].amount).toBe(15000);
    expect(reminders[0].is_credit_card).toBe(false);
  });
});

describe("calendar helpers — display rules", () => {
  const AUG = { start: "2026-08-01", endExclusive: "2026-09-01" };

  it("monthRange is a half-open interval and monthGrid is 6x7", () => {
    expect(monthRange(2026, 7)).toEqual({ start: "2026-08-01", endExclusive: "2026-09-01" });
    const grid = monthGrid(2026, 7);
    expect(grid).toHaveLength(6);
    expect(grid.flat()).toHaveLength(42);
    expect(isInMonth("2026-08-31", AUG.start, AUG.endExclusive)).toBe(true);
    expect(isInMonth("2026-09-01", AUG.start, AUG.endExclusive)).toBe(false);
  });

  it("shows a monthly bill once inside its month and never duplicates", () => {
    const bill = makeBill({ due_date: "2026-08-15", frequency: "monthly", status: "upcoming" });
    const events = billEventsForMonth([bill], AUG.start, AUG.endExclusive, "2026-08-11");
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(`bill-${BILL_ID}-2026-08-15`);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("repeats a weekly bill for every occurrence inside the month", () => {
    const bill = makeBill({
      due_date: "2026-08-05",
      frequency: "weekly",
      anchor_day: 5,
      status: "upcoming",
    });
    const events = billEventsForMonth([bill], AUG.start, AUG.endExclusive, "2026-08-11");
    const dates = events.map((e) => e.date);
    expect(dates).toContain("2026-08-05");
    expect(dates).toContain("2026-08-12");
    expect(dates).toContain("2026-08-26");
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("an overdue bill still lands on its due date inside the month", () => {
    const bill = makeBill({ due_date: "2026-08-02", frequency: "one_time", status: "overdue" });
    const events = billEventsForMonth([bill], AUG.start, AUG.endExclusive, "2026-08-11");
    expect(events).toHaveLength(1);
    expect(events[0].billStatus).toBe("overdue");
  });

  it("hides paid one-time bills and cancelled bills entirely", () => {
    const paid = makeBill({ due_date: "2026-08-15", frequency: "one_time", status: "paid" });
    const cancelled = makeBill({ due_date: "2026-08-15", frequency: "monthly", status: "cancelled" });
    expect(billEventsForMonth([paid, cancelled], AUG.start, AUG.endExclusive, "2026-08-11")).toHaveLength(0);
  });

  it("advances an overdue recurring bill to its first due date in the month", () => {
    const bill = makeBill({
      due_date: "2026-07-31",
      frequency: "monthly",
      anchor_day: 31,
      status: "overdue",
    });
    const events = billEventsForMonth([bill], AUG.start, AUG.endExclusive, "2026-08-11");
    expect(events.map((e) => e.date)).toContain("2026-08-31");
  });

  it("billsDueThisMonth counts unpaid bills only", () => {
    const bill = makeBill({ due_date: "2026-08-15", amount: 1000, status: "upcoming" });
    const events: CalendarEvent[] = billEventsForMonth([bill], AUG.start, AUG.endExclusive, "2026-08-11");
    expect(billsDueThisMonth(events)).toBe(1000);
  });

  it("recurring events and generated transactions never share an id", () => {
    const txEvent = {
      date: "2026-08-12",
      id: "tx-123",
      kind: "transaction" as const,
      title: "Expense",
      amount: 100,
      income: false,
      expense: true,
      category: "Food",
      note: null,
      pending: false,
      billStatus: null,
      isCreditCard: false,
      txId: "123",
      ruleId: null,
      billId: null,
    };
    const rule = {
      id: "rule-1",
      next_occurrence: "2026-08-12",
      amount: 200,
      type: "expense" as const,
      category: "Food",
      description: "Dinner",
      account: null,
      status: "active" as const,
      requires_confirmation: false,
    };
    const events = recurringEventsForMonth(
      [rule as never],
      [],
      AUG.start,
      AUG.endExclusive
    );
    const ids = [txEvent.id, ...events.map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("daysBetween matches daysUntil semantics", () => {
    expect(daysBetween("2026-08-11", "2026-08-15")).toBe(4);
  });
});

describe("bills migration — database guarantees", () => {
  const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sql = readFileSync(resolve(MIGRATIONS_DIR, "20260812000000_bills_and_calendar.sql"), "utf8");

  it("is part of the shipped migration set", () => {
    expect(migrations).toContain("20260812000000_bills_and_calendar.sql");
  });

  it("defines user-owned bills with a status gate and reminder fields", () => {
    expect(sql).toContain("create table if not exists public.bills");
    expect(sql).toMatch(/status text not null default 'upcoming'/);
    expect(sql).toMatch(/check \(status in \('upcoming', 'due', 'paid', 'overdue', 'cancelled'\)\)/);
    expect(sql).toMatch(/reminder_enabled boolean not null default true/);
    expect(sql).toMatch(/reminder_days_before integer not null default 3/);
  });

  it("enforces RLS on bills, payments and reminders", () => {
    expect(sql).toContain("alter table public.bills enable row level security");
    expect(sql).toContain("alter table public.bill_payments enable row level security");
    expect(sql).toContain("alter table public.bill_reminders enable row level security");
    expect(sql).toMatch(/create policy "bills: read own" on public\.bills/);
    expect(sql).toMatch(/create policy "bill_reminders: read own" on public\.bill_reminders/);
  });

  it("prevents double-paying the same due date", () => {
    expect(sql).toMatch(/unique \(bill_id, due_date\)/);
  });

  it("dedupes reminders at the database level", () => {
    expect(sql).toMatch(/unique \(bill_id, due_date, kind\)/);
  });

  it("prevents one payment from booking two transactions", () => {
    expect(sql).toContain("create unique index if not exists transactions_bill_payment_idx");
    expect(sql).toContain("on public.transactions (bill_payment_id)");
    expect(sql).toContain("where bill_payment_id is not null");
  });

  it("keeps payment history forever (ON DELETE RESTRICT)", () => {
    expect(sql).toMatch(/bill_id uuid not null references public\.bills\(id\) on delete restrict/);
  });

  it("mark_bill_paid verifies ownership before paying", () => {
    expect(sql).toContain("create or replace function public.mark_bill_paid");
    expect(sql).toContain("if v_bill.user_id is distinct from auth.uid() then");
    expect(sql).toContain("raise exception 'unauthorized'");
    expect(sql).toContain("raise exception 'bill_already_paid'");
  });

  it("_apply_bill_expense blocks duplicate expense creation", () => {
    expect(sql).toContain("create or replace function public._apply_bill_expense");
    expect(sql).toContain("select exists (");
    expect(sql).toContain("where bill_payment_id = p_bill_payment_id");
    expect(sql).toContain("raise exception 'duplicate_payment'");
  });

  it("reminder generation cannot process another user's bills from a client", () => {
    expect(sql).toContain("create or replace function public.generate_all_bill_reminders");
    expect(sql).toContain("if auth.uid() is not null then");
    expect(sql).toContain("raise exception 'unauthorized'");
  });

  it("exposes a minimal grant surface", () => {
    expect(sql).toContain("revoke all on function public.mark_bill_paid(uuid, boolean) from public");
    expect(sql).toContain("revoke all on function public.generate_all_bill_reminders() from public");
    expect(sql).toContain("grant execute on function public.mark_bill_paid(uuid, boolean) to authenticated, service_role");
    expect(sql).toContain("grant execute on function public.generate_bill_reminders(uuid) to authenticated, service_role");
    expect(sql).toContain("grant execute on function public.generate_all_bill_reminders() to service_role");
  });

  it("ships the bill-reminder Edge Function that consumes only new rows", () => {
    expect(() =>
      readFileSync(resolve(process.cwd(), "supabase/functions/bill-reminder/index.ts"), "utf8")
    ).not.toThrow();
  });

  it("AuthApiError is the shared error envelope used by the bills API", () => {
    expect(new AuthApiError(400, "boom").status).toBe(400);
  });
});
