"use client";

import { useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import Toggle from "./ui/Toggle";
import Icon, { type IconName } from "./ui/Icons";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import { CATEGORY_PRESETS } from "@/lib/finance";
import { useCategories } from "@/lib/useCategories";
import { toCategoryOptions } from "@/lib/categories";
import { GOAL_ICONS, GOAL_THEMES, GOAL_THEME_HEX, type Goal, type GoalIcon, type GoalInput, type GoalTheme } from "@/lib/goals";
import { createGoal, updateGoal } from "@/lib/goalsApi";
import { emitRefresh } from "@/lib/events";

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function oneYearAhead(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function GoalFormSheet({
  open,
  onClose,
  editing,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  editing: Goal | null;
  userId: string;
}) {
  const toast = useToast();
  const { categories } = useCategories(userId);

  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("");
  const [targetDate, setTargetDate] = useState(oneYearAhead);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [icon, setIcon] = useState<GoalIcon>("target");
  const [theme, setTheme] = useState<GoalTheme>("accent");
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    if (editing) {
      setName(editing.name);
      setTargetAmount(String(editing.target_amount));
      setCurrentAmount("");
      setTargetDate(editing.target_date);
      setDescription(editing.description ?? "");
      setCategory(editing.category ?? "");
      setCategoryId(editing.category_id ?? null);
      setIcon(editing.icon);
      setTheme(editing.theme);
      setReminderEnabled(editing.reminder_enabled);
    } else {
      setName("");
      setTargetAmount("");
      setCurrentAmount("");
      setTargetDate(oneYearAhead());
      setDescription("");
      setCategory("");
      setCategoryId(null);
      setIcon("target");
      setTheme("accent");
      setReminderEnabled(true);
    }
  }, [open, editing]);

  const canonicalOptions = toCategoryOptions(categories ?? []);
  const categoryOptions =
    canonicalOptions.length > 0
      ? canonicalOptions
      : Object.keys(CATEGORY_PRESETS).map((name) => ({
          id: null as string | null,
          name,
          children: CATEGORY_PRESETS[name],
        }));
  const selectedCategoryId = categoryOptions.find((o) => o.name === category)?.id ?? null;

  function buildInput(): GoalInput | null {
    const target = Number(targetAmount);
    if (!target || target <= 0) {
      setError("Enter a target amount greater than zero.");
      return null;
    }
    const title = name.trim();
    if (!title) {
      setError("Give your goal a name.");
      return null;
    }
    if (!targetDate) {
      setError("Pick a target date.");
      return null;
    }
    const start = currentAmount.trim() === "" ? 0 : Number(currentAmount);
    if (Number.isNaN(start) || start < 0) {
      setError("Starting amount can't be negative.");
      return null;
    }
    return {
      name: title,
      target_amount: target,
      current_amount: editing ? 0 : start,
      target_date: targetDate,
      description: description.trim() || null,
      category: category || null,
      category_id: selectedCategoryId,
      icon,
      theme,
      reminder_enabled: reminderEnabled,
    };
  }

  async function submit() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      if (editing) {
        await updateGoal(editing.id, input);
        toast.success("Goal updated.");
      } else {
        await createGoal(input);
        toast.success("Goal created.");
      }
      haptic("success");
      emitRefresh();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "FinSight couldn't save that right now."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit goal" : "New goal"}
      subtitle={
        editing
          ? "Changes apply right away"
          : "Save toward something that matters"
      }
    >
      <div className="space-y-6">
        <div>
          <p className="field-label">Goal name</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emergency fund, New laptop"
            className="field"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="field-label">Target amount</p>
            <div className="relative">
              <span className="pointer-events-none select-none absolute left-4 top-1/2 -translate-y-1/2 w-6 text-center text-lg font-semibold text-slate" aria-hidden="true">
                ₹
              </span>
              <input
                inputMode="decimal"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                className="field !pl-12 text-xl font-semibold tabular tracking-tight"
                aria-label="Target amount"
              />
            </div>
          </div>
          <div>
            <p className="field-label">Target date</p>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="field"
              aria-label="Target date"
            />
          </div>
        </div>

        {!editing && (
          <div>
            <p className="field-label">Already saved (optional)</p>
            <div className="relative">
              <span className="pointer-events-none select-none absolute left-4 top-1/2 -translate-y-1/2 w-6 text-center text-lg font-semibold text-slate" aria-hidden="true">
                ₹
              </span>
              <input
                inputMode="decimal"
                value={currentAmount}
                onChange={(e) => setCurrentAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                className="field !pl-12 text-xl font-semibold tabular tracking-tight"
                aria-label="Already saved"
              />
            </div>
            <p className="text-[13px] text-slate mt-2">
              You can also log contributions after creating the goal.
            </p>
          </div>
        )}

        <div>
          <p className="field-label">Icon</p>
          <div className="flex flex-wrap gap-2">
            {GOAL_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => {
                  haptic("light");
                  setIcon(ic);
                }}
                className={`neo-chip ${icon === ic ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
                aria-label={`${ic} icon`}
              >
                <Icon name={ic as IconName} size={16} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Colour</p>
          <div className="flex flex-wrap gap-2">
            {GOAL_THEMES.map((th) => (
              <button
                key={th}
                type="button"
                onClick={() => {
                  haptic("light");
                  setTheme(th);
                }}
                className={`neo-chip ${theme === th ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full inline-block"
                  style={{ background: GOAL_THEME_HEX[th] }}
                />
                {th}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Category (optional)</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                haptic("light");
                setCategory("");
                setCategoryId(null);
              }}
              className={`neo-chip ${category === "" ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
            >
              None
            </button>
            {categoryOptions.map((c) => (
              <button
                key={c.id ?? c.name}
                type="button"
                onClick={() => {
                  haptic("light");
                  setCategory(c.name);
                  setCategoryId(c.id);
                }}
                className={`neo-chip ${category === c.name ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                <Icon name="tag" size={13} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Notes (optional)</p>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why are you saving this?"
            className="field"
            autoComplete="off"
          />
        </div>

        <label className="flex items-center justify-between gap-4 py-1">
          <div>
            <p className="text-sm font-medium text-snow">Remind me before the deadline</p>
            <p className="text-[13px] text-slate">Alerts 30, 7 and 1 day before</p>
          </div>
          <Toggle on={reminderEnabled} onChange={setReminderEnabled} label="Deadline reminders" />
        </label>

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
            {saving ? "Saving…" : editing ? "Save changes" : "Create goal"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
