-- ============================================================
-- FinSight — Financial integrity hardening (audit fixes, round 1)
-- (migration 20260915000000_financial_integrity)
--
-- Fixes from the production A–Z audit, all in the database layer:
--
--  P1 #1 — Recurring expenses kept the PRE-convergence accounting model.
--    `_apply_recurring_expense` (20260811000001) deducted only the over-budget
--    EXCESS and raised `insufficient_balance` when salary/<budget> was low, so:
--      * credit-card recurring charges depended on salary availability (wrong —
--        card charges are liabilities and must never touch salary);
--      * cash recurring charges were silently dropped when salary/monthly-budget
--        was zero (budget=0 produced full-amount overspend -> insufficient_balance
--        -> process_recurring_due swallowed the error and marked it failed).
--    We now mirror the converged `apply_expense` model exactly:
--      * cash  -> salary_balance -= FULL amount (never blocked, may go negative),
--                 overspend_amount = p_amount (refundable by delete_transaction)
--      * card  -> never touches salary_balance, overspend_amount = 0
--      * the RPC still returns the over-budget EXCESS for the UI toast.
--
--  P1 #2 — Balance-minting vector via direct `transactions` INSERT.
--    The only legitimate way to write a transaction is through the SECURITY
--    DEFINER money RPCs (apply_expense / apply_income / apply_savings_move /
--    pay_* / *_recurring / card RPCs). All the app and every Edge Function use
--    those RPCs (they run as the definer/postgres, bypassing this guard). No
--    client ever legitimately INSERTs a ledger row directly. A malicious client
--    could previously INSERT a forged row (e.g. `expense` with
--    overspend_amount=50000, or a `credit_card_payment` with note='savings')
--    and then call delete_transaction to refund it -> minting money.
--    We now add a BEFORE INSERT guard that rejects any direct INSERT issued by
--    a non-trusted server role (authenticated/anon). Trusted server code
--    (postgres / supabase_admin / service_role / definer RPCs) is unaffected.
--
--  P2 B — delete_transaction TOCTOU race.
--    The transaction row was read without a lock; two concurrent deletes could
--    both re-read the same balance and double-refund. We lock the row with
--    SELECT ... FOR UPDATE so the second delete blocks until the first commits
--    and then sees the row is gone -> 'transaction_not_found' (no double
--    refund, naturally idempotent).
--
--  P2 E — Category RPCs trusted a client-supplied p_user.
--    categories_create / categories_delete are SECURITY DEFINER and took a
--    client-supplied p_user UUID with no auth.uid() verification, so a caller
--    could create/delete another user's categories by supplying their UUID.
--    They are no longer called by the app (categories are admin-managed now),
--    but the direct-RPC surface must be safe. We derive identity from
--    auth.uid() and ignore any client-supplied id.
--
-- The accounting invariant from 20260910000000 is preserved throughout:
--   cash deducts full amount (never blocked), card never touches salary,
--   overspend_amount stores refundable salary consumption, delete refunds
--   exactly what was stored, and security definer RPCs remain the single
--   trusted money path.
-- ============================================================

-- ------------------------------------------------------------
-- P1 #1 — Redefine _apply_recurring_expense on the converged model.
-- Signature is unchanged so process_recurring_due and
-- confirm_recurring_occurrence call it exactly as before.
-- ------------------------------------------------------------
create or replace function public._apply_recurring_expense(
  p_user_id uuid,
  p_category text,
  p_subcategory text,
  p_amount numeric,
  p_note text,
  p_is_credit_card boolean,
  p_recurring_transaction_id uuid,
  p_occurrence_date date
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_spent   numeric;
  v_overspend numeric;
  v_credit  boolean;
  v_duplicate boolean;
begin
  v_credit := coalesce(p_is_credit_card, false);

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select exists (
    select 1 from public.transactions
    where recurring_transaction_id = p_recurring_transaction_id
      and occurrence_date = p_occurrence_date
  ) into v_duplicate;
  if v_duplicate then
    return jsonb_build_object('overspend_amount', 0, 'duplicate', true);
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

  -- Over-budget EXCESS, used only for the UI warning (converged behaviour).
  -- When monthly_budget is 0 or null there is nothing to exceed, so report 0
  -- to avoid spurious "over budget" toasts (same guard as apply_expense).
  if coalesce(v_profile.monthly_budget, 0) > 0 then
    v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));
  else
    v_overspend := 0;
  end if;

  -- Cash deducts the FULL amount and is never blocked (salary may go negative).
  -- Card charges are liabilities and never touch salary; overspend stored as 0.
  if not v_credit then
    update public.profiles
       set salary_balance = v_profile.salary_balance - p_amount
     where id = p_user_id;
  end if;

  insert into public.transactions (
    user_id, type, category, subcategory, amount, overspend_amount, note,
    recurring_transaction_id, occurrence_date
  )
  values (
    p_user_id,
    case when v_credit then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    case when v_credit then 0 else p_amount end,
    coalesce(p_note, ''),
    p_recurring_transaction_id,
    p_occurrence_date
  );

  return jsonb_build_object('overspend_amount', v_overspend, 'duplicate', false);
