-- ============================================================
-- FinSight — Multi-card credit card management
-- (migration 20260912000000_credit_cards)
--
-- Today the app has a single virtual credit card: every card purchase is a
-- `credit_card` transaction and every repayment a `credit_card_payment`
-- transaction; the outstanding bill is Σ(credit_card) − Σ(credit_card_payment)
-- computed for the whole account. That model cannot answer "which card was
-- this charged to?", so this migration introduces per-card management while
-- keeping every existing behaviour (apply_expense / pay_credit_card /
-- delete_transaction and the rest) intact:
--
--   1. A `public.credit_cards` table — id, user_id, name, credit_limit,
--      billing_day (1–31), created_at, updated_at. No balance is stored:
--      outstanding and available credit are always derived from the ledger,
--      so they can never drift from history. RLS grants read-own + admin-read
--      only; every write happens through SECURITY DEFINER RPCs (no user
--      INSERT/UPDATE/DELETE policies exist, mirroring bug_reports).
--   2. A nullable `transactions.card_id` FK (ON DELETE RESTRICT) so every
--      card charge / repayment is attributable to a card, while legacy rows
--      (and bills paid as credit) remain valid with card_id = NULL.
--   3. A backfill that assigns all pre-existing per-user card activity to a
--      legacy card named "My Card" (limit = greatest(100000, total charges),
--      billing day 1) — see data-preservation notes below.
--   4. A BEFORE UPDATE guard on credit_cards (updated_at + limits below the
--      outstanding balance are rejected for everyone except trusted server
--      roles / admins), and `card_id` joins the transaction protected-columns
--      guard so clients cannot reassign ledger entries.
--   5. New atomic SECURITY DEFINER RPCs, all scoped to auth.uid() (no
--      client-supplied user_id is ever trusted):
--        create_credit_card(text, numeric, integer)
--        update_credit_card(uuid, text, numeric, integer)
--        delete_credit_card(uuid)
--        list_credit_cards()                -> per-card outstanding + available
--        apply_credit_card_expense(uuid, text, text, numeric, text)
--        pay_card_bill(uuid, numeric, text)
--
-- Error codes (mapped to friendly UI text by src/lib/finance.ts):
--   card_not_found, card_has_transactions, limit_below_outstanding,
--   credit_limit_exceeded, invalid_card_name, invalid_credit_limit,
--   invalid_billing_day  (plus the existing invalid_amount / invalid_source /
--   profile_not_found / insufficient_balance / payment_exceeds_outstanding).
--
-- Data preservation / backward compatibility:
--   - No existing rows are deleted or altered except setting card_id on
--     backfilled credit-card activity.
--   - The existing RPCs (apply_expense, apply_income, apply_savings_move,
--     pay_credit_card, delete_transaction, mark_bill_paid) are NOT redefined
--     here; the single-card QuickAdd path still works unchanged, so a user
--     with no cards keeps today's exact behaviour (charges recorded with
--     card_id NULL, pay_credit_card aggregates the whole account).
--   - Legacy card activity is preserved under "My Card" with a generous
--     placeholder limit; the user can edit it to match their real limit.
-- ============================================================

-- 1. Credit cards table. Balances are never stored — outstanding/available
--    are derived from transactions so they cannot drift from history.
create table if not exists public.credit_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  credit_limit numeric(12,2) not null check (credit_limit > 0),
  billing_day integer not null check (billing_day between 1 and 31),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists credit_cards_user_idx
  on public.credit_cards (user_id);

-- 2. RLS: read-own + admin-read. All writes go through SECURITY DEFINER RPCs;
--    deliberately no user insert/update/delete policies (same as bug_reports).
alter table public.credit_cards enable row level security;

drop policy if exists "credit_cards: read own" on public.credit_cards;
create policy "credit_cards: read own" on public.credit_cards
  for select using (auth.uid() = user_id);

drop policy if exists "credit_cards: admin read" on public.credit_cards;
create policy "credit_cards: admin read" on public.credit_cards
  for select using (public.is_admin());

-- 3. Attribute ledger rows to a card. Nullable so legacy rows and bills paid
--    as credit stay valid; RESTRICT (with the delete_credit_card guard) means
--    a card with history can never be orphaned by a silent delete.
alter table public.transactions
  add column if not exists card_id uuid references public.credit_cards(id) on delete restrict;

create index if not exists transactions_card_idx
  on public.transactions (user_id, card_id);

-- 4a. Backfill: preserve existing card activity under a per-user legacy card.
--     card_id stays NULL for any future "legacy" charges (users without cards,
--     bills paid as credit), which keeps old behaviour fully intact.
do $$
declare
  v_user   uuid;
  v_card   uuid;
  v_charges numeric;
  v_paid   numeric;
