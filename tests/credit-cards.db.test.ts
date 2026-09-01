import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract tests for the multi-card credit-card migration
 * (supabase/migrations/20260912000000_credit_cards.sql).
 *
 * The migration adds per-card management on top of the existing single-card
 * model without touching any existing money RPC:
 *   - public.credit_cards (id, user_id, name, credit_limit, billing_day,
 *     created_at, updated_at) with read-own/admin-read RLS only; writes go
 *     through SECURITY DEFINER RPCs.
 *   - transactions.card_id (nullable FK, RESTRICT) + index, so legacy rows
 *     and bills-paid-as-credit stay valid (card_id NULL).
 *   - A backfill preserving existing card activity under a per-user legacy
 *     card "My Card" (limit greatest(100000, total charges), day 1).
 *   - card_id joins the transaction protected-columns guard; a new
 *     guard_credit_cards_manage trigger keeps updated_at fresh and refuses
 *     limit decreases below outstanding for non-trusted callers.
 *   - New RPCs, all auth.uid()-scoped with no client-supplied user_id:
 *     create_credit_card, update_credit_card, delete_credit_card,
 *     list_credit_cards, apply_credit_card_expense, pay_card_bill.
 */
const MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260912000000_credit_cards.sql"
);

function readSql(): string {
  return readFileSync(MIGRATION, "utf8");
}

