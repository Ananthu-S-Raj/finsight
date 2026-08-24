"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminPage from "@/components/admin/AdminPage";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { EmptyState, LoadingRow, Pagination, PermissionGate, SearchInput, SectionCard, StatusBadge } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, type AdminUser, type Paged } from "@/lib/admin/client";
import { exportPagedToCsv } from "@/lib/admin/export";
import { useAdminData } from "@/lib/admin/useAdminData";
import { useAdminAuth } from "@/lib/admin/client";
import { timeAgo } from "@/lib/format";

type Filter = { search: string; role: string; status: string; page: number; sort: string; dir: "asc" | "desc"; unverified: boolean };

/** Stable module-level component so sorting clicks never remount the table. */
function SortHeader({
  column,
  label,
  active,
  dir,
  onToggle,
  children,
}: {
  column: string;
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onToggle: (column: string) => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Sort by ${label}`}
      onClick={() => onToggle(column)}
      className="inline-flex items-center gap-1 font-semibold uppercase tracking-widest hover:text-snow transition-colors"
    >
      {children}
      {active && <span aria-hidden="true">{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

export default function AdminUsersPage() {
  useEffect(() => {
    document.title = "Users · Admin · FinSight";
  }, []);
  const auth = useAdminAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>({ search: "", role: "", status: "", page: 1, sort: "", dir: "asc", unverified: false });
  const [pending, setPending] = useState<{ user: AdminUser; action: "role" | "suspend" | "disable" | "activate"; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (filter.search) p.set("search", filter.search);
    if (filter.role) p.set("role", filter.role);
    if (filter.status) p.set("status", filter.status);
    if (filter.sort) {
      p.set("sort", filter.sort);
      p.set("order", filter.dir);
    }
    if (filter.unverified) p.set("verified", "false");
    return p;
  }

  async function exportUsers() {
    if (exporting) return;
    setExporting(true);
    try {
      const count = await exportPagedToCsv<AdminUser>({
        basePath: `/users?${filterParams().toString()}`,
        filenamePrefix: "admin-users",
        columns: ["ID", "Name", "Email", "Role", "Status", "Email Verified", "Created At"],
        row: (u) => [
          u.id,
          u.full_name,
          u.email,
          u.role,
          u.account_status,
          u.email_confirmed_at ? "true" : "false",
          u.created_at,
        ],
      });
      toast.success(`Exported ${count} user${count === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const params = filterParams();
  params.set("page", String(filter.page));
  params.set("pageSize", "15");

  const state = useAdminData<Paged<AdminUser>>(`/users?${params.toString()}`);
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];

  const apply = useCallback((patch: Partial<Filter>) => {
    setFilter((f) => ({ ...f, ...patch, page: "page" in patch ? (patch.page ?? 1) : 1 }));
  }, []);

  function toggleSort(column: string) {
    setFilter((f) => ({
      ...f,
      sort: column,
      dir: f.sort === column && f.dir === "asc" ? "desc" : "asc",
      page: 1,
    }));
  }

  async function runAction() {
    if (!pending) return;
    const { user, action, value } = pending;
    setBusy(true);
    try {
      const body =
        action === "role"
          ? { role: value }
          : { account_status: value };
      const res = await adminFetch<{ id: string }>(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(res.id === user.id ? "User updated." : "User updated.");
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <AdminPage title="Users" subtitle="Manage accounts, roles and access" icon="profile">
      <SectionCard
        title="Filters"
        actions={
          <select value={filter.status} onChange={(e) => apply({ status: e.target.value })} className="field !py-2 text-[13px]" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
          </select>
        }
      >
        <div className="p-5 flex flex-col sm:flex-row gap-2 sm:items-center">
          <SearchInput value={filter.search} onChange={(v) => apply({ search: v })} placeholder="Search name or email…" className="flex-1" />
          <select value={filter.role} onChange={(e) => apply({ role: e.target.value })} className="field sm:w-40" aria-label="Filter by role">
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
          <label className="flex items-center gap-2 text-[13px] text-slate cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={filter.unverified}
              onChange={(e) => apply({ unverified: e.target.checked })}
              aria-label="Unverified only"
              className="h-4 w-4 accent-[#10b981]"
            />
            Unverified only
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="Accounts"
        className="mt-4"
        actions={
          <PermissionGate permission="USER_VIEW" permissions={permissions}>
            <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={exportUsers} disabled={exporting}>
              <Icon name="download" size={14} /> Export CSV
            </Button>
          </PermissionGate>
        }
      >
        {state.status === "error" && (
          <div className="p-5">
            <EmptyState icon="alert" title="Could not load users" hint={state.error.message} />
          </div>
        )}
        {state.status === "loading" && <LoadingRow />}
        {state.status === "ready" && (
          <>
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-widest text-slate border-b border-line">
                    <th className="px-5 py-3"><SortHeader column="full_name" label="name" active={filter.sort === "full_name"} dir={filter.dir} onToggle={toggleSort}>User</SortHeader></th>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3"><SortHeader column="account_status" label="status" active={filter.sort === "account_status"} dir={filter.dir} onToggle={toggleSort}>Status</SortHeader></th>
                    <th className="px-4 py-3 font-semibold">Verified</th>
                    <th className="px-4 py-3"><SortHeader column="created_at" label="created" active={filter.sort === "created_at"} dir={filter.dir} onToggle={toggleSort}>Created</SortHeader></th>
                    <th className="px-4 py-3 font-semibold">Active</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-6">
                        <EmptyState icon="profile" title="No users match" />
                      </td>
                    </tr>
                  )}
                  {state.data.items.map((u) => {
                    const isSelf = auth.status === "ready" && auth.whoami.id === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-tint transition-colors">
                        <td className="px-5 py-3">
                          <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 group">
                            <span
                              className="h-9 w-9 rounded-xl inline-flex items-center justify-center text-sm font-bold text-[#04140d] shrink-0"
                              style={{ background: u.role === "admin" ? "linear-gradient(135deg,#6366f1,#10b981)" : "linear-gradient(135deg,#10b981,#34d399)" }}
                            >
                              {(u.full_name?.[0] ?? u.email?.[0] ?? "U").toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-snow truncate group-hover:text-accent transition-colors">
                                {u.full_name || "Unnamed"}
                                {isSelf && <span className="text-[13px] text-accent ml-1.5">(you)</span>}
                              </span>
                              <span className="block text-[13px] text-slate truncate">{u.email ?? "no email"}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={u.role} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={u.account_status} />
                        </td>
                        <td className="px-4 py-3 text-slate">
                          {u.email_confirmed_at ? <span className="text-accent">Verified</span> : "Unverified"}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-slate whitespace-nowrap">{u.created_at.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-[13px] text-slate">{u.last_active_at ? timeAgo(u.last_active_at) : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <PermissionGate permission="ROLE_MANAGE" permissions={permissions}>
                              <Button
                                variant="neo"
                                className="btn-sm !px-2.5 !py-1.5 text-[13px]"
                                onClick={() => {
                                  const next = u.role === "admin" ? "user" : "admin";
                                  setPending({ user: u, action: "role", value: next });
                                }}
                                title={u.role === "admin" ? "Demote to user" : "Promote to admin"}
                              >
                                {u.role === "admin" ? <Icon name="trendDown" size={14} /> : <Icon name="trendUp" size={14} />}
                              </Button>
                            </PermissionGate>
                            <PermissionGate permission="USER_SUSPEND" permissions={permissions}>
                              {u.account_status === "active" ? (
                                <>
                                  <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPending({ user: u, action: "suspend", value: "suspended" })} title="Suspend account">
                                    <Icon name="lock" size={14} />
                                  </Button>
                                  <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPending({ user: u, action: "disable", value: "disabled" })} title="Disable account">
                                    <Icon name="eyeOff" size={14} />
                                  </Button>
                                </>
                              ) : (
                                <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPending({ user: u, action: "activate", value: "active" })} title="Reactivate account">
                                  <Icon name="check" size={14} />
                                </Button>
                              )}
                            </PermissionGate>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} onPage={(p) => apply({ page: p })} />
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === "role"
            ? pending.value === "admin"
              ? "Promote to administrator"
              : "Demote to user"
            : pending?.action === "activate"
              ? "Reactivate account"
              : pending?.action === "suspend"
                ? "Suspend account"
                : "Disable account"
        }
        message={
          pending &&
          (pending.action === "role" ? (
            <>
              {pending.value === "user"
                ? <>Remove <strong className="text-snow">{pending.user.full_name || pending.user.email}</strong> as administrator? They will lose console access immediately.</>
                : <>Grant <strong className="text-snow">{pending.user.full_name || pending.user.email}</strong> full administrator access?</>}
            </>
          ) : pending.action === "activate" ? (
            <>Restore <strong className="text-snow">{pending.user.full_name || pending.user.email}</strong>&apos;s access to FinSight?</>
          ) : (
            <>
              {pending.action === "suspend" ? "Suspend" : "Disable"} <strong className="text-snow">{pending.user.full_name || pending.user.email}</strong>? They will not be able to sign in.
            </>
          ))
        }
        confirmLabel={pending?.action === "activate" ? "Reactivate" : pending?.action === "role" ? "Change role" : pending?.action === "suspend" ? "Suspend" : "Disable"}
        onConfirm={runAction}
        onClose={() => setPending(null)}
      />
      {busy && <div className="fixed inset-0 z-[95] bg-scrim backdrop-blur-sm flex items-center justify-center"><p className="text-sm font-semibold text-snow animate-pulse">Applying change…</p></div>}
    </AdminPage>
  );
}
