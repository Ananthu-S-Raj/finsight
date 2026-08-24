"use client";

import { useMemo } from "react";
import Icon, { type IconName } from "./ui/Icons";
import { ProgressRing } from "./ui/Progress";
import { GOAL_THEME_HEX, type Goal, type GoalTheme } from "@/lib/goals";
import { goalDaysRemaining, goalHealth, goalProgressPercent, goalRemaining, requiredContribution } from "@/lib/goals";
import { inr } from "@/lib/format";

const HEALTH_META: Record<
  "on_track" | "at_risk" | "overdue" | "completed",
  { label: string; color: string }
> = {
  on_track: { label: "On track", color: "#10b981" },
  at_risk: { label: "At risk", color: "#f59e0b" },
  overdue: { label: "Overdue", color: "#ef4444" },
  completed: { label: "Completed", color: "#10b981" },
};

function ringColor(theme: GoalTheme, health: keyof typeof HEALTH_META): "accent" | "indigo" | "warn" | "gold" | "danger" {
  if (health === "overdue") return "danger";
  if (health === "at_risk") return "warn";
  return theme;
}

function deadlineLabel(goal: Goal, today: Date): string {
  const diff = goalDaysRemaining(goal, today);
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due in ${diff} days`;
}

export default function GoalCard({
  goal,
  today,
  onOpen,
}: {
  goal: Goal;
  today?: Date;
  onOpen?: (goal: Goal) => void;
}) {
  const now = useMemo(() => today ?? new Date(), [today]);
  const health = useMemo(() => goalHealth(goal, now), [goal, now]);
  const pct = goalProgressPercent(goal);
  const remaining = goalRemaining(goal);
  const required = requiredContribution(goal, now);
  const meta = HEALTH_META[health.status];
  const iconName = (goal.icon || "target") as IconName;

  const subtitle =
    goal.status === "completed" || health.status === "completed"
      ? `Reached ${inr(goal.target_amount)}`
      : goal.status === "paused"
        ? "Paused — no new reminders"
        : health.status === "overdue"
          ? `${inr(remaining)} still needed`
          : `${deadlineLabel(goal, now)} · ${inr(required.monthly)}/mo to stay on plan`;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(goal)}
      className="w-full glass-soft rounded-2xl p-4 flex items-center gap-4 text-left row-press glass-hover"
      aria-label={`${goal.name} — ${Math.round(pct)}% funded`}
    >
      <span
        className="h-12 w-12 rounded-2xl inline-flex items-center justify-center shrink-0"
        style={{ background: `${GOAL_THEME_HEX[goal.theme]}1a`, color: GOAL_THEME_HEX[goal.theme] }}
      >
        <Icon name={iconName} size={22} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-snow truncate">{goal.name}</p>
          <span
            className="text-[12px] font-semibold uppercase tracking-wide shrink-0"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
        </div>
        <p className="text-[13px] text-slate truncate mt-0.5">{subtitle}</p>
        <div className="flex items-center justify-between gap-3 mt-2.5">
          <div className="flex-1 progress-track" style={{ height: 7 }}>
            <div
              className="progress-fill"
              style={{
                width: "100%",
                transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})`,
                background: GOAL_THEME_HEX[goal.theme],
              }}
            />
          </div>
          <span className="text-[13px] font-bold tabular text-snow shrink-0">
            {inr(goal.current_amount)}
            <span className="text-slate font-medium"> / {inr(goal.target_amount)}</span>
          </span>
        </div>
      </div>

      <span className="shrink-0">
        <ProgressRing value={pct} size={58} stroke={6} color={ringColor(goal.theme, health.status)} />
      </span>
    </button>
  );
}
