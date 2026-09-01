import { describe, it, expect } from "vitest";

/**
 * Behavioral model of the credit-card RPCs from
 * supabase/migrations/20260912000000_credit_cards.sql.
 *
 * It mirrors the migration's semantics exactly (validation order, ownership
 * scoping to auth.uid(), per-card net outstanding, available credit, and the
 * salary/savings accounting) so the feature's behaviour is pinned down
 * independently of the PostgreSQL runtime used by the contract tests in
 * credit-cards.db.test.ts.
 */

const ERRORS = {
  invalidAmount: "invalid_amount",
  invalidSource: "invalid_source",
  invalidCardName: "invalid_card_name",
  invalidCreditLimit: "invalid_credit_limit",
  invalidBillingDay: "invalid_billing_day",
  cardNotFound: "card_not_found",
  cardHasTransactions: "card_has_transactions",
  limitBelowOutstanding: "limit_below_outstanding",
  creditLimitExceeded: "credit_limit_exceeded",
  profileNotFound: "profile_not_found",
  insufficientBalance: "insufficient_balance",
  paymentExceedsOutstanding: "payment_exceeds_outstanding",
} as const;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

interface Card {
  id: string;
  userId: string;
  name: string;
  creditLimit: number;
  billingDay: number;
  createdAt: number;
}

type LedgerType = "credit_card" | "credit_card_payment" | "expense";

interface LedgerRow {
  userId: string;
  cardId: string | null;
  type: LedgerType;
  amount: number;
  createdAt: number;
  category?: string;
  subcategory?: string;
  note?: string;
}

interface Profile {
  salaryBalance: number;
  savingsBalance: number;
  monthlyBudget: number;
}

class Models {
  cards: Card[] = [];
  ledger: LedgerRow[] = [];
  profiles = new Map<string, Profile>();
  private seq = 0;

  profile(userId: string): Profile {
    let p = this.profiles.get(userId);
    if (!p) {
      p = { salaryBalance: 0, savingsBalance: 0, monthlyBudget: 0 };
      this.profiles.set(userId, p);
    }
    return p;
  }

  outstanding(cardId: string): number {
    return this.ledger
      .filter((l) => l.cardId === cardId)
      .reduce((s, l) => s + (l.type === "credit_card_payment" ? -l.amount : l.amount), 0);
  }

  available(cardId: string): number {
    const c = this.cards.find((c) => c.id === cardId);
    if (!c) return 0;
    return Math.max(0, c.creditLimit - this.outstanding(cardId));
  }

  monthSpent(userId: string, now: Date): number {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return this.ledger
      .filter(
        (l) =>
          l.userId === userId &&
          l.type !== "credit_card_payment" &&
          l.createdAt >= start
      )
      .reduce((s, l) => s + l.amount, 0);
  }

  listFor(userId: string) {
    return this.cards
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({
        ...c,
        outstanding: this.outstanding(c.id),
        available: this.available(c.id),
      }));
  }
}

function createCard(
  m: Models,
  userId: string,
  name: string,
  creditLimit: number,
  billingDay: number,
  now: Date
): Result<Card> {
  if (name == null || name.trim().length === 0) return { ok: false, error: ERRORS.invalidCardName };
  if (creditLimit == null || creditLimit <= 0) return { ok: false, error: ERRORS.invalidCreditLimit };
  if (billingDay == null || billingDay < 1 || billingDay > 31) return { ok: false, error: ERRORS.invalidBillingDay };
  const card: Card = {
    id: `card-${++m.seq}`,
    userId,
    name: name.trim(),
    creditLimit,
    billingDay,
    createdAt: now.getTime(),
  };
  m.cards.push(card);
  return { ok: true, value: card };
}

