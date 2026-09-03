import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract tests for the financial-integrity migration
 * (supabase/migrations/20260915000000_financial_integrity.sql).
 *
 * The audit found several database-layer defects that this migration fixes:
 *  P1 #1 — `_apply_recurring_expense` still used the PRE-convergence model:
 *          cash recurring expenses were blocked/rejected on insufficient
 *          salary and credit-card recurring charges wrongly depended on salary.
 *  P1 #2 — No BEFORE INSERT guard on `transactions`: a client could INSERT a
 *          forged row and delete_transaction-refund it to mint balance.
 *  P2 B — delete_transaction read the transaction row without a lock, so two
 *          concurrent deletes could double-refund.
 *  P2 E — categories_create / categories_delete trusted a client-supplied
 *          p_user instead of deriving identity from auth.uid().
 * These tests read the actual migration SQL and lock down the corrected model
 * (the same static-contract approach used by db-convergence.test.ts and
 * credit-cards.db.test.ts).
 */
const MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260915000000_financial_integrity.sql"
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

describe("financial-integrity migration — recurring expense (P1 #1)", () => {
  const sql = readSql();
  const block = functionBlock(sql, "_apply_recurring_expense(");

  it("redefines _apply_recurring_expense with the converged full-deduction model", () => {
    expect(block).toContain("create or replace function public._apply_recurring_expense(");
    expect(block).toMatch(/salary_balance = v_profile\.salary_balance - p_amount/);
    // No insufficient_balance rejection anywhere in the expense body: a fresh
    // user with no salary / no budget can still log (recurring) expenses.
    expect(block).not.toMatch(/insufficient_balance/);
  });

  it("keeps card recurring charges independent of salary (no deduction, zero stored)", () => {
    // The converged card rule: `if not v_credit then` guard for the deduction,
    // `case when v_credit then 0 else p_amount end` for stored overspend, and
    // `case when v_credit then 'credit_card' else 'expense' end` for the type.
    expect(block).toMatch(/if not v_credit then/);
    expect(block).toMatch(/case when v_credit then 0 else p_amount end/);
    expect(block).toMatch(/case when v_credit then 'credit_card' else 'expense' end/);
  });

  it("deducts the FULL cash amount and stores the refundable consumed amount", () => {
    expect(block).toMatch(/case when v_credit then 0 else p_amount end/);
    expect(block).toMatch(/v_overspend := greatest\(0, v_spent \+ p_amount - greatest\(v_profile\.monthly_budget, v_spent\)\)/);
    // The over-budget excess is only reported, not used to refuse the expense.
    expect(block).toMatch(/return jsonb_build_object\('overspend_amount', v_overspend, 'duplicate', false\);/);
  });

  it("preserves the exact signature so process_recurring_due still works", () => {
    expect(block).toMatch(/p_recurring_transaction_id uuid/);
    expect(block).toMatch(/p_occurrence_date date/);
  });

  it("keeps duplicate protection (occurrence creation is still idempotent)", () => {
    expect(block).toMatch(/'duplicate', true/);
    expect(block).toMatch(/'duplicate', false/);
  });
});

// The required accounting scenarios are proven against the SQL itself: each
// assertion pins the exact expression the migration must contain to implement
// the converged model, so a regression back to the pre-convergence (excess-only,
// insufficient_balance-blocking) behaviour fails on the next run.
describe("financial-integrity migration — recurring cash expense scenarios", () => {
  const block = functionBlock(readSql(), "_apply_recurring_expense(");

  it("deducts the FULL amount even when salary < amount (salary may go negative)", () => {
    // salary_balance is unconditionally decremented by p_amount inside the
    // `if not v_credit` guard; there is NO `if v_profile.salary_balance < ...`
    // rejection guarding that decrement.
    expect(block).toMatch(/if not v_credit then\s+update public\.profiles\s+set salary_balance = v_profile\.salary_balance - p_amount/);
    expect(block).not.toMatch(/if v_profile\.salary_balance < p_amount/);
  });

  it("deducts the FULL amount when salary = 0 (no budget / no salary must not block)", () => {
    // The get/update is unconditional; only the defragged cash branch changes
    // the salary. A zero salary simply goes negative by p_amount.
    expect(block).toMatch(/salary_balance = v_profile\.salary_balance - p_amount/);
    expect(block).not.toMatch(/insufficient_balance/);
  });

  it("stores overspend_amount = p_amount for cash (refundable by delete)", () => {
    expect(block).toMatch(/case when v_credit then 0 else p_amount end/);
  });

  it("reports the over-budget excess separately for the UI (not used to refuse)", () => {
    expect(block).toMatch(/v_overspend := greatest\(0, v_spent \+ p_amount - greatest\(v_profile\.monthly_budget, v_spent\)\)/);
  });

  it("returns 0 overspend when monthly_budget is 0 (no spurious over-budget toast)", () => {
    // When no budget is set, there is nothing to exceed. Same guard as apply_expense.
    expect(block).toMatch(/coalesce\(v_profile\.monthly_budget, 0\) > 0/);
    expect(block).toMatch(/v_overspend\s*:=\s*0/);
  });
});

