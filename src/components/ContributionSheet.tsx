"use client";

import { useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import { goalRemaining, goalProgressPercent, type Goal } from "@/lib/goals";
import { contributeToGoal } from "@/lib/goalsApi";
import { emitRefresh } from "@/lib/events";
import { inr } from "@/lib/format";

function quickAmounts(goal: Goal): number[] {
  const remaining = goalRemaining(goal);
  const pct = goalProgressPercent(goal);
  const options: number[] = [];
  if (goal.current_amount === 0) {
    const starter = Math.ceil(goal.target_amount / 12 / 10) * 10 || 100;
    options.push(starter, Math.round(starter * 2), Math.round(starter * 6));
  } else if (pct >= 50) {
    options.push(remaining);
  } else {
    const month = Math.ceil(goalRemaining(goal) / Math.max(1, Math.ceil(goalDaysUntil(goal)) / 30));
    const round = Math.ceil(month / 10) * 10 || 100;
    options.push(round, round * 2, Math.round(goal.current_amount * 0.1));
  }
  const unique = [...new Set(options.filter((n) => n > 0))].slice(0, 3);
  if (unique.length === 0) unique.push(100);
  return unique;
}

function goalDaysUntil(goal: Goal): number {
  const diff = new Date(goal.target_date).getTime() - Date.now();
  return Math.max(1, Math.round(diff / 86_400_000));
}

export default function ContributionSheet({
  open,
  onClose,
  goal,
}: {
  open: boolean;
  onClose: () => void;
  goal: Goal | null;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setNote("");
    setError("");
    setSaving(false);
  }, [open, goal?.id]);

  if (!goal) return null;

  function submit() {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!goal) return;
    setSaving(true);
    contributeToGoal(goal.id, value, note.trim() || undefined)
      .then((res) => {
        if (res) {
          haptic("success");
          toast.success(`Added ${inr(value)} to ${goal.name}.`);
          emitRefresh();
          onClose();
        } else {
          setError("FinSight couldn't log that contribution right now.");
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't log that contribution.");
      })
      .finally(() => setSaving(false));
  }

  const remaining = goalRemaining(goal);
  const quick = quickAmounts(goal);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add contribution"
      subtitle={remaining > 0 ? `${inr(remaining)} to go` : "Goal reached"}
    >
      <div className="space-y-6">
        <div>
          <p className="field-label">Amount</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-slate" aria-hidden="true">
              ₹
            </span>
            <input
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              className="field pl-10 text-2xl font-semibold tabular tracking-tight"
              aria-label="Contribution amount"
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {quick.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  haptic("light");
                  setAmount(String(n));
                }}
                className={`neo-chip ${Number(amount) === n ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                {inr(n, { compact: true })}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Note (optional)</p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Monthly top-up"
            className="field"
            autoComplete="off"
            maxLength={300}
          />
        </div>

        {error && (
          <p className="text-sm text-danger font-medium" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button full variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button full variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add contribution"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
