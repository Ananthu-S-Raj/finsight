"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import TransactionRow from "@/components/TransactionRow";
import TransactionDetailSheet from "@/components/TransactionDetailSheet";
import PayBillSheet from "@/components/PayBillSheet";
import { BalanceSkeleton } from "@/components/ui/Skeleton";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { inr, monthName } from "@/lib/format";
import type { Transaction } from "@/lib/finance";
import { useQuickAdd } from "@/components/QuickAddContext";

export default function CardsPage() {
  const userId = useRequireAuth();
  const { profile, txns, summary, loading } = usePageData(userId, 200);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const openQuickAdd = useQuickAdd();

  useEffect(() => {
    document.title = "Credit Cards · FinSight";
  }, []);

  const { cardTxns, cardTotal, largest, outstanding, charges, payments } = useMemo(() => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const charges = txns.filter((t) => t.type === "credit_card");
    const payments = txns.filter((t) => t.type === "credit_card_payment");
    let total = 0;
    let max = 0;
    for (const t of charges) {
      if (new Date(t.created_at).getTime() >= start.getTime()) {
        total += Number(t.amount);
        max = Math.max(max, Number(t.amount));
      }
    }
    const paid = payments.reduce((s, t) => s + Number(t.amount), 0);
    const outstanding = charges.reduce((s, t) => s + Number(t.amount), 0) - paid;
    const list = [...charges, ...payments].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return { cardTxns: list, cardTotal: total, largest: max, outstanding, charges, payments };
  }, [txns]);

  const limit = summary.budget > 0 ? summary.budget : 0;
  const util = limit > 0 ? Math.min(100, (cardTotal / limit) * 100) : 0;

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Credit Cards"
        subtitle={`Card spending in ${monthName(new Date())}.`}
        icon="card"
        actions={
          <Button variant="primary" icon="creditCard" onClick={() => openQuickAdd("credit")}>
            Log a charge
          </Button>
        }
      />

      {loading && !profile ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          {/* Card visual */}
          <section
            className="relative overflow-hidden rounded-3xl p-6 aspect-[1.65/1] max-w-md"
            style={{
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.28), rgba(16,185,129,0.14)), #101826",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.12) inset, 0 30px 60px -30px rgba(0,0,0,0.9)",
            }}
          >
            <div className="hero-sheen" aria-hidden="true" />
            <div className="relative flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-frost">
                  <Icon name="creditCard" size={20} />
                  <span className="font-semibold tracking-widest text-sm">FINSIGHT CARD</span>
                </span>
                <Icon name="shield" size={18} className="text-accent" />
              </div>
              <div>
                <p className="text-[13px] uppercase tracking-widest text-slate mb-1">
                  Spent this month
                </p>
                <p className="text-3xl font-bold text-snow tabular">{inr(cardTotal)}</p>
              </div>
              <div className="flex items-center justify-between text-[13px] text-slate">
                <span>Tap a charge below for details</span>
                <span className="tabular">
                  {limit > 0 ? `${Math.round(util)}% of budget` : "no limit set"}
                </span>
              </div>
            </div>
          </section>

          {limit > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] text-slate">Card usage vs monthly budget</span>
                <span className="text-[13px] font-semibold text-snow tabular">{Math.round(util)}%</span>
              </div>
              <div className="progress-track" style={{ height: 8 }}>
                <div
                  className="progress-fill"
                  style={{
                    width: "100%",
                    transform: `scaleX(${util / 100})`,
                    background: util > 80 ? "linear-gradient(90deg,#f59e0b,#fbbf24)" : "linear-gradient(90deg,#6366f1,#818cf8)",
                  }}
                />
              </div>
            </div>
          )}

          {cardTotal === 0 && charges.length === 0 && payments.length === 0 && (
            <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
              <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                <Icon name="card" size={24} />
              </span>
              <p className="font-semibold text-snow">No card charges yet</p>
              <p className="text-sm text-slate max-w-xs">
                Log card purchases separately so you can see exactly how much is going on plastic.
              </p>
            </GlassCard>
          )}

          {outstanding > 0 && (
            <GlassCard className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] uppercase tracking-widest text-slate mb-1">
                    Outstanding bill
                  </p>
                  <p className="text-2xl font-bold text-snow tabular">{inr(outstanding)}</p>
                  <p className="text-[13px] text-slate mt-1.5">
                    Payable from{" "}
                    <span className="text-snow">account {inr(profile?.salary_balance ?? 0)}</span>
                    {" · "}
                    <span className="text-snow">savings {inr(profile?.savings_balance ?? 0)}</span>
                  </p>
                </div>
                <Button variant="primary" icon="check" onClick={() => setPayOpen(true)}>
                  Pay bill
                </Button>
              </div>
              {payments.length > 0 && (
                <p className="text-[13px] text-slate mt-3">
                  {inr(payments.reduce((s, t) => s + Number(t.amount), 0))} already paid.
                </p>
              )}
            </GlassCard>
          )}

          {cardTxns.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-frost uppercase tracking-wider mb-3 flex items-center gap-2">
                <Icon name="transactions" size={16} className="text-warn" />
                Card activity
              </h2>
              <div className="space-y-2.5">
                {cardTxns.map((t) => (
                  <TransactionRow key={t.id} tx={t} onOpen={setSelected} />
                ))}
              </div>
            </section>
          )}

          <PayBillSheet
            open={payOpen}
            onClose={() => setPayOpen(false)}
            outstanding={Math.max(0, outstanding)}
            accountBalance={profile?.salary_balance ?? 0}
            savingsBalance={profile?.savings_balance ?? 0}
          />

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