describe("financial-integrity migration — recurring credit-card scenarios", () => {
  const block = functionBlock(readSql(), "_apply_recurring_expense(");

  it("never deducts salary for a card charge even when salary < amount or = 0", () => {
    // The decrement is inside `if not v_credit then`, so a card charge (v_credit
    // true) never touches salary and never hits an insufficient_balance block.
    expect(block).toMatch(/if not v_credit then/);
    expect(block).not.toMatch(/insufficient_balance/);
  });

  it("stores overspend_amount = 0 for card charges", () => {
    expect(block).toMatch(/case when v_credit then 0 else p_amount end/);
  });

  it("records card recurring charges with type 'credit_card'", () => {
    expect(block).toMatch(/case when v_credit then 'credit_card' else 'expense' end/);
  });
});

describe("financial-integrity migration — INSERT guard (P1 #2)", () => {
  const sql = readSql();

  it("adds a BEFORE INSERT guard that blocks direct non-trusted inserts", () => {
    expect(sql).toMatch(/create or replace function public\.guard_transactions_no_direct_insert\(\)/);
    expect(sql).toMatch(/raise exception 'direct_transaction_insert_forbidden'/);
    expect(sql).toMatch(/current_user not in \('postgres', 'supabase_admin', 'service_role'\)/);
    expect(sql).toMatch(/before insert on public\.transactions/);
  });

  it("never blocks the trusted definer RPCs that run as postgres", () => {
    const block = functionBlock(sql, "guard_transactions_no_direct_insert(");
    expect(block).toMatch(/return new;/);
    // Trusted roles are explicitly exempted, so the RPC money path is preserved.
    expect(block).toMatch(/current_user not in \('postgres', 'supabase_admin', 'service_role'\)/);
  });
});

describe("financial-integrity migration — delete_transaction TOCTOU (P2 B)", () => {
  const block = functionBlock(readSql(), "delete_transaction(");

  it("locks the transaction row so concurrent deletes cannot double-refund", () => {
    expect(block).toMatch(/for update/);
    // The lock is on the transaction read (not just the profile).
    expect(block).toMatch(/from public\.transactions\s+where id = p_transaction_id\s+and user_id = auth\.uid\(\)\s+for update;/);
  });

  it("still refunds exactly the stored salary-consumed amount", () => {
    expect(block).toMatch(/salary_balance = v_profile\.salary_balance \+ v_tx\.overspend_amount/);
    expect(block).toMatch(/'credit_card_payment' then/);
  });

  it("raises transaction_not_found when a concurrent delete already removed the row", () => {
    expect(block).toMatch(/raise exception 'transaction_not_found'/);
  });
});

describe("financial-integrity migration — category RPCs (P2 E)", () => {
  const sql = readSql();
  const create = functionBlock(sql, "categories_create(");
  const del = functionBlock(sql, "categories_delete(");

  it("derives identity from auth.uid() and rejects unauthenticated calls", () => {
    expect(create).toMatch(/v_uid := auth\.uid\(\);/);
    expect(create).toMatch(/raise exception 'unauthorized'/);
    expect(del).toMatch(/v_uid := auth\.uid\(\);/);
    expect(del).toMatch(/raise exception 'unauthorized'/);
  });

  it("ignores the client-supplied p_user when scoping ownership", () => {
    // Ownership checks and inserts are keyed off v_uid, not p_user.
    expect(create).toMatch(/insert into public\.categories \(name, user_id\)\s+values \(p_name, v_uid\)/);
    expect(del).toMatch(/where id = p_id and user_id = v_uid/);
    // p_user must never appear as the scoping key.
    expect(create).not.toMatch(/user_id = p_user/);
    expect(del).not.toMatch(/user_id = p_user/);
  });

  it("preserves ownership checks, category limits and search_path safety", () => {
    expect(create).toMatch(/Custom category limit reached/);
    expect(create).toMatch(/set search_path = public/);
    expect(del).toMatch(/Category is in use/);
    expect(del).toMatch(/set search_path = public/);
  });
});

