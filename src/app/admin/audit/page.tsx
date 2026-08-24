"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminPage from "@/components/admin/AdminPage";
import { EmptyState, LoadingRow, Pagination, SearchInput, SectionCard, StatusBadge } from "@/components/admin/ui";
import { adminFetch, type AuditEntry, type Paged } from "@/lib/admin/client";
import { AUDIT_RESOURCE_TYPES } from "@/lib/admin/auditResourceTypes";
import { exportPagedToCsv } from "@/lib/admin/export";
import { useAdminData } from "@/lib/admin/useAdminData";
import { useToast } from "@/components/ui/ToastProvider";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { timeAgo } from "@/lib/format";

type Filter = {
  search: string;
  action: string;
  dateFrom: string;
  dateTo: string;
  actorId: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  page: number;
};

const EMPTY_FILTER: Omit<Filter, "page"> = {
  search: "",
  action: "",
  dateFrom: "",
  dateTo: "",
  actorId: "",
  userId: "",
  resourceType: "",
  resourceId: "",
};

/** Action catalogue grouped by resource domain, mirroring the writeAudit calls. */
const ACTION_GROUPS: Array<{ label: string; options: Array<[string, string]> }> = [
  {
    label: "Users",
    options: [
      ["user.update", "User updates"],
      ["user.activate", "Account activations"],
      ["user.disable", "Account disables"],
      ["user.suspend", "Account suspensions"],
      ["user.sessions_revoke", "Session revocations"],
      ["user.password_reset.request", "Password resets"],
    ],
  },
  {
    label: "Transactions",
    options: [
      ["transaction.correct", "Corrections"],
      ["transaction.flag", "Flags"],
      ["transaction.unflag", "Flag removals"],
      ["transaction.delete", "Deletions"],
    ],
  },
  {
    label: "Categories",
    options: [
      ["category.create", "Category create"],
      ["category.update", "Category update"],
      ["category.disable", "Category disable"],
      ["category.delete", "Category delete"],
    ],
  },
  {
    label: "Notifications",
    options: [
      ["notification.create", "Notification create"],
      ["notification.update", "Notification update"],
      ["notification.send", "Notification send"],
      ["notification.cancel", "Notification cancel"],
      ["notification.delete", "Notification delete"],
    ],
  },
  {
    label: "Roles & permissions",
    options: [
      ["role.permission.grant", "Permission grants"],
      ["role.permission.revoke", "Permission revocations"],
    ],
  },
  {
    label: "Auth & security",
    options: [
      ["ADMIN_LOGIN", "Admin sign-ins"],
      ["ADMIN_PASSWORD_RESET_COMPLETED", "Admin password resets"],
      ["ADMIN_PASSWORD_CHANGE_COMPLETED", "Admin password changes"],
    ],
  },
  {
    label: "System",
    options: [
      ["settings.update", "Settings update"],
      ["maintenance.toggle", "Maintenance toggle"],
    ],
  },
  {
    label: "Push",
    options: [["push.delete", "Push remove"]],
  },
];

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

export default function AdminAuditPage() {
  // useSearchParams needs a Suspense boundary during prerendering.
  return (
    <Suspense fallback={null}>
      <AdminAuditPageInner />
    </Suspense>
  );
}