function updateCard(
  m: Models,
  userId: string,
  cardId: string,
  name: string,
  creditLimit: number,
  billingDay: number
): Result<Card> {
  if (name == null || name.trim().length === 0) return { ok: false, error: ERRORS.invalidCardName };
  if (creditLimit == null || creditLimit <= 0) return { ok: false, error: ERRORS.invalidCreditLimit };
  if (billingDay == null || billingDay < 1 || billingDay > 31) return { ok: false, error: ERRORS.invalidBillingDay };
  const card = m.cards.find((c) => c.id === cardId && c.userId === userId);
  if (!card) return { ok: false, error: ERRORS.cardNotFound };
  if (creditLimit < m.outstanding(cardId)) return { ok: false, error: ERRORS.limitBelowOutstanding };
  card.name = name.trim();
  card.creditLimit = creditLimit;
  card.billingDay = billingDay;
  return { ok: true, value: card };
}

function deleteCard(m: Models, userId: string, cardId: string): Result<null> {
  const card = m.cards.find((c) => c.id === cardId && c.userId === userId);
  if (!card) return { ok: false, error: ERRORS.cardNotFound };
  const hasTxn = m.ledger.some((l) => l.cardId === cardId);
  if (hasTxn) return { ok: false, error: ERRORS.cardHasTransactions };
  m.cards = m.cards.filter((c) => c.id !== cardId);
  return { ok: true, value: null };
}

interface ChargeOpts {
  category?: string;
  subcategory?: string;
  note?: string;
}

function chargeCard(
  m: Models,
  userId: string,
  cardId: string,
  amount: number,
  opts: ChargeOpts,
  now: Date
): Result<{ overspend: number; outstanding: number }> {
  if (amount == null || amount <= 0) return { ok: false, error: ERRORS.invalidAmount };
  const card = m.cards.find((c) => c.id === cardId && c.userId === userId);
  if (!card) return { ok: false, error: ERRORS.cardNotFound };
  const outstanding = m.outstanding(cardId);
  if (amount > card.creditLimit - outstanding) return { ok: false, error: ERRORS.creditLimitExceeded };
  if (!m.profiles.has(userId)) return { ok: false, error: ERRORS.profileNotFound };
  const spent = m.monthSpent(userId, now);
  const overspend = Math.max(0, spent + amount - Math.max(m.profile(userId).monthlyBudget, spent));
  m.ledger.push({
    userId,
    cardId,
    type: "credit_card",
    amount,
    createdAt: now.getTime(),
    category: opts.category,
    subcategory: opts.subcategory,
    note: opts.note,
  });
  return { ok: true, value: { overspend, outstanding: outstanding + amount } };
}

