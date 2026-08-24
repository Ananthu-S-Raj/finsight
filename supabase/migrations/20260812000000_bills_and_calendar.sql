-- ============================================================
-- FinSight — Bills & Financial Calendar
-- (migration 20260812000000_bills_and_calendar)
--
-- Adds bill tracking with recurring due dates plus the data needed for the
-- Financial Calendar. Design notes:
--
--  * Bills are user-owned rows the app writes through the user-scoped client
--    (RLS enforces ownership) — matching the recurring-transactions surface.
--  * Every payment is recorded in `bill_payments` (append-only) and linked to
--    the real transaction created for it. The unique (bill_id, due_date) pair
--    makes double-paying the same due date impossible at the database level.
--  * Deleting a bill is restricted when it has payment history — money has
--    already moved, so the record is never destroyed.
--  * `mark_bill_paid` is the only way to pay a bill; it optionally books the
--    matching expense through `_apply_bill_expense`, which mirrors the
--    existing apply_expense money layer (row-locked profile, overspend
--    deduction) and stamps `bill_payment_id` on the transaction.
--  * Recurring bills advance their `due_date` when paid (weekly/monthly/
--    quarterly/yearly via `next_recurring_date`, one_time bills become 'paid').
--  * `generate_bill_reminders` produces advance/due/overdue reminder rows
--    exactly once per (bill, due_date, kind) — the in-app center and the
--    bill-reminder Edge Function both consume it without ever duplicating.
-- ============================================================

-- ------------------------------------------------------------
-- 1. bills — the bills themselves.
-- ------------------------------------------------------------
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  amount numeric(12,2) not null check (amount > 0),
  -- Category snapshot (renaming a category must not rewrite history) plus an
  -- FK for deletion protection, mirroring recurring_transactions.
  category text,
  subcategory text,
  category_id uuid references public.categories(id) on delete set null,
  due_date date not null,
  frequency text not null default 'monthly'
    check (frequency in ('one_time', 'weekly', 'monthly', 'quarterly', 'yearly')),
  status text not null default 'upcoming'
    check (status in ('upcoming', 'due', 'paid', 'overdue', 'cancelled')),
  is_credit_card boolean not null default false,
  reminder_enabled boolean not null default true,
  reminder_days_before integer not null default 3 check (reminder_days_before between 0 and 7),
  notes text check (notes is null or length(notes) <= 500),
  -- Calendar anchor for day-of-month recurrence (see next_bill_due_date).
  anchor_day integer not null default 1 check (anchor_day between 1 and 31),
  -- When the CURRENT due date was paid (one-time bills stay 'paid').
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bills_user_status_idx
  on public.bills (user_id, status, due_date);
create index if not exists bills_user_due_idx
  on public.bills (user_id, due_date);

-- ------------------------------------------------------------
-- 2. bill_payments — append-only payment history.
--    ON DELETE RESTRICT on bill_id: a bill with payments can never be
--    deleted, so the money trail survives. transaction_id links to the
--    real expense/credit-card row when the user books one.
-- ------------------------------------------------------------
create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz not null default now(),
  unique (bill_id, due_date)
);

create index if not exists bill_payments_user_idx
  on public.bill_payments (user_id, paid_at desc);

-- ------------------------------------------------------------
-- 3. bill_reminders — deduplicated reminder feed.
--    unique (bill_id, due_date, kind) is the hard anti-spam guarantee:
--    a given reminder fires once, no matter how many times the client or
--    the scheduler asks for it.
-- ------------------------------------------------------------
create table if not exists public.bill_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  kind text not null check (kind in ('advance', 'due', 'overdue')),
  days_before integer not null default 3 check (days_before between 0 and 7),
  due_date date not null,
  fired_at timestamptz not null default now(),
  unique (bill_id, due_date, kind)
);

create index if not exists bill_reminders_user_fired_idx
  on public.bill_reminders (user_id, fired_at desc);

-- ------------------------------------------------------------
-- 4. transactions: link a generated expense back to the payment that
--    produced it. The unique partial index means one payment can never
--    generate two transactions (NULL bill_payment_id rows are untouched).
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists bill_payment_id uuid
    references public.bill_payments(id) on delete set null;

create unique index if not exists transactions_bill_payment_idx
  on public.transactions (bill_payment_id)
  where bill_payment_id is not null;

-- ------------------------------------------------------------
-- 5. Row Level Security — own-row policies for users, is_admin()
--    overrides for administrators (matching every other table).
--    Payments and reminders are append-only: users can only read them,
--    writes happen exclusively through the SECURITY DEFINER RPCs.
-- ------------------------------------------------------------
alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;
alter table public.bill_reminders enable row level security;

create policy "bills: read own" on public.bills
  for select using (auth.uid() = user_id);
create policy "bills: insert own" on public.bills
  for insert with check (auth.uid() = user_id);
