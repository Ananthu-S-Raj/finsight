"use client";

import { useEffect, useRef } from "react";
import { processRecurringDue, listRecurring } from "./recurringApi";
import { addNotificationIfMissing } from "./notifications";
import { emitRefresh } from "./events";
import { inr } from "./format";
import { ruleTitle, type RecurringTransaction } from "./recurring";

/**
 * Client-side recurring engine.
 *
 * Runs once per browser session right after the app shell mounts:
 *   1. process_recurring_due — catches up any occurrences that fell due while
 *      the app was closed (idempotent, so re-running is safe), then fires a
 *      refresh so every open page re-reads balances.
 *   2. Due-soon reminders — for rules whose next occurrence is tomorrow,
 *      push an in-app notification ("Payment due tomorrow").
 *
 * The server-side backstop is the process-recurring Edge Function on pg_cron,
 * so nothing is ever dropped even if this never runs.
 */
let sessionStarted = false;

export function useRecurringEngine(userId: string | null) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (startedRef.current) return;
    startedRef.current = true;

    if (sessionStarted) return;
    sessionStarted = true;

    void (async () => {
      try {
        const result = await processRecurringDue();
        if (result.generated > 0 || result.pending > 0) {
          emitRefresh();
        }
      } catch {
        // Non-critical: balances simply refresh on next action.
      }
      try {
        await pushDueSoonReminders();
      } catch {
        // Non-critical: reminders are best-effort.
      }
    })();
  }, [userId]);
}

/** In-app reminders for rules with a tomorrow due date. */
async function pushDueSoonReminders(): Promise<void> {
  const rules = await listRecurring();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateOnly(tomorrow);

  for (const rule of rules) {
    if (rule.status !== "active") continue;
    if (rule.next_occurrence !== tomorrowStr) continue;
    pushDueSoonReminder(rule, tomorrowStr);
  }
}

function pushDueSoonReminder(rule: RecurringTransaction, onDate: string): void {
  const title =
    rule.type === "expense"
      ? "Payment due tomorrow"
      : rule.type === "income"
        ? "Income due tomorrow"
        : "Transfer due tomorrow";

  const message =
    rule.type === "expense"
      ? `${ruleTitle(rule)} — ${inr(rule.amount)} is due tomorrow.`
      : rule.type === "income"
        ? `${ruleTitle(rule)} — ${inr(rule.amount)} will be added tomorrow.`
        : `Salary → savings of ${inr(rule.amount)} is scheduled for tomorrow.`;

  addNotificationIfMissing({
    id: `recurring-due-${rule.id}-${onDate}`,
    category: "payments",
    icon: rule.type === "expense" ? "expense" : rule.type === "income" ? "income" : "transfer",
    title,
    message,
    at: Date.now(),
    read: false,
    route: "/recurring",
  });
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
