"use client";

import { useEffect, useState } from "react";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import Icon from "./ui/Icons";
import { haptic } from "@/lib/haptics";
import { useToast } from "./ui/ToastProvider";
import {
  createCreditCard,
  updateCreditCard,
  type CreditCardWithBalance,
} from "@/lib/cards";
import { emitRefresh } from "@/lib/events";

export default function CardFormSheet({
  open,
  onClose,
  card,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the sheet edits this card; otherwise it creates a new one. */
  card?: CreditCardWithBalance | null;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [billingDay, setBillingDay] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(card);

  useEffect(() => {
    if (!open) return;
    setName(card?.name ?? "");
    setLimit(card ? String(card.credit_limit) : "");
    setBillingDay(card ? String(card.billing_day) : "");
    setError("");
    setSaving(false);
  }, [open, card]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a card name.");
      return;
    }
    const limitValue = Number(limit);
    if (!Number.isFinite(limitValue) || limitValue <= 0) {
      setError("Credit limit must be greater than zero.");
      return;
    }
    const day = Number(billingDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setError("Billing day must be between 1 and 31.");
      return;
    }

    setSaving(true);
    const op = card
      ? updateCreditCard(card.id, { name: trimmed, creditLimit: limitValue, billingDay: day })
      : createCreditCard({ name: trimmed, creditLimit: limitValue, billingDay: day });

    op.then(() => {
      haptic("success");
      toast.success(card ? "Card updated." : "Card added.");
      emitRefresh();
      onClose();
    })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "FinSight couldn't save that card.");
      })
      .finally(() => setSaving(false));
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit card" : "Add credit card"}
      subtitle={editing ? `Manage ${card?.name ?? ""}` : "Track a card's limit and bill separately"}
    >
      <div className="space-y-6">
        <div>
          <p className="field-label">Card name</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. HDFC Millennia"
            autoComplete="off"
            className="field"
            aria-label="Card name"
          />
        </div>

        <div>
          <p className="field-label">Credit limit</p>
          <div className="relative">
            <span
              className="pointer-events-none select-none absolute left-4 top-1/2 -translate-y-1/2 w-6 text-center text-lg font-semibold text-slate"
              aria-hidden="true"
            >
              ₹
            </span>
            <input
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              className="field !pl-12 text-2xl font-semibold tabular tracking-tight"
              aria-label="Credit limit"
            />
          </div>
        </div>

        <div>
          <p className="field-label">Billing day</p>
          <input
            inputMode="numeric"
            maxLength={2}
            value={billingDay}
            onChange={(e) => setBillingDay(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="15"
            className="field"
            aria-label="Billing day"
          />
          <p className="text-[13px] text-slate mt-1.5">
            Day of the month your bill is generated (1–31). Reminders can use
            this later.
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger flex items-center gap-2">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <Button
          variant="primary"
          full
          disabled={saving}
          onClick={submit}
          icon="check"
          iconSize={18}
          className="!py-4 !text-base"
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Add card"}
        </Button>
      </div>
    </BottomSheet>
  );
}