-- ============================================================
-- Converge the production schema with the migration history.
--
-- Root cause observed on the production database (live PostgREST
-- probes, 2026-08-31): although the migration history is in sync,
-- the live schema has DRIFTED from the migration files:
--   * public.apply_savings_move(numeric) is MISSING
--     (RPC 404 "no matches were found in the schema cache").
--   * public.pay_credit_card(numeric, text) is MISSING
--     (same RPC 404).
--   * public.apply_expense / apply_income / delete_transaction /
--     mark_bill_paid exist but still execute for the anonymous role
--     (the `revoke ... from public` hardening never applied).
--
-- This migration is IDEMPOTENT: every statement is CREATE OR REPLACE
-- or a repeatable revoke/grant, so it is safe to run again and safe
-- to apply on both a fresh database and the drifted production one.
--
-- It also changes the expense accounting model (the agreed fix):
--   * A normal (cash) expense deducts its FULL amount from
--     salary_balance, and the deduction is NEVER blocked — a fresh user
--     with no salary can still log expenses and the balance may go
--     negative. defense for "available balance not decreasing".
--   * A credit-card charge is a liability only: it never touches
--     salary_balance (as already established by 20260830000000).
--   * overspend_amount now stores the salary balance this transaction
--     actually consumed (p_amount for cash expenses, 0 for cards), so
--     delete_transaction refunds exactly what was deducted.
--   * The RPC return value still reports the OVER-BUDGET excess
--     (v_overspend) so the QuickAdd "you're over budget" toast and the
--     bills "over budget, covered from salary" message keep working.
--
-- Apply to the production project by pushing all pending migrations
-- (this is the last one) or by pasting this file into the Supabase
-- SQL Editor. Logged-in users call these functions as the
-- `authenticated` role; the edge functions call them as
-- `service_role`; both keep EXECUTE. Only the anonymous role is
-- revoked.
-- ============================================================

