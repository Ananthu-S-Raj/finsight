"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import Button from "@/components/ui/Button";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Icon, { type IconName } from "@/components/ui/Icons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import RecurringFormSheet from "@/components/RecurringFormSheet";
import {
  listRecurring,
  listPendingOccurrences,
  confirmOccurrence,
  skipOccurrence,
  setRecurringStatus,
  deleteRecurring,
} from "@/lib/recurringApi";
import {
  FREQUENCY_LABEL,
  RECURRING_TYPE_LABEL,
  RECURRING_STATUS_LABEL,
  prettyDate,
  ruleTitle,
  type RecurringOccurrence,
  type RecurringTransaction,
  type RecurringType,
} from "@/lib/recurring";
import { inr } from "@/lib/format";
import { listenRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";

const TYPE_ICON: Record<RecurringType, IconName> = {
  expense: "expense",
  income: "income",
  transfer: "transfer",
};

const TYPE_TINT: Record<RecurringType, string> = {
  expense: "text-danger",
  income: "text-emerald",
  transfer: "text-accent",
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
];

export default function RecurringPage() {
  const userId = useRequireAuth();
  const toast = useToast();

  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [pending, setPending] = useState<RecurringOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Recurring · FinSight";
  }, []);

  const load = useCallback(async () => {
    try {
      const [rulesRes, pendingRes] = await Promise.all([
        listRecurring(),
        listPendingOccurrences(),
      ]);
      setRules(rulesRes);
      setPending(pendingRes);
    } catch {
      toast.error("Couldn't load your schedules.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  useEffect(() => listenRefresh(load), [load]);

  const filtered = useMemo(
    () => (filter === "all" ? rules : rules.filter((r) => r.type === filter)),
    [rules, filter]
  );

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(rule: RecurringTransaction) {
    setEditing(rule);
    setSheetOpen(true);
  }

  async function run(action: string, fn: () => Promise<unknown>, success: string, id: string) {
    setBusyId(id);
    try {
      await fn();
      toast.success(success);
      haptic("success");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(rule: RecurringTransaction) {
    if (rule.status === "paused") {
      await run("resume", () => setRecurringStatus(rule.id, "active"), "Schedule resumed.", rule.id);
    } else {
      await run("pause", () => setRecurringStatus(rule.id, "paused"), "Schedule paused.", rule.id);
    }
  }

  async function cancel(rule: RecurringTransaction) {
    await run("cancel", () => setRecurringStatus(rule.id, "cancelled"), "Schedule cancelled.", rule.id);
  }

  async function remove(rule: RecurringTransaction) {
    if (!window.confirm("Delete this schedule? Past transactions stay in your history.")) return;
    await run("delete", () => deleteRecurring(rule.id), "Schedule deleted.", rule.id);
  }

  async function confirmPending(occ: RecurringOccurrence) {
    await run("confirm", () => confirmOccurrence(occ.id), "Transaction created.", occ.id);
  }

  async function skipPending(occ: RecurringOccurrence) {
    await run("skip", () => skipOccurrence(occ.id), "Skipped this occurrence.", occ.id);
  }

  const statusChip = (rule: RecurringTransaction) => {
    if (rule.status === "active") return null;
    const tones: Record<string, string> = {
      paused: "text-amber",
      completed: "text-slate",
      cancelled: "text-danger",
    };
    return (
      <span className={`text-[12px] font-semibold uppercase tracking-wide ${tones[rule.status] ?? "text-slate"}`}>
        {RECURRING_STATUS_LABEL[rule.status]}
      </span>
    );
  };

  return (
    <AppShell userId={userId ?? ""} profile={null}>
      <PageHeader
        title="Recurring"
        subtitle="Expenses, income and transfers that happen on their own."
        icon="recurring"
        actions={
          <Button variant="primary" icon="plus" onClick={openNew}>
            New schedule
          </Button>
        }
      />

      <div className="space-y-6">
        {pending.length > 0 && (
          <section aria-label="Awaiting confirmation">
            <h2 className="mb-3 text-[13px] uppercase tracking-widest text-slate font-medium">
              Awaiting confirmation · {pending.length}
            </h2>
            <div className="space-y-3">
              {pending.map((occ) => (
                <div key={occ.id} className="glass-soft rounded-2xl p-4 flex items-center gap-4">
                  <span className="h-11 w-11 rounded-xl bg-tint-hi inline-flex items-center justify-center text-amber shrink-0">
                    <Icon name="alert" size={19} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-snow truncate">
                      {ruleTitle(occ.rule)}
                    </p>
                    <p className="text-[13px] text-slate">
                      {prettyDate(occ.occurrence_date)} · {inr(occ.rule.amount)} ·{" "}
                      {RECURRING_TYPE_LABEL[occ.rule.type]}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="default" className="btn-sm" onClick={() => skipPending(occ)} disabled={busyId === occ.id}>
                      Skip
                    </Button>
                    <Button variant="primary" className="btn-sm" onClick={() => confirmPending(occ)} disabled={busyId === occ.id}>
                      Confirm
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <SegmentedControl
          label="Filter by type"
          value={filter}
          options={FILTERS}
          onChange={setFilter}
        />

        {loading ? (
          <ListSkeleton rows={4} />
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <span className="mx-auto mb-4 inline-flex h-14 w-14 rounded-2xl glass items-center justify-center text-accent">
              <Icon name="recurring" size={24} />
            </span>
            <h3 className="text-lg font-semibold text-snow">
              {rules.length === 0 ? "No recurring transactions yet" : "Nothing here"}
            </h3>
            <p className="text-sm text-slate mt-1.5 max-w-sm mx-auto leading-relaxed">
              {rules.length === 0
                ? "Set up rent, subscriptions, salary or savings transfers once — FinSight handles them automatically."
                : "Try a different filter."}
            </p>
            {rules.length === 0 && (
              <Button variant="primary" icon="plus" className="mt-5" onClick={openNew}>
                Create your first schedule
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((rule) => {
              const subtitle = `${FREQUENCY_LABEL[rule.frequency]} · Next ${prettyDate(rule.next_occurrence)}`;
              const terminal = rule.status === "completed" || rule.status === "cancelled";
              return (
                <div key={rule.id} className="glass-soft rounded-2xl p-4 flex items-center gap-4">
                  <span className={`h-11 w-11 rounded-xl bg-tint-hi inline-flex items-center justify-center shrink-0 ${TYPE_TINT[rule.type]}`}>
                    <Icon name={TYPE_ICON[rule.type]} size={19} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-snow truncate">{ruleTitle(rule)}</p>
                      {statusChip(rule)}
                    </div>
                    <p className="text-[13px] text-slate truncate">
                      {subtitle}
                      {rule.requires_confirmation && " · asks first"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-base font-bold tabular ${TYPE_TINT[rule.type]}`}>
                      {rule.type === "income" ? "+" : "−"}{inr(rule.amount)}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <button
                        type="button"
                        onClick={() => openEdit(rule)}
                        className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-snow"
                        aria-label="Edit schedule"
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      {!terminal && (
                        <button
                          type="button"
                          onClick={() => toggleStatus(rule)}
                          className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-snow"
                          aria-label={rule.status === "paused" ? "Resume schedule" : "Pause schedule"}
                          disabled={busyId === rule.id}
                        >
                          <Icon name={rule.status === "paused" ? "play" : "pause"} size={14} />
                        </button>
                      )}
                      {!terminal && (
                        <button
                          type="button"
                          onClick={() => cancel(rule)}
                          className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-danger"
                          aria-label="Cancel schedule"
                          disabled={busyId === rule.id}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(rule)}
                        className="neo h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate hover:text-danger"
                        aria-label="Delete schedule"
                        disabled={busyId === rule.id}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecurringFormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
        userId={userId ?? ""}
      />
    </AppShell>
  );
}
