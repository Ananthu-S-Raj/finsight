-- ============================================================
-- FinSight — Security & financial integrity hardening
-- (migration 20260811000000_security_hardening)
-- ============================================================
-- 1. Closes the privilege-escalation hole: users could previously
--    UPDATE their own `profiles` row to set role='admin' (or rewrite
--    their own balances) because "profiles: update own" covered every
--    column. A BEFORE UPDATE guard now blocks changes to protected
--    columns unless the caller is an administrator or a trusted
--    server-side function (current_user = postgres / service_role).
-- 2. Transactions become a real ledger: direct user UPDATEs may no
--    longer touch amount/type/overspend_amount (only category /
--    subcategory / note), and new rows are constrained to amount > 0.
-- 3. Balance-affecting writes move to atomic SECURITY DEFINER RPCs
--    (apply_expense / apply_income / apply_savings_move) that lock the
--    profile row, so concurrent writes cannot lose updates and overspend
--    can never drive a balance negative (raises 'insufficient_balance').
-- ============================================================

-- ------------------------------------------------------------
-- 1. Profiles: revoke direct INSERT (profiles are created by the
--    handle_new_user trigger, which runs with definer rights and is
--    unaffected). Also drop the now-redundant insert policy.
-- ------------------------------------------------------------
revoke insert on table public.profiles from anon, authenticated;
drop policy if exists "profiles: insert own" on public.profiles;

-- ------------------------------------------------------------
-- 2. Guard trigger: only admins (or trusted server code) may change
--    role / account_status / balances / password_changed_at on a
--    profile. Users keep updating full_name and monthly_budget.
--    `current_user` tells us who issued the statement:
--      - user UPDATE via anon-key client  -> authenticated (blocked)
--      - admin handler via anon-key client -> authenticated + is_admin (allowed)
--      - financial RPC (SECURITY DEFINER) -> postgres (allowed)
--    Invoker rights are intentional so RLS still scopes is_admin().
-- ------------------------------------------------------------
create or replace function public.guard_profile_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.role is distinct from old.role)
     or (new.account_status is distinct from old.account_status)
     or (new.salary_balance is distinct from old.salary_balance)
     or (new.savings_balance is distinct from old.savings_balance)
     or (new.password_changed_at is distinct from old.password_changed_at) then
    if current_user not in ('postgres', 'supabase_admin', 'service_role')
       and not public.is_admin() then
      raise exception 'cannot_modify_protected_profile_fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_protected_columns on public.profiles;
create trigger profiles_guard_protected_columns
  before update on public.profiles
  for each row execute function public.guard_profile_protected_columns();

-- ------------------------------------------------------------
-- 3. Transactions: users may update only non-financial columns.
--    Admin corrections (amount, flagged, ...) keep working because
--    the is_admin() check passes for admin sessions.
-- ------------------------------------------------------------
create or replace function public.guard_transactions_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.user_id is distinct from old.user_id)
     or (new.type is distinct from old.type)
     or (new.amount is distinct from old.amount)
     or (new.overspend_amount is distinct from old.overspend_amount)
     or (new.created_at is distinct from old.created_at) then
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

-- ------------------------------------------------------------
-- 4. Check constraints. All added NOT VALID so the migration applies
--    cleanly even if legacy rows already violate them; enforcement
--    still applies to every NEW write (balances >= 0, amount > 0).
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_salary_balance_nonneg'
  ) then
    alter table public.profiles
      add constraint profiles_salary_balance_nonneg check (salary_balance >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_savings_balance_nonneg'
  ) then
    alter table public.profiles
      add constraint profiles_savings_balance_nonneg check (savings_balance >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_amount_positive'
  ) then
    alter table public.transactions
      add constraint transactions_amount_positive check (amount > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_overspend_nonneg'
  ) then
    alter table public.transactions
      add constraint transactions_overspend_nonneg check (overspend_amount >= 0) not valid;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 5. Atomic financial RPCs — the single trusted path for anything that
--    moves money. Each locks the caller's profile row (FOR UPDATE) so
--    concurrent writes serialize instead of losing updates. Errors use
--    stable codes the client can map:
--      invalid_amount, profile_not_found, insufficient_balance,
--      invalid_kind
-- ------------------------------------------------------------
create or replace function public.apply_expense(
  p_category text default null,
  p_subcategory text default null,
  p_amount numeric default 0,
  p_note text default '',
  p_is_credit_card boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_spent numeric;
  v_overspend numeric;
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

  select coalesce(sum(amount), 0) into v_spent
    from public.transactions
   where user_id = auth.uid()
     and type in ('expense', 'credit_card')
     and created_at >= date_trunc('month', now());

  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

  if v_overspend > 0 then
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
    case when coalesce(p_is_credit_card, false) then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    v_overspend,
    coalesce(p_note, '')
  );

  return jsonb_build_object('overspend_amount', v_overspend);
end;
$$;

create or replace function public.apply_income(
  p_kind text,
  p_amount numeric,
  p_note text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_type public.transactions.type%type;
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

  if p_kind = 'salary' then
    v_type := 'salary_add';
    update public.profiles set salary_balance = v_profile.salary_balance + p_amount where id = auth.uid();
  elsif p_kind = 'savings' then
    v_type := 'savings_add';
    update public.profiles set savings_balance = v_profile.savings_balance + p_amount where id = auth.uid();
  elsif p_kind = 'loan' then
    v_type := 'loan_add';
    update public.profiles set salary_balance = v_profile.salary_balance + p_amount where id = auth.uid();
  else
    raise exception 'invalid_kind';
  end if;

  insert into public.transactions (user_id, type, amount, note)
  values (auth.uid(), v_type, p_amount, coalesce(p_note, ''));
end;
$$;

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

-- Execution: public by default in the `public` schema, but these must
-- only be callable by authenticated users (never anon).
revoke all on function public.apply_expense(text, text, numeric, text, boolean) from public;
revoke all on function public.apply_income(text, numeric, text) from public;
revoke all on function public.apply_savings_move(numeric) from public;

grant execute on function public.apply_expense(text, text, numeric, text, boolean) to authenticated, service_role;
grant execute on function public.apply_income(text, numeric, text) to authenticated, service_role;
grant execute on function public.apply_savings_move(numeric) to authenticated, service_role;
