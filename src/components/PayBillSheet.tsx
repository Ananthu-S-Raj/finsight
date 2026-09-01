"use client";

import { useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import Icon from "./ui/Icons";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import { payCreditCard } from "@/lib/finance";
import { payCardBill } from "@/lib/cards";
import { emitRefresh } from "@/lib/events";
import { inr } from "@/lib/format";

export type PaySource = "salary" | "savings";

export default function PayBillSheet({
  open,
  onClose,
  outstanding,
  accountBalance,
  savingsBalance,
  cardId,
  cardName,
}: {
  open: boolean;
  onClose: () => void;
  outstanding: number;
  accountBalance: number;
  savingsBalance: number;
  /** Present => pay down a single card (pay_card_bill); absent => legacy
      account-wide bill (pay_credit_card). */
  cardId?: string | null;
  cardName?: string | null;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<PaySource>("salary");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setError("");
    setSaving(false);
    setSource(accountBalance > 0 ? "salary" : "savings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (outstanding <= 0) return null;

  const available = source === "salary" ? accountBalance : savingsBalance;
  const quick = Math.min(outstanding, available) <= 0 ? [] : [Math.min(outstanding, available)];

  function submit() {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (value > outstanding) {
      setError("That's more than your outstanding card bill.");
      return;
    }
    if (value > available) {
      setError(`Not enough in ${source === "salary" ? "your account balance" : "savings"} to cover that.`);
      return;
    }
    setSaving(true);
    const op = cardId
      ? payCardBill(cardId, value, source)
      : payCreditCard(value, source);
    op.then((res) => {
      haptic("success");
      toast.success(
        cardName
          ? `Paid ${inr(value)} toward ${cardName}.`
          : `Paid ${inr(value)} toward your card bill.`
      );
      emitRefresh();
      onClose();
    })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "FinSight couldn't process that payment right now.");
      })
      .finally(() => setSaving(false));
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Pay card bill"
      subtitle={cardName ? `${inr(outstanding)} outstanding · ${cardName}` : `${inr(outstanding)} outstanding`}
    >
      <div className="space-y-6">
        <div>
          <p className="field-label">Amount</p>
          <div className="relative">
            <span className="pointer-events-none select-none absolute left-4 top-1/2 -translate-y-1/2 w-6 text-center text-lg font-semibold text-slate" aria-hidden="true">
              ₹
            </span>
            <input
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              className="field !pl-12 text-2xl font-semibold tabular tracking-tight"
              aria-label="Payment amount"
            />
          </div>
          {quick.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {quick.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setAmount(String(n));
                  }}
                  className="neo-chip"
                >
                  Pay full {inr(n)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-widest text-slate mb-3 font-medium">
            Pay from
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setSource("salary");
                haptic("light");
              }}
              aria-pressed={source === "salary"}
              className={`neo-chip !py-3 ${source === "salary" ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
            >
              <span className="block text-sm">Account balance</span>
              <span className="block text-[12px] text-slate tabular mt-0.5">{inr(accountBalance)}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSource("savings");
                haptic("light");
              }}
              aria-pressed={source === "savings"}
              className={`neo-chip !py-3 ${source === "savings" ? "!text-snow !border-accent/50 shadow-glow-accent" : ""}`}
            >
              <span className="block text-sm">Savings</span>
              <span className="block text-[12px] text-slate tabular mt-0.5">{inr(savingsBalance)}</span>
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger flex items-center gap-2">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <Button
          variant="primary"
          full
          disabled={saving || outstanding <= 0}
          onClick={submit}
          icon="check"
          iconSize={18}
          className="!py-4 !text-base"
        >
          {saving ? "Paying…" : `Pay ${amount ? inr(Number(amount)) : "bill"}`}
        </Button>
      </div>
    </BottomSheet>
  );
}
