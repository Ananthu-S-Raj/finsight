"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import AppShell from "@/components/AppShell";
import GlassCard from "@/components/ui/GlassCard";
import Icon, { type IconName } from "@/components/ui/Icons";
import TransactionRow from "@/components/TransactionRow";
import TransactionDetailSheet from "@/components/TransactionDetailSheet";
import { ProgressRing } from "@/components/ui/Progress";
import { BalanceSkeleton, ListSkeleton } from "@/components/ui/Skeleton";
import { useBalanceHidden, EyeToggle, PrivateValue } from "@/components/ui/BalanceVisibility";
import { BudgetHint } from "@/components/SmartHints";
import NotificationPermissionCard from "@/components/NotificationPermissionCard";
import GoalsSection from "@/components/GoalsSection";
import CreditCardsSection from "@/components/CreditCardsSection";
import PageHeader from "@/components/PageHeader";
import BirthdayGreeting from "@/components/BirthdayGreeting";
import { usePageData } from "@/lib/usePageData";
import { firstName, greeting, inr, monthName } from "@/lib/format";
import type { Transaction } from "@/lib/finance";
import { useSettings } from "@/lib/settings";
import { useQuickAdd } from "@/components/QuickAddContext";
import type { AddMode } from "@/components/QuickAddSheet";