function payCardBill(
  m: Models,
  userId: string,
  cardId: string,
  amount: number,
  source: string,
  now: Date
): Result<{ outstanding: number; source: string }> {
  if (source !== "salary" && source !== "savings") return { ok: false, error: ERRORS.invalidSource };
  if (amount == null || amount <= 0) return { ok: false, error: ERRORS.invalidAmount };
  const card = m.cards.find((c) => c.id === cardId && c.userId === userId);
  if (!card) return { ok: false, error: ERRORS.cardNotFound };
  const outstanding = m.outstanding(cardId);
  if (amount > outstanding) return { ok: false, error: ERRORS.paymentExceedsOutstanding };
  if (!m.profiles.has(userId)) return { ok: false, error: ERRORS.profileNotFound };
  const p = m.profile(userId);
  if (source === "salary") {
    if (p.salaryBalance < amount) return { ok: false, error: ERRORS.insufficientBalance };
    p.salaryBalance -= amount;
  } else {
    if (p.savingsBalance < amount) return { ok: false, error: ERRORS.insufficientBalance };
    p.savingsBalance -= amount;
  }
  m.ledger.push({
    userId,
    cardId,
    type: "credit_card_payment",
    amount,
    createdAt: now.getTime(),
    note: source,
  });
  return { ok: true, value: { outstanding: outstanding - amount, source } };
}

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected success, got ${r.error}`);
  return r.value;
}

describe("credit cards — card management", () => {
  it("creates one card", () => {
    const m = new Models();
    const c = ok(createCard(m, "u1", "HDFC Millennia", 50000, 15, new Date(2026, 5, 1)));
    expect(c).toMatchObject({ userId: "u1", name: "HDFC Millennia", creditLimit: 50000, billingDay: 15 });
    expect(m.listFor("u1")).toHaveLength(1);
    expect(m.listFor("u1")[0].outstanding).toBe(0);
    expect(m.listFor("u1")[0].available).toBe(50000);
  });

  it("creates multiple cards, listed in creation order", () => {
    const m = new Models();
    const t = (d: number) => new Date(2026, 5, d);
    ok(createCard(m, "u1", "SBI Cashback", 30000, 5, t(1)));
    ok(createCard(m, "u1", "HDFC Millennia", 50000, 15, t(2)));
    ok(createCard(m, "u1", "Axis Flipkart", 25000, 20, t(3)));
    const list = m.listFor("u1");
    expect(list.map((c) => c.name)).toEqual(["SBI Cashback", "HDFC Millennia", "Axis Flipkart"]);
  });

  it("rejects a blank name", () => {
    const m = new Models();
    expect(createCard(m, "u1", "   ", 50000, 15, new Date()).error).toBe(ERRORS.invalidCardName);
    expect(createCard(m, "u1", null as unknown as string, 50000, 15, new Date()).error).toBe(ERRORS.invalidCardName);
  });

  it("rejects a non-positive limit", () => {
    const m = new Models();
    expect(createCard(m, "u1", "Card", 0, 15, new Date()).error).toBe(ERRORS.invalidCreditLimit);
    expect(createCard(m, "u1", "Card", -1, 15, new Date()).error).toBe(ERRORS.invalidCreditLimit);
  });

  it("rejects an out-of-range billing day", () => {
    const m = new Models();
    expect(createCard(m, "u1", "Card", 50000, 0, new Date()).error).toBe(ERRORS.invalidBillingDay);
    expect(createCard(m, "u1", "Card", 50000, 32, new Date()).error).toBe(ERRORS.invalidBillingDay);
  });

  it("edits a card, trimming the name", () => {
    const m = new Models();
    const c = ok(createCard(m, "u1", "HDFC", 50000, 15, new Date()));
    const r = ok(updateCard(m, "u1", c.id, "  HDFC Millennia  ", 60000, 10));
    expect(r).toMatchObject({ name: "HDFC Millennia", creditLimit: 60000, billingDay: 10 });
  });

  it("refuses to lower a limit below the outstanding balance", () => {
    const m = new Models();
    const now = new Date(2026, 5, 1);
    m.profile("u1").monthlyBudget = 0;
    m.profile("u1").salaryBalance = 50000;
    const c = ok(createCard(m, "u1", "Card", 20000, 15, now));
    ok(chargeCard(m, "u1", c.id, 15000, {}, now));
    ok(payCardBill(m, "u1", c.id, 5000, "salary", now)); // net outstanding = 10,000
    expect(updateCard(m, "u1", c.id, "Card", 9999, 15).error).toBe(ERRORS.limitBelowOutstanding);
    expect(ok(updateCard(m, "u1", c.id, "Card", 10000, 15)).creditLimit).toBe(10000);
  });

  it("deletes a fresh card but protects a card with history", () => {
    const m = new Models();
    const now = new Date(2026, 5, 1);
    m.profile("u1").monthlyBudget = 0;
    const fresh = ok(createCard(m, "u1", "Fresh", 10000, 1, now));
    const used = ok(createCard(m, "u1", "Used", 10000, 1, now));
    ok(chargeCard(m, "u1", used.id, 500, {}, now));
    expect(deleteCard(m, "u1", fresh.id)).toEqual({ ok: true, value: null });
    expect(deleteCard(m, "u1", used.id).error).toBe(ERRORS.cardHasTransactions);
    expect(deleteCard(m, "u1", "card-fake").error).toBe(ERRORS.cardNotFound);
  });

  it(`treats another user's card as not found (card_not_found)`, () => {
    const m = new Models();
    const now = new Date(2026, 5, 1);
    const c = ok(createCard(m, "u1", "Card", 10000, 15, now));
    expect(chargeCard(m, "u2", c.id, 500, {}, now).error).toBe(ERRORS.cardNotFound);
    expect(payCardBill(m, "u2", c.id, 500, "salary", now).error).toBe(ERRORS.cardNotFound);
    expect(updateCard(m, "u2", c.id, "Card", 10000, 15).error).toBe(ERRORS.cardNotFound);
    expect(deleteCard(m, "u2", c.id).error).toBe(ERRORS.cardNotFound);
    expect(m.listFor("u2")).toHaveLength(0);
  });
});

