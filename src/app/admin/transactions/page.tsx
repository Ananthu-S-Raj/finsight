"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminPage from "@/components/admin/AdminPage";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { EmptyState, LoadingRow, Pagination, PermissionGate, SearchInput, SectionCard, StatusBadge } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import GlassCard from "@/components/ui/GlassCard";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, type AdminTransaction, type Paged } from "@/lib/admin/client";
import { useAdminAuth } from "@/lib/admin/client";
import { exportPagedToCsv } from "@/lib/admin/export";
import { useAdminData } from "@/lib/admin/useAdminData";
import { inr } from "@/lib/format";

type Filter = { search: string; type: string; flagged: string; userId: string; page: number };

const TX_COLORS: Record<string, string> = {
  salary_add: "#10b981",
  savings_add: "#34d399",
  savings_move: "#6366f1",
  expense: "#ef4444",
  credit_card: "#f59e0b",
  loan_add: "#a855f7",
};

export default function AdminTransactionsPage() {
  // useSearchParams needs a Suspense boundary during prerendering.
  return (
    <Suspense fallback={null}>
      <AdminTransactionsPageInner />
    </Suspense>
  );
}

function AdminTransactionsPageInner() {
  useEffect(() => {
    document.title = "Transactions · Admin · FinSight";
  }, []);
  const auth = useAdminAuth();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => ({
    search: "",
    type: "",
    flagged: "",
    userId: searchParams.get("userId") ?? "",
    page: 1,
  }));
  const [pendingDelete, setPendingDelete] = useState<AdminTransaction | null>(null);
  const [pendingFlag, setPendingFlag] = useState<AdminTransaction | null>(null);
  const [pendingUnflag, setPendingUnflag] = useState<AdminTransaction | null>(null);
  const [pendingCorrect, setPendingCorrect] = useState<AdminTransaction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];

  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.type) params.set("type", filter.type);
  if (filter.flagged) params.set("flagged", filter.flagged);
  if (filter.userId.trim()) params.set("userId", filter.userId.trim());
  params.set("page", String(filter.page));
  params.set("pageSize", "15");

  const state = useAdminData<Paged<AdminTransaction>>(`/transactions?${params.toString()}`);
  const apply = useCallback((patch: Partial<Filter>) => setFilter((f) => ({ ...f, ...patch, page: 1 })), []);

  const [exporting, setExporting] = useState(false);

  async function exportTx() {
    if (exporting) return;
    setExporting(true);
    try {
      const p = new URLSearchParams();
      if (filter.search) p.set("search", filter.search);
      if (filter.type) p.set("type", filter.type);
      if (filter.flagged) p.set("flagged", filter.flagged);
      if (filter.userId.trim()) p.set("userId", filter.userId.trim());
      const count = await exportPagedToCsv<AdminTransaction>({
        basePath: `/transactions?${p.toString()}`,
        filenamePrefix: "admin-transactions",
        columns: ["Date", "User", "Email", "Type", "Category", "Subcategory", "Amount", "Note", "Flagged", "Flag Reason"],
        row: (tx) => [
          tx.created_at,
          tx.user?.full_name ?? "",
          tx.user?.email ?? "",
          tx.type,
          tx.category ?? "",
          tx.subcategory ?? "",
          tx.amount,
          tx.note ?? "",
          tx.flagged ? "true" : "false",
          tx.flag_reason ?? "",
        ],
      });
      toast.success(`Exported ${count} transaction${count === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteTx() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminFetch(`/transactions/${pendingDelete.id}`, { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
      toast.success("Transaction deleted.");
      state.refresh();
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function flagTx() {
    if (!pendingFlag || !reason.trim()) return;
    setBusy(true);
    try {
      await adminFetch(`/transactions/${pendingFlag.id}/flag`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      toast.success("Transaction flagged for review.");
      state.refresh();
      setPendingFlag(null);
      setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Flagging failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unflagTx() {
    if (!pendingUnflag) return;
    setBusy(true);
    try {
      await adminFetch(`/transactions/${pendingUnflag.id}/unflag`, { method: "POST" });
      toast.success("Flag removed.");
      state.refresh();
      setPendingUnflag(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unflagging failed.");
    } finally {
      setBusy(false);
    }
  }

  async function correctTx(patch: { amount?: number; note?: string }) {
    if (!pendingCorrect) return;
    setBusy(true);
    try {
      await adminFetch(`/transactions/${pendingCorrect.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      toast.success("Transaction corrected.");
      state.refresh();
      setPendingCorrect(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Correction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title="Transactions" subtitle="Review, correct, flag or remove entries" icon="transactions">
      <SectionCard
        title="Filters"
        actions={
          <select value={filter.flagged} onChange={(e) => apply({ flagged: e.target.value })} className="field !py-2 text-[13px]" aria-label="Flag filter">
            <option value="">All</option>
            <option value="true">Flagged</option>
          </select>
        }
      >
        <div className="p-5 flex flex-col sm:flex-row gap-2">
          <SearchInput value={filter.search} onChange={(v) => apply({ search: v })} placeholder="Search note, category…" className="flex-1" />
          <select value={filter.type} onChange={(e) => apply({ type: e.target.value })} className="field sm:w-44" aria-label="Type filter">
            <option value="">All types</option>
            <option value="salary_add">Salary add</option>
            <option value="savings_add">Savings add</option>
            <option value="savings_move">Savings move</option>
            <option value="expense">Expense</option>
            <option value="credit_card">Credit card</option>
            <option value="loan_add">Loan received</option>
          </select>
        </div>
        {filter.userId.trim() && (
          <div className="px-5 pb-4 -mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold text-snow" style={{ background: "#6366f122", boxShadow: "inset 0 0 0 1px #6366f155" }}>
              user: {filter.userId.trim().slice(0, 8)}…
              <button
                type="button"
                onClick={() => apply({ userId: "" })}
                aria-label="Clear user filter"
                className="text-slate hover:text-snow transition-colors"
              >
                ✕
              </button>
            </span>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Entries"
        className="mt-4"
        actions={
          <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={exportTx} disabled={exporting}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        }
      >
        {state.status === "error" && (
          <div className="p-5">
            <EmptyState icon="alert" title="Could not load transactions" hint={state.error.message} />
          </div>
        )}
        {state.status === "loading" && <LoadingRow />}
        {state.status === "ready" && (
          <>
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-widest text-slate border-b border-line">
                    <th className="px-5 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold">Flag</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.data.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-6">
                        <EmptyState icon="transactions" title="No transactions match" />
                      </td>
                    </tr>
                  )}
                  {state.data.items.map((tx) => {
                    const color = TX_COLORS[tx.type] ?? "#94a3b8";
                    return (
                      <tr key={tx.id} className="hover:bg-tint transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-semibold text-snow truncate max-w-[180px]">{tx.user?.full_name || "Unknown user"}</p>
                          <p className="text-[13px] text-slate truncate max-w-[180px]">{tx.user?.email ?? tx.user_id.slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[13px] font-semibold capitalize" style={{ color }}>{tx.type.replace("_", " ")}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-snow">{tx.category ?? "—"}</p>
                          {tx.subcategory && <p className="text-[13px] text-slate">{tx.subcategory}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-snow tabular">{inr(tx.amount, { cents: true })}</td>
                        <td className="px-4 py-3">
                          {tx.flagged ? (
                            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warn">
                              <Icon name="alert" size={13} /> {tx.flag_reason ?? "Flagged"}
                            </span>
                          ) : (
                            <span className="text-[13px] text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <PermissionGate permission="TRANSACTION_EDIT" permissions={permissions}>
                              <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPendingCorrect(tx)} title="Correct transaction">
                                <Icon name="edit" size={14} />
                              </Button>
                              {tx.flagged ? (
                                <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPendingUnflag(tx)} title="Remove flag">
                                  <Icon name="check" size={14} />
                                </Button>
                              ) : (
                                <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => { setReason(""); setPendingFlag(tx); }} title="Flag for review">
                                  <Icon name="filter" size={14} />
                                </Button>
                              )}
                            </PermissionGate>
                            <PermissionGate permission="TRANSACTION_DELETE" permissions={permissions}>
                              <Button variant="danger" className="btn-sm !px-2.5 !py-1.5 text-[13px]" onClick={() => setPendingDelete(tx)} title="Delete transaction">
                                <Icon name="trash" size={14} />
                              </Button>
                            </PermissionGate>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} onPage={(p) => setFilter((f) => ({ ...f, page: p }))} />
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete transaction"
        message={
          <>
            This permanently deletes a <strong className="text-snow">{inr(pendingDelete?.amount ?? 0, { cents: true })}</strong> {pendingDelete?.type?.replace("_", " ")} entry from the user&apos;s history. This cannot be undone and is recorded in the audit log.
          </>
        }
        confirmText="DELETE"
        onConfirm={deleteTx}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingFlag !== null}
        title="Flag transaction"
        message="Flagging marks this entry for review. The reason is visible to other administrators."
        confirmLabel="Flag"
        onConfirm={flagTx}
        onClose={() => setPendingFlag(null)}
      >
        <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5 mt-5">
          Reason
        </label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="field" placeholder="e.g. duplicate entry, suspicious amount" maxLength={300} />
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingUnflag !== null}
        title="Remove flag"
        message={
          <>
            Clear the review flag from this entry? The previous reason (<strong className="text-warn">{pendingUnflag?.flag_reason ?? "none"}</strong>) is preserved in the audit log.
          </>
        }
        confirmLabel="Remove flag"
        onConfirm={unflagTx}
        onClose={() => setPendingUnflag(null)}
      />

      {pendingCorrect && (
        <CorrectionDialog tx={pendingCorrect} busy={busy} onCancel={() => setPendingCorrect(null)} onSave={correctTx} />
      )}

      {busy && <div className="fixed inset-0 z-[95] bg-scrim backdrop-blur-sm flex items-center justify-center"><p className="text-sm font-semibold text-snow animate-pulse">Working…</p></div>}
    </AdminPage>
  );
}

function CorrectionDialog({
  tx,
  busy,
  onCancel,
  onSave,
}: {
  tx: AdminTransaction;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { amount?: number; note?: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(tx.amount));
  const [note, setNote] = useState(tx.note ?? "");
  const numeric = Number(amount);
  const valid = Number.isFinite(numeric) && numeric >= 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <GlassCard className="relative w-full max-w-md p-6 animate-fade-up">
        <h3 className="text-base font-bold text-snow">Correct transaction</h3>
        <p className="text-sm text-slate mt-1">Type: <span className="text-snow">{tx.type.replace("_", " ")}</span> · {tx.category ?? "uncategorised"}</p>
        <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5 mt-5">Amount (₹)</label>
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="field" aria-label="Amount" />
        <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5 mt-4">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="field" placeholder="Optional note" maxLength={500} />
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => onSave({ amount: numeric, note })}>
            Save correction
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