create policy "bills: update own" on public.bills
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bills: delete own" on public.bills
  for delete using (auth.uid() = user_id);

create policy "bills: admin read" on public.bills
  for select using (public.is_admin());
create policy "bills: admin update" on public.bills
  for update using (public.is_admin()) with check (public.is_admin());
create policy "bills: admin delete" on public.bills
  for delete using (public.is_admin());

create policy "bill_payments: read own" on public.bill_payments
  for select using (auth.uid() = user_id);
create policy "bill_payments: admin read" on public.bill_payments
  for select using (public.is_admin());

create policy "bill_reminders: read own" on public.bill_reminders
  for select using (auth.uid() = user_id);
create policy "bill_reminders: admin read" on public.bill_reminders
  for select using (public.is_admin());
create policy "bill_reminders: admin delete" on public.bill_reminders
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 6. next_bill_due_date — recurrence math for bills.
--    one_time bills don't advance; weekly is a plain +7; the month-based
--    frequencies reuse next_recurring_date (month-end clamping, Feb 29 /
--    leap years, 31st-day anchors).
-- ------------------------------------------------------------
create or replace function public.next_bill_due_date(
  p_frequency text,
  p_from date,
  p_anchor_day integer
)
returns date
language plpgsql immutable
as $$
begin
  if p_from is null then
    return null;
  end if;
  case p_frequency
    when 'one_time' then return null;
    when 'weekly' then return p_from + 7;
    else return public.next_recurring_date(p_frequency, p_from, p_anchor_day);
  end case;
end;
$$;

-- ------------------------------------------------------------
-- 7. _apply_bill_expense — internal money RPC. Mirrors apply_expense /
--    _apply_recurring_expense exactly (row-locked profile, overspend
--    deduction) but stamps bill_payment_id so the transaction is traceable
--    and the unique index blocks duplicate booking.
-- ------------------------------------------------------------
create or replace function public._apply_bill_expense(
  p_user_id uuid,
  p_category text,
  p_subcategory text,
  p_amount numeric,
  p_note text,
  p_is_credit_card boolean,
  p_bill_payment_id uuid
)
returns numeric
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
    select 1 from public.transactions where bill_payment_id = p_bill_payment_id
  ) into v_duplicate;
  if v_duplicate then
    raise exception 'duplicate_payment';
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
    bill_payment_id
  )
  values (
    p_user_id,
    case when coalesce(p_is_credit_card, false) then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_amount,
    v_overspend,
    coalesce(p_note, ''),
    p_bill_payment_id
  );

  return v_overspend;
end;
$$;

