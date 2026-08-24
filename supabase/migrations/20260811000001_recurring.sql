-- ============================================================
-- FinSight — Recurring Transactions
-- (migration 20260811000001_recurring)
--
-- Adds a reusable recurring transaction system that generates real
-- transactions (expenses / income / salary→savings transfers) when their
-- occurrence falls due. Design notes:
--
--  * Idempotency is enforced at the database level: the unique index
--    `transactions_recurring_occurrence_idx` on
--    (recurring_transaction_id, occurrence_date) makes it impossible for the
--    same occurrence to be written twice.
--  * Deleting a recurring rule never deletes history: transactions keep a
--    `recurring_transaction_id` FK with ON DELETE SET NULL, so generated
--    rows survive rule deletion.
--  * Every balance-affecting write goes through SECURITY DEFINER RPCs that
--    row-lock the profile, mirroring the existing apply_expense / apply_income
--    / apply_savings_move money layer.
--  * `next_recurring_date()` implements calendar-correct recurrence math
--    (month-end clamping, Feb 29 / leap years, 31st-day anchors).
--
-- NOTE on ordering: transactions gains a FK to recurring_transactions, so the
-- rule table is created before that column is added.
-- ============================================================

-- ------------------------------------------------------------
-- 1. recurring_transactions — the rules themselves.
-- ------------------------------------------------------------
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('expense', 'income', 'transfer')),
  amount numeric(12,2) not null check (amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  category text,
  subcategory text,
  -- Source account (semantics depend on type):
  --   expense  -> null (cash/UPI) or 'credit_card'
  --   income   -> 'salary' | 'savings' | 'loan'
  --   transfer -> 'salary' (source)
  account text,
  -- Destination account, currently only 'savings' (transfer).
  destination_account text,
  description text,
  frequency text not null
    check (frequency in ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  start_date date not null,
  end_date date,
  next_occurrence date not null,
  -- Calendar anchor for day-of-month recurrence (see next_recurring_date).
  anchor_day integer not null default 1 check (anchor_day between 1 and 31),
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  -- true = create a pending occurrence and ask the user; false = auto-create.
  requires_confirmation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

-- The query planner's working set: due rules by user (scheduler) and the
-- user-facing list.
create index if not exists recurring_user_status_due_idx
  on public.recurring_transactions (user_id, status, next_occurrence);
create index if not exists recurring_status_due_idx
  on public.recurring_transactions (status, next_occurrence);

-- ------------------------------------------------------------
-- 2. transactions: link generated rows back to their rule.
--    ON DELETE SET NULL keeps historical records intact when a
--    rule is deleted. `occurrence_date` records WHICH occurrence
--    of the rule produced the row.
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists recurring_transaction_id uuid
    references public.recurring_transactions(id) on delete set null;
alter table public.transactions
  add column if not exists occurrence_date date;

-- Hard duplicate-prevention guarantee: the same (rule, occurrence) pair can
-- never be inserted twice. NULL recurring_transaction_id rows (all normal
-- transactions) are unaffected — Postgres unique indexes ignore NULLs.
create unique index if not exists transactions_recurring_occurrence_idx
  on public.transactions (recurring_transaction_id, occurrence_date)
  where recurring_transaction_id is not null;

create index if not exists transactions_recurring_id_idx
  on public.transactions (recurring_transaction_id);

-- ------------------------------------------------------------
-- 3. recurring_occurrences — ledger of pending confirmations.
--    Auto rules generate transactions directly (deduped by the
--    transactions unique index); confirmation-mode rules create a
--    pending row here instead and wait for the user.
-- ------------------------------------------------------------
create table if not exists public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recurring_transaction_id uuid not null
    references public.recurring_transactions(id) on delete cascade,
  occurrence_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'skipped')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurring_transaction_id, occurrence_date)
);

create index if not exists recurring_occurrences_user_status_idx
  on public.recurring_occurrences (user_id, status, occurrence_date);

-- ------------------------------------------------------------
-- 4. Row Level Security — own-row policies for users, is_admin()
--    overrides for administrators (matching every other table).
-- ------------------------------------------------------------
alter table public.recurring_transactions enable row level security;
alter table public.recurring_occurrences enable row level security;

create policy "recurring: read own" on public.recurring_transactions
  for select using (auth.uid() = user_id);
create policy "recurring: insert own" on public.recurring_transactions
  for insert with check (auth.uid() = user_id);
