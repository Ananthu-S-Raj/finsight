// Deno Edge Function — deploy with: supabase functions deploy process-recurring
// Scheduled by pg_cron (see bottom of supabase/migrations/20260811000001_recurring.sql).
//
// Required secrets (set with `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_URL/ANON_KEY are already
//   injected automatically for every Edge Function)
//
// Optional secret — strongly recommended:
//   CRON_SECRET — when set, only callers presenting the matching
//   `x-cron-secret` header may invoke this function. This stops anyone holding
//   the (public) anon key from triggering the scheduler via the public URL.
//   The pg_cron `net.http_post` call must then include the header.
//
// The heavy lifting happens inside the database (`process_all_recurring_due`),
// which batches per-user processing, applies the money-layer RPCs idempotently
// and row-locks profiles. This function only provides the authenticated HTTP
// surface for pg_cron.

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "scheduler is not configured" }, 500);
  }

  // Optional shared-secret gate (mirrors daily-reminder).
  if (cronSecret) {
    const presented = req.headers.get("x-cron-secret") ?? "";
    if (!secretsEqual(presented, cronSecret)) {
      return json({ error: "unauthorized" }, 403);
    }
  }

  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase.rpc("process_all_recurring_due");
    if (error) {
      return json({ error: "rpc_failed", detail: error.message }, 500);
    }
    return json({ ok: true, result: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "unexpected", detail: message }, 500);
  }
});
