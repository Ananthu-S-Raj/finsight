"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "./ui/Icons";
import Button from "./ui/Button";
import GlassCard from "./ui/GlassCard";
import CardFormSheet from "./CardFormSheet";
import PayBillSheet from "./PayBillSheet";
import { useCreditCards, type CreditCardWithBalance } from "@/lib/cards";
import { inr } from "@/lib/format";

/**
 * Dashboard widget for credit card management. Reuses the shared card data
 * hook, form sheet and pay sheet — no admin privilege required. Balancing
 * (outstanding/available) is derived server-side by list_credit_cards.
 */
export default function CreditCardsSection({
  accountBalance,
  savingsBalance,
}: {
  accountBalance: number;
  savingsBalance: number;
}) {
  const { cards, loading } = useCreditCards();
  const [formCard, setFormCard] = useState<CreditCardWithBalance | null | undefined>(undefined);
  const [payCard, setPayCard] = useState<CreditCardWithBalance | null>(null);

  const totalOutstanding = cards.reduce((s, c) => s + c.outstanding, 0);

  return (
    <section aria-label="Credit Cards">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-frost uppercase tracking-wider flex items-center gap-2">
          <Icon name="card" size={16} className="text-warn" />
          Credit Cards
          {totalOutstanding > 0 && (
            <span className="text-[12px] font-medium text-slate lowercase tabular">
              · {inr(totalOutstanding)} outstanding
            </span>
          )}
        </h2>
        <Link href="/cards" className="text-sm text-slate hover:text-snow flex items-center gap-1">
          Manage <Icon name="chevronRight" size={14} />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="glass-soft rounded-2xl h-[76px] animate-pulse" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="glass-soft rounded-2xl p-4 flex items-center gap-4">
          <span
            className="h-11 w-11 rounded-2xl inline-flex items-center justify-center shrink-0"
            style={{ background: "#f59e0b1a", color: "#f59e0b" }}
          >
            <Icon name="creditCard" size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-snow">No cards yet</p>
            <p className="text-[13px] text-slate mt-0.5">
              Track a card&apos;s limit and bill from here.
            </p>
          </div>
          <Button
            variant="primary"
            icon="plus"
            aria-label="Add credit card"
            className="shrink-0"
            onClick={() => setFormCard(null)}
          >
            Add
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {cards.map((card) => (
            <GlassCard key={card.id} className="p-4 flex items-center gap-3.5" hover>
              <span
                className="shrink-0 h-10 w-10 rounded-xl inline-flex items-center justify-center"
                style={{ background: "#f59e0b1a", color: "#f59e0b" }}
              >
                <Icon name="creditCard" size={18} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-snow truncate">{card.name}</p>
                <p className="text-[13px] text-slate tabular">
                  {inr(card.outstanding)} owed · {inr(card.available)} available
                </p>
              </div>
              {card.outstanding > 0 ? (
                <Button
                  variant="primary"
                  icon="check"
                  className="btn-sm shrink-0"
                  onClick={() => setPayCard(card)}
                >
                  Pay bill
                </Button>
              ) : (
                <Button variant="neo" icon="check" disabled className="btn-sm shrink-0">
                  Clear
                </Button>
              )}
            </GlassCard>
          ))}
          <button
            type="button"
            onClick={() => setFormCard(null)}
            className="w-full rounded-2xl border border-dashed border-slate/40 p-3 flex items-center justify-center gap-2 text-[13px] font-semibold text-slate hover:text-snow hover:border-accent/50 transition-colors"
          >
            <Icon name="plus" size={15} /> Add credit card
          </button>
        </div>
      )}

      <CardFormSheet
        open={formCard !== undefined}
        onClose={() => setFormCard(undefined)}
        card={formCard ?? null}
      />

      <PayBillSheet
        open={payCard !== null}
        onClose={() => setPayCard(null)}
        outstanding={payCard?.outstanding ?? 0}
        accountBalance={accountBalance}
        savingsBalance={savingsBalance}
        cardId={payCard ? payCard.id : undefined}
        cardName={payCard ? payCard.name : null}
      />
    </section>
  );
}
