// Deno Edge Function — deploy with: supabase functions deploy daily-reminder
// Scheduled by pg_cron (see bottom of supabase/schema.sql).
//
// Required secrets (set with `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_URL/ANON_KEY are already
//   injected automatically for every Edge Function)
//
// Optional secret — strongly recommended:
//   CRON_SECRET — when set, only callers presenting the matching
//   `x-cron-secret` header may invoke this function. This stops anyone holding
//   the (public) anon key from triggering push spam via the scheduled URL.
//   The pg_cron `net.http_post` call must then include the header.
//
// Sends a web-push reminder to subscribed users who haven't opted out of daily
// reminders. Per-user preferences are read from the `prefs` jsonb column on
// push_subscriptions (synced from the app's Settings → Notifications). Stale
// subscriptions (HTTP 410 Gone) are cleaned up automatically.

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
  // Configuration must be complete before doing anything.
  if (!supabaseUrl || !serviceRoleKey || !vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(JSON.stringify({ error: "reminder service is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Optional shared-secret gate. When CRON_SECRET is configured it is
  // REQUIRED — anonymous callers are rejected (403).
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

  function privacySafeBody(): string {
    // No balances, no amounts — privacy-safe copy only.
    return "Quick reminder — log anything you spent today.";
  }

  let type = "daily";
  try {
    const body = await req.json().catch(() => ({}));
    type = String(body.type || "daily");
  } catch {
    // default daily reminder
  }

  // Try to read preferences; fall back to a plain read if the prefs column
  // doesn't exist on an older deployment.
  let { data: rows } = await supabase
    .from("push_subscriptions")
    .select("id, subscription, prefs")
    .catch(() => ({ data: null, error: null }));

  if (!Array.isArray(rows)) {
    const res = await supabase.from("push_subscriptions").select("id, subscription");
    rows = res.data;
  }

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const payloads: Record<string, { title: string; body: string; url: string; tag: string; actions: unknown[] }> = {
    daily: {
      title: "FinSight",
      body: privacySafeBody(),
      url: "/dashboard?add=expense",
      tag: "reminder",
      actions: [
        { action: "add-expense", title: "Add Expense", url: "/dashboard?add=expense" },
        { action: "dismiss", title: "Dismiss" },
      ],
    },
    budget: {
      title: "FinSight",
      body: "Your FinSight budget needs attention.",
      url: "/budgets",
      tag: "budget-alert",
      actions: [
        { action: "view-budget", title: "View Budget", url: "/budgets" },
        { action: "dismiss", title: "Dismiss" },
      ],
    },
    card: {
      title: "FinSight",
      body: "A credit card payment reminder is waiting for you.",
      url: "/cards",
      tag: "card-reminder",
      actions: [
        { action: "view-card", title: "View Card", url: "/cards" },
        { action: "dismiss", title: "Dismiss" },
      ],
    },
    savings: {
      title: "FinSight",
      body: "You're doing great — check your savings progress.",
      url: "/savings",
      tag: "savings",
      actions: [
        { action: "view-savings", title: "View Savings", url: "/savings" },
        { action: "dismiss", title: "Dismiss" },
      ],
    },
  };

  const payload = payloads[type] ?? payloads.daily;

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      // Respect opt-outs stored on the subscription.
      const prefs = row.prefs && typeof row.prefs === "object" ? row.prefs : {};
      if (type === "daily" && prefs.dailyReminders === false) return "skipped";
      if (type === "budget" && prefs.budgetAlerts === false) return "skipped";
      if (type === "card" && prefs.cardReminders === false) return "skipped";
      if (type === "savings" && prefs.savingsNotifications === false) return "skipped";

      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
        return "sent";
      } catch (err) {
        const status = err && typeof err === "object" && "statusCode" in err ? err.statusCode : null;
        if (status === 410 || status === 404) {
          // Subscription is gone — remove it so we don't retry forever.
          await supabase.from("push_subscriptions").delete().eq("id", row.id).catch(() => null);
          return "removed";
        }
        throw err;
      }
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value === "sent").length;
  const removed = results.filter((r) => r.status === "fulfilled" && r.value === "removed").length;

  return new Response(
    JSON.stringify({ sent, total: rows.length, removed }),
    { headers: { "Content-Type": "application/json" } }
  );
});
