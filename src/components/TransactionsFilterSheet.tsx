"use client";

import { useEffect, useMemo, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import { useToast } from "./ui/ToastProvider";
import type { TransactionFilters, TransactionType } from "@/lib/transactions";
import type { Category } from "@/lib/categories";
import { toDateOnly } from "@/lib/recurring";
import { haptic } from "@/lib/haptics";

interface Props {
  open: boolean;
  onClose: () => void;
  filters: TransactionFilters;
  categories: Category[];
  onApply: (filters: TransactionFilters) => void;
  onClear: () => void;
}

type RangePreset = { id: string; label: string; range?: string };

function rangePresets(): RangePreset[] {
  const now = new Date();
  const monthStart = toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1));
  const yearStart = toDateOnly(new Date(now.getFullYear(), 0, 1));
  const thirty = toDateOnly(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  return [
    { id: "any", label: "Any time" },
    { id: "month", label: "This month", range: `[${monthStart}` },
    { id: "30d", label: "Last 30 days", range: `[${thirty}` },
    { id: "year", label: "This year", range: `[${yearStart}` },
  ];
}

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "credit_card", label: "Card" },
  { value: "salary_add", label: "Income" },
  { value: "savings_add", label: "Savings in" },
  { value: "savings_move", label: "Savings move" },
  { value: "loan_add", label: "Loan" },
];

export default function TransactionsFilterSheet({
  open,
  onClose,
  filters,
  categories,
  onApply,
  onClear,
}: Props) {
  const toast = useToast();
  const [type, setType] = useState<TransactionType | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<string | undefined>(undefined);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const presets = useMemo(rangePresets, []);

  useEffect(() => {
    if (!open) return;
    setType(filters.type ?? null);
    setCategory(filters.category ?? null);
    setRange(filters.range);
    setMin(filters.min !== undefined ? String(filters.min) : "");
    setMax(filters.max !== undefined ? String(filters.max) : "");
  }, [open, filters]);

  function apply() {
    const next: TransactionFilters = {};
    if (type) next.type = type;
    if (category) next.category = category;
    if (range) next.range = range;
    const nMin = min.trim() ? Number(min) : NaN;
    const nMax = max.trim() ? Number(max) : NaN;
    if (Number.isFinite(nMin) && nMin >= 0) next.min = nMin;
    if (Number.isFinite(nMax) && nMax >= 0) next.max = nMax;
    if (next.min !== undefined && next.max !== undefined && next.min > next.max) {
      toast.error("Minimum can't be more than maximum.");
      return;
    }
    haptic("success");
    onApply(next);
    onClose();
  }

  const activeCount =
    (filters.type ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.range ? 1 : 0) +
    (filters.min !== undefined ? 1 : 0) +
    (filters.max !== undefined ? 1 : 0);

  return (
    <BottomSheet open={open} onClose={onClose} title="Filters" subtitle="Narrow down your history">
      <div className="space-y-6">
        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">When</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setRange(p.range)}
                className={`neo-chip ${range === p.range ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">Type</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setType(null)}
              className={`neo-chip ${type === null ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
            >
              All
            </button>
            {TYPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setType(o.value)}
                className={`neo-chip ${type === o.value ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">Category</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={`neo-chip ${category === null ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
            >
              Any
            </button>
            {(categories ?? [])
              .filter((c) => c.type === "expense" && !c.is_disabled && !c.parent_id)
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.name)}
                  className={`neo-chip ${category === c.name ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">Amount</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate mb-1 block">Minimum (₹)</span>
              <input
                inputMode="decimal"
                value={min}
                onChange={(e) => setMin(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                className="field"
                aria-label="Minimum amount"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate mb-1 block">Maximum (₹)</span>
              <input
                inputMode="decimal"
                value={max}
                onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="Any"
                className="field"
                aria-label="Maximum amount"
              />
            </label>
          </div>
        </div>

        <div className="flex gap-3">
          {activeCount > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                setType(null);
                setCategory(null);
                setRange(undefined);
                setMin("");
                setMax("");
                onClear();
                onClose();
              }}
              className="flex-1"
            >
              Clear all
            </Button>
          )}
          <Button variant="primary" onClick={apply} className={activeCount > 0 ? "flex-1" : "w-full"} icon="check">
            Apply filters
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