create policy "recurring: update own" on public.recurring_transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recurring: delete own" on public.recurring_transactions
  for delete using (auth.uid() = user_id);

create policy "recurring: admin read" on public.recurring_transactions
  for select using (public.is_admin());
create policy "recurring: admin update" on public.recurring_transactions
  for update using (public.is_admin()) with check (public.is_admin());
create policy "recurring: admin delete" on public.recurring_transactions
  for delete using (public.is_admin());

-- Occurrences are created/confirmed/skipped through security definer RPCs
-- (the scheduler, confirm_recurring_occurrence, skip_recurring_occurrence),
-- so regular users only ever read their own rows.
create policy "occurrences: read own" on public.recurring_occurrences
  for select using (auth.uid() = user_id);
create policy "occurrences: admin read" on public.recurring_occurrences
  for select using (public.is_admin());
create policy "occurrences: admin update" on public.recurring_occurrences
  for update using (public.is_admin()) with check (public.is_admin());
create policy "occurrences: admin delete" on public.recurring_occurrences
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 5. next_recurring_date() — calendar-correct recurrence math.
--
--   daily/ weekly/ biweekly: simple interval addition.
--   monthly/quarterly/yearly: month-step then clamp the day to
--   min(anchor_day, last_day_of_target_month). The anchor day is the
--   day-of-month recorded on the rule, so:
--     Jan 31 + 1 month -> Feb 28 (clamped, never Feb 31)
--     Feb 28 + 1 month -> Mar 31 (anchor day restored)
--     Feb 29 (2024) + 1 year -> Feb 28 (2025, no Feb 29)
--     Feb 28 (2025) + 1 year -> Feb 29 (2028, leap day restored)
-- ------------------------------------------------------------
create or replace function public.next_recurring_date(
  p_frequency text,
  p_from date,
  p_anchor_day integer
)
returns date
language plpgsql immutable
as $$
declare
  v_offset int;
  v_next date;
  v_last_day int;
begin
  if p_from is null then
    return null;
  end if;

  case p_frequency
    when 'daily' then return p_from + 1;
    when 'weekly' then return p_from + 7;
    when 'biweekly' then return p_from + 14;
    when 'monthly' then v_offset := 1;
    when 'quarterly' then v_offset := 3;
    when 'yearly' then v_offset := 12;
    else raise exception 'invalid_frequency';
  end case;

  -- date + months clamps to the last valid day of the target month
  -- (e.g. 2024-02-29 + 1 month = 2024-03-29; + 12 months = 2025-02-28).
  v_next := (p_from + make_interval(months => v_offset))::date;

  v_last_day := extract(day from (
    date_trunc('month', v_next) + interval '1 month' - interval '1 day'
  ))::int;

  v_next := date_trunc('month', v_next)::date + least(coalesce(p_anchor_day, 1), v_last_day) - 1;

  return v_next;
end;
$$;

-- ------------------------------------------------------------
-- 6. Internal money RPCs (security definer). These mirror the exact math of
--    apply_expense / apply_income / apply_savings_move but take an explicit
--    user id (the scheduler runs as the service role, where auth.uid() is
--    null) and stamp recurring_transaction_id + occurrence_date on the row.
--    Each one is idempotent: if the (rule, occurrence) pair already exists
--    in transactions it returns without touching any balance.
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
  v_spent numeric;
  v_overspend numeric;
  v_duplicate boolean;
begin
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

  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

  if v_overspend > 0 then
    if v_profile.salary_balance < v_overspend then
      raise exception 'insufficient_balance';
    end if;
    update public.profiles
       set salary_balance = v_profile.salary_balance - v_overspend
     where id = p_user_id;
  end if;

  insert into public.transactions (
    user_id, type, category, subcategory, amount, overspend_amount, note,
    recurring_transaction_id, occurrence_date
  )
  values (
    p_user_id,
    case when coalesce(p_is_credit_card, false) then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    v_overspend,
    coalesce(p_note, ''),
    p_recurring_transaction_id,
    p_occurrence_date
  );

  return jsonb_build_object('overspend_amount', v_overspend, 'duplicate', false);
end;
$$;

