-- ============================================================
-- delete_transaction: atomic delete with balance reversal
-- Mirrors apply_expense / apply_income / apply_savings_move
-- Reverse-effects (e.g. overspend refund) are computed from
-- the transaction row itself, NOT by querying the budget, so
-- the logic stays correct even after month-rollover.
-- ============================================================
create or replace function public.delete_transaction(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tx    public.transactions%rowtype;
  v_profile public.profiles%rowtype;
begin
  -- 1. Fetch the target transaction (must belong to the caller)
  select * into v_tx
    from public.transactions
   where id = p_transaction_id
     and user_id = auth.uid();

  if not found then
    raise exception 'transaction_not_found';
  end if;

  -- 2. Lock the profile row to prevent concurrent balance mutations
  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  -- 3. Reverse balance effects
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
      -- Only reverse the overspend portion that was deducted from salary
      if v_tx.overspend_amount > 0 then
        update public.profiles
           set salary_balance = v_profile.salary_balance + v_tx.overspend_amount
         where id = auth.uid();
      end if;

    else
      raise exception 'unknown_transaction_type';
  end case;

  -- 4. Delete the transaction
  delete from public.transactions
   where id = p_transaction_id
     and user_id = auth.uid();

end;
$$;

-- RLS-compatible grants (matches apply_expense / apply_income pattern)
revoke all on function public.delete_transaction(uuid) from public;
grant execute on function public.delete_transaction(uuid) to authenticated, service_role;
