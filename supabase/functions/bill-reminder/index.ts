// Deno Edge Function — deploy with: supabase functions deploy bill-reminder
// Scheduled by pg_cron (see the commented schedule at the bottom of
// supabase/migrations/20260812000000_bills_and_calendar.sql).
//
// Required secrets (set with `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_URL/ANON_KEY are already
//   injected automatically for every Edge Function)
//
// Optional secret — strongly recommended:
//   CRON_SECRET — when set, only callers presenting the matching
//   `x-cron-secret` header may invoke this function (same contract as the
//   daily-reminder function).
//
// Calls generate_all_bill_reminders (service role) to create exactly the
// advance / due / overdue rows that are owed for every user, then sends one
// web-push notification per newly created row to that user's subscribed
// devices — respecting the per-user `prefs.billReminders` opt-out synced from
// Settings → Notifications. Stale subscriptions (HTTP 410 Gone) are cleaned
// up automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "https://esm.sh/web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const cronSecret = Deno.env.get("CRON_SECRET");

/** Constant-time-ish string comparison for the shared secret. */
function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (!supabaseUrl || !serviceRoleKey || !vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(JSON.stringify({ error: "reminder service is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (cronSecret) {
    const presented = req.headers.get("x-cron-secret") ?? "";
    if (!secretsEqual(presented, cronSecret)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  // Create the reminder rows that are owed. Returns only the new ones.
  const { data: rows, error } = await supabase.rpc("generate_all_bill_reminders");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const created = (Array.isArray(rows) ? rows : []) as Array<{
    user_id: string;
    bill_id: string;
    kind: "advance" | "due" | "overdue";
    days_before: number;
    due_date: string;
    bill_name: string | null;
    amount: number;
    is_credit_card: boolean;
  }>;
  if (created.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0, created: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Load every push subscription once, grouped by user.
  const { data: subs } = await supabase.from("push_subscriptions").select("id, user_id, subscription, prefs");
  const byUser = new Map<string, Array<{ id: string; subscription: unknown; prefs: unknown }>>();
  for (const s of subs ?? []) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }

  const jobs: Array<{ sub: { id: string; subscription: unknown; prefs: unknown }; payload: string }> = [];
  for (const r of created) {
    const usersSubs = byUser.get(r.user_id) ?? [];
    for (const sub of usersSubs) {
      const prefs = sub.prefs && typeof sub.prefs === "object" ? sub.prefs as Record<string, unknown> : {};
      if (prefs.billReminders === false) continue;
      jobs.push({ sub, payload: JSON.stringify(buildPayload(r)) });
    }
  }

  const results = await Promise.allSettled(
    jobs.map(async ({ sub, payload }) => {
      try {
        await webpush.sendNotification(sub.subscription, payload);
        return "sent";
      } catch (err) {
        const status = err && typeof err === "object" && "statusCode" in err ? err.statusCode : null;
        if (status === 410 || status === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id).catch(() => null);
          return "removed";
        }
        throw err;
      }
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value === "sent").length;
  const removed = results.filter((r) => r.status === "fulfilled" && r.value === "removed").length;

  return new Response(
    JSON.stringify({ sent, total: jobs.length, created: created.length, removed }),
    { headers: { "Content-Type": "application/json" } }
  );
});

/** generate_all_bill_reminders returns the newly created rows. */
function buildPayload(r: {
  bill_id: string;
  kind: "advance" | "due" | "overdue";
  days_before: number;
  due_date: string;
  bill_name: string | null;
  amount: number;
  is_credit_card: boolean;
}): {
  category: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  actions: unknown[];
} {
  const name = r.bill_name ?? "A bill";
  const amount = Number(r.amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const due = r.due_date;

  let title: string;
  let body: string;
  if (r.kind === "overdue") {
    title = "Bill overdue";
    body = `${name} — ₹${amount} is overdue.`;
  } else if (r.kind === "due") {
    title = "Bill due today";
    body = `${name} — ₹${amount} is due today.`;
  } else {
    const diff = daysUntilToday(due);
    const when = diff <= 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
    title = "Bill due soon";
    body = `${name} — ₹${amount} is due ${when}.`;
  }

  return {
    category: "card",
    title,
    body,
    url: "/bills",
    tag: `bill-reminder-${r.bill_id}-${due}-${r.kind}`,
    actions: [
      { action: "view-bills", title: "View Bills", url: "/bills" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };
}

function daysUntilToday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
