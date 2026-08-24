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
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { inr } from "@/lib/format";
import type { Transaction } from "@/lib/finance";
import { useQuickAdd } from "@/components/QuickAddContext";

export default function LendPage() {
  const userId = useRequireAuth();
  const { profile, txns, loading } = usePageData(userId, 200);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const openQuickAdd = useQuickAdd();

  useEffect(() => {
    document.title = "Borrow & Lend · FinSight";
  }, []);

  const loans = useMemo(() => txns.filter((t) => t.type === "loan_add"), [txns]);

  const totals = useMemo(() => {
    let received = 0;
    let max = 0;
    for (const t of loans) {
      received += Number(t.amount);
      max = Math.max(max, Number(t.amount));
    }
    return { received, count: loans.length, max };
  }, [loans]);

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Borrow & Lend"
        subtitle="Track money that came in from loans."
        icon="lend"
        actions={
          <Button variant="primary" icon="coins" onClick={() => openQuickAdd("income")}>
            Add loan
          </Button>
        }
      />

      {loading && !profile ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          <div className="grid grid-cols-2 gap-2.5">
            <GlassCard className="p-5" hover>
              <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center" style={{ background: "#10b9811a", color: "#10b981" }}>
                <Icon name="coins" size={19} />
              </span>
              <p className="text-2xl font-bold text-snow tabular mt-3">{inr(totals.received)}</p>
              <p className="text-[13px] text-slate mt-0.5">Total borrowed ({totals.count} loans)</p>
            </GlassCard>
            <GlassCard className="p-5" hover>
              <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center" style={{ background: "#6366f11a", color: "#6366f1" }}>
                <Icon name="trendUp" size={19} />
              </span>
              <p className="text-2xl font-bold text-snow tabular mt-3">{inr(totals.max)}</p>
              <p className="text-[13px] text-slate mt-0.5">Largest single loan</p>
            </GlassCard>
          </div>

          <div className="glass-soft rounded-2xl px-4 py-3 flex items-center gap-3 animate-fade-up" style={{ borderColor: "#6366f133" }}>
            <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#6366f11a", color: "#6366f1" }}>
              <Icon name="info" size={17} />
            </span>
            <p className="text-sm text-snow font-medium">
              Loans received are added to your spendable balance so you can use them right away.
            </p>
          </div>

          <section>
            <h2 className="text-sm font-semibold text-frost uppercase tracking-wider mb-3 flex items-center gap-2">
              <Icon name="transactions" size={16} className="text-accent" />
              Loan history
            </h2>
            {loans.length === 0 ? (
              <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                  <Icon name="lend" size={24} />
                </span>
                <p className="font-semibold text-snow">No loans logged</p>
                <p className="text-sm text-slate max-w-xs">
                  Borrowed money from a friend or a bank? Log it so it stays visible in your history.
                </p>
                <Button variant="primary" icon="plus" onClick={() => openQuickAdd("income")} className="mt-2">
                  Add a loan
                </Button>
              </GlassCard>
            ) : (
              <div className="space-y-2.5">
                {loans.map((t) => (
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
