"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import BottomSheet from "@/components/ui/BottomSheet";
import Toggle from "@/components/ui/Toggle";
import Icon, { type IconName } from "@/components/ui/Icons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import BillFormSheet from "@/components/BillFormSheet";
import {
  cancelBill,
  deleteBill,
  listBills,
  listPayments,
  markBillPaid,
} from "@/lib/billsApi";
import {
  BILL_FREQUENCY_LABEL,
  BILL_STATUS_LABEL,
  computeBillStatus,
  daysUntil,
  type Bill,
  type BillPayment,
  type BillStatus,
} from "@/lib/bills";
import { inr } from "@/lib/format";
import { listenRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";
import { prettyDate } from "@/lib/recurring";

const STATUS_META: Record<
  BillStatus,
  { icon: IconName; tone: string; bar: string }
> = {
  overdue: { icon: "alert", tone: "text-danger", bar: "#ef4444" },
  due: { icon: "alert", tone: "text-amber", bar: "#f59e0b" },
  upcoming: { icon: "calendar", tone: "text-slate", bar: "#64748b" },
  paid: { icon: "check", tone: "text-emerald", bar: "#10b981" },
  cancelled: { icon: "close", tone: "text-slate", bar: "#334155" },
};

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function relativeLabel(dueDate: string, today: string): string {
  const diff = daysUntil(dueDate, today);
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} ago`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `In ${diff} days`;
}

export default function BillsPage() {
  const userId = useRequireAuth();
  const toast = useToast();

  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payingBusy, setPayingBusy] = useState(false);

  useEffect(() => {
    document.title = "Bills · FinSight";
  }, []);

  const load = useCallback(async () => {
    try {
      const [billsRes, paymentsRes] = await Promise.all([listBills(), listPayments()]);
      setBills(billsRes);
      setPayments(paymentsRes);
    } catch {
      toast.error("Couldn't load your bills.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  useEffect(() => listenRefresh(load), [load]);

  const grouped = useMemo(() => {
    const today = todayStr();
    const groups: Record<BillStatus, Bill[]> = {
      overdue: [],
      due: [],
      upcoming: [],
      paid: [],
      cancelled: [],
    };
    for (const bill of bills) {
      const status = computeBillStatus(bill, today);
      groups[status].push(bill);
    }
    for (const key of Object.keys(groups) as BillStatus[]) {
      groups[key].sort((a, b) =>
        a.due_date === b.due_date
          ? a.name.localeCompare(b.name)
          : a.due_date < b.due_date
            ? -1
            : 1
      );
    }
    return groups;
  }, [bills]);

  const totalDue = useMemo(() => {
    let total = 0;
    for (const bill of bills) {
      if (bill.status === "cancelled") continue;
      if (bill.status === "paid") continue;
      total += Number(bill.amount);
    }
    return total;
  }, [bills]);

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(bill: Bill) {
    setEditing(bill);
    setSheetOpen(true);
  }

  async function doCancel(bill: Bill) {
    if (!window.confirm(`Cancel “${bill.name}”? You can still mark it paid later.`)) return;
    setBusyId(bill.id);
    try {
      await cancelBill(bill.id);
      toast.success("Bill cancelled.");
      haptic("success");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel the bill.");
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(bill: Bill) {
    if (!window.confirm(`Delete “${bill.name}”? This can't be undone.`)) return;
    setBusyId(bill.id);
    try {
      await deleteBill(bill.id);
      toast.success("Bill deleted.");
      haptic("success");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the bill.");
    } finally {
      setBusyId(null);
    }
  }

  async function doMarkPaid(createExpense: boolean) {
    if (!paying) return;
    setPayingBusy(true);
    try {
      const result = await markBillPaid(paying.id, createExpense);
      const msg = result.overspend_amount > 0
        ? `Paid — ₹${inr(result.overspend_amount)} over budget, covered from salary.`
        : result.transaction_id
          ? "Paid and logged to your transactions."
          : "Bill marked as paid.";
      toast.success(msg);
      haptic("success");
      setPaying(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't mark the bill as paid.");
    } finally {
      setPayingBusy(false);
    }
  }

  const sections: Array<{ key: BillStatus; title: string; empty: string }> = [
    { key: "overdue", title: "Overdue", empty: "Nothing overdue — nice." },
    { key: "due", title: "Due today", empty: "Nothing due today." },
    { key: "upcoming", title: "Upcoming", empty: "No upcoming bills." },
    { key: "paid", title: "Paid", empty: "No paid bills yet." },
  ];

  return (
    <AppShell userId={userId ?? ""} profile={null}>
      <PageHeader
        title="Bills"
        subtitle="Track due dates and never miss a payment."
        icon="creditCard"
        actions={
          <Button variant="primary" icon="plus" onClick={openNew}>
            Add bill
          </Button>
        }
      />

      <div className="space-y-6">
        {!loading && (
          <div className="glass rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] uppercase tracking-widest text-slate font-medium">Outstanding</p>
              <p className="mt-1 text-2xl font-bold tabular text-snow">
                {inr(totalDue)}
              </p>
            </div>
            <p className="text-[13px] text-slate max-w-[180px] text-right leading-snug">
              Unpaid bills including recurring ones this month
            </p>
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={5} />
        ) : bills.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <span className="mx-auto mb-4 inline-flex h-14 w-14 rounded-2xl glass items-center justify-center text-accent">
              <Icon name="creditCard" size={24} />
            </span>
            <h3 className="text-lg font-semibold text-snow">No bills yet</h3>
            <p className="text-sm text-slate mt-1.5 max-w-sm mx-auto leading-relaxed">
              Add rent, subscriptions or EMI and FinSight will remind you before each due date.
            </p>
            <Button variant="primary" icon="plus" className="mt-5" onClick={openNew}>
              Add your first bill
            </Button>
          </div>
        ) : (
          <>
            {sections.map((section) => {
              const items = grouped[section.key];
              if (items.length === 0) return null;
              return (
                <section key={section.key} aria-label={section.title}>
                  <h2 className="mb-3 text-[13px] uppercase tracking-widest text-slate font-medium">
                    {section.title} · {items.length}
                  </h2>
                  <div className="space-y-3">
                    {items.map((bill) => {
                      const meta = STATUS_META[computeBillStatus(bill, todayStr())];
                      return (
                        <div key={bill.id} className="glass-soft rounded-2xl p-4 flex items-center gap-4">
                          <span className="h-11 w-11 rounded-xl bg-tint-hi inline-flex items-center justify-center shrink-0">
                            <Icon name={meta.icon} size={19} className={meta.tone} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-snow truncate">
                              {bill.name}
                            </p>
                            <p className="text-[13px] text-slate truncate">
                              {prettyDate(bill.due_date)} · {relativeLabel(bill.due_date, todayStr())} ·{" "}
                              {BILL_FREQUENCY_LABEL[bill.frequency]}
                              {bill.notes ? " · " + bill.notes : ""}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-base font-bold tabular ${meta.tone}`}>{inr(bill.amount)}</p>
                            <div className="flex items-center justify-end gap-1 mt-1">
                              {(bill.status === "upcoming" || bill.status === "due" || bill.status === "overdue") && (
                                <button
                                  type="button"
                                  onClick={() => setPaying(bill)}
                                  className="neo h-8 rounded-lg px-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-snow hover:text-snow"
                                  aria-label={`Mark ${bill.name} as paid`}
                                >
                                  <Icon name="check" size={14} className="text-accent" />
                                  Paid
                                </button>
                              )}
                              {bill.status !== "paid" && bill.status !== "cancelled" && (
                                <button
                                  type="button"
                                  onClick={() => openEdit(bill)}
                                  className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-snow"
                                  aria-label="Edit bill"
                                  disabled={busyId === bill.id}
                                >
                                  <Icon name="edit" size={14} />
                                </button>
                              )}
                              {bill.status === "cancelled" && (
                                <button
                                  type="button"
                                  onClick={() => doDelete(bill)}
                                  className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-danger"
                                  aria-label="Delete bill"
                                  disabled={busyId === bill.id}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                              {(bill.status === "upcoming" || bill.status === "due" || bill.status === "overdue") && (
                                <button
                                  type="button"
                                  onClick={() => doCancel(bill)}
                                  className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-danger"
                                  aria-label="Cancel bill"
                                  disabled={busyId === bill.id}
                                >
                                  <Icon name="close" size={14} />
                                </button>
                              )}
                              {bill.status === "paid" && (
                                <span className="text-[12px] font-semibold uppercase tracking-wide text-emerald">
                                  {BILL_STATUS_LABEL.paid}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {payments.length > 0 && (
              <section aria-label="Payment history">
                <h2 className="mb-3 text-[13px] uppercase tracking-widest text-slate font-medium">
                  Payment history · {payments.length}
                </h2>
                <div className="glass-soft rounded-2xl overflow-hidden">
                  <ul className="divide-y divide-line">
                    {payments.slice(0, 10).map((p) => (
                      <li key={p.id} className="px-4 py-3 flex items-center gap-3">
                        <span className="h-9 w-9 rounded-lg bg-tint-hi inline-flex items-center justify-center text-emerald shrink-0">
                          <Icon name="check" size={15} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-snow truncate">{p.bill_name ?? "Bill"}</p>
                          <p className="text-[13px] text-slate">
                            {p.bill_category ?? "Payment"} · {prettyDate(p.due_date)}
                          </p>
                        </div>
                        <p className="text-sm font-bold tabular text-snow shrink-0">{inr(p.amount)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <BillFormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
        userId={userId ?? ""}
      />

      {/* Mark-paid sheet */}
      <BottomSheet
        open={paying !== null}
        onClose={() => setPaying(null)}
        title="Mark as paid"
        subtitle={paying ? `${paying.name} · due ${prettyDate(paying.due_date)}` : undefined}
      >
        {paying && <MarkPaidContent bill={paying} busy={payingBusy} onConfirm={doMarkPaid} />}
      </BottomSheet>
    </AppShell>
  );
}

function MarkPaidContent({
  bill,
  busy,
  onConfirm,
}: {
  bill: Bill;
  busy: boolean;
  onConfirm: (createExpense: boolean) => void;
}) {
  const [createExpense, setCreateExpense] = useState(true);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl neo-inset p-4 flex items-center justify-between">
        <p className="text-sm text-slate">Amount</p>
        <p className="text-2xl font-bold tabular text-snow">{inr(bill.amount)}</p>
      </div>

      <label className="flex items-center justify-between gap-4 py-1">
        <div>
          <p className="text-sm font-medium text-snow">
            {bill.is_credit_card ? "Book as a card charge" : "Log as an expense"}
          </p>
          <p className="text-[13px] text-slate">
            {bill.is_credit_card
              ? "Creates a credit-card transaction under your card balance"
              : "Creates an expense entry in this month's spending"}
          </p>
        </div>
        <Toggle on={createExpense} onChange={setCreateExpense} label="Book transaction" />
      </label>

      {bill.frequency !== "one_time" && (
        <p className="text-[13px] text-slate leading-relaxed">
          This bill repeats {BILL_FREQUENCY_LABEL[bill.frequency].toLowerCase()}. Paying it will
          advance the due date to the next occurrence and record the payment in history.
        </p>
      )}

      <div className="flex gap-3">
        <Button full variant="default" onClick={() => onConfirm(createExpense)} disabled={busy}>
          {busy ? "Saving…" : "Confirm payment"}
        </Button>
      </div>
    </div>
  );
}
