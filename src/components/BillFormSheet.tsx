"use client";

import { useCallback, useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import Toggle from "./ui/Toggle";
import Icon, { type IconName } from "./ui/Icons";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import { CATEGORY_PRESETS } from "@/lib/finance";
import { useCategories } from "@/lib/useCategories";
import { toCategoryOptions, type CategoryOption } from "@/lib/categories";
import {
  BILL_FREQUENCIES,
  BILL_FREQUENCY_LABEL,
  REMINDER_OPTIONS,
  dayOfMonth,
  type Bill,
  type BillFrequency,
  type BillInput,
} from "@/lib/bills";
import { createBill, generateBillReminders, updateBill } from "@/lib/billsApi";
import { prettyDate } from "@/lib/recurring";
import { emitRefresh } from "@/lib/events";

const CATEGORY_ICONS: Record<string, IconName> = {
  Travel: "bank",
  Food: "wallet",
  Shopping: "tag",
  Other: "tag",
};

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function BillFormSheet({
  open,
  onClose,
  editing,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  editing: Bill | null;
  userId: string;
}) {
  const toast = useToast();
  const { categories } = useCategories(userId);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayStr);
  const [frequency, setFrequency] = useState<BillFrequency>("monthly");
  const [category, setCategory] = useState("Other");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState("Other expense");
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDays, setReminderDays] = useState(3);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    if (editing) {
      setName(editing.name);
      setAmount(String(editing.amount));
      setDueDate(editing.due_date);
      setFrequency(editing.frequency);
      setCategory(editing.category ?? "Other");
      setCategoryId(editing.category_id ?? null);
      setSubcategory(editing.subcategory ?? "Other expense");
      setIsCreditCard(editing.is_credit_card);
      setReminderEnabled(editing.reminder_enabled);
      setReminderDays(editing.reminder_days_before);
      setNotes(editing.notes ?? "");
    } else {
      setName("");
      setAmount("");
      setDueDate(todayStr());
      setFrequency("monthly");
      setCategory("Other");
      setCategoryId(null);
      setSubcategory("Other expense");
      setIsCreditCard(false);
      setReminderEnabled(true);
      setReminderDays(3);
      setNotes("");
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
  const presets = categoryOptions.find((o) => o.name === category)?.children ?? [];

  const selectCategory = useCallback(
    (c: CategoryOption) => {
      setCategory(c.name);
      setCategoryId(c.id);
      setSubcategory(c.children[0] ?? "");
    },
    []
  );

  const anchorDay = dayOfMonth(dueDate);

  function buildInput(): BillInput | null {
    const n = Number(amount);
    if (!n || n <= 0) {
      setError("Enter an amount greater than zero.");
      return null;
    }
    const title = name.trim();
    if (!title) {
      setError("Give this bill a name.");
      return null;
    }
    if (!dueDate) {
      setError("Pick a due date.");
      return null;
    }
    return {
      name: title,
      amount: n,
      due_date: dueDate,
      frequency,
      category,
      category_id: selectedCategoryId,
      subcategory: subcategory || "Other expense",
      is_credit_card: isCreditCard,
      reminder_enabled: reminderEnabled,
      reminder_days_before: reminderDays,
      notes: notes.trim() || null,
    };
  }

  async function submit() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      if (editing) {
        await updateBill(editing.id, input);
        toast.success("Bill updated.");
      } else {
        await createBill(input);
        toast.success("Bill added.");
      }
      haptic("success");
      await generateBillReminders().catch(() => null);
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
      title={editing ? "Edit bill" : "Add a bill"}
      subtitle={
        editing
          ? "Changes apply from the next due date"
          : "Rent, EMI, subscriptions — we'll remind you before it's due"
      }
    >
      <div className="space-y-6">
        <div>
          <p className="field-label">Bill name</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rent, Netflix, Bike EMI"
            className="field"
            autoComplete="off"
          />
        </div>

        <div>
          <p className="field-label">Amount</p>
          <div className="relative">
            <span className="pointer-events-none select-none absolute left-4 top-1/2 -translate-y-1/2 w-6 text-center text-lg font-semibold text-slate" aria-hidden="true">
              ₹
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              className="field !pl-12 text-2xl font-semibold tabular tracking-tight"
              aria-label="Amount"
            />
          </div>
        </div>

        <div>
          <p className="field-label">Due date</p>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="field"
          />
          {frequency !== "one_time" && (
            <p className="text-[13px] text-slate mt-2">
              Repeats on the {ordinal(anchorDay)} of each period.
            </p>
          )}
        </div>

        <div>
          <p className="field-label">Frequency</p>
          <div className="flex flex-wrap gap-2">
            {BILL_FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  haptic("light");
                  setFrequency(f);
                }}
                className={`neo-chip ${frequency === f ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                {BILL_FREQUENCY_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Category</p>
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((c) => (
              <button
                key={c.id ?? c.name}
                type="button"
                onClick={() => selectCategory(c)}
                className={`neo-chip ${category === c.name ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                <Icon name={CATEGORY_ICONS[c.name] ?? "tag"} size={15} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {presets.length > 0 && (
          <div>
            <p className="field-label">Subcategory</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubcategory(s)}
                  className={`neo-chip ${subcategory === s ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center justify-between gap-4 py-1">
          <div>
            <p className="text-sm font-medium text-snow">Pay by credit card</p>
            <p className="text-[13px] text-slate">Records the payment as a card charge</p>
          </div>
          <Toggle on={isCreditCard} onChange={setIsCreditCard} label="Pay by credit card" />
        </label>

        <label className="flex items-center justify-between gap-4 py-1">
          <div>
            <p className="text-sm font-medium text-snow">Remind me before it&apos;s due</p>
            <p className="text-[13px] text-slate">A notification on your device</p>
          </div>
          <Toggle on={reminderEnabled} onChange={setReminderEnabled} label="Remind me" />
        </label>

        {reminderEnabled && (
          <div>
            <p className="field-label">Remind me</p>
            <div className="flex flex-wrap gap-2">
              {REMINDER_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setReminderDays(opt.days);
                  }}
                  className={`neo-chip ${reminderDays === opt.days ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="field-label">Notes (optional)</p>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. UPI ID, provider, auto-pay off"
            className="field"
            autoComplete="off"
          />
        </div>

        {editing && (
          <div className="rounded-2xl neo-inset p-4">
            <p className="text-[13px] text-slate">Next due date</p>
            <p className="mt-1 text-lg font-bold tabular text-snow">
              {prettyDate(editing.due_date)}
            </p>
          </div>
        )}

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
            {saving ? "Saving…" : editing ? "Save changes" : "Add bill"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function ordinal(day: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = day % 100;
  return day + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
