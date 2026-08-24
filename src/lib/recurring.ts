/**
 * Shared types and pure helpers for the recurring-transactions feature.
 *
 * This module is importable from both the client and the server (it has no
 * side effects), so the same recurrence math, labels and validation drive the
 * Next.js API, the scheduler, the UI and the tests. The reference
 * implementation of the calendar math lives in the database as
 * `public.next_recurring_date()` (see
 * supabase/migrations/20260811000001_recurring.sql); `nextRecurringDateStr`
 * below mirrors it exactly for client-side previews and tests.
 */

export const RECURRING_TYPES = ["expense", "income", "transfer"] as const;
export type RecurringType = (typeof RECURRING_TYPES)[number];

export const FREQUENCIES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const RECURRING_STATUSES = [
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

export const INCOME_KINDS = ["salary", "savings", "loan"] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const RECURRING_TYPE_LABEL: Record<RecurringType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

export const RECURRING_STATUS_LABEL: Record<RecurringStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  salary: "Salary",
  savings: "Savings",
  loan: "Loan",
};

/** Wire shape of a recurring rule as returned by the API. */
export type RecurringTransaction = {
  id: string;
  user_id: string;
  type: RecurringType;
  amount: number;
  category: string | null;
  category_id: string | null;
  subcategory: string | null;
  account: string | null;
  destination_account: string | null;
  description: string | null;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  next_occurrence: string;
  anchor_day: number;
  status: RecurringStatus;
  requires_confirmation: boolean;
  created_at: string;
  updated_at: string;
};

/** Wire shape of a pending confirmation occurrence. */
export type RecurringOccurrence = {
  id: string;
  user_id: string;
  recurring_transaction_id: string;
  occurrence_date: string;
  status: "pending" | "confirmed" | "skipped";
  transaction_id: string | null;
  rule: RecurringTransaction;
};

export type RecurringResult = {
  processed: number;
  generated: number;
  pending: number;
  skipped: number;
  failed: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fromDateOnly(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : null;
}

export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Calendar-correct recurrence math (client mirror of `next_recurring_date`).
 *
 * Month-based frequencies step to the same day-of-month as the anchor, clamped
 * to the last valid day of the target month: Jan 31 + 1 month -> Feb 28,
 * Feb 28 + 1 month -> Mar 31 (anchor restored), Feb 29 2024 + 1 year ->
 * Feb 28 2025, then leap day is restored in 2028.
 */
export function nextRecurringDateStr(
  frequency: Frequency,
  from: string,
  anchorDay: number
): string {
  const d = fromDateOnly(from);
  if (!d) return from;
  const day = Math.min(Math.max(1, Math.floor(anchorDay) || 1), 31);

  switch (frequency) {
    case "daily":
      return toDateOnly(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    case "weekly":
      return toDateOnly(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
    case "biweekly":
      return toDateOnly(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14));
    default: {
      const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
      const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return toDateOnly(new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay)));
    }
  }
}

/** Lists the next `count` occurrence dates starting from `from` (inclusive). */
export function upcomingOccurrences(
  frequency: Frequency,
  from: string,
  anchorDay: number,
  count: number
): string[] {
  const out: string[] = [];
  let current = from;
  for (let i = 0; i < count && out.length < 24; i += 1) {
    out.push(current);
    current = nextRecurringDateStr(frequency, current, anchorDay);
  }
  return out;
}

export function dayOfMonth(dateStr: string): number {
  const d = fromDateOnly(dateStr);
  return d ? d.getDate() : 1;
}

