-- ============================================================
-- Fix pay_credit_card outstanding computation.
--
-- The original 20260901000000 migration computed outstanding as
--   Σ(amount) WHERE type IN ('credit_card', 'credit_card_payment')
-- summing BOTH types as positive amounts. Payments are stored positive, so
-- every payment INFLATED outstanding instead of reducing it, and the
-- payment_exceeds_outstanding guard could never stop a caller from "paying"
-- a phantom bill and draining salary/savings.
--
-- Correct mathematics (what the UI and docs already assume):
--   outstanding = Σ(credit_card) − Σ(credit_card_payment)
--
-- Applied AFTER 20260901000000 (which may already have run remotely), this
-- CREATE OR REPLACEs the function in place with the corrected arithmetic.
-- SECURITY DEFINER, search_path, profile row-locking, auth.uid() ownership,
-- source validation, balance guards and the return structure are preserved;
-- grants are re-asserted for idempotence.
-- ============================================================

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

  -- 2a. Lock the caller's profile to serialize concurrent balance changes.
  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  -- 2b. Outstanding bill = Σ(credit_card) − Σ(credit_card_payment).
  --     Payments are stored positive, so they are subtracted here.
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

  -- 2c. Verify the chosen source can cover the payment.
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

  -- 2d. Record the payment. The source token is stored in note so
  --     delete_transaction can refund the correct balance.
  v_used_savings := (p_source = 'savings');

  insert into public.transactions (user_id, type, amount, overspend_amount, note)
  values (
    auth.uid(),
    'credit_card_payment',
    p_amount,
    0,
    case when v_used_savings then 'savings' else 'salary' end
  );

  -- 2e. Report the new outstanding balance.
  return jsonb_build_object(
    'outstanding', v_outstanding - p_amount,
    'source', p_source
  );
end;
$$;

-- Re-assert RLS-compatible grants (mirror of the original migration).
revoke all on function public.pay_credit_card(numeric, text) from public;
grant execute on function public.pay_credit_card(numeric, text) to authenticated, service_role;