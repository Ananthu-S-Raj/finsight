"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import BottomSheet from "@/components/ui/BottomSheet";
import { ProgressRing } from "@/components/ui/Progress";
import { BudgetHint } from "@/components/SmartHints";
import { BalanceSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { setMonthlyBudget } from "@/lib/finance";
import { emitRefresh } from "@/lib/events";
import { inr, monthName } from "@/lib/format";
import { haptic } from "@/lib/haptics";

const QUICK_BUDGETS = [5000, 10000, 15000, 20000, 30000];

export default function BudgetsPage() {
  const userId = useRequireAuth();
  const { profile, summary, loading } = usePageData(userId);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Budgets · FinSight";
  }, []);

  const pct = summary.budget > 0 ? (summary.spent / summary.budget) * 100 : 0;

  async function saveBudget() {
    const n = Number(amount);
    if (!n || n <= 0) {
      setError("Enter a budget greater than zero.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setMonthlyBudget(userId!, n);
      haptic("success");
      toast.success("Budget updated.");
      emitRefresh();
      setOpen(false);
    } catch {
      setError("Couldn't save that budget right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Budgets"
        subtitle={`Your ${monthName(new Date())} spending plan.`}
        icon="budgets"
        actions={
          <Button variant="primary" icon="edit" onClick={() => setOpen(true)}>
            <span className="hidden sm:inline">Set budget</span>
            <span className="sm:hidden">Set</span>
          </Button>
        }
      />

      {loading && !profile ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          <GlassCard className="p-6 flex flex-col sm:flex-row items-center gap-6" tone="elevated">
            <ProgressRing
              value={pct}
              size={150}
              stroke={12}
              color={summary.isOverspent ? "danger" : pct > 80 ? "warn" : "accent"}
            >
              <div className="text-center">
                <p className="text-3xl font-bold text-snow tabular">{Math.round(pct)}%</p>
                <p className="text-[13px] uppercase tracking-wider text-slate mt-0.5">used</p>
              </div>
            </ProgressRing>
            <div className="flex-1 w-full grid grid-cols-2 gap-2.5">
              <div className="glass-soft rounded-2xl p-4">
                <p className="text-[13px] uppercase tracking-wider text-slate font-medium">Budget</p>
                <p className="text-xl font-bold text-snow tabular mt-1">{inr(summary.budget)}</p>
              </div>
              <div className="glass-soft rounded-2xl p-4">
                <p className="text-[13px] uppercase tracking-wider text-slate font-medium">Spent</p>
                <p className="text-xl font-bold text-danger tabular mt-1">{inr(summary.spent)}</p>
              </div>
              <div className="glass-soft rounded-2xl p-4 col-span-2">
                <p className="text-[13px] uppercase tracking-wider text-slate font-medium">
                  {summary.isOverspent ? "Over by" : "Remaining"}
                </p>
                <p className={`text-xl font-bold tabular mt-1 ${summary.isOverspent ? "text-danger" : "text-accent"}`}>
                  {inr(Math.abs(summary.remaining))}
                </p>
              </div>
            </div>
          </GlassCard>

          <BudgetHint spent={summary.spent} budget={summary.budget} />

          {summary.budget > 0 && summary.isOverspent && (
            <GlassCard className="p-5" hover>
              <div className="flex items-start gap-3">
                <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#ef44441a", color: "#ef4444" }}>
                  <Icon name="alert" size={19} />
                </span>
                <div>
                  <h3 className="font-semibold text-snow">Overspending is hitting your balance</h3>
                  <p className="text-sm text-slate mt-1 leading-relaxed">
                    When you go past your budget, the overspill is deducted from your spendable
                    balance. You can raise this month&apos;s budget to stop the deductions, or
                    trim spending in your top categories.
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {summary.budget === 0 && (
            <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
              <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                <Icon name="target" size={24} />
              </span>
              <p className="font-semibold text-snow">No budget set yet</p>
              <p className="text-sm text-slate max-w-xs">
                Set a monthly budget and FinSight will warn you before you overshoot.
              </p>
              <Button variant="primary" icon="plus" onClick={() => setOpen(true)} className="mt-2">
                Set monthly budget
              </Button>
            </GlassCard>
          )}
        </div>
      )}

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Set this month's budget"
        subtitle={`How much do you want to spend in ${monthName(new Date())}?`}
      >
        <div className="space-y-5">
          <div>
            <p className="text-[13px] uppercase tracking-widest text-slate mb-2 font-medium">Monthly budget</p>
            <div className="relative">
              <span className="pointer-events-none select-none absolute left-4 top-1/2 -translate-y-1/2 w-8 text-center text-2xl font-semibold text-slate" aria-hidden="true">₹</span>
              <input
                autoFocus
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                placeholder="0"
                className="field !py-4 !pl-14 text-4xl font-semibold tabular"
                aria-label="Monthly budget"
              />
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {QUICK_BUDGETS.map((b) => (
                <button key={b} onClick={() => setAmount(String(b))} className="neo-chip">
                  ₹{b.toLocaleString("en-IN")}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button variant="primary" full disabled={busy} onClick={saveBudget} className="!py-4">
            {busy ? "Saving…" : "Save budget"}
          </Button>
        </div>
      </BottomSheet>
    </AppShell>
  );
}