end;
$$;

-- ------------------------------------------------------------
-- P1 #2 — BEFORE INSERT guard on transactions. Direct client INSERTs are
-- rejected (all legitimate ledger writes go through SECURITY DEFINER RPCs,
-- which run as the definer/trusted server roles and are unaffected). This
-- closes the forge-then-refund minting vector at the source.
-- ------------------------------------------------------------
create or replace function public.guard_transactions_no_direct_insert()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'direct_transaction_insert_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_guard_no_direct_insert on public.transactions;
create trigger transactions_guard_no_direct_insert
  before insert on public.transactions
  for each row execute function public.guard_transactions_no_direct_insert();

-- ------------------------------------------------------------
-- P2 B — delete_transaction: lock the transaction row so concurrent deletes
-- cannot both re-read the balance and double-refund. The profile is then
-- locked and the existing refund logic runs unchanged.
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
  -- FOR UPDATE serializes concurrent deletes of the same row: the second caller
  -- blocks until the first commits, then finds the row deleted and raises
  -- 'transaction_not_found' -> no double refund (naturally idempotent).
  select * into v_tx
    from public.transactions
   where id = p_transaction_id
     and user_id = auth.uid()
   for update;

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
-- P2 E — Category RPCs: derive identity from auth.uid(), never trust a
-- client-supplied user id. The legacy p_user parameter is kept (for call
-- compatibility) but ignored; ownership/limits now use the authenticated user.
-- ------------------------------------------------------------
create or replace function public.categories_create(p_name text, p_user uuid)
returns public.categories language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid;
  v_cap   int;
  v_count int;
  v_result public.categories;
begin
  -- Never trust a caller-supplied identity.
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  p_name := lower(btrim(p_name));
  if p_name = '' then
    raise exception 'Category name cannot be empty';
  end if;
  if length(p_name) > 40 then
    raise exception 'Category name is too long';
  end if;

  if exists (
    select 1 from public.categories
    where lower(name) = p_name
      and user_id is not distinct from v_uid
  ) then
    raise exception 'Category already exists';
  end if;

  v_cap := coalesce((
    select (s.value ->> 'max_custom_per_user')::int
    from public.app_settings s
    where s.key = 'categories'
    limit 1
  ), 20);

  select count(*) into v_count from public.categories where user_id = v_uid;
  if v_count >= v_cap then
    raise exception 'Custom category limit reached';
  end if;

  insert into public.categories (name, user_id)
  values (p_name, v_uid)
  returning * into v_result;

  return v_result;
end $$;

create or replace function public.categories_delete(p_id uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid;
  v_name  text;
  v_row   public.categories;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select * into v_row
  from public.categories
  where id = p_id and user_id = v_uid
  for update;

  if v_row.id is null then
    raise exception 'Category not found';
  end if;

  v_name := lower(v_row.name);

  -- Refuse deletion while transactions still reference the category.
  if exists (
    select 1 from public.transactions
    where user_id = v_uid and category_id = p_id
  ) then
    raise exception 'Category is in use';
  end if;

  -- Recurring transactions referencing the category lose their pointer
  -- (the snapshot in category remains).
  update public.recurring_transactions
  set category_id = null
  where user_id = v_uid and category_id = p_id;

  delete from public.categories where id = p_id and user_id = v_uid;
  return true;
end $$;

-- ------------------------------------------------------------
-- Grants — preserve the existing privilege model (anonymous revoked,
-- authenticated/service_role keep EXECUTE on the category + delete RPCs).
-- _apply_recurring_expense stays a strictly internal function: it is revoked
-- from public and not re-granted (only the definer-owner, postgres, can run
-- it — which is exactly how process_recurring_due / confirm_recurring_occurrence
-- call it). Matches the grant model of the original 20260811000001 migration.
-- ------------------------------------------------------------
revoke all on function public._apply_recurring_expense(uuid, text, text, numeric, text, boolean, uuid, date) from public;

revoke all on function public.delete_transaction(uuid) from public;
grant execute on function public.delete_transaction(uuid) to authenticated, service_role;

revoke all on function public.categories_create(text, uuid) from public;
revoke all on function public.categories_delete(uuid, uuid) from public;
grant execute on function public.categories_create(text, uuid) to authenticated, service_role;
grant execute on function public.categories_delete(uuid, uuid) to authenticated, service_role;
