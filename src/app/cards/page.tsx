"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import TransactionRow from "@/components/TransactionRow";
import TransactionDetailSheet from "@/components/TransactionDetailSheet";
import PayBillSheet from "@/components/PayBillSheet";
import CardFormSheet from "@/components/CardFormSheet";
import { BalanceSkeleton } from "@/components/ui/Skeleton";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { useCreditCards, deleteCreditCard, type CreditCardWithBalance } from "@/lib/cards";
import { useToast } from "@/components/ui/ToastProvider";
import { emitRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";
import { inr, monthName } from "@/lib/format";
import type { Transaction } from "@/lib/finance";

export default function CardsPage() {
  const userId = useRequireAuth();
  const { profile, txns, loading } = usePageData(userId, 200);
  const { cards } = useCreditCards();
  const toast = useToast();

  const [selected, setSelected] = useState<Transaction | null>(null);
  const [payCard, setPayCard] = useState<CreditCardWithBalance | null>(null);
  const [formCard, setFormCard] = useState<CreditCardWithBalance | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<CreditCardWithBalance | null>(null);

  useEffect(() => {
    document.title = "Credit Cards · FinSight";
  }, []);

  // Legacy account-wide view when the user has no dedicated cards: preserve the
  // original single "virtual card" experience exactly as before.
  const legacy = useMemo(() => {
    const charges = txns.filter((t) => t.type === "credit_card");
    const payments = txns.filter((t) => t.type === "credit_card_payment");
    const outstanding = charges.reduce((s, t) => s + Number(t.amount), 0) - payments.reduce((s, t) => s + Number(t.amount), 0);
    const sum = (rows: Transaction[]) => rows.reduce((s, t) => s + Number(t.amount), 0);
    return { outstanding, charges, payments, thisMonth: sum(charges), paid: sum(payments) };
  }, [txns]);

  const totalOutstanding = cards.reduce((s, c) => s + c.outstanding, 0);

  function requestDelete(card: CreditCardWithBalance) {
    setConfirmDelete(card);
  }

  function confirmDeleteCard() {
    if (!confirmDelete) return;
    deleteCreditCard(confirmDelete.id)
      .then(() => {
        haptic("success");
        toast.success("Card deleted.");
        emitRefresh();
        setConfirmDelete(null);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "FinSight couldn't delete that card.");
        setConfirmDelete(null);
      });
  }

  const busy = loading && !profile;

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader
        title="Credit Cards"
        subtitle={cards.length > 0 ? `${cards.length} card${cards.length === 1 ? "" : "s"} · ${monthName(new Date())}.` : `Card spending in ${monthName(new Date())}.`}
        icon="card"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setFormCard(null)}>
            Add credit card
          </Button>
        }
      />

      {busy ? (
        <BalanceSkeleton />
      ) : (
        <div className="space-y-5 animate-fade-up">
          {cards.length === 0 && (
            <>
              {/* Legacy single virtual card — unchanged visual. */}
              <section
                className="relative overflow-hidden rounded-3xl p-6 aspect-[1.65/1] max-w-md"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(99,102,241,0.28), rgba(16,185,129,0.14)), #101826",
                  border: "1px solid rgba(255,255,255,0.12)",
                  boxShadow:
                    "0 1px 0 rgba(255,255,255,0.12) inset, 0 30px 60px -30px rgba(0,0,0,0.9)",
                }}
              >
                <div className="hero-sheen" aria-hidden="true" />
                <div className="relative flex flex-col justify-between h-full">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-frost">
                      <Icon name="creditCard" size={20} />
                      <span className="font-semibold tracking-widest text-sm">FINSIGHT CARD</span>
                    </span>
                    <Icon name="shield" size={18} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-[13px] uppercase tracking-widest text-slate mb-1">
                      Spent this month
                    </p>
                    <p className="text-3xl font-bold text-snow tabular">{inr(legacy.thisMonth)}</p>
                  </div>
                  <div className="flex items-center justify-between text-[13px] text-slate">
                    <span>Tap a charge below for details</span>
                    <span className="tabular">no limit set</span>
                  </div>
                </div>
              </section>

              {legacy.charges.length === 0 && legacy.payments.length === 0 && (
                <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                  <span className="h-14 w-14 rounded-2xl glass inline-flex items-center justify-center text-slate">
                    <Icon name="card" size={24} />
                  </span>
                  <p className="font-semibold text-snow">No card charges yet</p>
                  <p className="text-sm text-slate max-w-xs">
                    Add a card to track its limit and bill, or keep logging card
                    purchases with the button above.
                  </p>
                </GlassCard>
              )}

              {legacy.outstanding > 0 && (
                <GlassCard className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[13px] uppercase tracking-widest text-slate mb-1">
                        Outstanding bill
                      </p>
                      <p className="text-2xl font-bold text-snow tabular">{inr(legacy.outstanding)}</p>
                      <p className="text-[13px] text-slate mt-1.5">
                        Payable from{" "}
                        <span className="text-snow">account {inr(profile?.salary_balance ?? 0)}</span>
                        {" · "}
                        <span className="text-snow">savings {inr(profile?.savings_balance ?? 0)}</span>
                      </p>
                    </div>
                    <Button variant="primary" icon="check" onClick={() => setPayCard({ outstanding: legacy.outstanding } as CreditCardWithBalance)}>
                      Pay bill
                    </Button>
                  </div>
                  {legacy.payments.length > 0 && (
                    <p className="text-[13px] text-slate mt-3">
                      {inr(legacy.paid)} already paid.
                    </p>
                  )}
                </GlassCard>
              )}
            </>
          )}

          {/* Always show the multi-card management UI once a card exists. */}
          {cards.length > 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {cards.map((card) => (
                  <GlassCard key={card.id} className="p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon name="creditCard" size={18} className="text-accent" />
                        <span className="font-semibold text-snow truncate">{card.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" icon="edit" iconSize={16} aria-label={`Edit ${card.name}`} onClick={() => setFormCard(card)} />
                        <Button variant="ghost" icon="trash" iconSize={16} aria-label={`Delete ${card.name}`} onClick={() => requestDelete(card)} />
                      </div>
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[12px] uppercase tracking-widest text-slate mb-1">
                          Outstanding
                        </p>
                        <p className="text-xl font-bold text-snow tabular">{inr(card.outstanding)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] uppercase tracking-widest text-slate mb-1">
                          Available
                        </p>
                        <p className="text-xl font-bold text-snow tabular">{inr(card.available)}</p>
                      </div>
                    </div>

                    <div className="text-[13px] text-slate">
                      Limit <span className="text-snow tabular">{inr(card.credit_limit)}</span>
                      {" · Billing day "}
                      <span className="text-snow">{card.billing_day}</span>
                    </div>

                    {card.outstanding > 0 ? (
                      <Button variant="primary" full icon="check" onClick={() => setPayCard(card)}>
                        Pay bill
                      </Button>
                    ) : (
                      <Button variant="neo" full icon="check" disabled>
                        No outstanding
                      </Button>
                    )}
                  </GlassCard>
                ))}
              </div>

              {totalOutstanding > 0 && (
                <GlassCard className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[13px] uppercase tracking-widest text-slate mb-1">
                        Total outstanding
                      </p>
                      <p className="text-2xl font-bold text-snow tabular">{inr(totalOutstanding)}</p>
                    </div>
                  </div>
                </GlassCard>
              )}
            </>
          )}

          {/* Per-card activity */}
          {cards.map((card) => {
            const rows = txns
              .filter((t) => t.card_id === card.id && (t.type === "credit_card" || t.type === "credit_card_payment"))
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            if (rows.length === 0) return null;
            return (
              <section key={card.id}>
                <h2 className="text-sm font-semibold text-frost uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Icon name="transactions" size={16} className="text-warn" />
                  {card.name} activity
                </h2>
                <div className="space-y-2.5">
                  {rows.map((t) => (
                    <TransactionRow key={t.id} tx={t} onOpen={setSelected} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Legacy activity that isn't tied to a card (bills paid as credit,
              pre-card charges). Kept visible so nothing disappears. */}
          {(() => {
            const orphan = txns.filter((t) => !t.card_id && (t.type === "credit_card" || t.type === "credit_card_payment"));
            if (cards.length === 0 || orphan.length === 0) return null;
            return (
              <section>
                <h2 className="text-sm font-semibold text-frost uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Icon name="transactions" size={16} className="text-warn" />
                  Other card activity
                </h2>
                <div className="space-y-2.5">
                  {orphan
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((t) => (
                      <TransactionRow key={t.id} tx={t} onOpen={setSelected} />
                    ))}
                </div>
              </section>
            );
          })()}
        </div>
      )}

      <PayBillSheet
        open={payCard !== null}
        onClose={() => setPayCard(null)}
        outstanding={payCard?.outstanding ?? 0}
        accountBalance={profile?.salary_balance ?? 0}
        savingsBalance={profile?.savings_balance ?? 0}
        cardId={payCard ? (cards.some((c) => c.id === payCard.id) ? payCard.id : null) : undefined}
        cardName={payCard && cards.some((c) => c.id === payCard.id) ? cards.find((c) => c.id === payCard.id)!.name : null}
      />

      <CardFormSheet
        open={formCard !== undefined}
        onClose={() => setFormCard(undefined)}
        card={formCard ?? null}
      />

      {confirmDelete && (
        <GlassCard className="fixed inset-0 z-50 m-auto h-fit max-w-sm p-6 space-y-4">
          <p className="font-semibold text-snow">Delete “{confirmDelete.name}”?</p>
          <p className="text-sm text-slate">This can&apos;t be undone.</p>
          <div className="flex gap-2">
            <Button variant="ghost" full onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" full onClick={confirmDeleteCard}>
              Delete
            </Button>
          </div>
        </GlassCard>
      )}

      <TransactionDetailSheet
        tx={selected}
        onClose={() => setSelected(null)}
        userId={userId!}
      />
    </AppShell>
  );
}
