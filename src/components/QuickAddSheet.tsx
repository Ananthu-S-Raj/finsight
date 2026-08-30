"use client";

import { useCallback, useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import SegmentedControl from "./ui/SegmentedControl";
import Icon, { type IconName } from "./ui/Icons";
import Button from "./ui/Button";
import { useToast } from "./ui/ToastProvider";
import { CATEGORY_PRESETS } from "@/lib/finance";
import {
  addSalary,
  addSavingsDirect,
  addLoan,
  moveToSavings,
  recordSpend,
} from "@/lib/finance";
import { getRecentMerchants } from "@/lib/analytics";
import { useCategories } from "@/lib/useCategories";
import { toCategoryOptions, type CategoryOption } from "@/lib/categories";
import { emitRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";

export type AddMode = "expense" | "income" | "transfer" | "savings" | "credit";

const CATEGORY_ICONS: Record<string, IconName> = {
  Food: "bank",
  Travel: "calendar",
  Shopping: "tag",
  Other: "coins",
  Salary: "income",
  Savings: "piggy",
  Loan: "coins",
};

const QUICK_AMOUNTS = [100, 200, 500, 1000];

interface QuickAddSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  initialMode?: AddMode;
}

type FlowMode = "expense" | "income" | "transfer";
type IncomeKind = "salary" | "savings" | "loan";

/**
 * Maps the entry mode to the sheet's concrete flow + income kind.
 *
 * "savings" (Add to savings from the Savings page / empty state) must open the
 * income flow pre-selected on the Savings type so a user with no existing
 * savings can set their initial amount. Previously "savings" fell through to
 * the expense flow, making initial custom savings impossible to add from the
 * Savings page.
 */
function resolveEntryMode(
  initialMode: AddMode
): { flow: FlowMode; incomeKind: IncomeKind } {
  switch (initialMode) {
    case "transfer":
      return { flow: "transfer", incomeKind: "salary" };
    case "income":
    case "savings":
      return {
        flow: "income",
        incomeKind: initialMode === "savings" ? "savings" : "salary",
      };
    default:
      return { flow: "expense", incomeKind: "salary" };
  }
}

export default function QuickAddSheet({
  open,
  onClose,
  userId,
  initialMode = "expense",
}: QuickAddSheetProps) {
  const toast = useToast();
  const { categories } = useCategories(userId);

  const canonicalOptions = toCategoryOptions(categories ?? []);
  const categoryOptions =
    canonicalOptions.length > 0
      ? canonicalOptions
      : Object.keys(CATEGORY_PRESETS).map((name) => ({
          id: null as string | null,
          name,
          children: CATEGORY_PRESETS[name],
        }));

  const [flow, setFlow] = useState<FlowMode>(resolveEntryMode(initialMode).flow);
  const [category, setCategory] = useState("Food");
  const [subcategory, setSubcategory] = useState(
    categoryOptions.find((o) => o.name === "Food")?.children[0] ?? CATEGORY_PRESETS.Food[0] ?? "Restaurants"
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isCreditCard, setIsCreditCard] = useState(initialMode === "credit");
  const [incomeKind, setIncomeKind] = useState<IncomeKind>(resolveEntryMode(initialMode).incomeKind);
  const [recentMerchants, setRecentMerchants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const presets = categoryOptions.find((o) => o.name === category)?.children ?? [];
  const chips = recentMerchants.length > 0 ? [...recentMerchants, ...presets.filter((p) => !recentMerchants.includes(p))] : presets;

  useEffect(() => {
    if (open && userId) {
      setAmount("");
      setNote("");
      setError("");
      setIsCreditCard(initialMode === "credit");
      const entry = resolveEntryMode(initialMode);
      setFlow(entry.flow);
      setIncomeKind(entry.incomeKind);
      getRecentMerchants(userId)
        .then(setRecentMerchants)
        .catch(() => setRecentMerchants([]));
    }
  }, [open, userId, initialMode]);

  const selectCategory = useCallback(
    (c: CategoryOption) => {
      setCategory(c.name);
      setSubcategory(c.children[0] ?? "Other");
    },
    []
  );

  async function submit() {
    const n = Number(amount);
    if (!n || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (flow === "expense") {
        const { overspendAmount } = await recordSpend(userId, {
          category,
          subcategory: subcategory || "Other",
          amount: n,
          note,
          isCreditCard,
        });
        if (overspendAmount > 0) {
          toast.warning(`You're ₹${Math.round(overspendAmount)} over budget this month.`);
          playSound("budgetWarning");
        } else {
          toast.success(isCreditCard ? "Card charge logged." : "Expense added.");
          playSound("success");
        }
      } else if (flow === "income") {
        if (incomeKind === "salary") {
          await addSalary(userId, n, note);
          toast.success("Salary added.");
          playSound("income");
        } else if (incomeKind === "savings") {
          await addSavingsDirect(userId, n, note);
          toast.success("Savings added.");
          playSound("success");
        } else {
          if (!note.trim()) {
            setError("Who lent you this money?");
            setLoading(false);
            return;
          }
          await addLoan(userId, n, note.trim());
          toast.success("Loan received.");
          playSound("income");
        }
      } else {
        try {
          await moveToSavings(userId, n);
          toast.success("Moved to savings.");
          playSound("transfer");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't move that amount.");
          setLoading(false);
          return;
        }
      }
      haptic("success");
      emitRefresh();
      onClose();
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[QuickAdd submit]", err);
      }
      setError(
        err instanceof Error
          ? err.message
          : "FinSight couldn't save that right now."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Quick add"
      subtitle="Log money in a few taps"
    >
      <SegmentedControl
        label="Transaction type"
        value={flow}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
          { value: "transfer", label: "Transfer" },
        ]}
        onChange={(v) => {
          haptic("light");
          setFlow(v);
          setError("");
        }}
      />

      <div className="mt-6 space-y-6">
        {/* Amount first — type the number, then pick category/merchant. */}
        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate mb-2 font-medium">
            Amount
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate" aria-hidden="true">
              ₹
            </span>
            <input
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="0"
              className="field !py-4 !pl-14 text-4xl font-semibold tabular tracking-tight"
              aria-label="Amount"
            />
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(String(a))}
                className="neo-chip"
              >
                ₹{a}
              </button>
            ))}
          </div>
        </div>

        {flow === "expense" && (
          <>
            <div>
              <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">
                Category
              </p>
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

            <div>
              <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">
                Where
              </p>
              <div className="flex flex-wrap gap-2">
                {chips.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubcategory(s)}
                    className={`neo-chip ${subcategory === s ? "!text-snow !border-accent2/50 shadow-glow-indigo" : ""}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-frost">Paid by credit card</span>
              <input
                type="checkbox"
                checked={isCreditCard}
                onChange={(e) => {
                  setIsCreditCard(e.target.checked);
                  haptic("toggle");
                }}
                className="sr-only peer"
              />
              {/* The label forwards clicks to the checkbox, which is the single
                  source of truth for the toggle state. No separate onClick on
                  the visual switch: a second handler caused a double-toggle
                  (span + label → checkbox), making the state unreliable. */}
              <span
                className={`switch ${isCreditCard ? "" : ""}`}
                data-on={isCreditCard}
                role="switch"
                aria-checked={isCreditCard}
              />
            </label>
          </>
        )}

        {flow === "income" && (
          <>
            <div>
              <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">
                Type
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["salary", "savings", "loan"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setIncomeKind(k);
                      haptic("light");
                    }}
                    className={`neo-chip justify-center ${incomeKind === k ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
                  >
                    <Icon name={k === "salary" ? "income" : k === "savings" ? "piggy" : "coins"} size={15} />
                    {k[0].toUpperCase() + k.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {incomeKind === "loan" && (
              <p className="text-sm text-slate">
                From whom? Add their name as the note below — it&apos;s shown in
                your history.
              </p>
            )}
          </>
        )}

        {flow === "transfer" && (
          <div className="rounded-2xl neo-inset p-4 flex items-center gap-3 text-sm text-slate">
            <Icon name="transfer" size={18} className="text-accent" />
            Moves money from your spendable balance into savings.
          </div>
        )}

        {(flow === "expense" || flow === "income") && (
          <label className="block">
            <p className="text-[13px] uppercase tracking-widest text-slate mb-2 font-medium">
              {flow === "expense" ? "Note (optional)" : incomeKind === "loan" ? "From whom? (required)" : "Note (optional)"}
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="field"
              placeholder={flow === "expense" ? "e.g. dinner with friends" : "e.g. June salary"}
              autoComplete="off"
            />
          </label>
        )}

        {error && (
          <p className="text-sm text-danger flex items-center gap-2">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <Button
          variant="primary"
          full
          disabled={loading}
          onClick={submit}
          icon="check"
          iconSize={18}
          className="!py-4 !text-base"
        >
          {loading
            ? "Saving…"
            : flow === "expense"
              ? isCreditCard
                ? "Log card charge"
                : "Add expense"
              : flow === "income"
                ? "Add income"
                : "Move to savings"}
        </Button>
      </div>
    </BottomSheet>
  );
}
