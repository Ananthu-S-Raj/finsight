import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression contract tests for the credit-card / apply_expense changes.
 *
 * These tests read the actual migration SQL and assert the invariant contract
 * that fixes the production bugs:
 *   1. A credit-card charge never depends on (or checks) salary balance.
 *   2. A credit-card charge never deducts from salary_balance.
 *   3. Credit-card rows store overspend_amount = 0 (so delete_transaction never
 *      refunds salary for a card charge — create/delete stay consistent).
 *   4. Normal (non-credit-card) expenses keep the existing overspend check and
 *      salary deduction.
 *   5. The migration redefines ONLY the single apply_expense overload the app
 *      calls (text,text,numeric,text,boolean) and does NOT reference a
 *      non-existent 6-arg apply_expense(text,text,numeric,text,boolean,uuid)
 *      overload.
 */
const FIX_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260830000000_apply_expense_credit_card.sql"
);

const DELETE_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260828000000_delete_transaction_rpc.sql"
);

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

describe("apply_expense credit-card fix (migration contract)", () => {
  const sql = readSql(FIX_MIGRATION);

  it("redefines exactly the one apply_expense overload the app calls (text,text,numeric,text,boolean)", () => {
    const createCount = sql.split("create or replace function public.apply_expense").length - 1;
    expect(createCount).toBe(1);
    // The migration must use the exact existing signature and must NOT invent
    // a 6-parameter apply_expense variant with a category_id argument.
    expect(sql).toMatch(/apply_expense\(\s*p_category text,/);
    expect(sql).not.toMatch(/apply_expense\([\s\S]*p_category_id\s+uuid/);
    expect(sql).not.toMatch(/category_id/);
  });

  it("guards the salary check and deduction behind 'not credit' — card charges never need salary", () => {
    // The overspend insufficient_balance check + salary deduction must only run
    // for non-credit expenses.
    const guardBlocks = sql.match(
      /if not v_credit and v_overspend > 0 then[\s\S]*?end if;/g
    );
    expect(guardBlocks).toBeTruthy();
    expect(guardBlocks!.length).toBe(1);
    for (const block of guardBlocks!) {
      expect(block).toContain("insufficient_balance");
    }

    // A credit-card charge must never reach the insufficient_balance raise.
    const raises = sql.match(/\braise exception 'insufficient_balance'/g) ?? [];
    expect(raises.length).toBe(1); // only within the guarded block
  });

  it("stores overspend_amount = 0 for credit-card rows (never mutates salary on a card)", () => {
    // The insert must coerce overspend_amount to 0 when credit, keeping
    // delete_transaction from refunding salary for card charges.
    const insertBlobs = sql.match(
      /case when v_credit then 0 else v_overspend end/g
    );
    expect(insertBlobs).toBeTruthy();
    expect(insertBlobs!.length).toBe(1);
  });

  it("still returns the computed overspend so the UI can warn over-budget card spend", () => {
    const returns = sql.match(/return jsonb_build_object\('overspend_amount', v_overspend\);/g);
    expect(returns).toBeTruthy();
    expect(returns!.length).toBe(1);
  });

  it("normal (non-credit) expenses still deduct overspend from salary", () => {
    const deduction = sql.match(
      /set salary_balance = v_profile\.salary_balance - v_overspend/g
    );
    expect(deduction).toBeTruthy();
    expect(deduction!.length).toBe(1);
  });

  it("inserts type = 'credit_card' when the flag is set", () => {
    const typeCases = sql.match(
      /case when v_credit then 'credit_card' else 'expense' end/g
    );
    expect(typeCases).toBeTruthy();
    expect(typeCases!.length).toBe(1);
  });
});

describe("delete_transaction consistency (migration contract)", () => {
  it("refunds only overspend_amount for expense/credit_card — card rows with 0 overspend never change salary", () => {
    const sql = readSql(DELETE_MIGRATION);
    // The reversal for expense/credit_card is driven by overspend_amount.
    expect(sql).toMatch(/when 'expense', 'credit_card' then/);
    expect(sql).toMatch(
      /if v_tx\.overspend_amount > 0 then/
    );
    expect(sql).toMatch(/salary_balance = v_profile\.salary_balance \+ v_tx\.overspend_amount/);
  });
});
