"use client";

import { useEffect } from "react";
import Link from "next/link";
import AdminPage from "@/components/admin/AdminPage";
import { EmptyState, PermissionGate, SectionCard, StatCard, StatusBadge } from "@/components/admin/ui";
import { useAdminData, useMaintenanceStatus } from "@/lib/admin/useAdminData";
import { useAdminAuth, type AdminAIStatus, type AdminOverview, type AuditEntry, type Paged } from "@/lib/admin/client";
import { inr, timeAgo } from "@/lib/format";

function HealthRow({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-3">
      <span
        className="h-3 w-3 rounded-full shrink-0"
        style={{ background: ok ? "#10b981" : "#f59e0b", boxShadow: ok ? "0 0 8px #10b981" : "0 0 8px #f59e0b" }}
      />
      <p className="flex-1 text-sm font-semibold text-snow">{label}</p>
      {hint && <p className="text-[13px] text-slate">{hint}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  useEffect(() => {
    document.title = "Dashboard · Admin · FinSight";
  }, []);
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canReports = permissions.includes("REPORT_VIEW");
  const canAI = permissions.includes("AI_SETTINGS");
  const overview = useAdminData<AdminOverview>("/overview");
  const ai = useAdminData<AdminAIStatus>("/ai/status");
  // Latest administrative actions. The card lives below the REPORT_VIEW
  // early-return, the audit endpoint itself enforces AUDIT_LOG_VIEW
  // server-side, and the null path keeps the browser from even requesting
  // audit data without REPORT_VIEW. A failed fetch degrades to a hidden
  // card — never an error state for the dashboard as a whole.
  const activity = useAdminData<Paged<AuditEntry>>(
    canReports ? "/audit-logs?page=1&pageSize=5" : null
  );
  const { maintenance } = useMaintenanceStatus();

  // F-04: report/aggregate data requires REPORT_VIEW. The server enforces
  // this with 403 on /overview; here we render a clear restricted state
  // instead of surfacing the failed fetch.
  if (auth.status === "ready" && !canReports) {
    return (
      <AdminPage title="Dashboard" subtitle="Platform overview" icon="chart">
        <SectionCard>
          <EmptyState
            icon="lock"
            title="Report access required"
            hint="This account does not have the REPORT_VIEW permission, so aggregate platform statistics are hidden."
          />
        </SectionCard>
      </AdminPage>
    );
  }

  if (overview.status === "error") {
    return (
      <AdminPage title="Dashboard" subtitle="Platform overview" icon="chart">
        <EmptyState icon="alert" title="Could not load overview" hint={overview.error.message} />
      </AdminPage>
    );
  }

  if (overview.status !== "ready") {
    return (
      <AdminPage title="Dashboard" subtitle="Platform overview" icon="chart">
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl glass p-4 space-y-3">
                <div className="h-9 w-9 rounded-xl bg-tint animate-pulse" />
                <div className="h-7 w-16 rounded-full bg-tint animate-pulse" />
                <div className="h-3 w-20 rounded-full bg-tint animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </AdminPage>
    );
  }

  const { users, finance, notifications, push, health } = overview.data;

  return (
    <AdminPage title="Dashboard" subtitle="Platform overview" icon="chart">
      {maintenance && (
        <div className="mb-4 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm font-semibold text-[#5b3a00]" style={{ background: "#f59e0b22", boxShadow: "inset 0 0 0 1px #f59e0b55" }}>
          <StatusBadge value="sending" />
          <span>Maintenance mode is ON — the user app is unavailable. Admins retain access.</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 animate-fade-up">
        <StatCard label="Users" value={users.total} icon="profile" color="#6366f1" hint={`${users.verified} verified · ${users.admins} admins`} />
        <StatCard label="Transactions" value={finance.transactions} icon="transactions" color="#10b981" />
        <StatCard label="Income" value={inr(finance.income, { compact: true })} icon="income" color="#10b981" />
        <StatCard label="Expenses" value={inr(finance.expenses, { compact: true })} icon="expense" color="#ef4444" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-2.5 animate-fade-up">
        <StatCard label="Savings held" value={inr(finance.savings, { compact: true })} icon="piggy" color="#34d399" />
        <StatCard label="Active budgets" value={finance.active_budgets} icon="target" color="#f59e0b" />
        <StatCard label="Push subscribers" value={push.subscribers} icon="phone" color="#6366f1" />
        <StatCard label="Broadcasts (7d)" value={notifications.sent_last_7_days} icon="bell" color="#a855f7" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-5">
        <SectionCard title="System health" icon="shield">
          <div className="border-t border-line divide-y divide-line">
            <HealthRow label="Backend" ok={health.backend} hint="Next.js API responding." />
            <HealthRow label="Database" ok={health.database} hint="Live aggregate queries succeeding." />
            <HealthRow label="AI features" ok={health.ai} hint={health.ai ? "Enabled in app settings." : "Disabled in app settings."} />
            <HealthRow label="Notifications" ok={health.notifications} hint={health.notifications ? "Reminders enabled." : "Reminders disabled."} />
            <HealthRow label="PWA" ok={health.pwa} hint={health.pwa ? "Install prompts enabled." : "Install prompts disabled."} />
            <HealthRow label="Maintenance mode" ok={!health.maintenance} hint={health.maintenance ? "User access is suspended." : "Normal operation."} />
          </div>
        </SectionCard>

        <SectionCard title="Account status" icon="profile">
          <div className="grid grid-cols-2 gap-3 p-5">
            <MiniStat label="Active" value={users.active} color="#10b981" />
            <MiniStat label="Disabled" value={users.disabled} color="#f59e0b" />
            <MiniStat label="Suspended" value={users.suspended} color="#ef4444" />
            <MiniStat label="Unverified" value={users.unverified} color="#94a3b8" />
          </div>
        </SectionCard>
      </div>

      <div className="mt-5">
        <PermissionGate permission="AI_SETTINGS" permissions={permissions}>
          <SectionCard title="AI service" icon="sparkles">
          {ai.status === "ready" && ai.data ? (
            <div className="border-t border-line divide-y divide-line">
              <HealthRow label="Provider" ok={ai.data.config.configured} hint={`${ai.data.config.provider} · ${ai.data.config.model ?? "no model"}`} />
              <HealthRow label="Configured" ok={ai.data.config.configured} hint={ai.data.config.configured ? "API credentials present in environment." : "Set AI_ENABLED / OPENAI_API_KEY / OLLAMA_* env vars."} />
              <HealthRow label="Endpoint" ok={ai.data.health.reachable} hint={ai.data.health.reachable ? `Reachable${ai.data.health.latency_ms != null ? ` · ${ai.data.health.latency_ms}ms` : ""}` : (ai.data.health.detail ?? "unreachable")} />
              <HealthRow label="Enabled" ok={ai.data.config.enabled} hint={ai.data.config.enabled ? "User AI insights are on." : "Disabled via environment."} />
            </div>
          ) : ai.status === "error" ? (
            <EmptyState icon="alert" title="Could not load AI status" hint={ai.error.message} />
          ) : (
            <div className="p-5 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded-xl bg-tint animate-pulse" />
              ))}
            </div>
          )}
          </SectionCard>
        </PermissionGate>
      </div>

      <div className="mt-5">
        {activity.status !== "error" && (
        <SectionCard title="Recent administrative activity" icon="lock">
          {activity.status === "loading" && (
            <div className="p-5 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded-xl bg-tint animate-pulse" />
              ))}
            </div>
          )}
          {activity.status === "ready" && activity.data.items.length === 0 && (
            <div className="p-5">
              <EmptyState icon="lock" title="No administrative activity yet" hint="Actions taken in the console will appear here." />
            </div>
          )}
          {activity.status === "ready" && activity.data.items.length > 0 && (
            <>
              <div className="border-t border-line divide-y divide-line">
                {activity.data.items.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                    <StatusBadge value={e.result} />
                    <p className="font-mono text-[13px] font-semibold text-snow">{e.action}</p>
                    <p className="text-[13px] text-slate truncate max-w-[180px]">
                      {e.target_email ?? (e.resource_type ? `${e.resource_type}${e.resource_id ? ` ${e.resource_id.slice(0, 8)}…` : ""}` : "")}
                    </p>
                    <span className="text-[13px] text-muted ml-auto shrink-0">by {e.actor_email ?? e.actor_id?.slice(0, 8) ?? "system"} · {timeAgo(e.created_at)}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-line">
                <Link href="/admin/audit" className="text-[13px] font-semibold text-accent hover:underline">
                  View all audit activity →
                </Link>
              </div>
            </>
          )}
        </SectionCard>
      )}
      </div>

      <p className="text-[13px] text-muted mt-4 text-center">
        Aggregated platform statistics only. Individual financial data is never shown here.
      </p>
    </AdminPage>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl neo-inset p-4">
      <p className="text-2xl font-bold tabular" style={{ color }}>{value}</p>
      <p className="text-[13px] text-slate mt-0.5">{label}</p>
    </div>
  );
}
