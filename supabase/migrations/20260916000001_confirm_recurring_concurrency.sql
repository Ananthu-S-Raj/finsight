-- Fix: confirm_recurring_occurrence concurrency (FOR UPDATE)
--
-- The audit found that confirm_recurring_occurrence reads the occurrence row
-- without a row-level lock. Two concurrent confirms of the same pending
-- occurrence can both read status = 'pending' before either commits. The
-- unique index on transactions prevents a duplicate transaction from being
-- created, but the second request receives a raw unique-violation (500)
-- instead of the graceful already_processed response.
--
-- Fix: add FOR UPDATE to the initial occurrence SELECT. This serialises
-- concurrent confirms: the second request waits for the first to commit,
-- re-reads the locked row (now status = 'confirmed'), and returns the
-- idempotent {already_processed: true} result.
--
-- This migration drops and recreates confirm_recurring_occurrence with the
-- identical signature, security properties, and grants. The only change is
-- the addition of `for update` on line 584 of the original body.

drop function if exists public.confirm_recurring_occurrence(uuid);

create or replace function public.confirm_recurring_occurrence(
  p_occurrence_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_occ public.recurring_occurrences%rowtype;
  v_rule public.recurring_transactions%rowtype;
  v_tx_id uuid;
begin
  select * into v_occ
    from public.recurring_occurrences
   where id = p_occurrence_id
   for update;

  if not found then
    raise exception 'occurrence_not_found';
  end if;
  if v_occ.user_id is distinct from auth.uid() then
    raise exception 'unauthorized';
  end if;
  if v_occ.status <> 'pending' then
    return jsonb_build_object('already_processed', true, 'transaction_id', v_occ.transaction_id);
  end if;

  select * into v_rule
    from public.recurring_transactions
   where id = v_occ.recurring_transaction_id;

  if not found then
    raise exception 'rule_not_found';
  end if;

  if v_rule.type = 'expense' then
    perform public._apply_recurring_expense(
      v_rule.user_id,
      v_rule.category,
      v_rule.subcategory,
      v_rule.amount,
      v_rule.description,
      coalesce(v_rule.account = 'credit_card', false),
      v_rule.id,
      v_occ.occurrence_date
    );
  elsif v_rule.type = 'income' then
    perform public._apply_recurring_income(
      v_rule.user_id,
      v_rule.account,
      v_rule.amount,
      v_rule.description,
      v_rule.id,
      v_occ.occurrence_date
    );
  elsif v_rule.type = 'transfer' then
    perform public._apply_recurring_transfer(
      v_rule.user_id,
      v_rule.amount,
      v_rule.id,
      v_occ.occurrence_date
    );
  else
    raise exception 'invalid_rule_type';
  end if;

  select id into v_tx_id
    from public.transactions
   where recurring_transaction_id = v_rule.id
     and occurrence_date = v_occ.occurrence_date
   limit 1;

  update public.recurring_occurrences
     set status = 'confirmed',
         transaction_id = v_tx_id,
         updated_at = now()
   where id = p_occurrence_id;

  return jsonb_build_object('transaction_id', v_tx_id, 'already_processed', false);
end;
$$;

-- Preserve the original privilege model.
revoke all on function public.confirm_recurring_occurrence(uuid) from public;
grant execute on function public.confirm_recurring_occurrence(uuid) to authenticated, service_role;