/** Formats a date-only string as a short human label (e.g. "31 Jan"). */
export function prettyDate(dateStr: string): string {
  const d = fromDateOnly(dateStr);
  if (!d) return dateStr;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Normalizes and validates client-supplied rule data. Returns the sanitized
 * object or throws a typed error; the API layer turns these into 400s.
 */
export type RecurringInput = {
  type: RecurringType;
  amount: number;
  frequency: Frequency;
  start_date: string;
  end_date?: string | null;
  description?: string | null;
  category?: string | null;
  category_id?: string | null;
  subcategory?: string | null;
  account?: string | null;
  destination_account?: string | null;
  requires_confirmation?: boolean;
};

export class RecurringValidationError extends Error {
  code: string;
  constructor(message: string, code = "validation_failed") {
    super(message);
    this.name = "RecurringValidationError";
    this.code = code;
  }
}

function cleanString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function normalizeRecurringInput(raw: Record<string, unknown>): RecurringInput {
  const type = raw.type as RecurringType;
  if (!RECURRING_TYPES.includes(type)) {
    throw new RecurringValidationError("Transaction type is invalid.", "invalid_type");
  }

  const amount = typeof raw.amount === "number" ? raw.amount : Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99_999_999.99) {
    throw new RecurringValidationError("Amount must be greater than zero.", "invalid_amount");
  }

  const frequency = raw.frequency as Frequency;
  if (!FREQUENCIES.includes(frequency)) {
    throw new RecurringValidationError("Frequency is invalid.", "invalid_frequency");
  }

  const start_date = cleanString(raw.start_date);
  if (!start_date || !fromDateOnly(start_date)) {
    throw new RecurringValidationError("Start date is invalid.", "invalid_start_date");
  }

  let end_date: string | null = cleanString(raw.end_date);
  if (end_date) {
    if (!fromDateOnly(end_date)) {
      throw new RecurringValidationError("End date is invalid.", "invalid_end_date");
    }
    if (end_date < start_date) {
      throw new RecurringValidationError("End date must be after the start date.", "invalid_end_date");
    }
  } else {
    end_date = null;
  }

  const description = cleanString(raw.description);
  if (description && description.length > 120) {
    throw new RecurringValidationError("Description must be 120 characters or fewer.", "invalid_description");
  }

  const category = cleanString(raw.category);
  if (category && category.length > 60) {
    throw new RecurringValidationError("Category is too long.", "invalid_category");
  }
  const category_id = cleanString(raw.category_id);
  if (category_id && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(category_id)) {
    throw new RecurringValidationError("Category is invalid.", "invalid_category");
  }
  const subcategory = cleanString(raw.subcategory);
  if (subcategory && subcategory.length > 60) {
    throw new RecurringValidationError("Subcategory is too long.", "invalid_subcategory");
  }

  const account = cleanString(raw.account);
  if (account && account.length > 30) {
    throw new RecurringValidationError("Account is too long.", "invalid_account");
  }
  const destination_account = cleanString(raw.destination_account);
  if (destination_account && destination_account.length > 30) {
    throw new RecurringValidationError("Destination account is too long.", "invalid_destination_account");
  }

  // Type/account consistency rules (mirrors the existing money layer).
  if (type === "income" && account && !(INCOME_KINDS as readonly string[]).includes(account)) {
    throw new RecurringValidationError("That income type isn't supported.", "invalid_kind");
  }
  if (type === "expense" && account && account !== "credit_card") {
    throw new RecurringValidationError("Expense source must be cash/UPI or a credit card.", "invalid_account");
  }
  if (type === "transfer") {
    if (account && account !== "salary") {
      throw new RecurringValidationError("Transfer source must be salary.", "invalid_account");
    }
    if (destination_account && destination_account !== "savings") {
      throw new RecurringValidationError("Transfer destination must be savings.", "invalid_destination_account");
    }
  } else if (destination_account) {
    throw new RecurringValidationError("Destination account only applies to transfers.", "invalid_destination_account");
  }

  return {
    type,
    amount: Math.round(amount * 100) / 100,
    frequency,
    start_date,
    end_date,
    description,
    category,
    category_id,
    subcategory,
    account,
    destination_account,
    requires_confirmation: Boolean(raw.requires_confirmation),
  };
}

/** Human label for a rule, e.g. "Netflix" or "Monthly transfer". */
export function ruleTitle(rule: Pick<RecurringTransaction, "description" | "category" | "type">): string {
  return (
    rule.description ??
    rule.category ??
    (rule.type === "transfer" ? "Salary → Savings transfer" : RECURRING_TYPE_LABEL[rule.type])
  );
}
