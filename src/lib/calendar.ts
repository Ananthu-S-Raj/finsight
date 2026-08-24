/**
 * Pure helpers for the Financial Calendar. Importable from client, server
 * and tests. The month grid, event classification and month-total math all
 * live here so the UI stays declarative and the rules are unit-testable.
 *
 * Data model: a month is described by a half-open date range
 * `[start, endExclusive)`. Three event sources feed it:
 *
 *   * transactions  — real rows (income + spending), fetched via the existing
 *                     transactions API with a range filter;
 *   * recurring     — the NEXT occurrence of each active rule (the row that
 *                     will actually be generated) plus any pending
 *                     confirmations. These are mutually exclusive with
 *                     generated transactions, so nothing double-counts;
 *   * bills         — every due date of each unpaid bill that lands in the
 *                     month (recurring bills repeat, one-time bills show once).
 */

import {
  fromDateOnly,
  ruleTitle,
  toDateOnly,
  upcomingOccurrences,
  type RecurringOccurrence,
  type RecurringTransaction,
} from "./recurring";
import {
  billTitle,
  computeBillStatus,
  nextBillDueDateStr,
  type Bill,
  type BillStatus,
} from "./bills";
import {
  TRANSACTION_TYPE_LABEL,
  type TransactionRow,
  type TransactionType,
} from "./transactions";

export type CalendarEventKind = "transaction" | "recurring" | "bill";

export type CalendarEvent = {
  /** Date-only string (YYYY-MM-DD) the event lands on. */
  date: string;
  /** Stable dedupe key. */
  id: string;
  kind: CalendarEventKind;
  title: string;
  amount: number;
  /** True when the event adds to the month's income total. */
  income: boolean;
  /** True when the event adds to the month's expense total. */
  expense: boolean;
  category: string | null;
  note: string | null;
  /** A recurring occurrence still waiting for confirmation. */
  pending: boolean;
  /** Bill due-date status (bills only). */
  billStatus: BillStatus | null;
  isCreditCard: boolean;
  txId: string | null;
  ruleId: string | null;
  billId: string | null;
};

const INCOME_TYPES = new Set<TransactionType>(["salary_add", "savings_add", "loan_add"]);
const EXPENSE_TYPES = new Set<TransactionType>(["expense", "credit_card", "savings_move"]);

export function isIncomeType(type: TransactionType): boolean {
  return INCOME_TYPES.has(type);
}

export function isExpenseType(type: TransactionType): boolean {
  return EXPENSE_TYPES.has(type);
}

/** Half-open range for a (year, 0-based month) pair, e.g. [2026-08-01, 2026-09-01). */
export function monthRange(year: number, month: number): { start: string; endExclusive: string } {
  return {
    start: toDateOnly(new Date(year, month, 1)),
    endExclusive: toDateOnly(new Date(year, month + 1, 1)),
  };
}

export function isInMonth(dateStr: string, start: string, endExclusive: string): boolean {
  return dateStr >= start && dateStr < endExclusive;
}

/**
 * 6x7 calendar grid (Sunday-first). Cells are date-only strings; leading and
 * trailing days belong to neighbouring months and are rendered as overflow.
 */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const lead = first.getDay(); // 0 = Sunday
  const grid: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const d = new Date(year, month, 1 - lead + week * 7 + day);
      row.push(toDateOnly(d));
    }
    grid.push(row);
  }
  return grid;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function transactionEvent(tx: TransactionRow): CalendarEvent {
  const type = tx.type;
  return {
    date: tx.date,
    id: `tx-${tx.id}`,
    kind: "transaction",
    title: tx.category ?? TRANSACTION_TYPE_LABEL[type],
    amount: Number(tx.amount),
    income: isIncomeType(type),
    expense: isExpenseType(type),
    category: tx.category,
    note: tx.note,
    pending: false,
    billStatus: null,
    isCreditCard: type === "credit_card",
    txId: tx.id,
    ruleId: tx.recurring_id,
    billId: null,
  };
}

/**
 * Active rules contribute their next occurrence (the row that will actually
 * be generated) only when it falls inside the month. Pending confirmations
 * (occurrence_date inside the month) are shown as reminders. The two are
 * mutually exclusive by construction.
 */
