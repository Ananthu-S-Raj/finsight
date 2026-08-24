/**
 * Shared types, validation and pure math for the Financial Goals feature.
 *
 * This module is importable from both the client and the server (it has no
 * side effects), so the same validation, labels and deadline math drive the
 * Next.js API, the goal engine, the UI and the tests. The reference
 * implementation of the goal ledger lives in the database (see
 * supabase/migrations/20260813000000_financial_goals.sql) — contributions
 * go through `contribute_to_goal` / `remove_goal_contribution` so
 * `current_amount` always equals the sum of the contribution ledger.
 *
 * Deadline health model (so the UI never misleads):
 *   - COMPLETED  when current_amount >= target_amount (status may lag until
 *                the next mutation, so derived status wins in the UI).
 *   - OVERDUE    when target_date has passed and the target is not reached.
 *   - Otherwise the goal is judged against an even-contribution baseline:
 *     had you saved the same amount every day from creation to the target
 *     date, how far should you be today?
 *       expectedSoFar = target * (elapsedDays / totalDays)
 *     current_amount >= expectedSoFar -> ON TRACK, else AT RISK.
 *     (Target date today, not reached -> AT RISK.)
 *   - Required monthly/weekly contributions assume the remaining amount must
 *     be fully saved by the target date, spread over the remaining months /
 *     weeks and rounded up so the plan is always achievable.
 */

import { daysBetween } from "./calendar";
import { fromDateOnly, toDateOnly } from "./recurring";

export const GOAL_STATUSES = [
  "active",
  "completed",
  "paused",
  "cancelled",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Statuses shown by default in the goals list (cancelled is the soft-delete). */
export const VISIBLE_GOAL_STATUSES: GoalStatus[] = ["active", "paused", "completed"];

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const GOAL_ICONS = [
  "target",
  "piggy",
  "coins",
  "bank",
  "wallet",
  "calendar",
  "home",
  "trendUp",
] as const;
export type GoalIcon = (typeof GOAL_ICONS)[number];

export const GOAL_THEMES = ["accent", "indigo", "warn", "gold"] as const;
export type GoalTheme = (typeof GOAL_THEMES)[number];

export const GOAL_THEME_HEX: Record<GoalTheme, string> = {
  accent: "#10b981",
  indigo: "#6366f1",
  warn: "#f59e0b",
  gold: "#eab308",
};

/** Reminder lead-times (days before the target date) for deadline alerts. */
export const GOAL_DEADLINE_REMINDER_DAYS = [30, 7, 1] as const;

/** Wire shape of a goal as returned by the API. */
export type Goal = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_amount: number;
  current_amount: number;
  target_date: string;
  category: string | null;
  category_id: string | null;
  icon: GoalIcon;
  theme: GoalTheme;
  status: GoalStatus;
  reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
};

/** Wire shape of a contribution-history row. */
export type GoalContribution = {
  id: string;
  goal_id: string;
  user_id: string;
  amount: number;
  note: string | null;
  created_at: string;
};

/** Result of a contribution / removal, as returned by the RPCs. */
export type GoalContributionResult = {
  goal_id: string;
  current_amount: number;
  target_amount: number;
  status: GoalStatus;
};

export type GoalInput = {
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  description: string | null;
  category: string | null;
  category_id: string | null;
  icon: GoalIcon;
  theme: GoalTheme;
  reminder_enabled: boolean;
};

/** Reminder row with the joined goal info, as returned by the API. */
export type GoalReminder = {
  id: string;
  user_id: string;
  goal_id: string;
  kind: "deadline" | "completion";
  days_before: number;
  target_date: string;
  fired_at: string;
  goal_name: string | null;
  target_amount: number;
  current_amount: number;
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class GoalValidationError extends Error {
  code: string;
  constructor(message: string, code = "validation_failed") {
    super(message);
    this.name = "GoalValidationError";
    this.code = code;
  }
}

function cleanString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Validates + normalizes client-supplied goal data. Returns the sanitized
 * object or throws a typed error; the API layer turns these into 400s.
 * `current_amount` is accepted here only when a goal is being created with an
 * existing balance; updates ignore it (the ledger is the single source of
 * truth for progress).
 */
export function normalizeGoalInput(raw: Record<string, unknown>): GoalInput {
  const name = cleanString(raw.name);
  if (!name || name.length > 80) {
    throw new GoalValidationError("Give your goal a name (80 characters max).", "invalid_name");
  }

  const target_amount = typeof raw.target_amount === "number" ? raw.target_amount : Number(raw.target_amount);
  if (!Number.isFinite(target_amount) || target_amount <= 0 || target_amount > 99_999_999.99) {
    throw new GoalValidationError("Target amount must be greater than zero.", "invalid_target_amount");
  }

  const current_amount = typeof raw.current_amount === "number" ? raw.current_amount : Number(raw.current_amount ?? 0);
  if (!Number.isFinite(current_amount) || current_amount < 0 || current_amount > 99_999_999.99) {
    throw new GoalValidationError("Starting amount can't be negative.", "invalid_current_amount");
  }

  const target_date = cleanString(raw.target_date);
  if (!target_date || !fromDateOnly(target_date)) {
    throw new GoalValidationError("Pick a valid target date.", "invalid_target_date");
  }

  const description = cleanString(raw.description);
  if (description && description.length > 300) {
    throw new GoalValidationError("Description must be 300 characters or fewer.", "invalid_description");
  }

  const category = cleanString(raw.category);
  if (category && category.length > 60) {
    throw new GoalValidationError("Category is too long.", "invalid_category");
  }
  const category_id = cleanString(raw.category_id);
  if (category_id && !UUID_RE.test(category_id)) {
    throw new GoalValidationError("Category is invalid.", "invalid_category");
  }

  const icon = (raw.icon as GoalIcon) && GOAL_ICONS.includes(raw.icon as GoalIcon)
    ? (raw.icon as GoalIcon)
    : "target";
  const theme = (raw.theme as GoalTheme) && GOAL_THEMES.includes(raw.theme as GoalTheme)
    ? (raw.theme as GoalTheme)
    : "accent";

  return {
    name,
    target_amount: round2(target_amount),
    current_amount: round2(current_amount),
    target_date,
    description,
    category,
    category_id,
    icon,
    theme,
    reminder_enabled: raw.reminder_enabled === undefined ? true : Boolean(raw.reminder_enabled),
  };
}

/** Validates a single contribution amount. Throws a typed error. */
export function normalizeContributionAmount(raw: unknown): number {
  const amount = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99_999_999.99) {
    throw new GoalValidationError("Contribution must be greater than zero.", "invalid_amount");
  }
  return round2(amount);
}