describe("credit cards — per-card accounting", () => {
  function setup() {
    const m = new Models();
    m.profile("u1").salaryBalance = 50000;
    m.profile("u1").savingsBalance = 20000;
    m.profile("u1").monthlyBudget = 10000;
    return m;
  }

  const now = new Date(2026, 5, 1, 10);

  it("charges increase the card's outstanding and never touch salary", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    const salaryBefore = m.profile("u1").salaryBalance;
    const r = ok(chargeCard(m, "u1", c.id, 12500, { note: "laptop" }, now));
    expect(r.outstanding).toBe(12500);
    expect(m.outstanding(c.id)).toBe(12500);
    expect(m.profile("u1").salaryBalance).toBe(salaryBefore);
    expect(m.ledger.find((l) => l.cardId === c.id)?.note).toBe("laptop");
  });

  it("outstanding = Σ(credit) − Σ(payment) on the card", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 10000, {}, now));
    ok(chargeCard(m, "u1", c.id, 2000, {}, now));
    ok(chargeCard(m, "u1", c.id, 3000, {}, now));
    const r = payCardBill(m, "u1", c.id, 8000, "salary", now);
    expect(r).toMatchObject({ ok: true });
    expect(m.outstanding(c.id)).toBe(10000 + 2000 + 3000 - 8000);
  });

  it("available credit = limit − outstanding, never beyond the limit", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 20000, 15, now));
    expect(m.available(c.id)).toBe(20000);
    ok(chargeCard(m, "u1", c.id, 6000, {}, now));
    expect(m.available(c.id)).toBe(14000);
    // Paying restores available credit one-for-one (payments stored positive).
    ok(payCardBill(m, "u1", c.id, 1000, "salary", now));
    expect(m.available(c.id)).toBe(15000);
    const listed = m.listFor("u1")[0];
    expect(listed.available).toBeLessThanOrEqual(listed.creditLimit);
  });

  it("a full payment clears the card", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 12500, {}, now));
    const r = payCardBill(m, "u1", c.id, 12500, "salary", now);
    expect(r).toMatchObject({ ok: true, value: { outstanding: 0 } });
    expect(m.outstanding(c.id)).toBe(0);
    expect(m.available(c.id)).toBe(50000);
  });

  it("supports custom partial payments", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 12000, {}, now));
    const r = payCardBill(m, "u1", c.id, 2500, "salary", now);
    expect(r).toMatchObject({ ok: true, value: { outstanding: 9500 } });
    expect(m.outstanding(c.id)).toBe(9500);
  });

  it("accumulates multiple partial payments", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 12000, {}, now));
    ok(payCardBill(m, "u1", c.id, 2000, "salary", now));
    ok(payCardBill(m, "u1", c.id, 1000, "salary", now));
    ok(payCardBill(m, "u1", c.id, 500, "savings", now));
    expect(m.outstanding(c.id)).toBe(8500);
  });

  it("rejects a payment larger than the outstanding balance", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 10000, {}, now));
    expect(payCardBill(m, "u1", c.id, 10001, "salary", now).error).toBe(ERRORS.paymentExceedsOutstanding);
  });

  it("never lets outstanding go negative", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 5000, {}, now));
    ok(payCardBill(m, "u1", c.id, 5000, "salary", now));
    expect(m.outstanding(c.id)).toBe(0); // not −something
    expect(payCardBill(m, "u1", c.id, 1, "salary", now).error).toBe(ERRORS.paymentExceedsOutstanding);
  });

  it("a payment on Card A never changes Card B's outstanding", () => {
    const m = setup();
    const a = ok(createCard(m, "u1", "Card A", 50000, 15, now));
    const b = ok(createCard(m, "u1", "Card B", 30000, 5, now));
    ok(chargeCard(m, "u1", a.id, 10000, {}, now));
    ok(chargeCard(m, "u1", b.id, 7000, {}, now));
    ok(payCardBill(m, "u1", a.id, 3000, "salary", now));
    expect(m.outstanding(a.id)).toBe(7000);
    expect(m.outstanding(b.id)).toBe(7000);
    // Charging Card B uses Card B's own available credit only.
    expect(chargeCard(m, "u1", b.id, 25000, {}, now).error).toBe(ERRORS.creditLimitExceeded);
  });

  it("rejects a charge beyond the card's available credit", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 10000, 15, now));
    ok(chargeCard(m, "u1", c.id, 6000, {}, now));
    expect(chargeCard(m, "u1", c.id, 4001, {}, now).error).toBe(ERRORS.creditLimitExceeded);
    expect(ok(chargeCard(m, "u1", c.id, 4000, {}, now)).outstanding).toBe(10000);
    expect(chargeCard(m, "u1", c.id, 1, {}, now).error).toBe(ERRORS.creditLimitExceeded);
  });

  it("reports the over-budget excess on a charge without blocking it", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 8000, {}, now)); // spent 8k of 10k budget
    const r = ok(chargeCard(m, "u1", c.id, 3000, {}, now));
    expect(r.overspend).toBe(1000); // 11k − max(10k, 8k)
    expect(r.outstanding).toBe(11000);
  });

  it("deducts payments from the chosen pot (salary vs savings)", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 20000, {}, now));
    ok(payCardBill(m, "u1", c.id, 12000, "salary", now));
    ok(payCardBill(m, "u1", c.id, 3000, "savings", now));
    expect(m.profile("u1").salaryBalance).toBe(50000 - 12000);
    expect(m.profile("u1").savingsBalance).toBe(20000 - 3000);
    expect(m.ledger.filter((l) => l.cardId === c.id && l.type === "credit_card_payment").map((l) => l.note)).toEqual([
      "salary",
      "savings",
    ]);
  });

  it("rejects a payment the chosen pot cannot cover", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    m.profile("u1").salaryBalance = 5000;
    m.profile("u1").savingsBalance = 20000;
    ok(chargeCard(m, "u1", c.id, 20000, {}, now));
    // Outstanding is 20,000 so the amount passes the overpayment check; the
    // salary pot (5,000) is what blocks it.
    expect(payCardBill(m, "u1", c.id, 10000, "salary", now).error).toBe(ERRORS.insufficientBalance);
    expect(ok(payCardBill(m, "u1", c.id, 5000, "salary", now)).outstanding).toBe(15000);
    expect(m.profile("u1").salaryBalance).toBe(0);
    expect(ok(payCardBill(m, "u1", c.id, 15000, "savings", now)).outstanding).toBe(0);
  });

  it("rejects an invalid source and a non-positive amount", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 1000, {}, now));
    expect(payCardBill(m, "u1", c.id, 100, "credit", now).error).toBe(ERRORS.invalidSource);
    expect(payCardBill(m, "u1", c.id, 0, "salary", now).error).toBe(ERRORS.invalidAmount);
    expect(chargeCard(m, "u1", c.id, 0, {}, now).error).toBe(ERRORS.invalidAmount);
  });

  it("derives balances from the ledger so history edits reflect instantly", () => {
    const m = setup();
    const c = ok(createCard(m, "u1", "Card", 50000, 15, now));
    ok(chargeCard(m, "u1", c.id, 10000, {}, now));
    ok(chargeCard(m, "u1", c.id, 2000, {}, now));
    ok(payCardBill(m, "u1", c.id, 4000, "salary", now));
    expect(m.listFor("u1")[0].outstanding).toBe(8000);
    // Undo one charge (delete_transaction in the real app) → outstanding recomputed.
    m.ledger = m.ledger.filter((l) => !(l.cardId === c.id && l.amount === 2000));
    expect(m.listFor("u1")[0].outstanding).toBe(6000);
    expect(m.listFor("u1")[0].available).toBe(44000);
  });
});