-- ------------------------------------------------------------
-- 1. apply_savings_move(numeric) — recreate (was missing live).
--    Unchanged behaviour: a savings move never leaves the salary
--    balance negative and records a savings_move transaction.
-- ------------------------------------------------------------
create or replace function public.apply_savings_move(
  p_amount numeric
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if v_profile.salary_balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  update public.profiles
     set salary_balance = v_profile.salary_balance - p_amount,
         savings_balance = v_profile.savings_balance + p_amount
   where id = auth.uid();

  insert into public.transactions (user_id, type, amount)
  values (auth.uid(), 'savings_move', p_amount);
end;
$$;

-- ------------------------------------------------------------
-- 2. pay_credit_card(numeric, text) — recreate (was missing live).
--    Uses the corrected outstanding arithmetic:
--      outstanding = Σ(credit_card) − Σ(credit_card_payment)
--    so payments reduce the bill instead of inflating it.
-- ------------------------------------------------------------
create or replace function public.pay_credit_card(
  p_amount numeric,
  p_source text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile       public.profiles%rowtype;
  v_outstanding   numeric;
  v_used_savings  boolean;
begin
  if p_source is null or p_source not in ('salary', 'savings') then
    raise exception 'invalid_source';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  select coalesce(
    sum(
      case
        when type = 'credit_card' then amount
        when type = 'credit_card_payment' then -amount
        else 0
      end
    ),
    0
  )
  into v_outstanding
  from public.transactions
  where user_id = auth.uid()
    and type in ('credit_card', 'credit_card_payment');

  if p_amount > v_outstanding then
    raise exception 'payment_exceeds_outstanding';
  end if;

  if p_source = 'salary' then
    if v_profile.salary_balance < p_amount then
      raise exception 'insufficient_balance';
    end if;
    update public.profiles
       set salary_balance = v_profile.salary_balance - p_amount
     where id = auth.uid();
  else
    if v_profile.savings_balance < p_amount then
      raise exception 'insufficient_balance';
    end if;
    update public.profiles
       set savings_balance = v_profile.savings_balance - p_amount
     where id = auth.uid();
  end if;

  v_used_savings := (p_source = 'savings');

  insert into public.transactions (user_id, type, amount, overspend_amount, note)
  values (
    auth.uid(),
    'credit_card_payment',
    p_amount,
    0,
    case when v_used_savings then 'savings' else 'salary' end
  );

  return jsonb_build_object(
    'outstanding', v_outstanding - p_amount,
    'source', p_source
  );
end;
$$;

-- ------------------------------------------------------------
-- 3. apply_expense(text, text, numeric, text, boolean) — the
--    agreed accounting model:
--      card     -> no salary interaction at all, overspend_amount = 0
--      cash     -> salary_balance -= FULL p_amount (never blocked,
--                  balance may go negative), overspend_amount = p_amount
--    The return value is still the over-budget EXCESS for the UI toast.
-- ------------------------------------------------------------
create or replace function public.apply_expense(
  p_category text,
  p_subcategory text,
  p_amount numeric,
  p_note text,
  p_is_credit_card boolean
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile     public.profiles%rowtype;
  v_spent       numeric;
  v_overspend   numeric;
  v_credit      boolean;
begin
  v_credit := coalesce(p_is_credit_card, false);

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  select coalesce(sum(amount), 0) into v_spent
    from public.transactions
   where user_id = auth.uid()
     and type in ('expense', 'credit_card')
     and created_at >= date_trunc('month', now());

  -- Over-budget excess, used only for the UI warning. No monthly budget
  -- set (or no way to exceed it) => no over-budget report.
  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

  -- Cash expenses consume salary_balance immediately and are never blocked:
  -- a fresh user with no salary can log expenses (balance may go negative).
  -- Credit-card charges are liabilities and never touch salary_balance.
  if not v_credit then
    update public.profiles
       set salary_balance = v_profile.salary_balance - p_amount
     where id = auth.uid();
  end if;

  insert into public.transactions (user_id, type, category, subcategory, amount, overspend_amount, note)
  values (
    auth.uid(),
    case when v_credit then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    case when v_credit then 0 else p_amount end,
    coalesce(p_note, '')
  );

  return jsonb_build_object('overspend_amount', v_overspend);
end;
$$;

-- ------------------------------------------------------------
-- 4. _apply_bill_expense(uuid, text, text, numeric, text, boolean,
--    uuid) — the same accounting model for bills. Returns the
--    over-budget excess (unchanged) so mark_bill_paid keeps returning
--    the same shape to the bills page toast.
-- ------------------------------------------------------------
create or replace function public._apply_bill_expense(
  p_user_id uuid,
  p_category text,
  p_subcategory text,
  p_amount numeric,
  p_note text,
  p_is_credit_card boolean,
  p_bill_payment_id uuid
)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_spent numeric;
  v_overspend numeric;
  v_duplicate boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select exists (
    select 1 from public.transactions where bill_payment_id = p_bill_payment_id
  ) into v_duplicate;
  if v_duplicate then
    raise exception 'duplicate_payment';
  end if;

  select * into v_profile
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  select coalesce(sum(amount), 0) into v_spent
    from public.transactions
   where user_id = p_user_id
     and type in ('expense', 'credit_card')
     and created_at >= date_trunc('month', now());

  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

  if not coalesce(p_is_credit_card, false) then
    update public.profiles
       set salary_balance = v_profile.salary_balance - p_amount
     where id = p_user_id;
  end if;

  insert into public.transactions (
    user_id, type, category, subcategory, amount, overspend_amount, note,
    bill_payment_id
  )
  values (
    p_user_id,
    case when coalesce(p_is_credit_card, false) then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    case when coalesce(p_is_credit_card, false) then 0 else p_amount end,
    coalesce(p_note, ''),
    p_bill_payment_id
  );

  return v_overspend;
end;
$$;

-- ------------------------------------------------------------
-- 5. delete_transaction(uuid) — recreate unchanged (refunds the
--    stored salary-consumed amount, so it stays correct across both
--    the old "excess only" rows and the new "full amount" rows).
-- ------------------------------------------------------------
create or replace function public.delete_transaction(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tx        public.transactions%rowtype;
  v_profile   public.profiles%rowtype;
  v_from_savings boolean;
begin
  select * into v_tx
    from public.transactions
   where id = p_transaction_id
     and user_id = auth.uid();

  if not found then
    raise exception 'transaction_not_found';
  end if;

  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  case v_tx.type
    when 'salary_add' then
      update public.profiles
         set salary_balance = v_profile.salary_balance - v_tx.amount
       where id = auth.uid();

    when 'savings_add' then
      update public.profiles
         set savings_balance = v_profile.savings_balance - v_tx.amount
       where id = auth.uid();

    when 'savings_move' then
      update public.profiles
         set salary_balance  = v_profile.salary_balance  + v_tx.amount,
             savings_balance = v_profile.savings_balance - v_tx.amount
       where id = auth.uid();

    when 'loan_add' then
      update public.profiles
         set salary_balance = v_profile.salary_balance - v_tx.amount
       where id = auth.uid();

    when 'expense', 'credit_card' then
      if v_tx.overspend_amount > 0 then
        update public.profiles
           set salary_balance = v_profile.salary_balance + v_tx.overspend_amount
         where id = auth.uid();
      end if;

    when 'credit_card_payment' then
      v_from_savings := (coalesce(v_tx.note, '') = 'savings');
      if v_from_savings then
        update public.profiles
           set savings_balance = v_profile.savings_balance + v_tx.amount
         where id = auth.uid();
      else
        update public.profiles
           set salary_balance = v_profile.salary_balance + v_tx.amount
         where id = auth.uid();
      end if;

    else
      raise exception 'unknown_transaction_type';
  end case;

  delete from public.transactions where id = p_transaction_id and user_id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- 6. Security hardening — re-assert the money RPC privilege model.
--    Logged-in users (authenticated) and the edge functions
--    (service_role) keep EXECUTE; the anonymous role is revoked.
--    These functions all exist after the CREATE OR REPLACE blocks
--    above, so the revokes are safe on the drifted production DB.
-- ------------------------------------------------------------
revoke all on function public.apply_expense(text, text, numeric, text, boolean) from public;
revoke all on function public.apply_income(text, numeric, text) from public;
revoke all on function public.apply_savings_move(numeric) from public;
revoke all on function public.pay_credit_card(numeric, text) from public;
revoke all on function public.delete_transaction(uuid) from public;
revoke all on function public._apply_bill_expense(uuid, text, text, numeric, text, boolean, uuid) from public;
revoke all on function public.mark_bill_paid(uuid, boolean) from public;

grant execute on function public.apply_expense(text, text, numeric, text, boolean) to authenticated, service_role;
grant execute on function public.apply_income(text, numeric, text) to authenticated, service_role;
grant execute on function public.apply_savings_move(numeric) to authenticated, service_role;
grant execute on function public.pay_credit_card(numeric, text) to authenticated, service_role;
grant execute on function public.delete_transaction(uuid) to authenticated, service_role;
grant execute on function public._apply_bill_expense(uuid, text, text, numeric, text, boolean, uuid) to authenticated, service_role;
grant execute on function public.mark_bill_paid(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Remaining app-facing RPCs (recurring, goals, reminders,
--    categories, permissions, password reset). Applied through a
--    DO block that only touches functions that actually exist, so a
--    function the drift left behind can never abort this migration.
-- ------------------------------------------------------------
do $sweep$
declare
  v_names text[] := array[
    'process_recurring_due',
    'confirm_recurring_occurrence',
    'skip_recurring_occurrence',
    'next_recurring_date',
    'next_bill_due_date',
    'generate_bill_reminders',
    'generate_all_bill_reminders',
    'generate_goal_reminders',
    'generate_all_goal_reminders',
    'contribute_to_goal',
    'remove_goal_contribution',
    'has_permission',
    'request_password_reset',
    'mark_password_reset_token_used',
    'set_password_changed_at',
    'transactions_apply',
    'categories_create',
    'categories_delete'
  ];
  v_rec record;
begin
  for v_rec in
    select quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' as fqn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (v_names)
  loop
    execute format('revoke all on function %s from public;', v_rec.fqn);
    execute format('grant execute on function %s to authenticated, service_role;', v_rec.fqn);
  end loop;
end;
$sweep$;