begin
  for v_user in
    select distinct user_id
      from public.transactions
     where type in ('credit_card', 'credit_card_payment')
  loop
    select
      coalesce(sum(amount) filter (where type = 'credit_card'), 0),
      coalesce(sum(amount) filter (where type = 'credit_card_payment'), 0)
      into v_charges, v_paid
      from public.transactions
     where user_id = v_user
       and type in ('credit_card', 'credit_card_payment');

    -- Placeholder limit: at least ₹1,00,000, and never below what was ever
    -- charged, so historical spend always fits within the card's available
    -- credit. The user can edit the limit to match their real card.
    insert into public.credit_cards (user_id, name, credit_limit, billing_day)
    values (v_user, 'My Card', greatest(100000, v_charges), 1)
    returning id into v_card;

    update public.transactions
       set card_id = v_card
     where user_id = v_user
       and type in ('credit_card', 'credit_card_payment')
       and card_id is null;
  end loop;
end;
$$;

-- 4b. card_id joins the transaction protected-columns guard: direct client
--     UPDATEs may reassign category/note but never the ledger attribution.
create or replace function public.guard_transactions_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.user_id is distinct from old.user_id)
     or (new.type is distinct from old.type)
     or (new.amount is distinct from old.amount)
     or (new.overspend_amount is distinct from old.overspend_amount)
     or (new.created_at is distinct from old.created_at)
     or (new.card_id is distinct from old.card_id) then
    if current_user not in ('postgres', 'supabase_admin', 'service_role')
       and not public.is_admin() then
      raise exception 'cannot_modify_protected_transaction_fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_guard_protected_columns on public.transactions;
create trigger transactions_guard_protected_columns
  before update on public.transactions
  for each row execute function public.guard_transactions_protected_columns();

-- 4c. Credit-card row guard: keep updated_at fresh and never let a non-trusted
--     caller drive the limit below the outstanding balance (the card RPC does
--     the authoritative check; this blocks direct writes too).
create or replace function public.guard_credit_cards_manage()
returns trigger
language plpgsql
as $$
declare
  v_outstanding numeric;
begin
  new.updated_at := now();

  if new.credit_limit is distinct from old.credit_limit
     and new.credit_limit < old.credit_limit then
    if current_user not in ('postgres', 'supabase_admin', 'service_role')
       and not public.is_admin() then
      -- Net outstanding on THIS card = Σ(credit_card) − Σ(credit_card_payment).
      select coalesce(sum(
        case when type = 'credit_card_payment' then -amount else amount end
      ), 0) into v_outstanding
        from public.transactions
       where card_id = old.id
         and user_id = old.user_id
         and type in ('credit_card', 'credit_card_payment');

      if v_outstanding > new.credit_limit then
        raise exception 'limit_below_outstanding';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists credit_cards_guard_manage on public.credit_cards;
create trigger credit_cards_guard_manage
  before update on public.credit_cards
  for each row execute function public.guard_credit_cards_manage();

-- 5. RPCs -----------------------------------------------------------------

-- 5a. List the caller's cards with derived balances. available = limit −
--     outstanding and is never allowed to exceed the limit.
create or replace function public.list_credit_cards()
returns table (
  id          uuid,
  user_id     uuid,
  name        text,
  credit_limit numeric,
  billing_day integer,
  outstanding numeric,
  available   numeric,
  created_at  timestamptz,
  updated_at  timestamptz
)
language sql security definer set search_path = public
as $$
  select
    c.id,
    c.user_id,
    c.name,
    c.credit_limit,
    c.billing_day,
    coalesce(sum(
      case t.type
        when 'credit_card' then t.amount
        when 'credit_card_payment' then -t.amount
        else 0
      end
    ), 0) as outstanding,
    c.credit_limit - coalesce(sum(
      case t.type
        when 'credit_card' then t.amount
        when 'credit_card_payment' then -t.amount
        else 0
      end
    ), 0) as available,
    c.created_at,
    c.updated_at
  from public.credit_cards c
  left join public.transactions t on t.card_id = c.id
  where c.user_id = auth.uid()
  group by c.id
  order by c.created_at asc;
$$;

-- 5b. Create a card. First card of a fresh account becomes the per-card flow's
--     home; users with legacy activity keep their backfilled "My Card".
create or replace function public.create_credit_card(
  p_name text,
  p_credit_limit numeric,
  p_billing_day integer
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_card_id uuid;
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'invalid_card_name';
  end if;
  if p_credit_limit is null or p_credit_limit <= 0 then
    raise exception 'invalid_credit_limit';
  end if;
  if p_billing_day is null or p_billing_day < 1 or p_billing_day > 31 then
    raise exception 'invalid_billing_day';
  end if;

  insert into public.credit_cards (user_id, name, credit_limit, billing_day)
  values (auth.uid(), btrim(p_name), p_credit_limit, p_billing_day)
  returning id into v_card_id;

  return (
    select jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'name', name,
      'credit_limit', credit_limit,
      'billing_day', billing_day,
      'created_at', created_at,
      'updated_at', updated_at
    )
    from public.credit_cards
    where id = v_card_id
  );
end;
$$;

