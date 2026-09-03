"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import SegmentedControl from "./ui/SegmentedControl";
import Toggle from "./ui/Toggle";
import Icon, { type IconName } from "./ui/Icons";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import { CATEGORY_PRESETS } from "@/lib/finance";
import { useCategories } from "@/lib/useCategories";
import { toCategoryOptions, type CategoryOption } from "@/lib/categories";
import {
  FREQUENCIES,
  FREQUENCY_LABEL,
  INCOME_KINDS,
  INCOME_KIND_LABEL,
  dayOfMonth,
  upcomingOccurrences,
  prettyDate,
  type Frequency,
  type IncomeKind,
  type RecurringInput,
  type RecurringTransaction,
  type RecurringType,
} from "@/lib/recurring";
import { createRecurring, updateRecurring, processRecurringDue } from "@/lib/recurringApi";
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

export default function RecurringFormSheet({
  open,
  onClose,
  editing,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  editing: RecurringTransaction | null;
  userId: string;
}) {
  const toast = useToast();
  const { categories } = useCategories(userId);

  const [type, setType] = useState<RecurringType>("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState("");
  const [category, setCategory] = useState("Other");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState("Other expense");
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [incomeKind, setIncomeKind] = useState<IncomeKind>("salary");
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    if (editing) {
      setType(editing.type);
      setDescription(editing.description ?? "");
      setAmount(String(editing.amount));
      setFrequency(editing.frequency);
      setStartDate(editing.start_date);
      setEndDate(editing.end_date ?? "");
      setCategory(editing.category ?? "Other");
      setCategoryId(editing.category_id ?? null);
      setSubcategory(editing.subcategory ?? "");
      setIsCreditCard(editing.account === "credit_card");
      setIncomeKind(
        editing.type === "income" && INCOME_KINDS.includes(editing.account as IncomeKind)
          ? (editing.account as IncomeKind)
          : "salary"
      );
      setRequiresConfirmation(editing.requires_confirmation);
    } else {
      setType("expense");
      setDescription("");
      setAmount("");
      setFrequency("monthly");
      setStartDate(todayStr());
      setEndDate("");
      setCategory("Other");
      setCategoryId(null);
      setSubcategory("Other expense");
      setIsCreditCard(false);
      setIncomeKind("salary");
      setRequiresConfirmation(false);
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

  const anchorDay = dayOfMonth(startDate);
  const preview = useMemo(
    () => upcomingOccurrences(frequency, startDate, anchorDay, 3),
    [frequency, startDate, anchorDay]
  );

  function buildInput(): RecurringInput | null {
    const n = Number(amount);
    if (!n || n <= 0) {
      setError("Enter an amount greater than zero.");
      return null;
    }
    if (!startDate) {
      setError("Pick a start date.");
      return null;
    }
    if (endDate && endDate < startDate) {
      setError("End date must be after the start date.");
      return null;
    }
    const desc = description.trim() || null;
    if (type === "income" && incomeKind === "loan" && !desc) {
      setError("Describe the loan so you can spot it in your history.");
      return null;
    }

    const base: RecurringInput = {
      type,
      amount: n,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      description: desc,
      requires_confirmation: requiresConfirmation,
    };

    if (type === "expense") {
      return {
        ...base,
        category,
        category_id: selectedCategoryId,
        subcategory: subcategory || "Other expense",
        account: isCreditCard ? "credit_card" : null,
        destination_account: null,
      };
    }
    if (type === "income") {
      return { ...base, account: incomeKind, destination_account: null };
    }
    return {
      ...base,
      account: "salary",
      destination_account: "savings",
    };
  }

  async function submit() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      if (editing) {
        await updateRecurring(editing.id, input);
        toast.success("Schedule updated.");
      } else {
        await createRecurring(input);
        toast.success("Recurring transaction created.");
      }
      haptic("success");
      await processRecurringDue().catch(() => null);
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
      title={editing ? "Edit schedule" : "New recurring"}
      subtitle={editing ? "Changes apply from the next occurrence" : "Automated transactions on your schedule"}
    >
      <div className="space-y-6">
        <SegmentedControl
          label="Transaction type"
          value={type}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
            { value: "transfer", label: "Transfer" },
          ]}
          onChange={(v) => {
            haptic("light");
            setType(v);
            setError("");
          }}
        />

        <div>
          <p className="field-label">Label</p>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={type === "expense" ? "e.g. Netflix, rent, gym" : type === "income" ? "e.g. Monthly salary" : "e.g. Salary to savings"}
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
          <p className="field-label">Repeats</p>
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  haptic("light");
                  setFrequency(f);
                }}
                className={`neo-chip ${frequency === f ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                {FREQUENCY_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="field-label">Start date</p>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <p className="field-label">End date (optional)</p>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="field"
            />
          </div>
        </div>

        {type === "expense" && (
          <>
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
          </>
        )}

        {type === "income" && (
          <div>
            <p className="field-label">Income type</p>
            <SegmentedControl
              label="Income type"
              value={incomeKind}
              options={INCOME_KINDS.map((k) => ({ value: k, label: INCOME_KIND_LABEL[k] }))}
              onChange={(k) => {
                haptic("light");
                setIncomeKind(k);
              }}
            />
            <p className="text-[13px] text-slate mt-2">
              {incomeKind === "salary"
                ? "Added to your salary balance."
                : incomeKind === "savings"
                  ? "Added straight to savings."
                  : "Logged as a loan received (with a label)."}
            </p>
          </div>
        )}

        {type === "transfer" && (
          <div className="rounded-2xl neo-inset p-4 flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-tint-hi inline-flex items-center justify-center text-accent">
              <Icon name="bank" size={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-snow">Salary → Savings</p>
              <p className="text-[13px] text-slate">Moves money from salary to savings automatically</p>
            </div>
          </div>
        )}

        <label className="flex items-center justify-between gap-4 py-1">
          <div>
            <p className="text-sm font-medium text-snow">Ask before each one</p>
            <p className="text-[13px] text-slate">Creates a pending item instead of spending automatically</p>
          </div>
          <Toggle on={requiresConfirmation} onChange={setRequiresConfirmation} label="Ask before each one" />
        </label>

        <div className="rounded-2xl neo-inset p-4">
          <p className="field-label">Upcoming dates</p>
          <ul className="mt-2 space-y-1.5">
            {preview.map((d, i) => (
              <li key={d + i} className="flex items-center justify-between text-sm">
                <span className="text-slate">
                  {i === 0 ? (editing ? "From start" : "First") : i === 1 ? "Second" : "Third"}
                </span>
                <span className="font-semibold text-snow tabular">{prettyDate(d)}</span>
              </li>
            ))}
          </ul>
          {editing && (
            <p className="text-[13px] text-slate mt-2">
              Next scheduled: <span className="text-snow font-medium tabular">{prettyDate(editing.next_occurrence)}</span>
            </p>
          )}
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
            {saving ? "Saving…" : editing ? "Save changes" : "Create schedule"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
