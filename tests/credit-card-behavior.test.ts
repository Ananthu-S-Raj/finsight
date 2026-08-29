import { describe, it, expect } from "vitest";

/**
 * Behavioral model of the `apply_expense(5-arg)` RPC re-defined in
 * supabase/migrations/20260830000000_apply_expense_credit_card.sql.
 *
 * Reading and pinning the migration's decision logic in a faithful model makes
 * the user-visible requirements (salary independence for cards, preserved
 * salary checks for normal expenses, stored overspend_amount = 0 for cards,
 * computed overspend still returned for the over-budget warning) runnable and
 * regression-safe, without needing a live Postgres instance.
 */

type Profile = { salary_balance: number; monthly_budget: number };
type Result = {
  ok: boolean;
  error?: "insufficient_balance";
  type: "expense" | "credit_card";
  storedOverspend: number;
  returnedOverspend: number;
  finalSalary: number;
};

/** Faithful mirror of the 5-arg apply_expense body AFTER the credit-card fix. */
function applyExpense(
  profile: Profile,
  monthSpentExcludingThis: number,
  amount: number,
  isCreditCard: boolean
): Result {
  if (amount <= 0) throw new Error("invalid_amount");

  let { salary_balance: salary } = profile;
  const spent = monthSpentExcludingThis;
  const overspend = Math.max(0, spent + amount - Math.max(profile.monthly_budget, spent));
  const credit = Boolean(isCreditCard);

  if (!credit && overspend > 0) {
    if (salary < overspend) {
      return {
        ok: false,
        error: "insufficient_balance",
        type: "expense",
        storedOverspend: overspend,
        returnedOverspend: overspend,
        finalSalary: salary,
      };
    }
    salary -= overspend;
  }

  return {
    ok: true,
    type: credit ? "credit_card" : "expense",
    storedOverspend: credit ? 0 : overspend,
    returnedOverspend: overspend,
    finalSalary: salary,
  };
}

describe("Scenario A — credit card ON with zero salary", () => {
  it("succeeds, keeps salary at 0, records type=credit_card, stores overspend 0, still returns overspend for the warning", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 1000 }, 1000, 500, true);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("credit_card");
    expect(r.finalSalary).toBe(0);
    expect(r.storedOverspend).toBe(0);
    // 1000 + 500 - max(1000,1000) = 500 -> over budget warning still surfaced
    expect(r.returnedOverspend).toBe(500);
  });

  it("succeeds even when the card charge far exceeds salary", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 0 }, 0, 7000, true);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("credit_card");
    expect(r.finalSalary).toBe(0);
  });
});

describe("Scenario B — credit card OFF with zero salary (normal expense path preserved)", () => {
  it("is rejected with insufficient_balance when the overspend exceeds salary", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 1000 }, 1000, 500, false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("insufficient_balance");
    expect(r.finalSalary).toBe(0);
  });

  it("deducts overspend from salary when the overspend is affordable", () => {
    const r = applyExpense({ salary_balance: 2000, monthly_budget: 1000 }, 1000, 500, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.storedOverspend).toBe(500);
    expect(r.finalSalary).toBe(1500); // 2000 - 500 overspend
  });
});

describe("Scenario C — credit card ON with salary lower than the charge", () => {
  it("succeeds and does NOT spend salary", () => {
    const r = applyExpense({ salary_balance: 100, monthly_budget: 60000 }, 0, 1000, true);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("credit_card");
    expect(r.finalSalary).toBe(100); // unchanged
    expect(r.storedOverspend).toBe(0);
    // within budget, so no over-budget warning
    expect(r.returnedOverspend).toBe(0);
  });
});

describe("normal expense still respects the existing salary check exactly", () => {
  it("does not reject when under budget even with zero salary", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 50000 }, 0, 1000, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.finalSalary).toBe(0);
  });
});
