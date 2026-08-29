-- ============================================================
-- apply_expense: credit-card charges are independent of salary.
--
-- A credit-card charge is a monthly liability / card-spend entry, NOT a
-- cash transaction drawn from the user's salary balance. Previously the
-- overspend logic (insufficient_balance check + salary deduction) applied
-- to card charges too, which meant:
--   - a card charge pushing monthly spend past budget was rejected when the
--     salary balance couldn't cover the overspend, and
--   - the overspend was deducted from salary_balance.
--
-- This migration re-defines the single apply_expense overload that the app
-- actually calls (text, text, numeric, text, boolean — see recordSpend) so
-- that when p_is_credit_card = true:
--   - the overspend insufficient_balance check is skipped
--   - no salary_balance deduction happens
--   - overspend_amount is stored as 0 (nothing was deducted from salary)
--   - type = 'credit_card' is still stored
-- The computed overspend is still returned so the UI can show a budget
-- warning, and normal (non-credit-card) expenses keep their existing,
-- unchanged accounting.
--
-- Only this exact existing signature is redefined. No other overload is
-- created, granted, or dropped.
--
-- delete_transaction already reverses expense/credit_card rows by refunding
-- overspend_amount back to salary. Because credit-card rows now store
-- overspend_amount = 0, deleting a card charge never mutates salary_balance,
-- which keeps create/delete accounting consistent (no phantom refund).
-- ============================================================

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

  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

  -- Only cash expenses ever draw on (and are blocked by) the salary balance.
  -- A credit-card charge is a liability and must never be rejected for an
  -- insufficient salary balance, and never deducts from salary.
  if not v_credit and v_overspend > 0 then
    if v_profile.salary_balance < v_overspend then
      raise exception 'insufficient_balance';
    end if;
    update public.profiles
       set salary_balance = v_profile.salary_balance - v_overspend
     where id = auth.uid();
  end if;

  insert into public.transactions (user_id, type, category, subcategory, amount, overspend_amount, note)
  values (
    auth.uid(),
    case when v_credit then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    case when v_credit then 0 else v_overspend end,
    coalesce(p_note, '')
  );

  return jsonb_build_object('overspend_amount', v_overspend);
end;
$$;