create or replace function public._apply_recurring_income(
  p_user_id uuid,
  p_kind text,
  p_amount numeric,
  p_note text,
  p_recurring_transaction_id uuid,
  p_occurrence_date date
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_type public.transactions.type%type;
  v_duplicate boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select exists (
    select 1 from public.transactions
    where recurring_transaction_id = p_recurring_transaction_id
      and occurrence_date = p_occurrence_date
  ) into v_duplicate;
  if v_duplicate then
    return;
  end if;

  select * into v_profile
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if p_kind = 'salary' then
    v_type := 'salary_add';
    update public.profiles set salary_balance = v_profile.salary_balance + p_amount where id = p_user_id;
  elsif p_kind = 'savings' then
    v_type := 'savings_add';
    update public.profiles set savings_balance = v_profile.savings_balance + p_amount where id = p_user_id;
  elsif p_kind = 'loan' then
    v_type := 'loan_add';
    update public.profiles set salary_balance = v_profile.salary_balance + p_amount where id = p_user_id;
  else
    raise exception 'invalid_kind';
  end if;

  insert into public.transactions (
    user_id, type, amount, note, recurring_transaction_id, occurrence_date
  )
  values (
    p_user_id, v_type, p_amount, coalesce(p_note, ''),
    p_recurring_transaction_id, p_occurrence_date
  );
end;
$$;

create or replace function public._apply_recurring_transfer(
  p_user_id uuid,
  p_amount numeric,
  p_recurring_transaction_id uuid,
  p_occurrence_date date
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_duplicate boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select exists (
    select 1 from public.transactions
    where recurring_transaction_id = p_recurring_transaction_id
      and occurrence_date = p_occurrence_date
  ) into v_duplicate;
  if v_duplicate then
    return;
  end if;

  select * into v_profile
    from public.profiles
   where id = p_user_id
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
   where id = p_user_id;

  insert into public.transactions (
    user_id, type, amount, recurring_transaction_id, occurrence_date
  )
  values (p_user_id, 'savings_move', p_amount, p_recurring_transaction_id, p_occurrence_date);
end;
$$;

-- ------------------------------------------------------------
-- 7. process_recurring_due — the scheduler entry point.
--
--    Called per user either by the client (app load catch-up) or by the
--    process-recurring Edge Function (pg_cron, service role). Processes every
--    active rule whose next_occurrence <= today:
--
--      * auto rules  -> generate the transaction, advance next_occurrence;
--      * confirm rules -> create a pending occurrence, advance next_occurrence;
--      * failed occurrences (e.g. insufficient_balance) keep their
--        next_occurrence so the next run retries — money is never dropped;
--      * rules whose occurrence has passed end_date are marked completed.
--
--    Idempotent: the transactions unique index plus the per-rule existence
--    checks make double generation impossible.
-- ------------------------------------------------------------
create or replace function public.process_recurring_due(
  p_user_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid;
  v_rule record;
  v_result jsonb;
  v_today date := current_date;
  v_processed int := 0;
  v_generated int := 0;
  v_pending int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_guard int;
begin
  v_uid := coalesce(p_user_id, auth.uid());
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if auth.uid() is not null and v_uid is distinct from auth.uid() then
    raise exception 'unauthorized';
  end if;

  for v_rule in
    select *
    from public.recurring_transactions
    where user_id = v_uid
      and status = 'active'
      and next_occurrence <= v_today
    order by next_occurrence asc
    for update
  loop
    -- Safety valve: never generate more than a year of catch-up in one run.
    v_guard := 0;
    while v_rule.next_occurrence <= v_today and v_guard < 366 loop
      v_guard := v_guard + 1;

      if v_rule.end_date is not null and v_rule.next_occurrence > v_rule.end_date then
        exit;
      end if;

      begin
        if v_rule.requires_confirmation then
          insert into public.recurring_occurrences (
            user_id, recurring_transaction_id, occurrence_date
          )
          values (v_uid, v_rule.id, v_rule.next_occurrence)
          on conflict (recurring_transaction_id, occurrence_date) do nothing;
          v_pending := v_pending + 1;
        elsif v_rule.type = 'expense' then
          v_result := public._apply_recurring_expense(
            v_uid,
            v_rule.category,
            v_rule.subcategory,
            v_rule.amount,
            v_rule.description,
            coalesce(v_rule.account = 'credit_card', false),
            v_rule.id,
            v_rule.next_occurrence
          );
          if (v_result->>'duplicate')::boolean then
            v_skipped := v_skipped + 1;
          else
            v_generated := v_generated + 1;
          end if;
        elsif v_rule.type = 'income' then
          perform public._apply_recurring_income(
            v_uid,
            v_rule.account,
            v_rule.amount,
            v_rule.description,
            v_rule.id,
            v_rule.next_occurrence
          );
          v_generated := v_generated + 1;
        elsif v_rule.type = 'transfer' then
          perform public._apply_recurring_transfer(
            v_uid,
            v_rule.amount,
            v_rule.id,
            v_rule.next_occurrence
          );
          v_generated := v_generated + 1;
        end if;

        v_processed := v_processed + 1;
        v_rule.next_occurrence := public.next_recurring_date(
          v_rule.frequency, v_rule.next_occurrence, v_rule.anchor_day
        );
        update public.recurring_transactions
           set next_occurrence = v_rule.next_occurrence,
               updated_at = now()
         where id = v_rule.id;
      exception when others then
        -- Roll back this occurrence only (savepoint). The rule keeps its
        -- current next_occurrence and is retried on the next run.
        v_failed := v_failed + 1;
        v_processed := v_processed + 1;
        exit;
      end;
    end loop;

    if v_rule.end_date is not null and v_rule.next_occurrence > v_rule.end_date then
      update public.recurring_transactions
         set status = 'completed',
             updated_at = now()
       where id = v_rule.id;
    end if;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'generated', v_generated,
    'pending', v_pending,
    'skipped', v_skipped,
    'failed', v_failed
  );
end;
$$;

-- process_all_recurring_due — service-role batch entry for the scheduler.
-- Refuses calls that carry a user session (clients must use the per-user
-- function so RLS-equivalent scoping always applies).
create or replace function public.process_all_recurring_due()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_users int := 0;
begin
  if auth.uid() is not null then
    raise exception 'unauthorized';
  end if;

  for v_user_id in
    select distinct user_id
    from public.recurring_transactions
    where status = 'active'
      and next_occurrence <= current_date
  loop
    v_result := public.process_recurring_due(v_user_id);
    v_users := v_users + 1;
  end loop;

  return jsonb_build_object('users_processed', v_users);
end;
$$;

-- ------------------------------------------------------------
-- 8. Confirmation flow RPCs (user-initiated, security definer).
-- ------------------------------------------------------------
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
   where id = p_occurrence_id;

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

create or replace function public.skip_recurring_occurrence(
  p_occurrence_id uuid
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_updated int;
begin
  update public.recurring_occurrences
     set status = 'skipped',
         updated_at = now()
   where id = p_occurrence_id
     and user_id = auth.uid()
     and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ------------------------------------------------------------
-- 9. Grants. Money RPCs stay internal; the scheduler entry and the
--    confirmation flow are the only client-visible surface.
-- ------------------------------------------------------------
revoke all on function public.next_recurring_date(text, date, integer) from public;
revoke all on function public._apply_recurring_expense(uuid, text, text, numeric, text, boolean, uuid, date) from public;
revoke all on function public._apply_recurring_income(uuid, text, numeric, text, uuid, date) from public;
revoke all on function public._apply_recurring_transfer(uuid, numeric, uuid, date) from public;
revoke all on function public.process_all_recurring_due() from public;
revoke all on function public.process_recurring_due(uuid) from public;
revoke all on function public.confirm_recurring_occurrence(uuid) from public;
revoke all on function public.skip_recurring_occurrence(uuid) from public;

grant execute on function public.process_recurring_due(uuid) to authenticated, service_role;
grant execute on function public.process_all_recurring_due() to service_role;
grant execute on function public.confirm_recurring_occurrence(uuid) to authenticated, service_role;
grant execute on function public.skip_recurring_occurrence(uuid) to authenticated, service_role;

-- ============================================================
-- Optional: schedule the recurring processor via pg_cron + pg_net
-- (same mechanism as the daily-reminder function). Requires the
-- pg_cron and pg_net extensions. Replace the URL, anon key and
-- CRON_SECRET with your values. Runs hourly so missed occurrences
-- are caught quickly even if the app is closed.
-- ============================================================
-- select cron.schedule(
--   'process-recurring',
--   '0 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<your-project-ref>.supabase.co/functions/v1/process-recurring',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <ANON_KEY>',
--       'x-cron-secret', '<CRON_SECRET>',
--       'Content-Type', 'application/json'
--     )
--   );
--   $$
-- );
