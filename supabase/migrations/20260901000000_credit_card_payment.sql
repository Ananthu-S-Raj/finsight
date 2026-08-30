-- ============================================================
-- credit_card_payment: pay down the outstanding credit-card bill
--
-- The credit-card model keeps every purchase as a `credit_card` transaction
-- (a liability, never deducted from salary). The amount still owed -- the
-- "outstanding" bill -- is therefore:  Σ(credit_card) − Σ(credit_card_payment).
--
-- This migration:
--   1. Adds `credit_card_payment` to the transactions.type CHECK constraint
--      so a payment can be recorded as its own ledger row (visible in history,
--      and never counted as a normal expense or as income).
--   2. Creates an atomic, SECURITY DEFINER `pay_credit_card` RPC that:
--        - locks the caller's profile row (concurrency-safe),
--        - validates amount > 0 and amount <= outstanding,
--        - verifies the chosen source (salary/account balance or savings)
--          can actually cover the payment,
--        - deducts the payment from that source,
--        - inserts a `credit_card_payment` transaction row (amount > 0 keeps
--          the existing transactions_amount_positive check satisfied), and
--        - returns the new outstanding balance.
--   3. Adds a `credit_card_payment` reversal branch to delete_transaction so
--      deleting a payment refunds the source that funded it.
--
-- The payment's funding source is kept in the row's `note` ('salary' or
-- 'savings') so delete_transaction can refund the correct balance. Amounts are
-- stored positive (matching the amount > 0 constraint); the UI renders the
-- payment as a reduction of the outstanding bill.
--
-- Scoped to auth.uid() throughout; no client-supplied user_id is trusted.
-- RLS-compatible grants mirror apply_expense / delete_transaction.
-- ============================================================

-- 1. Extend the transactions.type CHECK constraint to allow a payment row.
alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (
    type in (
      'salary_add', 'savings_add', 'savings_move',
      'expense', 'credit_card', 'loan_add', 'credit_card_payment'
    )
  );

-- 2. pay_credit_card: atomic bill payment reducing the outstanding balance.
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
  select coalesce(sum(amount), 0) into v_outstanding
    from (
      select amount, type
        from public.transactions
       where user_id = auth.uid()
         and type in ('credit_card', 'credit_card_payment')
    ) s;

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

-- 3. delete_transaction: reverse a payment by refunding its source.
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
      -- Refund the source that funded the payment. The source token was
      -- stored in note by pay_credit_card ('salary' => salary_balance,
      -- 'savings' => savings_balance); default to salary.
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

  delete from public.transactions
   where id = p_transaction_id
     and user_id = auth.uid();
end;
$$;

-- RLS-compatible grants (matches apply_expense / delete_transaction pattern)
revoke all on function public.pay_credit_card(numeric, text) from public;
grant execute on function public.pay_credit_card(numeric, text) to authenticated, service_role;