/** Progress 0-100, capped at 100 (overachievement renders as a full ring). */
export function goalProgressPercent(goal: Pick<Goal, "current_amount" | "target_amount">): number {
  if (goal.target_amount <= 0) return 0;
  return Math.min(100, (goal.current_amount / goal.target_amount) * 100);
}

/** Amount still needed to reach the target (never below 0). */
export function goalRemaining(goal: Pick<Goal, "current_amount" | "target_amount">): number {
  return round2(Math.max(0, goal.target_amount - goal.current_amount));
}

/** Whole days from today (local midnight) until the target date. Negative = past. */
export function goalDaysRemaining(goal: Pick<Goal, "target_date">, today?: Date): number {
  const now = today ?? new Date();
  return daysBetween(toDateOnly(now), goal.target_date);
}

/**
 * Deadline health. Returns on_track | at_risk | overdue | completed plus the
 * even-contribution baseline used to decide on-track vs at-risk. Derived
 * status always wins over the stored status in the UI.
 */
export function goalHealth(
  goal: Pick<Goal, "current_amount" | "target_amount" | "target_date" | "created_at">,
  today?: Date
): { status: "on_track" | "at_risk" | "overdue" | "completed"; expected: number } {
  const remaining = goalRemaining(goal);
  if (remaining <= 0) return { status: "completed", expected: goal.target_amount };

  const now = today ?? new Date();
  const daysLeft = goalDaysRemaining(goal, now);
  if (daysLeft < 0) return { status: "overdue", expected: goal.target_amount };

  const created = goal.created_at ? toDateOnly(new Date(goal.created_at)) : toDateOnly(now);
  const totalDays = Math.max(1, daysBetween(created, goal.target_date));
  const elapsed = Math.max(0, Math.min(1, daysBetween(created, toDateOnly(now)) / totalDays));
  const expected = round2(goal.target_amount * elapsed);

  return {
    status: goal.current_amount >= expected ? "on_track" : "at_risk",
    expected,
  };
}

export type RequiredContribution = {
  monthly: number;
  weekly: number;
};

/**
 * Required monthly/weekly contribution to hit the target by the deadline.
 * Edge cases:
 *  - nothing remaining                        -> 0 / 0
 *  - target date today or already past        -> the full remaining amount
 *  - month/week counts are floor-protected    -> max(1, ...) so division
 *                                               never blows up
 */
export function requiredContribution(
  goal: Pick<Goal, "current_amount" | "target_amount" | "target_date">,
  today?: Date
): RequiredContribution {
  const remaining = goalRemaining(goal);
  if (remaining <= 0) return { monthly: 0, weekly: 0 };

  const now = today ?? new Date();
  const daysLeft = goalDaysRemaining(goal, now);
  if (daysLeft <= 0) return { monthly: round2(remaining), weekly: round2(remaining) };

  const months = Math.max(1, Math.round(daysLeft / (365.25 / 12)));
  const weeks = Math.max(1, Math.round(daysLeft / 7));
  return {
    monthly: round2(Math.ceil((remaining / months) * 100) / 100),
    weekly: round2(Math.ceil((remaining / weeks) * 100) / 100),
  };
}

/** Aggregates used by the dashboard + analytics goal sections. */
export function goalSummary(goals: Goal[]) {
  const visible = goals.filter((g) => VISIBLE_GOAL_STATUSES.includes(g.status));
  const active = visible.filter((g) => g.status === "active");
  const completed = visible.filter(
    (g) => g.status === "completed" || goalRemaining(g) <= 0
  );
  const totalTarget = visible.reduce((s, g) => s + g.target_amount, 0);
  const totalCurrent = visible.reduce((s, g) => s + g.current_amount, 0);
  return {
    activeCount: active.length,
    completedCount: completed.length,
    totalTarget: round2(totalTarget),
    totalProgress: round2(totalCurrent),
    overallPercent: totalTarget > 0 ? Math.min(100, (totalCurrent / totalTarget) * 100) : 0,
  };
}

/** Stable, dedupe-friendly id for a goal notification. */
export function goalNotificationId(
  goalId: string,
  kind: "deadline" | "completion" | "behind",
  anchor: string
): string {
  return `goal-${kind}-${goalId}-${anchor}`;
}

export { toDateOnly };
