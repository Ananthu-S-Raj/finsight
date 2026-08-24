"use client";

import { useEffect, useRef } from "react";
import { generateGoalReminders, listGoalReminders, listGoals } from "./goalsApi";
import { addNotificationIfMissing } from "./notifications";
import { goalDaysRemaining, goalHealth, goalNotificationId, type Goal, type GoalReminder } from "./goals";
import { daysBetween } from "./calendar";
import { toDateOnly } from "./recurring";
import { inr } from "./format";

/**
 * Client-side goal-reminder engine.
 *
 * Runs once per browser session right after the app shell mounts:
 *   1. generate_goal_reminders — creates any deadline / completion reminder
 *      rows that are owed (idempotent; the unique (goal, target_date, kind)
 *      index means each fires exactly once).
 *   2. In-app notifications — reminders newer than the last-seen marker are
 *      pushed into the notification center with stable dedupe ids.
 *   3. Falling-behind check — an active goal whose contributions trail the
 *      even-savings baseline is surfaced at most once per ISO week.
 *
 * The server-side backstop is the goal-reminder Edge Function on pg_cron, so
 * reminders are never lost even if this never runs.
 */
let sessionStarted = false;
let sessionUserId: string | null = null;

/** Goals last fetched by checkFallingBehind — reused by GoalsSection. */
let _lastGoals: Goal[] | null = null;

/**
 * Returns goals cached by the engine for the given user, or null.
 * Keyed by userId so that if user A logs out and user B logs in within the
 * same tab, user B never sees user A's cached goals.
 */
export function getLastEngineGoals(userId: string | null): Goal[] | null {
  if (userId !== sessionUserId) return null;
  return _lastGoals;
}

const LAST_SEEN_KEY = "finsight:goal-reminders:last-seen";
const BEHIND_KEY = "finsight:goal-reminders:behind-week";

export function useGoalEngine(userId: string | null) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (startedRef.current) return;
    startedRef.current = true;

    if (sessionStarted && sessionUserId === userId) return;
    sessionStarted = true;
    sessionUserId = userId;

    void (async () => {
      // Run checkFallingBehind early (in parallel with generateGoalReminders)
      // so its goals data is available for GoalsSection to reuse.
      const behindPromise = checkFallingBehind();

      try {
        await generateGoalReminders();
      } catch {
        // Non-critical: the scheduled Edge Function still covers this.
      }
      // pushInAppReminders needs generated reminders; checkFallingBehind is
      // independent — wait for both.
      await Promise.allSettled([
        pushInAppReminders(userId),
        behindPromise,
      ]);
    })();
  }, [userId]);
}

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(value: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, value);
  } catch {
    // storage unavailable
  }
}

function readBehindWeek(): string | null {
  try {
    return localStorage.getItem(BEHIND_KEY);
  } catch {
    return null;
  }
}

function writeBehindWeek(value: string): void {
  try {
    localStorage.setItem(BEHIND_KEY, value);
  } catch {
    // storage unavailable
  }
}

function isoWeekStart(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday-first
  d.setDate(d.getDate() - day);
  return toDateOnly(d);
}

function reminderTitle(kind: GoalReminder["kind"]): string {
  return kind === "completion" ? "Goal reached" : "Goal due soon";
}

function reminderMessage(r: GoalReminder): string {
  const name = r.goal_name ?? "Your goal";
  if (r.kind === "completion") {
    return `${name} — you've saved ${inr(r.current_amount)} of ${inr(r.target_amount)}.`;
  }
  const diff = daysBetween(toDateOnly(new Date()), r.target_date);
  const when = diff <= 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
  return `${name} — ${inr(r.target_amount)} target is due ${when}.`;
}

async function pushInAppReminders(userId: string): Promise<void> {
  const lastSeen = readLastSeen();
  const since = lastSeen ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

  const reminders = await listGoalReminders(since);
  for (const r of reminders) {
    addNotificationIfMissing({
      id: goalNotificationId(r.goal_id, r.kind, r.target_date),
      category: "savings",
      icon: "target",
      title: reminderTitle(r.kind),
      message: reminderMessage(r),
      at: new Date(r.fired_at).getTime(),
      read: false,
      route: "/goals",
    });
  }

  writeLastSeen(new Date().toISOString());
}

async function checkFallingBehind(): Promise<void> {
  const week = isoWeekStart();
  const alreadyChecked = readBehindWeek() === week;

  const today = new Date();
  const behind: Array<{ id: string; name: string; target: number }> = [];
  try {
    const goals = (await listGoals()) ?? [];
    _lastGoals = goals;
    if (alreadyChecked) return;
    for (const goal of goals) {
      if (goal.status !== "active") continue;
      const health = goalHealth(goal, today);
      if (health.status === "at_risk" && goalDaysRemaining(goal, today) > 0) {
        behind.push({ id: goal.id, name: goal.name, target: goal.target_amount });
      }
    }
  } catch {
    return;
  }
  if (behind.length === 0) return;

  writeBehindWeek(week);
  for (const goal of behind) {
    addNotificationIfMissing({
      id: goalNotificationId(goal.id, "behind", week),
      category: "savings",
      icon: "alert",
      title: "Goal falling behind",
      message: `${goal.name} — you're behind the pace to reach ${inr(goal.target)} on time.`,
      at: Date.now(),
      read: false,
      route: "/goals",
    });
  }
}