-- ------------------------------------------------------------
-- 8. mark_bill_paid — the only way to pay a bill.
--    Row-locks the bill, verifies ownership, records the payment (the
--    unique (bill_id, due_date) guard blocks double-paying), optionally
--    books the real expense, then advances the due date (recurring) or
--    marks the bill paid (one-time).
-- ------------------------------------------------------------
create or replace function public.mark_bill_paid(
  p_bill_id uuid,
  p_create_expense boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_payment uuid;
  v_tx_id uuid;
  v_overspend numeric := 0;
  v_next date;
begin
  select * into v_bill
    from public.bills
   where id = p_bill_id
   for update;

  if not found then
    raise exception 'bill_not_found';
  end if;
  if v_bill.user_id is distinct from auth.uid() then
    raise exception 'unauthorized';
  end if;
  if v_bill.status = 'cancelled' then
    raise exception 'bill_cancelled';
  end if;

  if exists (
    select 1 from public.bill_payments
    where bill_id = p_bill_id and due_date = v_bill.due_date
  ) then
    raise exception 'bill_already_paid';
  end if;

  insert into public.bill_payments (user_id, bill_id, amount, due_date)
  values (v_bill.user_id, p_bill_id, v_bill.amount, v_bill.due_date)
  returning id into v_payment;

  if coalesce(p_create_expense, false) then
    v_overspend := public._apply_bill_expense(
      v_bill.user_id,
      v_bill.category,
      v_bill.subcategory,
      v_bill.amount,
      coalesce(v_bill.notes, ''),
      v_bill.is_credit_card,
      v_payment
    );
    select id into v_tx_id
      from public.transactions
     where bill_payment_id = v_payment
     limit 1;
  end if;

  if v_bill.frequency = 'one_time' then
    update public.bills
       set status = 'paid',
           paid_at = now(),
           updated_at = now()
     where id = p_bill_id;
  else
    v_next := public.next_bill_due_date(v_bill.frequency, v_bill.due_date, v_bill.anchor_day);
    update public.bills
       set due_date = v_next,
           status = 'upcoming',
           paid_at = now(),
           updated_at = now()
     where id = p_bill_id;
  end if;

  return jsonb_build_object(
    'payment_id', v_payment,
    'transaction_id', v_tx_id,
    'overspend_amount', v_overspend,
    'next_due_date', v_next,
    'status', case when v_bill.frequency = 'one_time' then 'paid' else 'upcoming' end
  );
end;
$$;

-- ------------------------------------------------------------
-- 9. generate_bill_reminders — refresh statuses, then create the
--    advance / due / overdue reminders that are due. ON CONFLICT DO
--    NOTHING makes it fully idempotent; it returns only the newly
--    created rows (with the joined bill name/amount for messages).
-- ------------------------------------------------------------
create or replace function public.generate_bill_reminders(
  p_user_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  bill_id uuid,
  kind text,
  days_before integer,
  due_date date,
  fired_at timestamptz,
  bill_name text,
  amount numeric,
  is_credit_card boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid;
  v_today date := current_date;
begin
  v_uid := coalesce(p_user_id, auth.uid());
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if auth.uid() is not null and v_uid is distinct from auth.uid() then
    raise exception 'unauthorized';
  end if;

  -- Refresh statuses so the reminder logic sees reality.
  update public.bills
     set status = case
       when status = 'cancelled' then 'cancelled'
       when status = 'paid' then 'paid'
       when due_date < v_today then 'overdue'
       when due_date = v_today then 'due'
       else 'upcoming'
     end,
     updated_at = now()
   where user_id = v_uid;

  return query
  with eligible as (
    select b.*
      from public.bills b
     where b.user_id = v_uid
       and b.status <> 'cancelled'
       and b.status <> 'paid'
  ),
  created as (
    insert into public.bill_reminders (user_id, bill_id, kind, days_before, due_date)
    select
      b.user_id,
      b.id,
      case
        when b.due_date < v_today then 'overdue'
        when b.due_date = v_today then 'due'
        else 'advance'
      end,
      case when b.due_date <= v_today then 0 else b.reminder_days_before end,
      b.due_date
    from eligible b
    where b.due_date < v_today
       or b.due_date = v_today
       or (b.reminder_enabled and (b.due_date - b.reminder_days_before) <= v_today)
    on conflict (bill_id, due_date, kind) do nothing
    returning id, user_id, bill_id, kind, days_before, due_date, fired_at
  )
  select
    c.id,
    c.user_id,
    c.bill_id,
    c.kind,
    c.days_before,
    c.due_date,
    c.fired_at,
    b.name,
    b.amount,
    b.is_credit_card
  from created c
  join public.bills b on b.id = c.bill_id
  order by b.due_date asc;
end;
$$;

-- generate_all_bill_reminders — service-role batch entry for the scheduler.
-- Refuses calls that carry a user session (clients must use the per-user
-- function so RLS-equivalent scoping always applies). Returns the newly
-- created rows across every user so the Edge Function can send pushes.
create or replace function public.generate_all_bill_reminders()
returns table (
  id uuid,
  user_id uuid,
  bill_id uuid,
  kind text,
  days_before integer,
  due_date date,
  fired_at timestamptz,
  bill_name text,
  amount numeric,
  is_credit_card boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'unauthorized';
  end if;

  for v_user_id in
    select distinct user_id from public.bills
  loop
    return query
      select * from public.generate_bill_reminders(v_user_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 10. Grants. Internal math stays private; the user-visible surface is
--     mark_bill_paid and generate_bill_reminders (client) plus the
--     service-role batch entry (scheduler).
-- ------------------------------------------------------------
revoke all on function public.next_bill_due_date(text, date, integer) from public;
revoke all on function public._apply_bill_expense(uuid, text, text, numeric, text, boolean, uuid) from public;
revoke all on function public.mark_bill_paid(uuid, boolean) from public;
revoke all on function public.generate_bill_reminders(uuid) from public;
revoke all on function public.generate_all_bill_reminders() from public;

grant execute on function public.mark_bill_paid(uuid, boolean) to authenticated, service_role;
grant execute on function public.generate_bill_reminders(uuid) to authenticated, service_role;
grant execute on function public.generate_all_bill_reminders() to service_role;

-- ============================================================
-- Optional: schedule the bill-reminder processor via pg_cron + pg_net
-- (same mechanism as the daily-reminder function). Requires the
-- pg_cron and pg_net extensions. Replace the URL, anon key and
-- CRON_SECRET with your values. Runs daily so advance/due/overdue
-- reminders reach users even if the app is closed.
-- ============================================================
-- select cron.schedule(
--   'bill-reminder',
--   '0 7 * * *',
--   $$
--   select net.http_post(
--     url := 'https://<your-project-ref>.supabase.co/functions/v1/bill-reminder',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <ANON_KEY>',
--       'x-cron-secret', '<CRON_SECRET>',
--       'Content-Type', 'application/json'
--     )
--   );
--   $$
-- );
