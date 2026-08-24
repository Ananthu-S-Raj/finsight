import { ApiError, requirePermission, type Handler } from "../server";

/**
 * Platform-wide aggregate dashboard. Strictly aggregated figures only —
 * no individual user's financial data appears here.
 *
 * Requires REPORT_VIEW: this endpoint is the console's reporting surface
 * (user/finance aggregates and platform health). Enforced server-side;
 * the dashboard additionally hides these cards in the UI.
 */
export const overview: Handler = async (ctx) => {
  requirePermission(ctx, "REPORT_VIEW");
  const { client } = ctx;

  // ── User stats ──────────────────────────────────────────────────────
  // Use standard query builder instead of admin_user_stats RPC (which may
  // not exist on the remote database). The is_admin() RLS gate on profiles
  // allows the admin user to read all rows.
  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, role, account_status");

  if (profileError || !profiles) {
    throw new ApiError(502, "Live database statistics are unavailable.", "stats_unavailable");
  }

  const userStats = {
    total: profiles.length,
    active: profiles.filter((p) => p.account_status === "active").length,
    disabled: profiles.filter((p) => p.account_status === "disabled").length,
    suspended: profiles.filter((p) => p.account_status === "suspended").length,
    admins: profiles.filter((p) => p.role === "admin").length,
    verified: profiles.length,
    unverified: 0,
  };

  // Attempt to refine verified/unverified counts via the auth enrichment
  // RPC (already proven to work for the users endpoint). Falls back to
  // treating every profile as verified if the RPC is unavailable.
  try {
    const ids = profiles.map((p) => p.id);
    if (ids.length > 0) {
      const { data: authInfos, error: authError } = await client.rpc("admin_auth_infos", { ids });
      if (!authError && Array.isArray(authInfos)) {
        const confirmed = (authInfos as { email_confirmed_at: string | null }[]).filter(
          (a) => a.email_confirmed_at
        ).length;
        userStats.verified = confirmed;
        userStats.unverified = profiles.length - confirmed;
      }
    }
  } catch {
    // Auth enrichment is best-effort; keep the approximation from above.
  }

  // ── Finance stats ───────────────────────────────────────────────────
  // Use standard query builder instead of admin_finance_stats RPC.
  const { data: transactions, error: txError } = await client
    .from("transactions")
    .select("type, amount");

  if (txError || !transactions) {
    throw new ApiError(502, "Live database statistics are unavailable.", "stats_unavailable");
  }

  const financeStats = {
    transactions: transactions.length,
    income: transactions
      .filter((t) => ["salary_add", "loan_add", "savings_add"].includes(t.type))
      .reduce((sum, t) => sum + (t.amount ?? 0), 0),
    expenses: transactions
      .filter((t) => ["expense", "credit_card"].includes(t.type))
      .reduce((sum, t) => sum + (t.amount ?? 0), 0),
    savings: profiles.reduce((sum, p) => sum + ((p as Record<string, unknown>).savings_balance as number ?? 0), 0),
    active_budgets: profiles.filter((p) => ((p as Record<string, unknown>).monthly_budget as number ?? 0) > 0).length,
    credit_cards: transactions.filter((t) => t.type === "credit_card").length,
    loans: transactions
      .filter((t) => t.type === "loan_add")
      .reduce((sum, t) => sum + (t.amount ?? 0), 0),
    borrow_lend_entries: transactions.filter((t) => t.type === "loan_add").length,
  };

  // ── App status / maintenance ────────────────────────────────────────
  const { data: statusData, error: statusError } = await client.rpc("app_status");
  const maintenance = !statusError ? Boolean(statusData?.[0]?.maintenance) : false;

  // ── Notifications (sent in last 7 days) ────────────────────────────
  const { count: recentSentCount, error: notifError } = await client
    .from("admin_notifications")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());

  // ── Push subscribers ────────────────────────────────────────────────
  const { count: subscriberCount, error: pushError } = await client
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });

  // ── Settings ────────────────────────────────────────────────────────
  const { data: settings, error: settingsError } = await client
    .from("app_settings")
    .select("key,value");

  const settingsMap: Record<string, Record<string, unknown>> = {};
  for (const row of settings ?? []) {
    settingsMap[row.key as string] = (row.value as Record<string, unknown>) ?? {};
  }

  return {
    users: userStats,
    finance: financeStats,
    notifications: {
      sent_last_7_days: notifError ? 0 : (recentSentCount ?? 0),
    },
    push: {
      subscribers: pushError ? 0 : (subscriberCount ?? 0),
    },
    health: {
      database: !profileError && !txError,
      backend: true,
      ai: Boolean(settingsMap.ai?.ai_enabled),
      notifications: Boolean(settingsMap.notifications?.daily_reminder_enabled),
      pwa: Boolean(settingsMap.pwa?.install_prompt_enabled),
      maintenance,
      app_name: (settingsMap.general?.app_name as string) ?? "FinSight",
      settings_error: Boolean(settingsError),
    },
  };
};
