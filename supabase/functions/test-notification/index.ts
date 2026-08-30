// Deno Edge Function — deploy with: supabase functions deploy test-notification
//
// Required secrets (set with `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
//   SUPABASE_URL / SUPABASE_ANON_KEY are already injected automatically for
//   every Edge Function
//
// Authenticated "send me a test notification" delivery for the Settings →
// Notifications screen. The caller must present a valid user JWT as
// `Authorization: Bearer <token>`; the function verifies it with the anon key
// (RLS-scoped, no service-role exposure) and only ever sends to THAT user's own
// push_subscriptions rows — never to other accounts. Stale subscriptions
// (HTTP 410 Gone / 404) are cleaned up automatically.
//
// Unlike the cron-driven reminder functions it requires no CRON_SECRET: the
// bearer token itself is the authorization, and delivery is limited to the
// caller's own devices.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "https://esm.sh/web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  // Configuration must be complete before doing anything.
  if (!supabaseUrl || !supabaseAnonKey || !vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "vapid_not_configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  // Verify the caller with the anon client (RLS-scoped reads/writes follow).
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const token = authHeader.slice("Bearer ".length).trim();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "unauthorized" }, 401);
  }

  // Only the caller's own subscriptions — the user-scoped client + `.eq`
  // both enforce isolation; `.eq` also guarantees no cross-account leak even
  // if a future policy change exposes more.
  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id, subscription, prefs")
    .eq("user_id", user.id);
  if (error) {
    return json({ error: "load_failed", detail: error.message }, 500);
  }

  if (!rows || rows.length === 0) {
    return json({ sent: 0, removed: 0, total: 0 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = {
    category: "test",
    title: "FinSight",
    body: "Test notification received successfully.",
    url: "/settings",
    tag: `finsight-test-${Date.now()}`,
    actions: [{ action: "dismiss", title: "Dismiss" }],
  };

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
        return "sent";
      } catch (err) {
        const status = err && typeof err === "object" && "statusCode" in err ? err.statusCode : null;
        if (status === 410 || status === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", row.id).catch(() => null);
          return "removed";
        }
        throw err;
      }
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value === "sent").length;
  const removed = results.filter((r) => r.status === "fulfilled" && r.value === "removed").length;

  return json({ sent, removed, total: rows.length });
});