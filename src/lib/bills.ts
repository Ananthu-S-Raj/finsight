/**
 * Shared types and pure helpers for the bills feature.
 *
 * This module is importable from both the client and the server (it has no
 * side effects), so the same validation, labels and date math drive the
 * Next.js API, the bill engine, the UI and the tests. The reference
 * implementation of the due-date math lives in the database as
 * `public.next_bill_due_date()` (see
 * supabase/migrations/20260812000000_bills_and_calendar.sql);
 * `nextBillDueDateStr` below mirrors it exactly for client-side previews.
 */

import {
  dayOfMonth,
  fromDateOnly,
  nextRecurringDateStr,
  type Frequency,
} from "./recurring";

export const BILL_FREQUENCIES = [
  "one_time",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type BillFrequency = (typeof BILL_FREQUENCIES)[number];

export const BILL_FREQUENCY_LABEL: Record<BillFrequency, string> = {
  one_time: "One time",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const BILL_STATUSES = [
  "upcoming",
  "due",
  "paid",
  "overdue",
  "cancelled",
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  upcoming: "Upcoming",
  due: "Due today",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

/** Reminder lead-time choices shown in the bill form. */
export const REMINDER_OPTIONS = [
  { days: 7, label: "7 days before" },
  { days: 3, label: "3 days before" },
  { days: 1, label: "1 day before" },
  { days: 0, label: "On the due date" },
] as const;

/** Wire shape of a bill as returned by the API. */
export type Bill = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  category: string | null;
  subcategory: string | null;
  category_id: string | null;
  due_date: string;
  frequency: BillFrequency;
  status: BillStatus;
  is_credit_card: boolean;
  reminder_enabled: boolean;
  reminder_days_before: number;
  notes: string | null;
  anchor_day: number;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Wire shape of a payment-history row. `bill_name` is joined server-side. */
export type BillPayment = {
  id: string;
  bill_id: string;
  user_id: string;
  amount: number;
  due_date: string;
  transaction_id: string | null;
  paid_at: string;
  bill_name: string | null;
  bill_category: string | null;
};

export type BillPaidResult = {
  payment_id: string;
  transaction_id: string | null;
  overspend_amount: number;
  next_due_date: string | null;
  status: BillStatus;
};

export type BillReminder = {
  id: string;
  user_id: string;
  bill_id: string;
  kind: "advance" | "due" | "overdue";
  days_before: number;
  due_date: string;
  fired_at: string;
  bill_name: string | null;
  amount: number;
  is_credit_card: boolean;
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class BillValidationError extends Error {
  code: string;
  constructor(message: string, code = "validation_failed") {
    super(message);
    this.name = "BillValidationError";
    this.code = code;
  }
}

function cleanString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Client mirror of `public.next_bill_due_date`. Returns null for one-time
 * bills (they never advance) and clamps month-based frequencies via the same
 * math as recurring transactions.
 */
export function nextBillDueDateStr(
  frequency: BillFrequency,
  from: string,
  anchorDay: number
): string | null {
  if (frequency === "one_time") return null;
  if (frequency === "weekly") {
    const d = fromDateOnly(from);
    if (!d) return null;
    return nextRecurringDateStr("weekly", from, anchorDay);
  }
  return nextRecurringDateStr(frequency as Frequency, from, anchorDay);
}

/**
 * Status computed from today's date. Cancelled/paid are stored states;
 * everything else is derived from `due_date` (mirrors the SQL refresh inside
 * generate_bill_reminders).
 */
export function computeBillStatus(
  bill: Pick<Bill, "status" | "due_date">,
  today: string
): BillStatus {
  if (bill.status === "cancelled") return "cancelled";
  if (bill.status === "paid") return "paid";
  if (bill.due_date < today) return "overdue";
  if (bill.due_date === today) return "due";
  return "upcoming";
}

/** Sort priority for grouping bills (overdue first, then due, then upcoming). */
export function billStatusRank(status: BillStatus): number {
  switch (status) {
    case "overdue":
      return 0;
    case "due":
      return 1;
    case "upcoming":
      return 2;
    case "paid":
      return 3;
    case "cancelled":
      return 4;
  }
}

export function daysUntil(dueDate: string, today: string): number {
  const a = fromDateOnly(dueDate);
  const b = fromDateOnly(today);
  if (!a || !b) return 0;
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** True for a bill the user still needs to pay. */
export function isUnpaid(status: BillStatus): boolean {
  return status === "upcoming" || status === "due" || status === "overdue";
}

export type BillInput = {
  name: string;
  amount: number;
  due_date: string;
  frequency: BillFrequency;
  category: string | null;
  category_id: string | null;
  subcategory: string | null;
  is_credit_card: boolean;
  reminder_enabled: boolean;
  reminder_days_before: number;
  notes: string | null;
};

/**
 * Normalizes and validates client-supplied bill data. Returns the sanitized
 * object or throws a typed error; the API layer turns these into 400s.
 */
export function normalizeBillInput(raw: Record<string, unknown>): BillInput {
  const name = cleanString(raw.name);
  if (!name || name.length > 80) {
    throw new BillValidationError("Bill name is required (80 characters max).", "invalid_name");
  }

  const amount = typeof raw.amount === "number" ? raw.amount : Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99_999_999.99) {
    throw new BillValidationError("Amount must be greater than zero.", "invalid_amount");
  }

  const due_date = cleanString(raw.due_date);
  if (!due_date || !fromDateOnly(due_date)) {
    throw new BillValidationError("Due date is invalid.", "invalid_due_date");
  }

  const frequency = raw.frequency as BillFrequency;
  if (!BILL_FREQUENCIES.includes(frequency)) {
    throw new BillValidationError("Frequency is invalid.", "invalid_frequency");
  }

  const category = cleanString(raw.category);
  if (category && category.length > 60) {
    throw new BillValidationError("Category is too long.", "invalid_category");
  }
  const category_id = cleanString(raw.category_id);
  if (category_id && !UUID_RE.test(category_id)) {
    throw new BillValidationError("Category is invalid.", "invalid_category");
  }
  const subcategory = cleanString(raw.subcategory);
  if (subcategory && subcategory.length > 60) {
    throw new BillValidationError("Subcategory is too long.", "invalid_subcategory");
  }

  const notes = cleanString(raw.notes);
  if (notes && notes.length > 500) {
    throw new BillValidationError("Notes must be 500 characters or fewer.", "invalid_notes");
  }

  let reminder_days_before = Number(raw.reminder_days_before);
  if (!Number.isInteger(reminder_days_before)) reminder_days_before = 3;
  reminder_days_before = Math.min(Math.max(reminder_days_before, 0), 7);

  return {
    name,
    amount: Math.round(amount * 100) / 100,
    due_date,
    frequency,
    category,
    category_id,
    subcategory,
    is_credit_card: Boolean(raw.is_credit_card),
    reminder_enabled: raw.reminder_enabled === undefined ? true : Boolean(raw.reminder_enabled),
    reminder_days_before,
    notes,
  };
}

/** Human label for a bill: the name, falling back to its category. */
export function billTitle(bill: Pick<Bill, "name" | "category">): string {
  return bill.name || bill.category || "Bill";
}

/** Stable, dedupe-friendly id for a reminder notification. */
export function billReminderId(billId: string, dueDate: string, kind: string): string {
  return `bill-reminder-${billId}-${dueDate}-${kind}`;
}

/** dayOfMonth re-export so callers don't need the recurring import. */
export { dayOfMonth };
