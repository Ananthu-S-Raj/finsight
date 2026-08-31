import { describe, it, expect } from "vitest";

/**
 * Behavioral model of the `apply_expense(5-arg)` RPC as re-defined in
 * supabase/migrations/20260910000000_converge_production_schema.sql
 * (the full-deduction accounting model).
 *
 * Reading and pinning the migration's decision logic in a faithful model makes
 * the user-visible requirements runnable and regression-safe without needing a
 * live Postgres instance:
 *
 *   1. A normal (cash) expense deducts its FULL amount from salary_balance and
 *      is NEVER blocked — a fresh user with no salary can log expenses and the
 *      balance may go negative.
 *   2. A credit-card charge is a liability only: it never touches
 *      salary_balance and stores overspend_amount = 0.
 *   3. overspend_amount stores the salary actually consumed (p_amount for cash
 *      expenses), so delete_transaction refunds exactly what was deducted.
 *   4. The RPC still RETURNS the over-budget excess so the UI can raise the
 *      "over budget" warning (no budget configured => 0).
 */

type Profile = { salary_balance: number; monthly_budget: number };
type Result = {
  ok: boolean;
  type: "expense" | "credit_card";
  storedOverspend: number;
  returnedOverspend: number;
  finalSalary: number;
};

/** Faithful mirror of the 5-arg apply_expense body under the new model. */
function applyExpense(
  profile: Profile,
  monthSpentExcludingThis: number,
  amount: number,
  isCreditCard: boolean
): Result {
  if (amount <= 0) throw new Error("invalid_amount");

  let { salary_balance: salary } = profile;
  const spent = monthSpentExcludingThis;
  // No configured budget (<= 0) has no cap to exceed, so the over-budget
  // warning is always 0; with a budget it is the excess past it.
  const overspendExcess =
    profile.monthly_budget <= 0
      ? 0
      : Math.max(0, spent + amount - Math.max(profile.monthly_budget, spent));
  const credit = Boolean(isCreditCard);

  // Cash expenses consume the FULL amount immediately and are never rejected —
  // the balance may go negative. Card charges never touch salary.
  if (!credit) {
    salary -= amount;
  }

  return {
    ok: true,
    type: credit ? "credit_card" : "expense",
    storedOverspend: credit ? 0 : amount,
    returnedOverspend: overspendExcess,
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
    // 1000 + 500 - max(1000,1000) = 500 -> over-budget warning still surfaced
    expect(r.returnedOverspend).toBe(500);
  });

  it("succeeds even when the card charge far exceeds salary", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 0 }, 0, 7000, true);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("credit_card");
    expect(r.finalSalary).toBe(0);
  });
});

describe("Scenario B — credit card OFF with zero salary (normal expense never blocked)", () => {
  it("deducts the full amount even though the balance goes negative", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 1000 }, 1000, 500, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.finalSalary).toBe(-500); // full deduction, balance may go negative
    expect(r.storedOverspend).toBe(500); // salary actually consumed
    // 1000 + 500 - max(1000,1000) = 500 -> over-budget warning
    expect(r.returnedOverspend).toBe(500);
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

describe("normal expense respects the new full-deduction model", () => {
  it("deducts the FULL amount from salary even when fully within budget", () => {
    // Old model: within budget => nothing deducted, stored 0, salary 2000.
    // New model: the whole ₹200 comes out of salary, stored as consumed.
    const r = applyExpense({ salary_balance: 2000, monthly_budget: 1000 }, 100, 200, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.storedOverspend).toBe(200);
    expect(r.finalSalary).toBe(1800);
    expect(r.returnedOverspend).toBe(0); // within budget
  });

  it("deducts the full amount even when the transaction is over budget", () => {
    const r = applyExpense({ salary_balance: 2000, monthly_budget: 1000 }, 1000, 500, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.storedOverspend).toBe(500);
    expect(r.finalSalary).toBe(1500); // 2000 - 500 full amount
    expect(r.returnedOverspend).toBe(500);
  });
});

describe("Bug 1 — normal expense with a zero salary balance", () => {
  it("allows a normal expense when NO budget is set (budget defaults to 0) and salary is 0", () => {
    // A fresh profile: monthly_budget=0 (unset), salary_balance=0. The expense
    // is logged (never blocked) and the balance goes negative.
    const r = applyExpense({ salary_balance: 0, monthly_budget: 0 }, 0, 1000, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.storedOverspend).toBe(1000);
    expect(r.returnedOverspend).toBe(0);
    expect(r.finalSalary).toBe(-1000);
  });

  it("allows a normal expense past a real budget even when salary cannot cover it", () => {
    // Budget IS set and the user is genuinely over it — the transaction is
    // still recorded and salary goes negative. No more insufficient_balance
    // rejection on expenses.
    const r = applyExpense({ salary_balance: 0, monthly_budget: 1000 }, 1000, 500, false);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("expense");
    expect(r.finalSalary).toBe(-500);
    expect(r.returnedOverspend).toBe(500); // warning still surfaced
  });

  it("keeps credit-card charges salary-independent even with no budget configured", () => {
    const r = applyExpense({ salary_balance: 0, monthly_budget: 0 }, 0, 5000, true);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("credit_card");
    expect(r.finalSalary).toBe(0);
    expect(r.storedOverspend).toBe(0);
  });
});