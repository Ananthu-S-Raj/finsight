"use client";

import { useCallback, useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import GlassCard from "./ui/GlassCard";
import Icon, { type IconName } from "./ui/Icons";
import { ProgressRing } from "./ui/Progress";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import {
  goalDaysRemaining,
  goalHealth,
  goalProgressPercent,
  goalRemaining,
  GOAL_THEME_HEX,
  requiredContribution,
  type Goal,
  type GoalContribution,
} from "@/lib/goals";
import { deleteGoal, listContributions, removeContribution, setGoalStatus } from "@/lib/goalsApi";
import { emitRefresh } from "@/lib/events";
import { inr } from "@/lib/format";
import { prettyDate } from "@/lib/recurring";

export default function GoalDetailsSheet({
  open,
  onClose,
  goal,
  onEdit,
  onContribute,
}: {
  open: boolean;
  onClose: () => void;
  goal: Goal | null;
  onEdit: (goal: Goal) => void;
  onContribute: (goal: Goal) => void;
}) {
  const toast = useToast();
  const [contributions, setContributions] = useState<GoalContribution[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!goal) return;
    setLoadingHistory(true);
    try {
      setContributions((await listContributions(goal.id)) ?? []);
    } catch {
      setContributions([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [goal]);

  useEffect(() => {
    if (open && goal) void loadHistory();
  }, [open, goal, loadHistory]);

  if (!goal) return null;

  const health = goalHealth(goal, new Date());
  const pct = goalProgressPercent(goal);
  const remaining = goalRemaining(goal);
  const required = requiredContribution(goal, new Date());
  const days = goalDaysRemaining(goal, new Date());
  const themeHex = GOAL_THEME_HEX[goal.theme];
  const canEdit = goal.status !== "cancelled";

  async function transition(next: "active" | "paused" | "cancelled") {
    if (!goal) return;
    if (next === "cancelled") {
      const ok = window.confirm(
        contributions.length > 0
          ? `Cancel this goal? Its ${contributions.length} contribution${
              contributions.length === 1 ? "" : "s"
            } stay visible in history but it will stop counting toward your plan.`
          : "Cancel this goal? It will be hidden from your active goals."
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const updated = await setGoalStatus(goal.id, next);
      if (updated) {
        haptic("success");
        toast.success(next === "cancelled" ? "Goal cancelled." : next === "paused" ? "Goal paused." : "Goal resumed.");
        emitRefresh();
        onClose();
      } else {
        toast.error("FinSight couldn't update that goal.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update that goal.");
    } finally {
      setBusy(false);
    }
  }

  async function removeContributionRow(cid: string, amount: number) {
    if (!goal) return;
    const ok = window.confirm(
      `Remove this ${inr(amount)} contribution from ${goal.name}? Progress will be recalculated.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await removeContribution(goal.id, cid);
      if (updated) {
        haptic("success");
        toast.success("Contribution removed.");
        emitRefresh();
        await loadHistory();
      } else {
        toast.error("Couldn't remove that contribution.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove that contribution.");
    } finally {
      setBusy(false);
    }
  }

  async function removeGoal() {
    if (!goal) return;
    const ok = window.confirm(
      contributions.length > 0
        ? `This goal has history, so it can't be deleted. Cancel it instead to keep the record.`
        : `Delete ${goal.name}? This can't be undone.`
    );
    if (!ok) return;
    if (contributions.length > 0) {
      toast.info("Cancel the goal instead — goals with history can't be deleted.");
      return;
    }
    setBusy(true);
    try {
      await deleteGoal(goal.id);
      haptic("success");
      toast.success("Goal deleted.");
      emitRefresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete that goal.");
    } finally {
      setBusy(false);
    }
  }

  const statusLine =
    goal.status === "completed" || health.status === "completed"
      ? { label: "Goal reached", color: "#10b981" }
      : health.status === "overdue"
        ? { label: `Overdue by ${Math.abs(days)} days`, color: "#ef4444" }
        : days < 0
          ? { label: `Due ${Math.abs(days)} days ago`, color: "#f59e0b" }
          : days === 0
            ? { label: "Due today", color: "#f59e0b" }
            : { label: `${days} days to go`, color: "#10b981" };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={goal.name}
      subtitle={
        goal.description
          ? goal.description
          : `${inr(goal.target_amount)} · ${prettyDate(goal.target_date)}`
      }
    >
      <div className="space-y-5">
        <GlassCard tone="soft" className="!p-0">
          <div className="flex items-center gap-5 p-5">
            <ProgressRing value={pct} size={84} stroke={9} color={health.status === "overdue" ? "danger" : health.status === "at_risk" ? "warn" : goal.theme} />
            <div className="flex-1 min-w-0">
              <p className="text-3xl font-bold tabular text-snow">
                {Math.round(pct)}
                <span className="text-xl text-slate font-semibold">%</span>
              </p>
              <p className="text-[13px] text-slate mt-0.5">
                {inr(goal.current_amount)} of {inr(goal.target_amount)} saved
              </p>
              <p className="text-[13px] font-medium mt-1" style={{ color: statusLine.color }}>
                {statusLine.label}
              </p>
            </div>
          </div>
          <div className="px-5 pb-5">
            <div className="progress-track" style={{ height: 10 }}>
              <div
                className="progress-fill"
                style={{
                  width: "100%",
                  transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})`,
                  background: themeHex,
                }}
              />
            </div>
          </div>
        </GlassCard>

        <div className="grid grid-cols-2 gap-3">
          <GlassCard tone="soft">
            <p className="text-[13px] text-slate">Remaining</p>
            <p className="text-xl font-bold tabular text-snow mt-1">
              {inr(Math.max(0, remaining))}
            </p>
            <p className="text-[13px] text-slate mt-1">
              {required.monthly > 0 ? `${inr(required.monthly)}/mo to stay on plan` : "On track"}
            </p>
          </GlassCard>
          <GlassCard tone="soft">
            <p className="text-[13px] text-slate">Category</p>
            <p className="text-sm font-semibold text-snow mt-1 truncate">
              {goal.category ?? "Uncategorised"}
            </p>
            <p className="text-[13px] text-slate mt-1">
              {goal.status === "active"
                ? "Reminders on"
                : goal.status === "paused"
                  ? "Paused"
                  : goal.status}
            </p>
          </GlassCard>
        </div>

        <div className="flex gap-2">
          <Button
            full
            variant="primary"
            icon="plus"
            disabled={busy || goal.status === "cancelled"}
            onClick={() => onContribute(goal)}
          >
            Add
          </Button>
          {goal.status === "active" && (
            <Button full variant="default" icon="pause" disabled={busy} onClick={() => void transition("paused")}>
              Pause
            </Button>
          )}
          {goal.status === "paused" && (
            <Button full variant="default" icon="play" disabled={busy} onClick={() => void transition("active")}>
              Resume
            </Button>
          )}
          {goal.status === "completed" && (
            <Button full variant="default" icon="play" disabled={busy} onClick={() => void transition("active")}>
              Reopen
            </Button>
          )}
          {canEdit && (
            <Button full variant="ghost" icon="edit" disabled={busy} onClick={() => onEdit(goal)}>
              Edit
            </Button>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-snow">History</p>
            <span className="text-[13px] text-slate">{contributions.length} contribution{contributions.length === 1 ? "" : "s"}</span>
          </div>
          {loadingHistory ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="glass-soft rounded-xl h-14 animate-pulse" />
              ))}
            </div>
          ) : contributions.length === 0 ? (
            <p className="text-[13px] text-slate text-center py-4 glass-soft rounded-xl">
              No contributions yet — add your first one.
            </p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
              {contributions.map((c) => (
                <div key={c.id} className="glass-soft rounded-xl px-4 py-3 flex items-center gap-3">
                  <span
                    className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0"
                    style={{ background: `${themeHex}1a`, color: themeHex }}
                  >
                    <Icon name="plus" size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-snow tabular">+{inr(c.amount)}</p>
                    <p className="text-[13px] text-slate truncate">{prettyDate(c.created_at)}{c.note ? ` · ${c.note}` : ""}</p>
                  </div>
                  <button
                    type="button"
                    className="text-slate hover:text-danger transition-colors p-1.5"
                    aria-label={`Remove ${inr(c.amount)} contribution`}
                    disabled={busy}
                    onClick={() => void removeContributionRow(c.id, c.amount)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          {goal.status !== "cancelled" && goal.status !== "completed" && (
            <Button full variant="danger" icon="close" disabled={busy} onClick={() => void transition("cancelled")}>
              Cancel goal
            </Button>
          )}
          <Button full variant="ghost" icon="trash" disabled={busy} onClick={() => void removeGoal()}>
            Delete
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
