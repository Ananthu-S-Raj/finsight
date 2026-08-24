"use client";

import { useEffect, useRef } from "react";
import { generateBillReminders, listReminders } from "./billsApi";
import { addNotificationIfMissing } from "./notifications";
import { billReminderId, type BillReminder } from "./bills";
import { daysBetween } from "./calendar";
import { toDateOnly } from "./recurring";
import { inr } from "./format";

/**
 * Client-side bill-reminder engine.
 *
 * Runs once per browser session right after the app shell mounts:
 *   1. generate_bill_reminders — refreshes bill statuses and creates any
 *      advance / due / overdue reminder rows that are owed (idempotent, the
 *      unique (bill, due_date, kind) index means each fires exactly once).
 *   2. In-app notifications — reminders newer than the last-seen marker are
 *      pushed into the notification center with stable dedupe ids, so rows
 *      created while the app was closed (e.g. by the bill-reminder Edge
 *      Function) still surface here.
 *
 * The server-side backstop is the bill-reminder Edge Function on pg_cron,
 * so reminders are never lost even if this never runs.
 */
let sessionStarted = false;

const LAST_SEEN_KEY = "finsight:bill-reminders:last-seen";

export function useBillEngine(userId: string | null) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (startedRef.current) return;
    startedRef.current = true;

    if (sessionStarted) return;
    sessionStarted = true;

    void (async () => {
      try {
        await generateBillReminders();
      } catch {
        // Non-critical: the scheduled Edge Function still covers this.
      }
      try {
        await pushInAppReminders(userId);
      } catch {
        // Non-critical: reminders are best-effort.
      }
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

function todayStr(): string {
  return toDateOnly(new Date());
}

function reminderTitle(kind: BillReminder["kind"]): string {
  if (kind === "overdue") return "Bill overdue";
  if (kind === "due") return "Bill due today";
  return "Bill due soon";
}

function reminderMessage(r: BillReminder): string {
  const amount = inr(r.amount);
  if (r.kind === "overdue") {
    return `${r.bill_name ?? "A bill"} — ${amount} is overdue.`;
  }
  if (r.kind === "due") {
    return `${r.bill_name ?? "A bill"} — ${amount} is due today.`;
  }
  const diff = daysBetween(todayStr(), r.due_date);
  const when = diff <= 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
  return `${r.bill_name ?? "A bill"} — ${amount} is due ${when}.`;
}

async function pushInAppReminders(userId: string): Promise<void> {
  const lastSeen = readLastSeen();
  const since = lastSeen ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

  const reminders = await listReminders(since);
  for (const r of reminders) {
    addNotificationIfMissing({
      id: billReminderId(r.bill_id, r.due_date, r.kind),
      category: "payments",
      icon: "calendar",
      title: reminderTitle(r.kind),
      message: reminderMessage(r),
      at: new Date(r.fired_at).getTime(),
      read: false,
      route: "/bills",
    });
  }

  writeLastSeen(new Date().toISOString());
}
