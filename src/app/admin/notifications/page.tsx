"use client";

import { useEffect, useState } from "react";
import AdminPage from "@/components/admin/AdminPage";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { EmptyState, LoadingRow, Pagination, SectionCard, StatusBadge } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import GlassCard from "@/components/ui/GlassCard";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, useAdminAuth, type AdminNotification, type Paged } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";
import { timeAgo } from "@/lib/format";

const EMPTY_FORM = { title: "", body: "", audience: "all", channel: "both" };

export default function AdminNotificationsPage() {
  useEffect(() => {
    document.title = "Notifications · Admin · FinSight";
  }, []);
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canManage = permissions.includes("NOTIFICATION_MANAGE");
  const [page, setPage] = useState(1);
  const state = useAdminData<Paged<AdminNotification>>(`/notifications?page=${page}&pageSize=15`);
  const [form, setForm] = useState(EMPTY_FORM);
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState<AdminNotification | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<AdminNotification | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminNotification | null>(null);

  function openComposer() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDrafting(true);
  }

  function editDraft(n: AdminNotification) {
    setEditing(n);
    setForm({ title: n.title, body: n.body, audience: n.audience, channel: n.channel });
    setDrafting(true);
  }

  function closeComposer() {
    setDrafting(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function saveDraft() {
    if (!form.title.trim() || !form.body.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await adminFetch(`/notifications/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
        toast.success("Draft updated.");
      } else {
        await adminFetch("/notifications", { method: "POST", body: JSON.stringify(form) });
        toast.success("Draft created.");
      }
      closeComposer();
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

  async function send(n: AdminNotification) {
    setBusy(true);
    try {
      await adminFetch(`/notifications/${n.id}/send`, { method: "POST" });
      toast.success("Notification sent.");
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!pendingCancel) return;
    setBusy(true);
    try {
      await adminFetch(`/notifications/${pendingCancel.id}/cancel`, { method: "POST" });
      toast.success("Notification cancelled.");
      state.refresh();
      setPendingCancel(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  // G-04: permanent removal of broadcasts that already reached a terminal
  // state. The server independently re-checks permission, the explicit
  // confirm marker and the status allowlist — this dialog is UX, not the
  // boundary.
  async function remove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminFetch(`/notifications/${pendingDelete.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      toast.success("Notification deleted.");
      // Drop the row from view immediately; the refetch reconciles paging.
      state.refresh();
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title="Notifications"
      subtitle="System broadcasts to FinSight users"
      icon="bell"
      actions={
        canManage && (
          <Button variant="primary" icon="plus" onClick={() => (drafting ? closeComposer() : openComposer())}>
            {drafting ? "Close composer" : "New notification"}
          </Button>
        )
      }
    >
      {drafting && canManage && (
        <GlassCard className="p-6 mb-5 animate-fade-up">
          <h3 className="text-base font-bold text-snow mb-1">
            {editing ? "Edit draft" : "Compose broadcast"}
          </h3>
          <p className="text-[13px] text-slate mb-4">
            Content is sanitized server-side. Notifications are saved as drafts and sent from the list below.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5">Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="field" maxLength={140} placeholder="e.g. Scheduled maintenance" />
            </div>
            <div>
              <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5">Audience</label>
              <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="field">
                <option value="all">Everyone</option>
                <option value="users">Regular users</option>
                <option value="admins">Admins only</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5">Message</label>
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="field min-h-24" maxLength={2000} placeholder="Details of the announcement…" />
            </div>
            <div>
              <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5">Channel</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="field">
                <option value="both">In-app + push</option>
                <option value="inapp">In-app only</option>
                <option value="push">Push only</option>
              </select>
              {form.channel !== "inapp" && (
                <p className="text-[12px] text-amber-400/90 mt-1.5 leading-snug">
                  Push delivery isn&apos;t wired up in this deployment — recipients get this in their in-app inbox only.
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={closeComposer} disabled={busy}>Discard</Button>
            <Button
              variant="primary"
              icon="check"
              disabled={!form.title.trim() || !form.body.trim() || busy}
              onClick={saveDraft}
            >
              {editing ? "Save changes" : "Save draft"}
            </Button>
          </div>
        </GlassCard>
      )}

      <SectionCard title="Broadcasts">
        {state.status === "error" && <EmptyState icon="alert" title="Could not load notifications" hint={state.error.message} />}
        {state.status === "loading" && <LoadingRow />}
        {state.status === "ready" && (
          <>
            <div className="divide-y divide-line border-t border-line">
              {state.data.items.length === 0 && <EmptyState icon="bell" title="No notifications yet" hint="Create your first broadcast above." />}
              {state.data.items.map((n) => (
                <div key={n.id} className="px-5 py-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-snow flex-1 min-w-0 truncate">{n.title}</p>
                    <StatusBadge value={n.status} />
                  </div>
                  <p className="text-sm text-slate mt-1 line-clamp-2">{n.body}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[13px] text-slate capitalize">to {n.audience === "all" ? "everyone" : n.audience}</span>
                    <span className="text-[13px] text-slate capitalize">· {n.channel}</span>
                    <span className="text-[13px] text-slate">· {timeAgo(n.created_at)}</span>
                    {n.sent_at && <span className="text-[13px] text-accent">· sent {timeAgo(n.sent_at)}</span>}
                    <div className="ml-auto flex items-center gap-1.5">
                      {canManage && n.status === "draft" && (
                        <Button variant="ghost" className="btn-sm !px-3 !py-1.5 text-[13px]" disabled={busy} onClick={() => editDraft(n)}>
                          <Icon name="edit" size={13} /> Edit
                        </Button>
                      )}
                      {canManage && ["draft", "failed", "cancelled"].includes(n.status) && (
                        <Button variant="primary" className="btn-sm !px-3 !py-1.5 text-[13px]" disabled={busy} onClick={() => send(n)}>
                          <Icon name="arrowUpRight" size={13} /> Send
                        </Button>
                      )}
                      {canManage && !["sent", "cancelled"].includes(n.status) && (
                        <Button variant="ghost" className="btn-sm !px-3 !py-1.5 text-[13px]" disabled={busy} onClick={() => setPendingCancel(n)}>
                          Cancel
                        </Button>
                      )}
                      {canManage && ["sent", "cancelled"].includes(n.status) && (
                        <Button variant="danger" className="btn-sm !px-3 !py-1.5 text-[13px]" disabled={busy} onClick={() => setPendingDelete(n)}>
                          <Icon name="trash" size={13} /> Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} onPage={setPage} />
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pendingCancel !== null}
        title="Cancel notification"
        message={<>Cancel <strong className="text-snow">{pendingCancel?.title}</strong>? It will not be delivered.</>}
        confirmLabel="Cancel notification"
        onConfirm={cancel}
        onClose={() => setPendingCancel(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete notification"
        message={
          <>
            Permanently delete <strong className="text-snow">{pendingDelete?.title}</strong>?
            This is destructive: the broadcast disappears for everyone and its
            read history cannot be recovered. Only sent or cancelled broadcasts
            can be deleted.
          </>
        }
        confirmLabel="Delete notification"
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />
    </AdminPage>
  );
}
