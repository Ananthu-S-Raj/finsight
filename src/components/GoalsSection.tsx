"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./ui/Icons";
import { ProgressRing } from "./ui/Progress";
import { listGoals } from "@/lib/goalsApi";
import { getLastEngineGoals } from "@/lib/useGoalEngine";
import { goalHealth, goalProgressPercent, type Goal } from "@/lib/goals";
import { inr } from "@/lib/format";
import { listenRefresh } from "@/lib/events";

export default function GoalsSection({ userId }: { userId?: string | null }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);

  const load = useCallback(async () => {
    // Reuse goals already fetched by useGoalEngine during app init.
    const cached = getLastEngineGoals(userId ?? null);
    if (cached) {
      setGoals(cached);
      return;
    }
    try {
      setGoals(await listGoals());
    } catch {
      setGoals([]);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  useEffect(() => listenRefresh(load), [load]);

  const visible = (goals ?? []).filter((g) => g.status !== "cancelled").slice(0, 3);

  if (goals === null) {
    return (
      <section aria-label="Goals">
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="glass-soft rounded-2xl h-[76px] animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-frost uppercase tracking-wider flex items-center gap-2">
          <Icon name="target" size={16} className="text-accent" />
          Goals
        </h2>
        <Link href="/goals" className="text-sm text-slate hover:text-snow flex items-center gap-1">
          {visible.length > 0 ? "View all" : "Start one"}{" "}
          <Icon name="chevronRight" size={14} />
        </Link>
      </div>

      {visible.length === 0 ? (
        <div className="glass-soft rounded-2xl p-5 flex items-center gap-4">
          <span className="h-11 w-11 rounded-2xl inline-flex items-center justify-center shrink-0" style={{ background: "#6366f11a", color: "#6366f1" }}>
            <Icon name="target" size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-snow">Save toward something</p>
            <p className="text-[13px] text-slate mt-0.5">Set a goal and track progress to it.</p>
          </div>
          <span className="text-slate">
            <Icon name="chevronRight" size={16} />
          </span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((goal) => (
            <GoalMini key={goal.id} goal={goal} />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalMini({ goal }: { goal: Goal }) {
  const health = goalHealth(goal, new Date());
  const pct = goalProgressPercent(goal);
  const ringColor =
    health.status === "overdue"
      ? "danger"
      : health.status === "at_risk"
        ? "warn"
        : (goal.theme as "accent" | "indigo" | "warn" | "gold");

  return (
    <Link
      href="/goals"
      className="glass-soft rounded-2xl p-4 flex items-center gap-3.5 row-press glass-hover"
    >
      <span className="shrink-0">
        <ProgressRing value={pct} size={44} stroke={5} color={ringColor} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-snow truncate">{goal.name}</p>
          <p className="text-[13px] font-bold tabular text-snow shrink-0">
            {Math.round(pct)}%
          </p>
        </div>
        <p className="text-[13px] text-slate truncate">
          {inr(goal.current_amount)} of {inr(goal.target_amount)}
        </p>
      </div>
      <span className="text-slate shrink-0">
        <Icon name="chevronRight" size={16} />
      </span>
    </Link>
  );
}
