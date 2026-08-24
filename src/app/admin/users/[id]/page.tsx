"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AdminPage from "@/components/admin/AdminPage";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { EmptyState, LoadingRow, Pagination, SectionCard, StatusBadge } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, useAdminAuth, type AuditEntry, type Paged, type UserDetail } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import { inr, timeAgo } from "@/lib/format";

export default function AdminUserDetailPage() {
  useEffect(() => {
    document.title = "User · Admin · FinSight";
  }, []);
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id ?? "";
  const router = useRouter();
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canChangeRole = permissions.includes("ROLE_MANAGE");
  const canSuspend = permissions.includes("USER_SUSPEND");
  const canEdit = permissions.includes("USER_EDIT");
  // Investigation surfaces: audit history reuses the shared audit-log API
  // (server-enforced AUDIT_LOG_VIEW); the transaction link deep-links into
  // the existing transactions page which already supports ?userId=.
  const canAudit = permissions.includes("AUDIT_LOG_VIEW");
  const canViewTx = permissions.includes("TRANSACTION_VIEW");
  const [auditPage, setAuditPage] = useState(1);
  const auditState = useAdminData<Paged<AuditEntry>>(
    canAudit ? `/audit-logs?userId=${encodeURIComponent(id)}&page=${auditPage}&pageSize=5` : null
  );
  const state = useAdminData<UserDetail>(`/users/${id}`);
  const [pending, setPending] = useState<
    "role" | "suspend" | "disable" | "activate" | "revoke" | "resetpw" | null
  >(null);
  const [revokeAfterStatus, setRevokeAfterStatus] = useState(false);
  const [busy, setBusy] = useState(false);

  if (state.status === "error") {
    return (
      <AdminPage title="User" icon="profile">
        <EmptyState icon="alert" title="Could not load user" hint={state.error.message} />
      </AdminPage>
    );
  }
  if (state.status !== "ready") {
    return (
      <AdminPage title="User" icon="profile">
        <div className="h-48 rounded-2xl glass animate-pulse" />
      </AdminPage>
    );
  }

  const u = state.data;

  async function runAction() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending === "revoke") {
        await adminFetch(`/users/${id}/sessions/revoke`, { method: "POST" });
        toast.success("All active sessions have been revoked.");
      } else if (pending === "resetpw") {
        await adminFetch(`/users/${id}/password-reset`, { method: "POST" });
        toast.success("Password reset link sent.");
      } else {
        // pending verb -> API status value ("suspend" -> "suspended", etc.)
        const STATUS_API = { suspend: "suspended", disable: "disabled", activate: "active" } as const;
        const body =
          pending === "role"
            ? { role: u.role === "admin" ? "user" : "admin" }
            : { account_status: STATUS_API[pending] };
        await adminFetch(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });

        const wantsRevoke =
          revokeAfterStatus && (pending === "suspend" || pending === "disable");
        if (wantsRevoke) {
          try {
            await adminFetch(`/users/${id}/sessions/revoke`, { method: "POST" });
            toast.success("User updated. Active sessions revoked.");
          } catch {
            toast.error(
              "Account updated, but revoking sessions failed. Use 'Revoke sessions' to retry."
            );
          }
        } else {
          toast.success("User updated.");
        }
      }
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
      setPending(null);
      setRevokeAfterStatus(false);
    }
  }

  return (
    <AdminPage title={u.full_name || "User"} subtitle={u.email ?? "No email"} icon="profile">
      <div className="space-y-5 animate-fade-up">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <InfoTile label="Role" value={u.role} badge />
          <InfoTile label="Status" value={u.account_status} badge />
          <InfoTile label="Verified" value={u.email_confirmed_at ? "Yes" : "No"} />
          <InfoTile label="Joined" value={u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN") : "—"} />
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          <SectionCard title="Financial snapshot" icon="wallet">
            <div className="divide-y divide-line border-t border-line">
              <MoneyRow label="Salary balance" value={u.salary_balance} />
              <MoneyRow label="Savings balance" value={u.savings_balance} />
              <MoneyRow label="Monthly budget" value={u.monthly_budget} />
            </div>
          </SectionCard>

          <SectionCard title="Activity" icon="sync">
            <div className="divide-y divide-line border-t border-line">
              <ActivityRow label="Last sign-in" value={u.last_sign_in_at ? timeAgo(u.last_sign_in_at) : "Never"} />
              <ActivityRow label="Last active" value={u.last_active_at ? timeAgo(u.last_active_at) : "Never"} />
              <ActivityRow label="Transactions" value={String(u.transaction_count)} />
              <ActivityRow label="Push devices" value={String(u.push_count)} />
            </div>
          </SectionCard>
        </div>

        {canAudit && (
          <SectionCard title="Audit history" icon="lock">
            {auditState.status === "loading" && <LoadingRow />}
            {auditState.status === "error" && (
              <div className="p-5">
                <EmptyState icon="alert" title="Could not load audit history" hint={auditState.error.message} />
              </div>
            )}
            {auditState.status === "ready" && auditState.data.items.length === 0 && (
              <div className="p-5">
                <EmptyState
                  icon="lock"
                  title="No administrative activity"
                  hint="Nothing has been done to or recorded against this account yet."
                />
              </div>
            )}
            {auditState.status === "ready" && auditState.data.items.length > 0 && (
              <>
                <div className="divide-y divide-line border-t border-line">
                  {auditState.data.items.map((e) => (
                    <div key={e.id} className="px-5 py-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge value={e.result} />
                        <p className="font-mono text-[13px] font-semibold text-snow">{e.action}</p>
                        <span className="text-[13px] text-slate">· {timeAgo(e.created_at)}</span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-x-4 mt-1 text-[13px] text-slate">
                        <p>By <span className="text-snow">{e.actor_email ?? e.actor_id?.slice(0, 8) ?? "system"}</span></p>
                        <p className="truncate font-mono">
                          {e.resource_type}
                          {e.resource_id ? `: ${e.resource_id.slice(0, 8)}…` : ""}
                        </p>
                      </div>
                      {e.reason && <p className="text-[13px] text-warn mt-1">Reason: {e.reason}</p>}
                    </div>
                  ))}
                </div>
                <Pagination
                  page={auditState.data.page}
                  pages={auditState.data.pages}
                  total={auditState.data.total}
                  onPage={setAuditPage}
                />
              </>
            )}
            <div className="px-5 py-3.5 border-t border-line">
              <Link href={`/admin/audit?userId=${encodeURIComponent(id)}`} className="text-[13px] font-semibold text-accent hover:underline">
                View all audit activity →
              </Link>
            </div>
          </SectionCard>
        )}

        <SectionCard title="Administrative actions" icon="shield">
          <div className="flex flex-wrap gap-2 p-5">
            {canChangeRole && (
              <Button variant="neo" icon="trendUp" onClick={() => setPending("role")} disabled={busy}>
                {u.role === "admin" ? "Demote to user" : "Promote to admin"}
              </Button>
            )}
            {canViewTx && (
              <Button variant="neo" icon="transactions" onClick={() => router.push(`/admin/transactions?userId=${encodeURIComponent(id)}`)} disabled={busy}>
                View transactions
              </Button>
            )}
            {canSuspend && u.account_status === "active" && (
              <>
                <Button variant="danger" icon="lock" onClick={() => setPending("suspend")} disabled={busy}>
                  Suspend account
                </Button>
                <Button variant="danger" icon="eyeOff" onClick={() => setPending("disable")} disabled={busy}>
                  Disable account
                </Button>
              </>
            )}
            {canSuspend && u.account_status !== "active" && (
              <Button variant="primary" icon="check" onClick={() => setPending("activate")} disabled={busy}>
                Reactivate account
              </Button>
            )}
            {canSuspend && (
              <Button
                variant="danger"
                icon="logOut"
                onClick={() => {
                  setRevokeAfterStatus(false);
                  setPending("revoke");
                }}
                disabled={busy}
              >
                Revoke sessions
              </Button>
            )}
            {canEdit && (
              <Button
                variant="neo"
                icon="edit"
                onClick={() => {
                  setRevokeAfterStatus(false);
                  setPending("resetpw");
                }}
                disabled={busy}
              >
                Send password reset
              </Button>
            )}
            <Button variant="ghost" icon="chevronLeft" onClick={() => router.push("/admin/users")}>
              Back to users
            </Button>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending === "role"
            ? u.role === "admin"
              ? "Demote to user"
              : "Promote to administrator"
            : pending === "activate"
              ? "Reactivate account"
              : pending === "suspend"
                ? "Suspend account"
                : pending === "disable"
                  ? "Disable account"
                  : pending === "revoke"
                    ? "Revoke active sessions"
                    : "Send password reset"
        }
        message={
          pending === "role"
            ? u.role === "admin"
              ? "This removes administrator access immediately. The change is audited."
              : "This grants full administrator access, including access to all user data. The change is audited."
            : pending === "activate"
              ? "Restore this account's access to FinSight."
              : pending === "revoke"
                ? "Every signed-in device is signed out on its next request. The change is audited."
                : pending === "resetpw"
                  ? "A password reset link will be emailed to this user. The link is never shown here. The request is audited."
                  : `This ${pending === "suspend" ? "suspends" : "disables"} the account. The user will not be able to sign in.`
        }
        confirmLabel={
          pending === "role"
            ? "Change role"
            : pending === "activate"
              ? "Reactivate"
              : pending === "suspend"
                ? "Suspend"
                : pending === "disable"
                  ? "Disable"
                  : pending === "revoke"
                    ? "Revoke sessions"
                    : "Send reset link"
        }
        onConfirm={runAction}
        onClose={() => setPending(null)}
      >
        {(pending === "suspend" || pending === "disable") && (
          <label className="mt-4 flex items-center gap-2.5 text-sm text-slate cursor-pointer select-none">
            <input
              type="checkbox"
              checked={revokeAfterStatus}
              onChange={(e) => setRevokeAfterStatus(e.target.checked)}
              className="h-4 w-4 accent-[#ef4444] cursor-pointer"
            />
            Also revoke active sessions
          </label>
        )}
      </ConfirmDialog>
    </AdminPage>
  );
}

function InfoTile({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="rounded-2xl glass p-4">
      <p className="text-[13px] uppercase tracking-wider text-slate font-medium">{label}</p>
      <div className="mt-1.5">{badge ? <StatusBadge value={value} /> : <p className="text-lg font-bold text-snow">{value}</p>}</div>
    </div>
  );
}

function MoneyRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <p className="text-sm text-slate">{label}</p>
      <p className="text-sm font-bold text-snow tabular">{inr(Number(value || 0))}</p>
    </div>
  );
}

function ActivityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <p className="text-sm text-slate">{label}</p>
      <p className="text-sm font-semibold text-snow">{value}</p>
    </div>
  );
}
