import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression contract tests for the production schema-convergence migration.
 *
 * The production database drifted from the migration files (missing functions,
 * anonymous-role EXECUTE on money RPCs). This migration is idempotent and
 * recreates the affected functions; these tests read the actual SQL and lock
 * the accounting model agreed for the fixes:
 *
 *   1. apply_savings_move and pay_credit_card are recreated (they were missing
 *      live -> every "move to savings" / credit-card payment RPC 404'd).
 *   2. A normal (cash) expense deducts its FULL amount from salary_balance and
 *      is NEVER blocked (a fresh user can log expenses; balance may go
 *      negative) — this is the fix for "expenses don't decrease the available
 *      balance".
 *   3. A credit-card charge never touches salary_balance.
 *   4. overspend_amount stores the salary actually consumed (p_amount for
 *      cash, 0 for cards) so delete_transaction refunds exactly what was
 *      deducted; the RPC return value still reports the over-budget excess.
 *   5. The privilege model is re-asserted: anonymous is revoked,
 *      authenticated/service_role keep EXECUTE.
 */
const MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260910000000_converge_production_schema.sql"
);

function readSql(): string {
  return readFileSync(MIGRATION, "utf8");
}

/** Returns the text of a single `create or replace function public.<fn>` block. */
function functionBlock(sql: string, fnPrefix: string): string {
  const marker = `create or replace function public.${fnPrefix}`;
  const start = sql.indexOf(marker);
  if (start === -1) return "";
  const next = sql.indexOf("create or replace function public.", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("db-convergence migration (contract)", () => {
  const sql = readSql();

  it("explains the production drift it converges", () => {
    expect(sql).toMatch(/Converge the production schema/i);
    expect(sql).toMatch(/apply_savings_move\(numeric\) is MISSING/i);
    expect(sql).toMatch(/pay_credit_card\(numeric, text\) is MISSING/i);
    expect(sql).toMatch(/revoke \.\.\. from public/i);
  });

  it("recreates apply_savings_move with its unchanged guarded transfer", () => {
    const block = functionBlock(sql, "apply_savings_move(");
    expect(block).toMatch(/p_amount numeric/);
    expect(block).toMatch(/raise exception 'insufficient_balance'/);
    expect(block).toMatch(/salary_balance = v_profile\.salary_balance - p_amount/);
    expect(block).toMatch(/'savings_move'/);
  });

  it("recreates pay_credit_card with the corrected outstanding arithmetic", () => {
    const block = functionBlock(sql, "pay_credit_card(");
    expect(block).toMatch(/p_source text/);
    // Outstanding = Σ(credit_card) − Σ(credit_card_payment): payments are
    // stored positive and must be subtracted, never added.
    expect(block).toMatch(/when type = 'credit_card_payment' then -amount/);
    expect(block).toMatch(/raise exception 'payment_exceeds_outstanding'/);
    expect(block).toMatch(/case when v_used_savings then 'savings' else 'salary' end/);
  });

  describe("apply_expense — full-deduction cash model", () => {
    const block = functionBlock(sql, "apply_expense(");

    it("redefines exactly the one overload the app calls (text,text,numeric,text,boolean)", () => {
      const markers =
        sql.match(new RegExp("create or replace function public.apply_expense", "g")) ?? [];
      expect(markers.length).toBe(1);
      expect(block).toMatch(/apply_expense\(\s*p_category text,/);
      expect(block).toMatch(/p_subcategory text/);
      expect(block).toMatch(/p_is_credit_card boolean/);
    });

    it("deducts the FULL amount from salary for cash expenses and never blocks", () => {
      expect(block).toMatch(/salary_balance = v_profile\.salary_balance - p_amount/);
      // No overspend-based rejection anywhere in the expense body: a fresh user
      // with no salary can log expenses and the balance may go negative. The
      // insufficient_balance raises in this file belong to pay/savings, not
      // apply_expense.
      expect(block).not.toMatch(/insufficient_balance/);
    });

    it("keeps card charges independent of salary (no deduction, 0 stored)", () => {
      expect(block).toMatch(/if not v_credit then/);
      expect(block).toMatch(/case when v_credit then 0 else p_amount end/);
      expect(block).toMatch(/case when v_credit then 'credit_card' else 'expense' end/);
    });

    it("returns the over-budget excess so the UI toast still works", () => {
      expect(block).toMatch(/return jsonb_build_object\('overspend_amount', v_overspend\);/);
    });
  });

  describe("_apply_bill_expense — same accounting model for bills", () => {
    const block = functionBlock(sql, "_apply_bill_expense(");

    it("keeps the exact signature mark_bill_paid calls", () => {
      expect(block).toMatch(/p_user_id uuid/);
      expect(block).toMatch(/p_bill_payment_id uuid/);
    });

    it("deducts the full bill amount for cash bills and never blocks", () => {
      expect(block).toMatch(/salary_balance = v_profile\.salary_balance - p_amount/);
      expect(block).not.toMatch(/insufficient_balance/);
      expect(block).toMatch(/case when coalesce\(p_is_credit_card, false\) then 0 else p_amount end/);
    });

    it("still returns the over-budget excess for the paid-bill toast", () => {
      expect(block).toMatch(/return v_overspend;/);
    });
  });

  it("keeps delete_transaction refunding exactly the stored salary-consumed amount", () => {
    const block = functionBlock(sql, "delete_transaction(");
    expect(block).toMatch(/salary_balance = v_profile\.salary_balance \+ v_tx\.overspend_amount/);
    expect(block).toMatch(/raise exception 'transaction_not_found'/);
    expect(block).toMatch(/'credit_card_payment' then/);
  });

  it("re-asserts the privilege model: revoke from public + grant to the app roles", () => {
    for (const fqn of [
      "public.apply_expense(text, text, numeric, text, boolean)",
      "public.apply_income(text, numeric, text)",
      "public.apply_savings_move(numeric)",
      "public.pay_credit_card(numeric, text)",
      "public.delete_transaction(uuid)",
      "public._apply_bill_expense(uuid, text, text, numeric, text, boolean, uuid)",
      "public.mark_bill_paid(uuid, boolean)",
    ]) {
      expect(sql).toContain(`revoke all on function ${fqn} from public;`);
      expect(sql).toContain(`grant execute on function ${fqn} to authenticated, service_role;`);
    }
  });

  it("sweeps the remaining app RPCs safely through an existence-guarded DO block", () => {
    const sweep = sql.match(/do \$sweep\$[\s\S]*?\$sweep\$;/);
    expect(sweep).toBeTruthy();
    expect(sweep![0]).toMatch(/'generate_bill_reminders'/);
    expect(sweep![0]).toMatch(/'request_password_reset'/);
    expect(sweep![0]).toMatch(/'contribute_to_goal'/);
    expect(sweep![0]).toMatch(/revoke all on function/);
    expect(sweep![0]).toMatch(/grant execute on function/);
  });
});