export function recurringEventsForMonth(
  rules: RecurringTransaction[],
  pending: RecurringOccurrence[],
  start: string,
  endExclusive: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const rule of rules) {
    if (rule.status !== "active") continue;
    if (!isInMonth(rule.next_occurrence, start, endExclusive)) continue;
    events.push({
      date: rule.next_occurrence,
      id: `recurring-${rule.id}-${rule.next_occurrence}`,
      kind: "recurring",
      title: ruleTitle(rule),
      amount: Number(rule.amount),
      income: rule.type === "income",
      expense: rule.type !== "income",
      category: rule.category,
      note: rule.description,
      pending: false,
      billStatus: null,
      isCreditCard: rule.account === "credit_card",
      txId: null,
      ruleId: rule.id,
      billId: null,
    });
  }

  for (const occ of pending) {
    if (occ.status !== "pending") continue;
    if (!isInMonth(occ.occurrence_date, start, endExclusive)) continue;
    events.push({
      date: occ.occurrence_date,
      id: `recurring-pending-${occ.id}`,
      kind: "recurring",
      title: ruleTitle(occ.rule),
      amount: Number(occ.rule.amount),
      income: occ.rule.type === "income",
      expense: occ.rule.type !== "income",
      category: occ.rule.category,
      note: occ.rule.description,
      pending: true,
      billStatus: null,
      isCreditCard: occ.rule.account === "credit_card",
      txId: null,
      ruleId: occ.rule.id,
      billId: null,
    });
  }

  return events;
}

/**
 * Every due date of each non-cancelled bill inside the month. One-time bills
 * show their single due date; recurring bills repeat from their current due
 * date (which may already be overdue). A one-time bill already paid is hidden.
 */
export function billEventsForMonth(
  bills: Bill[],
  start: string,
  endExclusive: string,
  today: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const bill of bills) {
    if (bill.status === "cancelled") continue;
    if (bill.frequency === "one_time" && bill.status === "paid") continue;

    let current = bill.due_date;
    const anchor = bill.anchor_day;
    let guard = 0;

    // Advance past the month start (a bill can be overdue well behind us).
    while (current < start && guard < 400) {
      const next = nextBillDueDateStr(bill.frequency, current, anchor);
      if (!next || next === current) break;
      current = next;
      guard += 1;
    }

    guard = 0;
    while (isInMonth(current, start, endExclusive) && guard < 400) {
      events.push({
        date: current,
        id: `bill-${bill.id}-${current}`,
        kind: "bill",
        title: billTitle(bill),
        amount: Number(bill.amount),
        income: false,
        expense: true,
        category: bill.category,
        note: bill.notes,
        pending: false,
        billStatus: computeBillStatus(bill, today),
        isCreditCard: bill.is_credit_card,
        txId: null,
        ruleId: null,
        billId: bill.id,
      });
      const next = nextBillDueDateStr(bill.frequency, current, anchor);
      if (!next || next === current) break;
      current = next;
      guard += 1;
    }
  }

  return events;
}

export type MonthTotals = {
  income: number;
  expenses: number;
  net: number;
};

/** Income / expenses / net from real transactions (dashboard convention). */
export function monthTotals(transactions: TransactionRow[]): MonthTotals {
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    const amount = Number(tx.amount);
    if (isIncomeType(tx.type)) income += amount;
    else if (isExpenseType(tx.type)) expenses += amount;
  }
  return { income, expenses, net: income - expenses };
}

/** Sum of bill amounts due inside the month (unpaid bills only). */
export function billsDueThisMonth(events: CalendarEvent[]): number {
  let total = 0;
  for (const e of events) {
    if (e.kind === "bill" && e.billStatus && e.billStatus !== "paid" && e.billStatus !== "cancelled") {
      total += e.amount;
    }
  }
  return total;
}

/** Days between two date-only strings (b - a), for "in 3 days" labels. */
export function daysBetween(a: string, b: string): number {
  const da = fromDateOnly(a);
  const db = fromDateOnly(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** Lists the next `count` occurrence dates of a bill from its due date. */
export function billUpcomingDates(bill: Bill, count: number): string[] {
  if (bill.frequency === "one_time") return [bill.due_date];
  return upcomingOccurrences(bill.frequency, bill.due_date, bill.anchor_day, count);
}