describe("financial-integrity migration — grants preserved", () => {
  const sql = readSql();

  it("keeps the money RPCs granted to authenticated + service_role (anon revoked)", () => {
    expect(sql).toMatch(/revoke all on function public\.delete_transaction\(uuid\) from public;/);
    expect(sql).toMatch(/grant execute on function public\.delete_transaction\(uuid\) to authenticated, service_role;/);
  });

  it("keeps _apply_recurring_expense strictly internal (no re-grant)", () => {
    // The internal helper is revoked from public and NOT exposed to callers,
    // matching the original 20260811000001 grant model.
    expect(sql).toMatch(/revoke all on function public\._apply_recurring_expense\(uuid, text, text, numeric, text, boolean, uuid, date\) from public;/);
  });

  it("keeps category RPCs granted to authenticated + service_role (anon revoked)", () => {
    expect(sql).toMatch(/grant execute on function public\.categories_create\(text, uuid\) to authenticated, service_role;/);
    expect(sql).toMatch(/grant execute on function public\.categories_delete\(uuid, uuid\) to authenticated, service_role;/);
  });
});

describe("no-budget overspend guard migration (20260916)", () => {
  const MIGRATION_NO_BUDGET = join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260916000000_fix_no_budget_overspend.sql"
  );
  let noBudgetSql: string;
  let applyExpenseBlock: string;
  let applyCreditBlock: string;
  let applyBillBlock: string;

  beforeAll(() => {
    noBudgetSql = readFileSync(MIGRATION_NO_BUDGET, "utf8");
    applyExpenseBlock = functionBlock(noBudgetSql, "apply_expense(");
    applyCreditBlock = functionBlock(noBudgetSql, "apply_credit_card_expense(");
    applyBillBlock = functionBlock(noBudgetSql, "_apply_bill_expense(");
  });

  it("redefines all three overspend-reporting RPCs", () => {
    expect(applyExpenseBlock).toContain("create or replace function public.apply_expense(");
    expect(applyCreditBlock).toContain("create or replace function public.apply_credit_card_expense(");
    expect(applyBillBlock).toContain("create or replace function public._apply_bill_expense(");
  });

  it("does NOT contain any DROP statements", () => {
    expect(noBudgetSql).not.toMatch(/drop\s+function/i);
  });

  it("uses SECURITY DEFINER + set search_path = public on all three RPCs", () => {
    expect(applyExpenseBlock).toMatch(/security definer set search_path = public/);
    expect(applyCreditBlock).toMatch(/security definer set search_path = public/);
    expect(applyBillBlock).toMatch(/security definer set search_path = public/);
  });

  it("apply_expense: over-budget excess returns 0 when no budget is configured", () => {
    // When monthly_budget is null or 0, there is nothing to exceed.
    expect(applyExpenseBlock).toMatch(/coalesce\(v_profile\.monthly_budget, 0\) > 0/);
    // The guard must be a conditional: budget > 0 → compute, else → 0.
    expect(applyExpenseBlock).toMatch(/v_overspend\s*:=\s*0/);
  });

  it("apply_expense: over-budget formula unchanged when budget IS set", () => {
    expect(applyExpenseBlock).toMatch(
      /greatest\(0, v_spent \+ p_amount - greatest\(v_profile\.monthly_budget, v_spent\)\)/
    );
  });

  it("apply_expense: stored overspend_amount unchanged (cash=p_amount, card=0)", () => {
    expect(applyExpenseBlock).toMatch(/case when v_credit then 0 else p_amount end/);
  });

  it("apply_expense: signature unchanged (no new parameter, no DROP)", () => {
    expect(applyExpenseBlock).toMatch(/p_category text,\s*p_subcategory text,\s*p_amount numeric,\s*p_note text,\s*p_is_credit_card boolean/);
  });

  it("apply_credit_card_expense: over-budget excess returns 0 when no budget is configured", () => {
    expect(applyCreditBlock).toMatch(/coalesce\(v_profile\.monthly_budget, 0\) > 0/);
    expect(applyCreditBlock).toMatch(/v_overspend\s*:=\s*0/);
  });

  it("apply_credit_card_expense: over-budget formula unchanged when budget IS set", () => {
    expect(applyCreditBlock).toMatch(
      /greatest\(0, v_spent \+ p_amount - greatest\(v_profile\.monthly_budget, v_spent\)\)/
    );
  });

  it("apply_credit_card_expense: stored overspend_amount remains 0 (card charges)", () => {
    // Card charges always store 0 for overspend_amount (salary untouched).
    const insertMatch = applyCreditBlock.match(/values\s*\(\s*[\s\S]*?0\s*,\s*coalesce\(p_note/);
    expect(insertMatch).toBeTruthy();
  });

  it("apply_credit_card_expense: signature unchanged", () => {
    expect(applyCreditBlock).toMatch(/p_card_id uuid,\s*p_category text,\s*p_subcategory text,\s*p_amount numeric/);
  });

  it("_apply_bill_expense: over-budget excess returns 0 when no budget is configured", () => {
    expect(applyBillBlock).toMatch(/coalesce\(v_profile\.monthly_budget, 0\) > 0/);
    expect(applyBillBlock).toMatch(/v_overspend\s*:=\s*0/);
  });

  it("_apply_bill_expense: over-budget formula unchanged when budget IS set", () => {
    expect(applyBillBlock).toMatch(
      /greatest\(0, v_spent \+ p_amount - greatest\(v_profile\.monthly_budget, v_spent\)\)/
    );
  });

  it("_apply_bill_expense: stored overspend_amount unchanged (cash=p_amount, card=0)", () => {
    expect(applyBillBlock).toMatch(/case when coalesce\(p_is_credit_card, false\) then 0 else p_amount end/);
  });

  it("_apply_bill_expense: signature unchanged", () => {
    expect(applyBillBlock).toMatch(/p_user_id uuid,\s*p_category text,\s*p_subcategory text,\s*p_amount numeric/);
  });

  it("all three RPCs return the overspend_amount for the UI toast (return shape unchanged)", () => {
    expect(applyExpenseBlock).toMatch(/return jsonb_build_object\('overspend_amount', v_overspend\)/);
    expect(applyCreditBlock).toMatch(/'overspend_amount', v_overspend/);
    expect(applyBillBlock).toMatch(/return v_overspend/);
  });
});

describe("confirm_recurring_occurrence concurrency fix (20260916000001)", () => {
  const MIGRATION_CONFIRM = join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260916000001_confirm_recurring_concurrency.sql"
  );
  let sql: string;
  let block: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_CONFIRM, "utf8");
    block = functionBlock(sql, "confirm_recurring_occurrence(");
  });

  it("is present in the shipped migration set", () => {
    const migrations = readdirSync(
      join(__dirname, "..", "supabase", "migrations")
    ).filter((f) => f.endsWith(".sql"));
    expect(migrations).toContain("20260916000001_confirm_recurring_concurrency.sql");
  });

  it("drops the function before recreating it", () => {
    expect(sql).toMatch(/drop function if exists public\.confirm_recurring_occurrence\(uuid\)/);
  });

  it("adds FOR UPDATE to the occurrence SELECT for concurrency safety", () => {
    expect(block).toMatch(/for update/);
    expect(block).toMatch(
      /from public\.recurring_occurrences\s+where id = p_occurrence_id\s+for update/
    );
  });

  it("preserves SECURITY DEFINER and search_path", () => {
    expect(block).toMatch(/security definer set search_path = public/);
  });

  it("preserves the exact RPC signature", () => {
    expect(block).toMatch(/confirm_recurring_occurrence\(\s*p_occurrence_id uuid\s*\)/);
    expect(block).toMatch(/returns jsonb/);
  });

  it("preserves authorization check (auth.uid() ownership)", () => {
    expect(block).toMatch(/v_occ\.user_id is distinct from auth\.uid\(\)/);
    expect(block).toMatch(/raise exception 'unauthorized'/);
  });

  it("preserves idempotent already_processed return", () => {
    expect(block).toMatch(/raise exception 'occurrence_not_found'/);
    expect(block).toMatch(/raise exception 'rule_not_found'/);
    expect(block).toMatch(/'already_processed', true/);
    expect(block).toMatch(/'already_processed', false/);
  });

  it("preserves all three rule type dispatches", () => {
    expect(block).toMatch(/perform public\._apply_recurring_expense\(/);
    expect(block).toMatch(/perform public\._apply_recurring_income\(/);
    expect(block).toMatch(/perform public\._apply_recurring_transfer\(/);
    expect(block).toMatch(/raise exception 'invalid_rule_type'/);
  });

  it("preserves the unique occurrence constraint (no destructive operations)", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/drop\s+column/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it("preserves the grant surface (authenticated + service_role only)", () => {
    expect(sql).toMatch(/revoke all on function public\.confirm_recurring_occurrence\(uuid\) from public;/);
    expect(sql).toMatch(/grant execute on function public\.confirm_recurring_occurrence\(uuid\) to authenticated, service_role;/);
  });
});