function block(sql: string, fnPrefix: string): string {
  const marker = `create or replace function public.${fnPrefix}`;
  const start = sql.indexOf(marker);
  if (start === -1) return "";
  const next = sql.indexOf("create or replace function public.", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("credit_cards migration — table + RLS", () => {
  const sql = readSql();

  it("creates the credit_cards table with the required columns", () => {
    expect(sql).toMatch(/create table if not exists public\.credit_cards/);
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/);
    expect(sql).toMatch(/user_id\s+uuid not null references auth\.users\(id\) on delete cascade/);
    expect(sql).toMatch(/name\s+text not null check \(length\(btrim\(name\)\) between 1 and 60\)/);
    expect(sql).toMatch(/credit_limit numeric\(12,2\) not null check \(credit_limit > 0\)/);
    expect(sql).toMatch(/billing_day integer not null check \(billing_day between 1 and 31\)/);
    expect(sql).toMatch(/created_at\s+timestamptz not null default now\(\)/);
    expect(sql).toMatch(/updated_at\s+timestamptz not null default now\(\)/);
  });

  it("indexes cards by user", () => {
    expect(sql).toMatch(/create index if not exists credit_cards_user_idx/);
    expect(sql).toMatch(/on public\.credit_cards \(user_id\)/);
  });

  it("enables RLS and grants read-own + admin-read only", () => {
    expect(sql).toMatch(/alter table public\.credit_cards enable row level security/);
    expect(sql).toMatch(/"credit_cards: read own"/);
    expect(sql).toMatch(/for select using \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/"credit_cards: admin read"/);
    expect(sql).toMatch(/for select using \(public\.is_admin\(\)\)/);
    // No user INSERT/UPDATE/DELETE policies: writes are RPC-only.
    const insertPolicies = sql.match(/create policy[^;]*for insert[^;]*on public\.credit_cards/g);
    const updatePolicies = sql.match(/create policy[^;]*for update[^;]*on public\.credit_cards/g);
    const deletePolicies = sql.match(/create policy[^;]*for delete[^;]*on public\.credit_cards/g);
    expect(insertPolicies ?? []).toHaveLength(0);
    expect(updatePolicies ?? []).toHaveLength(0);
    expect(deletePolicies ?? []).toHaveLength(0);
  });

  it("adds a nullable card_id FK (RESTRICT) + index to transactions", () => {
    expect(sql).toMatch(/add column if not exists card_id uuid references public\.credit_cards\(id\) on delete restrict/);
    expect(sql).toMatch(/create index if not exists transactions_card_idx/);
    expect(sql).toMatch(/on public\.transactions \(user_id, card_id\)/);
  });

  it("preserves existing card activity via a per-user legacy card backfill", () => {
    expect(sql).toMatch(/'My Card'/);
    expect(sql).toMatch(/greatest\(100000, v_charges\)/);
    expect(sql).toMatch(/update public\.transactions/);
    expect(sql).toMatch(/set card_id = v_card/);
    expect(sql).toMatch(/type in \('credit_card', 'credit_card_payment'\)/);
    expect(sql).toMatch(/card_id is null/);
    // Both sides of the ledger are backfilled together.
    expect(sql).toMatch(/filter \(where type = 'credit_card'\)/);
    expect(sql).toMatch(/filter \(where type = 'credit_card_payment'\)/);
  });

  it("recreates the transaction guard with card_id in the protected set", () => {
    const guard = block(sql, "guard_transactions_protected_columns(");
    expect(guard).toMatch(/new\.card_id is distinct from old\.card_id/);
    expect(guard).toMatch(/cannot_modify_protected_transaction_fields/);
  });

  it("installs an updated_at + limit guard on credit_cards", () => {
    const guard = block(sql, "guard_credit_cards_manage(");
    expect(guard).toMatch(/new\.updated_at := now\(\)/);
    expect(guard).toMatch(/new\.credit_limit is distinct from old\.credit_limit/);
    expect(guard).toMatch(/limit_below_outstanding/);
    expect(guard).toMatch(/drop trigger if exists credit_cards_guard_manage/);
    expect(guard).toMatch(/before update on public\.credit_cards/);
  });

  it("does NOT redefine any existing money RPC (backward compatibility)", () => {
    for (const fn of [
      "pay_credit_card",
      "apply_expense",
      "apply_income",
      "apply_savings_move",
      "delete_transaction",
      "mark_bill_paid",
      "_apply_bill_expense",
    ]) {
      expect(sql).not.toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
  });
});

describe("credit_cards migration — RPC surface", () => {
  const sql = readSql();

  it("defines create_credit_card(text, numeric, integer) with the staged signature", () => {
    const fn = block(sql, "create_credit_card(");
    expect(fn).toMatch(/create or replace function public\.create_credit_card\(\s*p_name text,/);
    expect(fn).toMatch(/p_credit_limit numeric/);
    expect(fn).toMatch(/p_billing_day integer/);
    expect(fn).toMatch(/security definer set search_path = public/);
    expect(fn).toMatch(/raise exception 'invalid_card_name'/);
    expect(fn).toMatch(/raise exception 'invalid_credit_limit'/);
    expect(fn).toMatch(/raise exception 'invalid_billing_day'/);
  });

  it("defines update_credit_card(uuid, text, numeric, integer) with the limit-below-outstanding guard", () => {
    const fn = block(sql, "update_credit_card(");
    expect(fn).toMatch(/p_card_id uuid/);
    expect(fn).toMatch(/select \* into v_card/);
    expect(fn).toMatch(/user_id = auth\.uid\(\)/);
    expect(fn).toMatch(/for update/);
    expect(fn).toMatch(/raise exception 'card_not_found'/);
    expect(fn).toMatch(/if p_credit_limit < v_outstanding then/);
    expect(fn).toMatch(/raise exception 'limit_below_outstanding'/);
  });

  it("defines delete_credit_card(uuid) that refuses to orphan history", () => {
    const fn = block(sql, "delete_credit_card(");
    expect(fn).toMatch(/for update/);
    expect(fn).toMatch(/raise exception 'card_not_found'/);
    expect(fn).toMatch(/select exists\(/);
    expect(fn).toMatch(/from public\.transactions\s+where card_id = p_card_id/);
    expect(fn).toMatch(/raise exception 'card_has_transactions'/);
  });

  it("defines list_credit_cards() returning derived per-card balances", () => {
    const fn = block(sql, "list_credit_cards(");
    expect(fn).toMatch(/returns table/);
    expect(fn).toMatch(/outstanding\s+numeric/);
    expect(fn).toMatch(/available\s+numeric/);
    expect(fn).toMatch(/when 'credit_card_payment' then -t\.amount/);
    expect(fn).toMatch(/left join public\.transactions t on t\.card_id = c\.id/);
    expect(fn).toMatch(/where c\.user_id = auth\.uid\(\)/);
    // available = credit_limit − outstanding (never beyond the limit).
    expect(fn).toMatch(/c\.credit_limit - coalesce\(/);
  });

  it("defines apply_credit_card_expense scoped to the card + auth.uid()", () => {
    const fn = block(sql, "apply_credit_card_expense(");
    expect(fn).toMatch(/p_card_id uuid/);
    expect(fn).toMatch(/select \* into v_card/);
    expect(fn).toMatch(/user_id = auth\.uid\(\)/);
    expect(fn).toMatch(/for update/);
    expect(fn).toMatch(/raise exception 'card_not_found'/);
    expect(fn).toMatch(/if p_amount > \(v_card\.credit_limit - v_outstanding\) then/);
    expect(fn).toMatch(/raise exception 'credit_limit_exceeded'/);
    // No salary deduction: overspend stored as the literal 0 for card charges.
    expect(fn).toMatch(/insert into public\.transactions \(user_id, type, category, subcategory, amount, overspend_amount, note, card_id\)/);
    expect(fn).toMatch(/^\s*0,\s*$/m);
    expect(fn).not.toMatch(/salary_balance/);
    // Still reports the over-budget excess for the UI warning.
    expect(fn).toMatch(/'overspend_amount', v_overspend/);
  });

  it("defines pay_card_bill scoped per card with the existing accounting rules", () => {
    const fn = block(sql, "pay_card_bill(");
    expect(fn).toMatch(/p_card_id uuid/);
    expect(fn).toMatch(/p_source text/);
    expect(fn).toMatch(/raise exception 'invalid_source'/);
    expect(fn).toMatch(/when type = 'credit_card_payment' then -amount/);
    expect(fn).toMatch(/raise exception 'payment_exceeds_outstanding'/);
    expect(fn).toMatch(/raise exception 'insufficient_balance'/);
    expect(fn).toMatch(/case when v_used_savings then 'savings' else 'salary' end/);
    expect(fn).toMatch(/'outstanding', v_outstanding - p_amount/);
  });

  it("scopes every RPC to auth.uid() — no client-supplied user_id", () => {
    for (const fnName of ["create_credit_card", "update_credit_card", "delete_credit_card", "apply_credit_card_expense", "pay_card_bill"]) {
      const fn = block(sql, `${fnName}(`);
      expect(fn).toMatch(/security definer set search_path = public/);
      expect(fn).not.toMatch(/p_user_id/);
      expect(fn).not.toMatch(/p_user\b/);
    }
  });

  it("grants execution to authenticated + service_role only for all six RPCs", () => {
    for (const fqn of [
      "public.create_credit_card(text, numeric, integer)",
      "public.update_credit_card(uuid, text, numeric, integer)",
      "public.delete_credit_card(uuid)",
      "public.list_credit_cards()",
      "public.apply_credit_card_expense(uuid, text, text, numeric, text)",
      "public.pay_card_bill(uuid, numeric, text)",
    ]) {
      expect(sql).toContain(`revoke all on function ${fqn} from public;`);
      expect(sql).toContain(`grant execute on function ${fqn} to authenticated, service_role;`);
    }
  });
});

describe("credit_cards migration — per-card outstanding model", () => {
  const sql = readSql();
  const charge = block(sql, "apply_credit_card_expense(");
  const pay = block(sql, "pay_card_bill(");

  it("computes outstanding as Σ(credit_card) − Σ(credit_card_payment) per card", () => {
    // Card-scoped: only rows attributed to this card count.
    expect(charge).toMatch(/card_id = p_card_id/);
    expect(charge).toMatch(/type in \('credit_card', 'credit_card_payment'\)/);
    const fixModel = `${charge}${pay}`;
    // Payments are stored positive, so net outstanding subtracts them.
    expect(fixModel).toMatch(/case when type = 'credit_card_payment' then -amount else amount end/);
  });

  it("keeps card charges independent of salary (never deducted, overspend 0)", () => {
    expect(charge).toMatch(/insert into public\.transactions \(user_id, type, category, subcategory, amount, overspend_amount, note, card_id\)/);
    expect(charge).toMatch(/'credit_card'/);
    // The insert stores the literal 0 — no salary deduction happens for card spend.
    expect(charge).toMatch(/^\s*0,\s*$/m);
  });

  it("records payments with the source token in note for delete_transaction refunds", () => {
    expect(pay).toMatch(/insert into public\.transactions \(user_id, type, amount, overspend_amount, note, card_id\)/);
    expect(pay).toMatch(/'credit_card_payment'/);
    expect(pay).toMatch(/case when v_used_savings then 'savings' else 'salary' end/);
    expect(pay).toMatch(/p_card_id/);
  });

  it("locks the card row first, then the profile — consistent lock order", () => {
    for (const fn of [charge, pay]) {
      const cardLock = fn.indexOf("from public.credit_cards");
      const profileLock = fn.indexOf("from public.profiles");
      expect(cardLock).toBeGreaterThanOrEqual(0);
      expect(profileLock).toBeGreaterThan(cardLock);
    }
  });
});