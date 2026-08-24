"use client";

import { useCallback, useEffect, useState } from "react";
import AdminPage from "@/components/admin/AdminPage";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { EmptyState, LoadingRow, Pagination, SectionCard } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, useAdminAuth, type Paged, type PushSubscriptionRow } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import { timeAgo } from "@/lib/format";

export default function AdminPushPage() {
  useEffect(() => {
    document.title = "Push Devices · Admin · FinSight";
  }, []);
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canManage = permissions.includes("USER_EDIT");
  const [page, setPage] = useState(1);
  const state = useAdminData<Paged<PushSubscriptionRow>>(`/push-subscriptions?page=${page}&pageSize=15`);
  const [pending, setPending] = useState<PushSubscriptionRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!pending) return;
    setBusy(true);
    try {
      await adminFetch(`/push-subscriptions/${pending.id}`, { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
      toast.success("Push subscription removed.");
      state.refresh();
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title="Push Devices" subtitle="Registered web-push subscriptions" icon="phone">
      <SectionCard title="Subscriptions">
        {state.status === "error" && <EmptyState icon="alert" title="Could not load subscriptions" hint={state.error.message} />}
        {state.status === "loading" && <LoadingRow />}
        {state.status === "ready" && (
          <>
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-widest text-slate border-b border-line">
                    <th className="px-5 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Endpoint</th>
                    <th className="px-4 py-3 font-semibold">Registered</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6">
                        <EmptyState icon="phone" title="No push subscriptions" hint="Users who enable web push appear here." />
                      </td>
                    </tr>
                  )}
                  {state.data.items.map((sub) => (
                    <tr key={sub.id} className="hover:bg-tint transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-snow truncate max-w-[180px]">{sub.user?.full_name || "Unknown user"}</p>
                        <p className="text-[13px] text-slate truncate max-w-[180px]">{sub.user?.email ?? sub.user_id.slice(0, 8)}</p>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate font-mono truncate max-w-[240px]" title={sub.endpoint ?? ""}>{sub.endpoint ?? "—"}</td>
                      <td className="px-4 py-3 text-[13px] text-slate">{timeAgo(sub.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {canManage && (
                          <Button variant="danger" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPending(sub)}>
                            <Icon name="trash" size={14} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} onPage={setPage} />
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pending !== null}
        title="Remove push subscription"
        message={<>Stop push delivery to <strong className="text-snow">{pending?.user?.email ?? "this device"}</strong>? The device will need to re-enable notifications to receive them again.</>}
        confirmText="DELETE"
        onConfirm={remove}
        onClose={() => setPending(null)}
      />
    </AdminPage>
  );
}
