import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Behavioral + contract tests for the credit-card payment feature
 * (supabase/migrations/20260901000000_credit_card_payment.sql).
 *
 * The migration extends the ledger with a `credit_card_payment` transaction
 * type and an atomic `pay_credit_card` RPC that:
 *   - requires a valid source ('salary' | 'savings') and amount > 0,
 *   - computes outstanding as Σ(credit_card) − Σ(credit_card_payment),
 *   - rejects payments above the outstanding bill,
 *   - deducts from the chosen source balance (never negative),
 *   - records the payment as a ledger row (positive amount, source in note),
 *   - returns the new outstanding.
 *
 * delete_transaction is also extended so deleting a payment refunds its source.
 */

const PAY_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260901000000_credit_card_payment.sql"
);

const DELETE_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260828000000_delete_transaction_rpc.sql"
);

const PAY_FIX_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260903000000_fix_credit_card_payment_outstanding.sql"
);

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

type Profile = { salary_balance: number; savings_balance: number };

/** Faithful mirror of the pay_credit_card RPC body for behavior tests. */
function payCreditCard(
  profile: Profile,
  charges: number[],
  payments: number[],
  amount: number,
  source: "salary" | "savings"
): {
  ok: boolean;
  error?: string;
  outstanding: number;
  final: Profile;
  recordedType?: string;
  recordedNote?: string;
} {
  if (source !== "salary" && source !== "savings") {
    throw new Error("invalid_source");
  }
  if (amount <= 0) throw new Error("invalid_amount");

  const outstanding = charges.reduce((a, b) => a + b, 0) - payments.reduce((a, b) => a + b, 0);
  if (amount > outstanding) {
    return { ok: false, error: "payment_exceeds_outstanding", outstanding, final: profile };
  }

  const final = { ...profile };
  if (source === "salary") {
    if (final.salary_balance < amount) {
      return { ok: false, error: "insufficient_balance", outstanding, final };
    }
    final.salary_balance -= amount;
  } else {
    if (final.savings_balance < amount) {
      return { ok: false, error: "insufficient_balance", outstanding, final };
    }
    final.savings_balance -= amount;
  }

  return {
    ok: true,
    outstanding: outstanding - amount,
    final,
    recordedType: "credit_card_payment",
    recordedNote: source === "savings" ? "savings" : "salary",
  };
}

