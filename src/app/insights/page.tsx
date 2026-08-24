"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import { BalanceSkeleton } from "@/components/ui/Skeleton";
import AIInsights from "@/components/AIInsights";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { inr, monthName } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { haptic } from "@/lib/haptics";
import { useToast } from "@/components/ui/ToastProvider";

type Insight = {
  icon: IconName;
  tone: "accent" | "warn" | "danger" | "indigo";
  title: string;
  body: string;
  action?: string;
};

export default function InsightsPage() {
  const userId = useRequireAuth();
  const { profile, txns, summary, loading } = usePageData(userId, 200);
  const { settings, patch } = useSettings();
  const toast = useToast();
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    document.title = "AI Insights · FinSight";
  }, []);

  const insights = useMemo<Insight[]>(() => {
    if (!settings.aiEnabled) return [];
    const list: Insight[] = [];

    // Category analysis
    const catTotals = new Map<string, number>();
    const catCounts = new Map<string, number>();
    let biggest: Transaction | null = null;
    let biggestAmount = 0;
    for (const t of txns) {
      if (t.type === "expense" || t.type === "credit_card") {
        const c = t.category ?? "Other";
        catTotals.set(c, (catTotals.get(c) ?? 0) + Number(t.amount));
        catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
        if (Number(t.amount) > biggestAmount) {
          biggestAmount = Number(t.amount);
          biggest = t;
        }
      }
    }

    const topCat = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCat) {
      const pct = summary.spent > 0 ? Math.round((topCat[1] / summary.spent) * 100) : 0;
      list.push({
        icon: "tag",
        tone: pct > 40 ? "warn" : "accent",
        title: `${topCat[0]} is your biggest category`,
        body: `About ${inr(topCat[1])} (${pct}% of spending) has gone to ${topCat[0]}${
          catCounts.get(topCat[0]) ? ` across ${catCounts.get(topCat[0])} transactions` : ""
        }. ${pct > 40 ? "Consider whether every purchase there was planned." : "Looking healthy."}`,
      });
    }

    if (biggest) {
      list.push({
        icon: "alert",
        tone: "warn",
        title: "Your largest single expense",
        body: `${inr(biggestAmount)} on ${biggest.subcategory ?? biggest.category ?? "an expense"}${
          biggest.note ? ` — ${biggest.note}` : ""
        }.`,
      });
    }

    if (summary.budget > 0) {
      if (summary.isOverspent) {
        list.push({
          icon: "trendDown",
          tone: "danger",
          title: "Over budget this month",
          body: `You're ₹${Math.round(summary.spent - summary.budget)} past your ${inr(
            summary.budget
          )} budget. Every rupee over is taken from your balance.`,
          action: "Raise it in Budgets",
        });
      } else {
        const pct = (summary.spent / summary.budget) * 100;
        list.push({
          icon: "trendUp",
          tone: pct > 80 ? "warn" : "accent",
          title: pct > 80 ? "Getting close to your budget" : "On track with your budget",
          body: `You've used ${Math.round(pct)}% of your ${inr(summary.budget)} budget with ${Math.max(
            1,
            31 - new Date().getDate()
          )} days left in ${monthName(new Date())}.`,
        });
      }
    }

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const savingsIn = txns
      .filter((t) => t.type === "savings_add" && new Date(t.created_at) >= start)
      .reduce((s, t) => s + Number(t.amount), 0);
    const incomeIn = txns
      .filter((t) => t.type === "salary_add" && new Date(t.created_at) >= start)
      .reduce((s, t) => s + Number(t.amount), 0);
    if (incomeIn > 0 && savingsIn > 0) {
      const rate = Math.round((savingsIn / incomeIn) * 100);
      list.push({
        icon: "piggy",
        tone: rate >= 20 ? "accent" : "indigo",
        title: `Savings rate: ${rate}%`,
        body:
          rate >= 20
            ? "You're saving over 20% of income — keep it up."
            : `You're saving ${rate}% of income. Moving even 5% more to savings builds a big cushion over time.`,
      });
    }

    if (list.length === 0) {
      list.push({
        icon: "sparkles",
        tone: "indigo",
        title: "Ready when you are",
        body: "Log a few expenses and income entries, and FinSight will start surfacing personalized insights here.",
      });
    }

    return list;
  }, [txns, summary, settings.aiEnabled]);

  const total = useMemo(
    () =>
      txns.filter((t) => t.type === "expense" || t.type === "credit_card").reduce((s, t) => s + Number(t.amount), 0),
    [txns]
  );

  function regenerate() {
    haptic("success");
    setGenerated(true);
    toast.success("Insights refreshed.");
    window.setTimeout(() => setGenerated(false), 1500);
  }

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="AI Insights"
        subtitle="Smart observations about your money."
        icon="sparkles"
        actions={
          <Button
            variant="default"
            icon="refresh"
            onClick={regenerate}
            className={generated ? "animate-ring-soft" : ""}
          >
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {loading && !profile ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          {/* AI status control */}
          <GlassCard className="p-5 flex items-center gap-4" hover>
            <span className="h-11 w-11 rounded-2xl inline-flex items-center justify-center shrink-0" style={{ background: "#6366f11a", color: "#6366f1" }}>
              <Icon name="sparkles" size={22} />
            </span>
            <div className="flex-1">
              <h3 className="font-semibold text-snow">On-device insights</h3>
              <p className="text-sm text-slate">
                Quick observations computed entirely in your browser — no data leaves your device.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={settings.aiEnabled}
              onClick={() => {
                haptic("toggle");
                patch({ aiEnabled: !settings.aiEnabled });
              }}
              className="switch shrink-0"
              data-on={settings.aiEnabled}
            />
          </GlassCard>

          {!settings.aiEnabled ? (
            <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
              <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                <Icon name="sparkles" size={24} />
              </span>
              <p className="font-semibold text-snow">Insights are off</p>
              <p className="text-sm text-slate max-w-xs">
                Turn insights back on to see personalized observations about your spending.
              </p>
            </GlassCard>
          ) : insights.length === 0 && total === 0 ? (
            <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
              <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                <Icon name="sparkles" size={24} />
              </span>
              <p className="font-semibold text-snow">Log some data to get insights</p>
              <p className="text-sm text-slate max-w-xs">
                Add a few expenses and income entries, then come back here.
              </p>
            </GlassCard>
          ) : (
            <div className="grid gap-3">
              {insights.map((ins) => {
                const color =
                  ins.tone === "accent"
                    ? "#10b981"
                    : ins.tone === "warn"
                      ? "#f59e0b"
                      : ins.tone === "danger"
                        ? "#ef4444"
                        : "#6366f1";
                return (
                  <GlassCard key={ins.title} className="p-5 flex items-start gap-4" hover>
                    <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>
                      <Icon name={ins.icon} size={19} />
                    </span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-snow">{ins.title}</h3>
                      <p className="text-sm text-slate mt-1 leading-relaxed">{ins.body}</p>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}

          <p className="text-[13px] text-slate text-center">
            Insights are computed locally from your recent activity.
          </p>

          <AIInsights />
        </div>
      )}
    </AppShell>
  );
}

type Transaction = {
  id: string;
  type: string;
  amount: number;
  category: string | null;
  subcategory: string | null;
  note: string | null;
  created_at: string;
};
