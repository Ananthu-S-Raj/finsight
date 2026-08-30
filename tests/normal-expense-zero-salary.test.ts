import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression contract tests for Bug 1 — "a normal expense cannot be added when
 * salary balance is zero".
 *
 * These read the actual migration SQL and assert the invariant that fixes the
 * bug while preserving the Task 3 credit-card rules and the existing salary
 * validation:
 *
 *   1. When NO budget is configured (monthly_budget <= 0), overspend is 0, so a
 *      normal expense is allowed even with a zero salary balance.
 *   2. When a budget IS configured, the over-budget overspend accounting and the
 *      insufficient_balance guard are unchanged — a normal expense past a real
 *      budget still requires salary to cover the overspend.
 *   3. Credit-card charges remain fully salary-independent (card=true skips the
 *      salary check/deduction and stores overspend 0).
 *   4. The migration redefines only the single apply_expense overload the app
 *      calls (text,text,numeric,text,boolean) — no new overload, no DROP, no
 *      category_id reference.
 */
const FIX_MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260831000000_normal_expense_zero_salary.sql"
);

const sql = readFileSync(FIX_MIGRATION, "utf8");

describe("Bug 1 — normal expense with zero salary balance (migration contract)", () => {
  it("redefines exactly the one apply_expense overload the app calls", () => {
    const createCount = sql.split("create or replace function public.apply_expense").length - 1;
    expect(createCount).toBe(1);
    expect(sql).toMatch(/apply_expense\(\s*p_category text,/);
    expect(sql).not.toMatch(/category_id/);
    expect(sql).not.toMatch(/p_category_id/);
  });

  it("treats an unconfigured budget (monthly_budget <= 0) as no overspend", () => {
    // The overspend formula must gate on a configured budget so a fresh profile
    // (budget 0, salary 0) is not forced into paying salary for the full amount.
    expect(sql).toMatch(/monthly_budget\s*<=\s*0\s*then\s*0/);
  });

  it("keeps the over-budget overspend formula for configured budgets", () => {
    expect(sql).toMatch(
      /greatest\(0, v_spent \+ p_amount - greatest\(v_profile\.monthly_budget, v_spent\)\)/
    );
  });

  it("guards the salary check/deduction behind 'not v_credit' only", () => {
    const guardBlocks = sql.match(
      /if not v_credit and v_overspend > 0 then[\s\S]*?end if;/g
    );
    expect(guardBlocks).toBeTruthy();
    expect(guardBlocks!.length).toBe(1);
    for (const block of guardBlocks!) {
      expect(block).toContain("insufficient_balance");
    }
    const raises = sql.match(/\braise exception 'insufficient_balance'/g) ?? [];
    expect(raises.length).toBe(1);
  });

  it("stores overspend_amount = 0 for credit-card rows", () => {
    const inserts = sql.match(/case when v_credit then 0 else v_overspend end/g);
    expect(inserts).toBeTruthy();
    expect(inserts!.length).toBe(1);
  });

  it("still returns the computed overspend for the UI warning", () => {
    const returns = sql.match(/return jsonb_build_object\('overspend_amount', v_overspend\);/g);
    expect(returns).toBeTruthy();
    expect(returns!.length).toBe(1);
  });

  it("does NOT drop the function (CREATE OR REPLACE only, signature unchanged)", () => {
    expect(sql).not.toMatch(/drop function/i);
  });
});