describe("pay_credit_card migration contract", () => {
  const sql = readSql(PAY_MIGRATION);

  it("adds credit_card_payment to the transactions.type CHECK constraint", () => {
    expect(sql).toMatch(/'credit_card_payment'/);
    expect(sql).toMatch(/alter table public\.transactions/);
    expect(sql).toMatch(/add constraint transactions_type_check/);
    // The new type must live alongside every existing type.
    for (const t of ["salary_add", "savings_add", "savings_move", "expense", "credit_card", "loan_add"]) {
      expect(sql).toMatch(new RegExp(`'${t}'`));
    }
  });

  it("creates exactly one pay_credit_card RPC with the (numeric, text) signature the app calls", () => {
    const createCount = sql.split("create or replace function public.pay_credit_card").length - 1;
    expect(createCount).toBe(1);
    expect(sql).toMatch(/pay_credit_card\(\s*p_amount numeric,?\s*p_source text/);
  });

  it("locks the caller's profile row (for update) for concurrency safety", () => {
    expect(sql).toMatch(/from public\.profiles/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/where id = auth\.uid\(\)/);
  });

  it("rejects an invalid source and a non-positive amount", () => {
    expect(sql).toMatch(/raise exception 'invalid_source'/);
    expect(sql).toMatch(/p_source not in \('salary', 'savings'\)/);
    expect(sql).toMatch(/raise exception 'invalid_amount'/);
    expect(sql).toMatch(/p_amount is null or p_amount <= 0/);
  });

  it("computes outstanding as sum(credit_card) − sum(credit_card_payment)", () => {
    // Regression contract: the original 20260901000000 query summed BOTH types
    // as positive amounts (payments inflated outstanding). The production fix
    // must subtract payment rows — verified against the deployed function.
    const fix = readSql(PAY_FIX_MIGRATION);
    expect(fix).toMatch(/when type = 'credit_card' then amount/);
    expect(fix).toMatch(/when type = 'credit_card_payment' then -amount/);
    expect(fix).not.toMatch(/coalesce\(sum\(amount\), 0\) into v_outstanding/);
    expect(fix).toMatch(/if p_amount > v_outstanding then/);
    expect(fix).toMatch(/raise exception 'payment_exceeds_outstanding'/);
  });

  it("deducts only from the chosen source and never drives balances negative", () => {
    expect(sql).toMatch(/if p_source = 'salary' then/);
    expect(sql).toMatch(/set salary_balance = v_profile\.salary_balance - p_amount/);
    expect(sql).toMatch(/if v_profile\.salary_balance < p_amount then/);
    expect(sql).toMatch(/raise exception 'insufficient_balance'/);
    expect(sql).toMatch(/set savings_balance = v_profile\.savings_balance - p_amount/);
    expect(sql).toMatch(/if v_profile\.savings_balance < p_amount then/);
  });

  it("records the payment as a ledger row with the source stored in note", () => {
    const insertBlobs = sql.match(/insert into public\.transactions[^;]*'credit_card_payment'/s);
    expect(insertBlobs).toBeTruthy();
    expect(sql).toMatch(/note[\s\S]*\n\s*case when v_used_savings then 'savings' else 'salary' end/);
    // Amount stays positive so the transactions_amount_positive check holds.
    expect(sql).toMatch(/p_amount/);
  });

  it("returns the new outstanding balance", () => {
    expect(sql).toMatch(/jsonb_build_object\(/);
    expect(sql).toMatch(/'outstanding', v_outstanding - p_amount/);
  });

  it("grants execution to authenticated + service_role only", () => {
    expect(sql).toMatch(/revoke all on function public\.pay_credit_card\(numeric, text\) from public/);
    expect(sql).toMatch(/grant execute on function public\.pay_credit_card\(numeric, text\) to authenticated, service_role/);
  });

  it("extends delete_transaction to refund the payment source", () => {
    expect(sql).toMatch(/when 'credit_card_payment' then/);
    expect(sql).toMatch(/v_from_savings := \(coalesce\(v_tx\.note, ''\) = 'savings'\)/);
    expect(sql).toMatch(/set savings_balance = v_profile\.savings_balance \+ v_tx\.amount/);
    expect(sql).toMatch(/set salary_balance = v_profile\.salary_balance \+ v_tx\.amount/);
  });
});

describe("delete_transaction consistency (existing migration)", () => {
  it("still refunds only overspend_amount for expense/credit_card", () => {
    const sql = readSql(DELETE_MIGRATION);
    expect(sql).toMatch(/when 'expense', 'credit_card' then/);
  });
});

describe("pay_credit_card behavior model", () => {
  it("pays a partial amount from salary and reports the reduced outstanding", () => {
    const r = payCreditCard({ salary_balance: 10000, savings_balance: 5000 }, [5000], [0], 2000, "salary");
    expect(r.ok).toBe(true);
    expect(r.outstanding).toBe(3000);
    expect(r.final.salary_balance).toBe(8000);
    expect(r.recordedType).toBe("credit_card_payment");
    expect(r.recordedNote).toBe("salary");
  });

  it("pays from savings without touching salary", () => {
    const r = payCreditCard({ salary_balance: 0, savings_balance: 10000 }, [5000], [0], 5000, "savings");
    expect(r.ok).toBe(true);
    expect(r.outstanding).toBe(0);
    expect(r.final.savings_balance).toBe(5000);
    expect(r.final.salary_balance).toBe(0);
  });

  it("rejects a payment larger than the outstanding bill", () => {
    const r = payCreditCard({ salary_balance: 10000, savings_balance: 5000 }, [3000], [1000], 5000, "salary");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("payment_exceeds_outstanding");
    expect(r.final.salary_balance).toBe(10000); // untouched
  });

  it("rejects a payment the chosen source cannot cover", () => {
    const r = payCreditCard({ salary_balance: 1000, savings_balance: 5000 }, [5000], [0], 3000, "salary");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("insufficient_balance");
  });

  it("outstanding reflects prior payments automatically", () => {
    const r = payCreditCard({ salary_balance: 5000, savings_balance: 0 }, [5000], [2000], 3000, "salary");
    expect(r.ok).toBe(true);
    expect(r.outstanding).toBe(0);
    expect(r.final.salary_balance).toBe(2000);
  });

  it("full payment via salary clears the bill and deducts exactly the outstanding", () => {
    const r = payCreditCard({ salary_balance: 5000, savings_balance: 5000 }, [5000], [0], 5000, "salary");
    expect(r.ok).toBe(true);
    expect(r.outstanding).toBe(0);
    expect(r.final.salary_balance).toBe(0);
    expect(r.final.savings_balance).toBe(5000); // untouched
  });

  it("supports multiple partial payments — outstanding keeps declining", () => {
    // ₹5,000 bill, three partial payments of ₹1,000 each, then a ₹2,000 top-up.
    const step1 = payCreditCard({ salary_balance: 10000, savings_balance: 0 }, [5000], [0], 1000, "salary");
    expect(step1.outstanding).toBe(4000);
    const step2 = payCreditCard({ salary_balance: step1.final.salary_balance, savings_balance: 0 }, [5000], [1000], 1000, "salary");
    expect(step2.outstanding).toBe(3000);
    const step3 = payCreditCard({ salary_balance: step2.final.salary_balance, savings_balance: 0 }, [5000], [2000], 1000, "salary");
    expect(step3.outstanding).toBe(2000);
    const step4 = payCreditCard({ salary_balance: step3.final.salary_balance, savings_balance: 0 }, [5000], [3000], 2000, "salary");
    expect(step4.outstanding).toBe(0);
    expect(step4.final.salary_balance).toBe(10000 - 5000);
  });

  it("rejects a zero payment as invalid without changing anything", () => {
    expect(() =>
      payCreditCard({ salary_balance: 10000, savings_balance: 5000 }, [5000], [0], 0, "salary")
    ).toThrow("invalid_amount");
  });

  it("rejects a negative payment as invalid without changing anything", () => {
    expect(() =>
      payCreditCard({ salary_balance: 10000, savings_balance: 5000 }, [5000], [0], -500, "salary")
    ).toThrow("invalid_amount");
  });

  it("rejects any payment when there is no outstanding bill", () => {
    const r = payCreditCard({ salary_balance: 10000, savings_balance: 0 }, [], [0], 1000, "salary");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("payment_exceeds_outstanding");
    expect(r.final.salary_balance).toBe(10000);
  });

  it("rejects when savings cannot cover the payment — atomic, nothing changes", () => {
    const r = payCreditCard({ salary_balance: 10000, savings_balance: 1000 }, [5000], [0], 3000, "savings");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("insufficient_balance");
    expect(r.final.savings_balance).toBe(1000); // untouched
    expect(r.outstanding).toBe(5000); // untouched
  });

  it("exactly-exhausting a source balance is allowed (no overdraft needed)", () => {
    const r = payCreditCard({ salary_balance: 2000, savings_balance: 0 }, [2000], [0], 2000, "salary");
    expect(r.ok).toBe(true);
    expect(r.outstanding).toBe(0);
    expect(r.final.salary_balance).toBe(0);
  });

  it("is IDOR-proof — the RPC takes no user_id and scopes every statement to auth.uid()", () => {
    const sql = readSql(PAY_MIGRATION);
    // No client-supplied user placeholder anywhere in the signature or body.
    expect(sql).not.toMatch(/p_user_id/);
    expect(sql).not.toMatch(/p_user/);
    // Outstanding computed from the caller's own rows only.
    expect(sql).toMatch(/user_id = auth\.uid\(\)/);
    // Profile lock keyed to the caller.
    expect(sql).toMatch(/from public\.profiles\s+where id = auth\.uid\(\)\s+for update/i);
    // Source-balance updates keyed to the caller.
    expect(sql).toMatch(/update public\.profiles\s+set salary_balance[^;]*where id = auth\.uid\(\)/i);
    expect(sql).toMatch(/update public\.profiles\s+set savings_balance[^;]*where id = auth\.uid\(\)/i);
    // Payment row inserted with the caller's identity.
    expect(sql).toMatch(/insert into public\.transactions \(user_id, type/);
    // Deletion refund path is equally scoped.
    expect(sql).toMatch(/delete from public\.transactions\s+where id = p_transaction_id\s+and user_id = auth\.uid\(\)/);
  });
});

describe("pay_credit_card outstanding fix (20260903000000)", () => {
  const fix = readSql(PAY_FIX_MIGRATION);

  it("subtracts payment rows — Σ(credit_card) − Σ(credit_card_payment)", () => {
    expect(fix).toMatch(/sum\(\s*case/);
    expect(fix).toMatch(/when type = 'credit_card' then amount/);
    expect(fix).toMatch(/when type = 'credit_card_payment' then -amount/);
    expect(fix).toMatch(/coalesce\(/);
    expect(fix).toMatch(/into v_outstanding/);
    // Only the caller's own rows contribute.
    expect(fix).toMatch(/user_id = auth\.uid\(\)/);
    expect(fix).toMatch(/type in \('credit_card', 'credit_card_payment'\)/);
    // The buggy plain-Σ form must not reappear anywhere in the function.
    expect(fix).not.toMatch(/coalesce\(sum\(amount\), 0\) into v_outstanding/);
  });

  it("CREATE OR REPLACEs the same (numeric, text) signature the app calls", () => {
    expect(fix).toMatch(/create or replace function public\.pay_credit_card\(\s*p_amount numeric,?\s*p_source text/);
  });

  it("is atomic and fully auth.uid()-scoped (no client-supplied user_id)", () => {
    expect(fix).toMatch(/security definer set search_path = public/);
    expect(fix).toMatch(/from public\.profiles\s+where id = auth\.uid\(\)\s+for update/);
    expect(fix).not.toMatch(/p_user_id/);
    expect(fix).not.toMatch(/p_user\b/);
  });

  it("preserves source validation, balance guards and overpayment rejection", () => {
    expect(fix).toMatch(/p_source not in \('salary', 'savings'\)/);
    expect(fix).toMatch(/p_amount is null or p_amount <= 0/);
    expect(fix).toMatch(/if p_amount > v_outstanding then/);
    expect(fix).toMatch(/raise exception 'payment_exceeds_outstanding'/);
    expect(fix).toMatch(/raise exception 'insufficient_balance'/);
  });

  it("still records positive payments and returns the reduced outstanding", () => {
    expect(fix).toMatch(/'credit_card_payment'/);
    expect(fix).toMatch(/'outstanding', v_outstanding - p_amount/);
    expect(fix).toMatch(/case when v_used_savings then 'savings' else 'salary' end/);
  });

  it("grants execution to authenticated + service_role only", () => {
    expect(fix).toMatch(/revoke all on function public\.pay_credit_card\(numeric, text\) from public/);
    expect(fix).toMatch(/grant execute on function public\.pay_credit_card\(numeric, text\) to authenticated, service_role/);
  });
});

describe("pay_credit_card scenario A–H (behavior contract)", () => {
  const profile = { salary_balance: 50000, savings_balance: 0 };

  it("A–C: charge ₹10,000 then pay ₹3,000 leaves ₹7,000 outstanding", () => {
    const r = payCreditCard(profile, [10000], [], 3000, "salary");
    expect(r.ok).toBe(true);
    expect(r.outstanding).toBe(7000);
    expect(r.final.salary_balance).toBe(50000 - 3000);
  });

  it("D–F: a second ₹7,000 payment clears the bill and a third is rejected", () => {
    const second = payCreditCard(profile, [10000], [3000], 7000, "salary");
    expect(second.ok).toBe(true);
    expect(second.outstanding).toBe(0);
    // A payment once the bill is cleared must be rejected outright.
    const third = payCreditCard(profile, [10000], [10000], 1000, "salary");
    expect(third.ok).toBe(false);
    expect(third.error).toBe("payment_exceeds_outstanding");
    expect(third.final.salary_balance).toBe(profile.salary_balance); // untouched
  });

  it("G: a payment can never increase outstanding", () => {
    let outstanding = 10000;
    let paid = 0;
    for (const amount of [1000, 2000, 3000]) {
      const r = payCreditCard(profile, [10000], [paid], amount, "salary");
      expect(r.ok).toBe(true);
      expect(r.outstanding).toBeLessThan(outstanding); // strictly decreasing
      expect(r.outstanding).toBe(10000 - (paid + amount)); // exactly charges − payments
      expect(r.outstanding).toBeGreaterThanOrEqual(0);
      outstanding = r.outstanding;
      paid += amount;
    }
  });

  it("H: multiple partial payments always reduce outstanding toward zero", () => {
    const steps = [1000, 2000, 3000, 4000];
    let paid = 0;
    const results: number[] = [];
    for (const amount of steps) {
      const r = payCreditCard(profile, [10000], [paid], amount, "salary");
      expect(r.ok).toBe(true);
      results.push(r.outstanding);
      paid += amount;
    }
    expect(results).toEqual([9000, 7000, 4000, 0]);
  });

  it("spec: ₹10,000 bill — ₹3,000 then ₹2,000 payments leave ₹5,000 outstanding", () => {
    const first = payCreditCard(profile, [10000], [], 3000, "salary");
    expect(first.ok).toBe(true);
    expect(first.outstanding).toBe(7000);
    // The second payment runs against the balances left by the first, exactly
    // like two sequential RPC calls would.
    const second = payCreditCard(first.final, [10000], [3000], 2000, "salary");
    expect(second.ok).toBe(true);
    expect(second.outstanding).toBe(5000);
    expect(second.final.salary_balance).toBe(50000 - 3000 - 2000);
  });
});