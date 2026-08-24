"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Icon from "@/components/ui/Icons";
import TrendChart, { type ChartDatum } from "@/components/TrendChart";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import GoalsSection from "@/components/GoalsSection";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { getCategoryBreakdown, getMonthBuckets, type CategorySlice } from "@/lib/analytics";
import { inr } from "@/lib/format";
import { listenRefresh } from "@/lib/events";

const CAT_COLORS: Record<string, string> = {
  Food: "#10b981",
  Travel: "#6366f1",
  Shopping: "#eab308",
  Other: "#94a3b8",
};

export default function AnalyticsPage() {
  const userId = useRequireAuth();
  const { profile, summary, loading } = usePageData(userId);
  const [buckets, setBuckets] = useState<ChartDatum[]>([]);
  const [slices, setSlices] = useState<CategorySlice[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    document.title = "Analytics · FinSight";
  }, []);

  useEffect(() => {
    if (!userId) return;
    const uid = userId;
    let active = true;
    async function load() {
      setChartLoading(true);
      try {
        const [b, s] = await Promise.all([
          getMonthBuckets(uid, 8),
          getCategoryBreakdown(uid),
        ]);
        if (!active) return;
        setBuckets(
          b.map((x) => ({
            label: x.label,
            value: x.spent,
            secondary: x.income,
          }))
        );
        setSlices(s);
      } finally {
        if (active) setChartLoading(false);
      }
    }
    load();
    const off = listenRefresh(load);
    return () => {
      active = false;
      off();
    };
  }, [userId]);

  const topCategory = slices?.[0];
  const avgDaily = summary.spent > 0
    ? summary.spent / new Date().getDate()
    : 0;

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Analytics"
        subtitle="Understand where your money goes."
        icon="analytics"
      />

      <div className="space-y-5 animate-fade-up">
        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { label: "Spent this month", value: inr(summary.spent), icon: "expense" as const, color: "#ef4444" },
            { label: "Budget", value: inr(summary.budget), icon: "budgets" as const, color: "#f59e0b" },
            { label: "Avg / day", value: `₹${Math.round(avgDaily)}`, icon: "calendar" as const, color: "#6366f1" },
            { label: "Top category", value: topCategory?.category ?? "—", icon: "tag" as const, color: "#10b981" },
          ].map((s) => (
            <GlassCard key={s.label} className="p-4" hover>
              <span className="h-9 w-9 rounded-xl inline-flex items-center justify-center" style={{ background: `${s.color}1a`, color: s.color }}>
                <Icon name={s.icon} size={17} />
              </span>
              <p className="text-xl font-bold text-snow tabular mt-3 truncate">{s.value}</p>
              <p className="text-[13px] text-slate mt-0.5">{s.label}</p>
            </GlassCard>
          ))}
        </div>

        {/* Trend chart */}
        {chartLoading ? (
          <ChartSkeleton />
        ) : (
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-snow">Expense trend</h2>
              <span className="flex items-center gap-3 text-[13px] text-slate">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: "#10b981" }} /> Spend
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: "#6366f1" }} /> Income
                </span>
              </span>
            </div>
            <TrendChart
              data={buckets}
              label="Last 8 months"
              height={220}
              formatValue={(n) => inr(n, { compact: true })}
              emptyLabel="Log a few months of transactions to see your trend."
            />
            <p className="text-[13px] text-slate mt-3">
              Touch any point to see that month&apos;s total.
            </p>
          </GlassCard>
        )}

        {/* Category breakdown */}
        {!chartLoading && slices && (
          <GlassCard className="p-5">
            <h2 className="font-semibold text-snow mb-4">Spending by category — {new Date().toLocaleDateString("en-IN", { month: "long" })}</h2>
            <div className="space-y-3.5">
              {slices.map((s) => (
                <div key={s.category}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-frost font-medium flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLORS[s.category] ?? "#94a3b8" }} />
                      {s.category}
                      <span className="text-[13px] text-slate">· {s.count} entries</span>
                    </span>
                    <span className="text-sm font-bold text-snow tabular">
                      {inr(s.total)} <span className="text-[13px] text-slate font-medium">({Math.round(s.pct)}%)</span>
                    </span>
                  </div>
                  <div className="progress-track" style={{ height: 8 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: "100%",
                        transform: `scaleX(${s.pct / 100})`,
                        background: CAT_COLORS[s.category] ?? "#94a3b8",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {!chartLoading && !slices && (
          <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
            <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
              <Icon name="chart" size={24} />
            </span>
            <p className="font-semibold text-snow">No spending this month yet</p>
            <p className="text-sm text-slate max-w-xs">
              Log an expense and your category breakdown will appear here.
            </p>
          </GlassCard>
        )}

        {/* Goals progress */}
        <GoalsSection userId={userId} />
      </div>
    </AppShell>
  );
}
