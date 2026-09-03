-- Fix P2-A: spurious "over budget" toasts when no budget is configured.
--
-- The converged schema's comment at line 215-216 of 20260910... states:
--   "No monthly budget set (or no way to exceed it) => no over-budget report."
-- However the formula `greatest(0, v_spent + p_amount - greatest(monthly_budget, v_spent))`
-- with monthly_budget = 0 evaluates to `v_spent + p_amount - v_spent = p_amount`
-- (for v_spent > 0) and even `0 + p_amount - 0 = p_amount` (v_spent = 0),
-- producing a spurious "over budget by ₹N" toast on every expense when no
-- budget is set. The old 20260831... migration had an explicit guard
-- (`if monthly_budget <= 0 then overspend := 0`) but that was dropped during
-- convergence.
--
-- This migration redefines the three RPCs that return overspend_amount for the
-- UI to add back that guard WITHOUT altering:
--   - stored overspend_amount (cash = p_amount, card = 0, unchanged)
--   - salary_balance deduction logic
--   - insert shape or triggers
--   - function signatures, volatility, security, grants
-- Balance accounting and create/delete symmetry are unchanged.

-- 1. apply_expense(text, text, numeric, text, boolean)
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

  -- Over-budget excess: only meaningful when a budget is actually set.
  -- When monthly_budget is 0 or null, there is nothing to exceed, so
  -- report 0 to avoid spurious "over budget" toasts.
  if coalesce(v_profile.monthly_budget, 0) > 0 then
    v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));
  else
    v_overspend := 0;
  end if;

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

-- 2. apply_credit_card_expense(uuid, text, text, numeric, text)
create or replace function public.apply_credit_card_expense(
  p_card_id uuid,
  p_category text,
  p_subcategory text,
  p_amount numeric,
  p_note text default ''
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_card         public.credit_cards%rowtype;
  v_profile      public.profiles%rowtype;
  v_outstanding  numeric;
  v_spent        numeric;
  v_overspend    numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_card
    from public.credit_cards
   where id = p_card_id
     and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'card_not_found';
  end if;

  -- Outstanding on THIS card = sum(credit_card) - sum(credit_card_payment).
  select coalesce(sum(
    case when type = 'credit_card_payment' then -amount else amount end
  ), 0) into v_outstanding
    from public.transactions
   where card_id = p_card_id
     and type in ('credit_card', 'credit_card_payment');

  if p_amount > (v_card.credit_limit - v_outstanding) then
    raise exception 'credit_limit_exceeded';
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

  -- Over-budget excess: only meaningful when a budget is actually set.
  if coalesce(v_profile.monthly_budget, 0) > 0 then
    v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));
  else
    v_overspend := 0;
  end if;

  -- Card charges never draw on (or are blocked by) the salary balance.
  insert into public.transactions (user_id, type, category, subcategory, amount, overspend_amount, note, card_id)
  values (
    auth.uid(),
    'credit_card',
    p_category,
    p_subcategory,
    p_amount,
    0,
    coalesce(p_note, ''),
    p_card_id
  );

  return jsonb_build_object(
    'overspend_amount', v_overspend,
    'outstanding', v_outstanding + p_amount
  );
end;
$$;

-- 3. _apply_bill_expense(uuid, text, text, numeric, text, boolean, uuid)
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

  -- Over-budget excess: only meaningful when a budget is actually set.
  if coalesce(v_profile.monthly_budget, 0) > 0 then
    v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));
  else
    v_overspend := 0;
  end if;

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