function AdminAuditPageInner() {
  useEffect(() => {
    document.title = "Audit Log · Admin · FinSight";
  }, []);
  const searchParams = useSearchParams();
  // Deep links (e.g. from a user's investigation page) pre-populate the
  // target-user filter via ?userId=<uuid>.
  const [filter, setFilter] = useState<Filter>(() => ({
    ...EMPTY_FILTER,
    userId: searchParams.get("userId") ?? "",
    page: 1,
  }));

  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.action) params.set("action", filter.action);
  if (filter.dateFrom) params.set("dateFrom", filter.dateFrom);
  if (filter.dateTo) params.set("dateTo", filter.dateTo);
  if (filter.actorId.trim()) params.set("actorId", filter.actorId.trim());
  if (filter.userId.trim()) params.set("userId", filter.userId.trim());
  if (filter.resourceType) params.set("resourceType", filter.resourceType);
  if (filter.resourceId.trim()) params.set("resourceId", filter.resourceId.trim());
  params.set("page", String(filter.page));
  params.set("pageSize", "25");

  const state = useAdminData<Paged<AuditEntry>>(`/audit-logs?${params.toString()}`);
  const apply = useCallback((patch: Partial<Filter>) => setFilter((f) => ({ ...f, ...patch, page: 1 })), []);
  const hasFilters = Object.entries(EMPTY_FILTER).some(([k, v]) => filter[k as keyof Filter] !== v);
  const reset = useCallback(() => setFilter({ ...EMPTY_FILTER, page: 1 }), []);

  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  async function exportAudit() {
    if (exporting) return;
    setExporting(true);
    try {
      const p = new URLSearchParams();
      if (filter.search) p.set("search", filter.search);
      if (filter.action) p.set("action", filter.action);
      if (filter.dateFrom) p.set("dateFrom", filter.dateFrom);
      if (filter.dateTo) p.set("dateTo", filter.dateTo);
      if (filter.actorId.trim()) p.set("actorId", filter.actorId.trim());
      if (filter.userId.trim()) p.set("userId", filter.userId.trim());
      if (filter.resourceType) p.set("resourceType", filter.resourceType);
      if (filter.resourceId.trim()) p.set("resourceId", filter.resourceId.trim());
      const count = await exportPagedToCsv<AuditEntry>({
        basePath: `/audit-logs?${p.toString()}`,
        filenamePrefix: "admin-audit",
        columns: ["Timestamp", "Action", "Actor", "Target User", "Resource Type", "Resource ID", "Reason", "Metadata"],
        row: (e) => [
          e.created_at,
          e.action,
          e.actor_email ?? e.actor_id ?? "",
          e.target_email ?? "",
          e.resource_type,
          e.resource_id ?? "",
          e.reason ?? "",
          e.metadata && Object.keys(e.metadata).length > 0 ? JSON.stringify(e.metadata) : "",
        ],
      });
      toast.success(`Exported ${count} event${count === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminPage title="Audit Log" subtitle="Append-only record of every administrative action" icon="lock">
      <SectionCard title="Filters">
        <div className="p-5 space-y-3">
          <SearchInput value={filter.search} onChange={(v) => apply({ search: v })} placeholder="Search actor or target email…" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select value={filter.action} onChange={(e) => apply({ action: e.target.value })} className="field !py-2 text-[13px]" aria-label="Action filter">
              <option value="">All actions</option>
              {ACTION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="block">
              <span className="sr-only">From date</span>
              <input
                type="date"
                value={filter.dateFrom}
                max={filter.dateTo || undefined}
                onChange={(e) => apply({ dateFrom: e.target.value })}
                className="field !py-2 text-[13px]"
                aria-label="From date"
              />
            </label>
            <label className="block">
              <span className="sr-only">To date</span>
              <input
                type="date"
                value={filter.dateTo}
                min={filter.dateFrom || undefined}
                onChange={(e) => apply({ dateTo: e.target.value })}
                className="field !py-2 text-[13px]"
                aria-label="To date"
              />
            </label>
            <button
              type="button"
              onClick={reset}
              disabled={!hasFilters}
              className="btn btn-ghost btn-sm !px-2.5 !py-1.5 text-[13px] self-start justify-self-start disabled:opacity-40"
            >
              Reset filters
            </button>
            <input
              type="text"
              value={filter.actorId}
              onChange={(e) => apply({ actorId: e.target.value })}
              placeholder="Actor ID (UUID)"
              pattern={UUID_PATTERN}
              spellCheck={false}
              className="field !py-2 font-mono text-[12px] lg:col-span-2"
              aria-label="Filter by actor user ID"
            />
            <input
              type="text"
              value={filter.userId}
              onChange={(e) => apply({ userId: e.target.value })}
              placeholder="Target user ID (UUID)"
              pattern={UUID_PATTERN}
              spellCheck={false}
              className="field !py-2 font-mono text-[12px] lg:col-span-2"
              aria-label="Filter by target user ID"
            />
            <select
              value={filter.resourceType}
              onChange={(e) => apply({ resourceType: e.target.value })}
              className="field !py-2 text-[13px]"
              aria-label="Resource type filter"
            >
              <option value="">All resources</option>
              {AUDIT_RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={filter.resourceId}
              onChange={(e) => apply({ resourceId: e.target.value })}
              placeholder="Resource ID (UUID)"
              pattern={UUID_PATTERN}
              spellCheck={false}
              className="field !py-2 font-mono text-[12px] lg:col-span-2"
              aria-label="Filter by resource ID"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Events"
        className="mt-4"
        actions={
          <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={exportAudit} disabled={exporting}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        }
      >
        {state.status === "error" && <EmptyState icon="alert" title="Could not load audit log" hint={state.error.message} />}
        {state.status === "loading" && <LoadingRow />}
        {state.status === "ready" && (
          <>
            <div className="divide-y divide-line border-t border-line">
              {state.data.items.length === 0 && <EmptyState icon="lock" title="No audit events match" />}
              {state.data.items.map((e) => (
                <div key={e.id} className="px-5 py-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge value={e.result} />
                    <p className="font-mono text-[13px] font-semibold text-snow">{e.action}</p>
                    <span className="text-[13px] text-slate">· {timeAgo(e.created_at)}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-4 mt-1.5 text-[13px] text-slate">
                    <p>By <span className="text-snow">{e.actor_email ?? e.actor_id?.slice(0, 8) ?? "system"}</span></p>
                    {e.target_email && <p>On <span className="text-snow">{e.target_email}</span></p>}
                    {e.resource_id && <p className="font-mono truncate">resource: {e.resource_id.slice(0, 8)}</p>}
                    {e.ip && <p className="text-muted">ip: {e.ip}</p>}
                  </div>
                  {e.reason && <p className="text-[13px] text-warn mt-1">Reason: {e.reason}</p>}
                </div>
              ))}
            </div>
            <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} onPage={(p) => apply({ page: p })} />
          </>
        )}
      </SectionCard>

      <p className="text-[13px] text-muted mt-4 text-center">
        Audit records are append-only and cannot be edited or deleted through any interface.
      </p>
    </AdminPage>
  );
}