-- 5c. Edit a card, with the limit-below-outstanding rejection (e.g. ₹20,000
--     outstanding with a limit change to ₹10,000 is refused). Trusted server
--     roles / admins may still correct balances via the table guard.
create or replace function public.update_credit_card(
  p_card_id uuid,
  p_name text,
  p_credit_limit numeric,
  p_billing_day integer
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_card         public.credit_cards%rowtype;
  v_outstanding  numeric;
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'invalid_card_name';
  end if;
  if p_credit_limit is null or p_credit_limit <= 0 then
    raise exception 'invalid_credit_limit';
  end if;
  if p_billing_day is null or p_billing_day < 1 or p_billing_day > 31 then
    raise exception 'invalid_billing_day';
  end if;

  select * into v_card
    from public.credit_cards
   where id = p_card_id
     and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'card_not_found';
  end if;

  -- Net outstanding on THIS card = Σ(credit_card) − Σ(credit_card_payment).
  select coalesce(sum(
    case when type = 'credit_card_payment' then -amount else amount end
  ), 0) into v_outstanding
    from public.transactions
   where card_id = p_card_id
     and type in ('credit_card', 'credit_card_payment');

  if p_credit_limit < v_outstanding then
    raise exception 'limit_below_outstanding';
  end if;

  update public.credit_cards
     set name = btrim(p_name),
         credit_limit = p_credit_limit,
         billing_day = p_billing_day
   where id = p_card_id;

  return (
    select jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'name', name,
      'credit_limit', credit_limit,
      'billing_day', billing_day,
      'created_at', created_at,
      'updated_at', updated_at
    )
    from public.credit_cards
    where id = p_card_id
  );
end;
$$;

-- 5d. Delete a card. A card with any ledger history is protected so history
--     is never silently orphaned; a fresh card can be removed cleanly.
create or replace function public.delete_credit_card(p_card_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_card    public.credit_cards%rowtype;
  v_has_txn boolean;
begin
  select * into v_card
    from public.credit_cards
   where id = p_card_id
     and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'card_not_found';
  end if;

  select exists(
    select 1
      from public.transactions
     where card_id = p_card_id
  ) into v_has_txn;

  if v_has_txn then
    raise exception 'card_has_transactions';
  end if;

  delete from public.credit_cards
   where id = p_card_id;
end;
$$;

-- 5e. Charge a purchase to a specific card. Mirrors apply_expense's credit
--     branch exactly: the charge is a liability (never touches salary_balance,
--     overspend stored as 0) and the RPC still reports the over-budget excess
-- so the existing UI warning keeps working. On top it enforces the card's
-- available credit limit atomically (the card row is locked first, then
--     the profile — consistent lock order with pay_card_bill).
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

  -- Outstanding on THIS card = Σ(credit_card) − Σ(credit_card_payment).
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

  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

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

-- 5f. Pay a bill on a specific card only. Same accounting as pay_credit_card
--     (deduct from salary or savings, payment stored positive with the source
--     token in note for delete_transaction refunds, never more than this
--     card's outstanding) but scoped per card and refusing overpayment.
create or replace function public.pay_card_bill(
  p_card_id uuid,
  p_amount numeric,
  p_source text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_card         public.credit_cards%rowtype;
  v_profile      public.profiles%rowtype;
  v_outstanding  numeric;
  v_used_savings boolean;
begin
  if p_source is null or p_source not in ('salary', 'savings') then
    raise exception 'invalid_source';
  end if;

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

  -- Net outstanding on THIS card = Σ(credit_card) − Σ(credit_card_payment).
  select coalesce(sum(
    case when type = 'credit_card_payment' then -amount else amount end
  ), 0) into v_outstanding
    from public.transactions
   where card_id = p_card_id
     and type in ('credit_card', 'credit_card_payment');

  if p_amount > v_outstanding then
    raise exception 'payment_exceeds_outstanding';
  end if;

  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
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

  insert into public.transactions (user_id, type, amount, overspend_amount, note, card_id)
  values (
    auth.uid(),
    'credit_card_payment',
    p_amount,
    0,
    case when v_used_savings then 'savings' else 'salary' end,
    p_card_id
  );

  return jsonb_build_object(
    'outstanding', v_outstanding - p_amount,
    'source', p_source
  );
end;
$$;

-- 6. Grants: anon never; authenticated + service_role keep EXECUTE (the same
--    privilege model as the existing money RPCs).
revoke all on function public.create_credit_card(text, numeric, integer) from public;
revoke all on function public.update_credit_card(uuid, text, numeric, integer) from public;
revoke all on function public.delete_credit_card(uuid) from public;
revoke all on function public.list_credit_cards() from public;
revoke all on function public.apply_credit_card_expense(uuid, text, text, numeric, text) from public;
revoke all on function public.pay_card_bill(uuid, numeric, text) from public;

grant execute on function public.create_credit_card(text, numeric, integer) to authenticated, service_role;
grant execute on function public.update_credit_card(uuid, text, numeric, integer) to authenticated, service_role;
grant execute on function public.delete_credit_card(uuid) to authenticated, service_role;
grant execute on function public.list_credit_cards() to authenticated, service_role;
grant execute on function public.apply_credit_card_expense(uuid, text, text, numeric, text) to authenticated, service_role;
grant execute on function public.pay_card_bill(uuid, numeric, text) to authenticated, service_role;