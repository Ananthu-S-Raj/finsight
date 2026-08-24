"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import TransactionRow from "@/components/TransactionRow";
import TransactionDetailSheet from "@/components/TransactionDetailSheet";
import { BalanceSkeleton } from "@/components/ui/Skeleton";
import { useBalanceHidden, PrivateValue, EyeToggle } from "@/components/ui/BalanceVisibility";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { inr } from "@/lib/format";
import type { Transaction } from "@/lib/finance";
import { useSettings } from "@/lib/settings";
import { useQuickAdd } from "@/components/QuickAddContext";

export default function SavingsPage() {
  const userId = useRequireAuth();
  const { profile, txns, loading } = usePageData(userId, 100);
  const [hidden, setHidden] = useBalanceHidden();
  const [selected, setSelected] = useState<Transaction | null>(null);
  const { settings } = useSettings();
  const openQuickAdd = useQuickAdd();

  useEffect(() => {
    document.title = "Savings · FinSight";
  }, []);

  const { addedThisMonth, movedThisMonth, savingsTxns } = useMemo(() => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    let added = 0;
    let moved = 0;
    const list = txns.filter(
      (t) => t.type === "savings_add" || t.type === "savings_move"
    );
    for (const t of list) {
      if (new Date(t.created_at).getTime() >= start.getTime()) {
        if (t.type === "savings_add") added += Number(t.amount);
        else moved += Number(t.amount);
      }
    }
    return { addedThisMonth: added, movedThisMonth: moved, savingsTxns: list };
  }, [txns]);

  const maskAll = hidden || settings.maskValues;

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Savings"
        subtitle="Money that compounds for your future."
        icon="piggy"
        actions={
          <>
            <Button icon="plus" onClick={() => openQuickAdd("savings")}>
              Add
            </Button>
            <Button variant="primary" icon="transfer" onClick={() => openQuickAdd("transfer")}>
              Move in
            </Button>
          </>
        }
      />

      {loading && !profile ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          <section className="relative overflow-hidden rounded-3xl p-6 glass-elevated">
            <div className="hero-sheen" aria-hidden="true" />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-[13px] uppercase tracking-widest text-slate font-medium">
                  Total savings
                </p>
                <p className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight tabular text-snow">
                  <PrivateValue value={profile!.savings_balance} hidden={maskAll} className="tabular" />
                </p>
              </div>
              <EyeToggle hidden={hidden} onChange={setHidden} />
            </div>

            <div className="relative mt-7 grid grid-cols-2 gap-2.5">
              <div className="glass rounded-2xl p-3.5">
                <span className="flex items-center gap-1.5 text-[13px] uppercase tracking-wider text-slate font-medium">
                  <Icon name="piggy" size={13} className="text-accent" />
                  Added this month
                </span>
                <p className="mt-1.5 text-lg font-bold tabular text-snow">
                  <PrivateValue value={addedThisMonth} hidden={maskAll} className="tabular" />
                </p>
              </div>
              <div className="glass rounded-2xl p-3.5">
                <span className="flex items-center gap-1.5 text-[13px] uppercase tracking-wider text-slate font-medium">
                  <Icon name="transfer" size={13} className="text-accent2" />
                  Moved in this month
                </span>
                <p className="mt-1.5 text-lg font-bold tabular text-snow">
                  <PrivateValue value={movedThisMonth} hidden={maskAll} className="tabular" />
                </p>
              </div>
            </div>
          </section>

          {addedThisMonth + movedThisMonth > 0 && (
            <div className="glass-soft rounded-2xl px-4 py-3 flex items-center gap-3 animate-fade-up" style={{ borderColor: "#10b98133" }}>
              <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#10b9811a", color: "#10b981" }}>
                <Icon name="trendUp" size={17} />
              </span>
              <p className="text-sm text-snow font-medium">
                Nice! Savings increased by{" "}
                <span className="font-bold tabular">{inr(addedThisMonth + movedThisMonth)}</span>{" "}
                this month. Every rupee counts.
              </p>
            </div>
          )}

          {addedThisMonth + movedThisMonth === 0 && (
            <div className="glass-soft rounded-2xl px-4 py-3 flex items-center gap-3 animate-fade-up" style={{ borderColor: "#6366f133" }}>
              <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#6366f11a", color: "#6366f1" }}>
                <Icon name="sparkles" size={17} />
              </span>
              <p className="text-sm text-snow font-medium">
                Tip: move money to savings right after you get paid — before it&apos;s spent.
              </p>
            </div>
          )}

          <section>
            <h2 className="text-sm font-semibold text-frost uppercase tracking-wider mb-3 flex items-center gap-2">
              <Icon name="transactions" size={16} className="text-accent" />
              Savings history
            </h2>
            {savingsTxns.length === 0 ? (
              <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                  <Icon name="piggy" size={24} />
                </span>
                <p className="font-semibold text-snow">No savings yet</p>
                <p className="text-sm text-slate max-w-xs">
                  Start your savings habit with any amount — it adds up fast.
                </p>
                <Button variant="primary" icon="plus" onClick={() => openQuickAdd("savings")} className="mt-2">
                  Add to savings
                </Button>
              </GlassCard>
            ) : (
              <div className="space-y-2.5">
                {savingsTxns.map((t) => (
                  <TransactionRow key={t.id} tx={t} onOpen={setSelected} />
                ))}
              </div>
            )}
          </section>

          <TransactionDetailSheet
            tx={selected}
            onClose={() => setSelected(null)}
            userId={userId!}
          />
        </div>
      )}
    </AppShell>
  );
}
