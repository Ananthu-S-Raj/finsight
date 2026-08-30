-- ============================================================
-- apply_expense: a normal (cash) expense must be addable when the
-- user's salary balance is sufficient for the amount that must
-- actually come from salary (the overspend).
--
-- Root cause fixed here: the overspend formula used
--   greatest(0, v_spent + p_amount - greatest(monthly_budget, v_spent))
-- which, when no budget is configured (monthly_budget defaults to 0),
-- treated the ENTIRE expense as overspend. A fresh profile has both
-- monthly_budget = 0 and salary_balance = 0, so ANY normal expense was
-- rejected with insufficient_balance even though nothing genuinely had
-- to come from salary. The credit-card Task 3 fix kept that behaviour
-- for cards by skipping the salary path, but ordinary expenses were
-- still wrongly blocked.
--
-- New behaviour:
--   * No budget configured (monthly_budget <= 0) -> there is no cap to
--     exceed, so overspend is 0 and the expense is allowed regardless of
--     salary balance. (Nothing must come from salary.)
--   * Budget configured -> the existing overspend accounting is preserved
--     unchanged (only the real over-budget excess is charged to salary and
--     the insufficient_balance guard still applies).
--   * Credit-card charges remain fully salary-independent (Task 3 rule):
--     card=true skips the salary check/deduction and stores overspend 0.
--
-- Same 5-argument signature as the function the app calls (recordSpend ->
-- apply_expense(text,text,numeric,text,boolean)); CREATE OR REPLACE is
-- safe here because the signature is unchanged (no DROP needed, grants are
-- preserved). No new overload is introduced.
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

  -- Overspend is the amount beyond the configured budget that must come
  -- from salary. When no budget is configured (<= 0), there is no cap to
  -- exceed, so nothing must come from salary (overspend = 0). This is what
  -- lets a user with a zero salary balance add a normal expense unless they
  -- have actually set a budget and are genuinely spending past it.
  v_overspend := case
    when v_profile.monthly_budget <= 0 then 0
    else greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent))
  end;

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