function HeroCard({
  salary,
  hidden,
  toggleHidden,
  income,
  expenses,
  savings,
}: {
  salary: number;
  hidden: boolean;
  toggleHidden: (v: boolean) => void;
  income: number;
  expenses: number;
  savings: number;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl p-6 sm:p-8 glass-elevated"
      aria-label="Available balance"
    >
      <div className="hero-sheen" aria-hidden="true" />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate font-medium">
            Available Balance
          </p>
          <div className="mt-2 flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5">
            <p className="text-[30px] sm:text-[38px] lg:text-[42px] font-bold leading-tight tracking-tight tabular text-snow">
              <PrivateValue value={salary} hidden={hidden} className="tabular" />
            </p>
            {!hidden && (
              <span className="text-lg font-semibold text-accent">INR</span>
            )}
          </div>
        </div>
        <EyeToggle hidden={hidden} onChange={toggleHidden} />
      </div>

      <div className="relative mt-7 grid grid-cols-3 gap-2.5">
        {[
          { label: "Income", value: income, icon: "income" as IconName, color: "#10b981" },
          { label: "Expenses", value: expenses, icon: "expense" as IconName, color: "#ef4444" },
          { label: "Savings", value: savings, icon: "piggy" as IconName, color: "#eab308" },
        ].map((s) => (
          <div key={s.label} className="glass rounded-2xl p-3.5">
            <span className="flex items-center gap-1.5 text-[13px] uppercase tracking-wider text-slate font-medium">
              <Icon name={s.icon} size={13} style={{ color: s.color }} />
              {s.label}
            </span>
            <p className="mt-1.5 text-[17px] sm:text-lg font-bold tabular text-snow">
              <PrivateValue value={s.value} hidden={hidden} className="tabular" />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const { profile, txns, summary, loading, refresh } = usePageData(userId);
  const [hidden, setHidden] = useBalanceHidden();
  const [selected, setSelected] = useState<Transaction | null>(null);
  const { settings } = useSettings();
  const openQuickAdd = useQuickAdd();

  useEffect(() => {
    document.title = "Dashboard · FinSight";
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setUserId(data.session.user.id);
    });
  }, [router]);

  // PWA shortcut / install card may launch the app with ?add=expense — open the
  // quick-add sheet right away.
  useEffect(() => {
    if (!userId) return;
    const add = new URLSearchParams(window.location.search).get("add");
    if (add === "expense") {
      openQuickAdd("expense");
      router.replace("/dashboard", { scroll: false });
    } else if (add === "income") {
      openQuickAdd("income");
      router.replace("/dashboard", { scroll: false });
    }
  }, [userId, openQuickAdd, router]);

  const { incomeThisMonth, expenseThisMonth, savingsAddedThisMonth, savingsRate } = useMemo(() => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    let income = 0;
    let expenses = 0;
    let savingsAdded = 0;
    for (const t of txns) {
      const at = new Date(t.created_at);
      if (at.getTime() < start.getTime()) continue;
      if (t.type === "credit_card_payment") {
        // A card payment reduces a balance but is neither monthly spending
        // nor income, so it must not skew either bucket.
        continue;
      }
      if (t.type === "expense" || t.type === "credit_card" || t.type === "savings_move") {
        expenses += Number(t.amount);
      } else {
        income += Number(t.amount);
        if (t.type === "savings_add") savingsAdded += Number(t.amount);
      }
    }
    return {
      incomeThisMonth: income,
      expenseThisMonth: expenses,
      savingsAddedThisMonth: savingsAdded,
      savingsRate: savingsAdded > 0 ? Math.min(100, Math.round((savingsAdded / Math.max(income, 1)) * 100)) : 0,
    };
  }, [txns]);

  const showLoading = !userId || (loading && !profile);
  const maskAll = hidden || settings.maskValues;

  const budgetPct =
    summary.budget > 0 ? Math.min(100, (summary.spent / summary.budget) * 100) : 0;

  // Stable reference for AppShell so it doesn't re-render on every dashboard
  // state change; AppShell only needs the identity fields AppShell actually
  // uses (full name, email, role).
  const shellProfile = useMemo(
    () =>
      profile
        ? { full_name: profile.full_name, email: profile.email, role: profile.role }
        : null,
    [profile]
  );

  return (
    <AppShell
      userId={userId ?? ""}
      profile={shellProfile}
    >
      {showLoading ? (
        <div className="space-y-5 animate-fade-in">
          <BalanceSkeleton />
          <ListSkeleton rows={4} />
        </div>
      ) : (
        <div className="space-y-6 animate-fade-up">
          <BirthdayGreeting name={profile!.full_name} dateOfBirth={profile!.date_of_birth} />
          <PageHeader
            title={`${greeting()}, ${firstName(profile!.full_name)}`}
            subtitle={`Here's how ${monthName(new Date())} is looking.`}
          />

          <HeroCard
            salary={profile!.salary_balance}
            hidden={maskAll}
            toggleHidden={setHidden}
            income={incomeThisMonth}
            expenses={expenseThisMonth}
            savings={profile!.savings_balance}
          />

          {/* Quick actions */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" aria-label="Quick actions">
            {[
              { icon: "expense" as IconName, label: "Log expense", mode: "expense" as AddMode, color: "#ef4444" },
              { icon: "income" as IconName, label: "Add income", mode: "income" as AddMode, color: "#10b981" },
              { icon: "transfer" as IconName, label: "To savings", mode: "transfer" as AddMode, color: "#6366f1" },
              { icon: "card" as IconName, label: "Card charge", mode: "credit" as AddMode, color: "#f59e0b" },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => openQuickAdd(a.mode)}
                className="neo rounded-2xl p-4 flex flex-col items-center gap-2 text-slate hover:text-snow"
              >
                <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center" style={{ background: `${a.color}1a`, color: a.color }}>
                  <Icon name={a.icon} size={19} />
                </span>
                <span className="text-[13px] font-semibold">{a.label}</span>
              </button>
            ))}
          </section>

          {/* Budget progress */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-frost uppercase tracking-wider flex items-center gap-2">
                <Icon name="budgets" size={16} className="text-accent" />
                This month&apos;s budget
              </h2>
              <Link href="/budgets" className="text-sm text-slate hover:text-snow flex items-center gap-1">
                Details <Icon name="chevronRight" size={14} />
              </Link>
            </div>
            <GlassCard className="p-5 flex items-center gap-6" hover>
              <div className="shrink-0">
                <ProgressRing
                  value={budgetPct}
                  size={110}
                  stroke={10}
                  color={summary.isOverspent ? "danger" : budgetPct > 80 ? "warn" : "accent"}
                >
                  <div className="text-center">
                    <p className="text-xl font-bold text-snow tabular">{Math.round(budgetPct)}%</p>
                    <p className="text-[13px] uppercase tracking-wider text-slate">spent</p>                  </div>
                </ProgressRing>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm text-slate">Spent this month</p>
                <p className="text-2xl font-bold text-snow tabular">
                  <PrivateValue value={summary.spent} hidden={maskAll} className="tabular" />
                </p>
                <p className="text-sm text-slate tabular">
                  of <span className="text-frost font-semibold">{inr(summary.budget)}</span> budget
                </p>
              </div>
            </GlassCard>
            <div className="mt-3">
              <BudgetHint spent={summary.spent} budget={summary.budget} />
            </div>
          </section>

          {/* Smart hint: savings increased */}
          {savingsAddedThisMonth > 0 && !summary.isOverspent && (
            <div className="glass-soft rounded-2xl px-4 py-3 flex items-center gap-3 animate-fade-up" style={{ borderColor: "#eab30833" }}>
              <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#eab3081a", color: "#eab308" }}>
                <Icon name="piggy" size={17} />
              </span>
              <p className="text-sm text-snow font-medium leading-snug">
                Nice! You put <span className="font-bold tabular">{inr(savingsAddedThisMonth)}</span> into
                savings this month{savingsRate > 0 ? ` — a ${savingsRate}% savings rate` : ""}.
              </p>
            </div>
          )}

          {/* Notifications permission (non-intrusive, user opts in) */}
          {userId && <NotificationPermissionCard userId={userId} />}

          {/* Goals */}
          <GoalsSection userId={userId} />

          {/* Credit Cards */}
          {profile && (
            <CreditCardsSection
              accountBalance={profile.salary_balance}
              savingsBalance={profile.savings_balance}
            />
          )}

          {/* Recent transactions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-frost uppercase tracking-wider flex items-center gap-2">
                <Icon name="transactions" size={16} className="text-accent" />
                Recent activity
              </h2>
              <Link href="/transactions" className="text-sm text-slate hover:text-snow flex items-center gap-1">
                View all <Icon name="chevronRight" size={14} />
              </Link>
            </div>
            {txns.length === 0 ? (
              <GlassCard className="p-10 flex flex-col items-center text-center gap-3">
                <span className="h-14 w-14 rounded-2xl glass items-center justify-center inline-flex text-slate">
                  <Icon name="wallet" size={24} />
                </span>
                <p className="font-semibold text-snow">No expenses yet</p>
                <p className="text-sm text-slate max-w-xs">
                  Tap the <span className="text-accent font-semibold">+</span> button to log your
                  first expense — it takes a couple of seconds.
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-2.5">
                {txns.slice(0, 6).map((t) => (
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
