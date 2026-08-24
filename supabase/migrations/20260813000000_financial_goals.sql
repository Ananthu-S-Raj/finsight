-- ============================================================
-- FinSight — Financial Goals
-- (migration 20260813000000_financial_goals)
--
-- Adds aspirational savings goals with their own progress ledger. Design
-- notes:
--
--  * A goal is a TARGET, not a money account. `current_amount` is goal
--    progress only; the user's real balances (salary/savings) are never
--    touched by this feature. "Contributing" to a goal records progress
--    against the target — the actual money stays in the user's accounts.
--    (The optional real-money transfer the spec allows is NOT implemented
--    because no existing safe money RPC moves funds OUT of savings, and
--    creating a new balance-mutation path is explicitly out of scope.)
--  * `goal_contributions` is the append-only, single source of truth:
--    `current_amount` is always recomputed from `sum(goal_contributions)`
--    inside the SECURITY DEFINER RPCs (contribute / remove), so the two can
--    never drift and no client-side arithmetic ever touches the column.
--  * Statuses: active | completed | paused | cancelled. Overachievement is
--    allowed (current_amount may exceed target; progress UI caps at 100%);
--    a goal auto-completes the first time current_amount >= target_amount.
--  * Deleting a goal is RESTRICTED when it has contributions (ON DELETE
--    RESTRICT + an API guard) — money history is never destroyed. The
--    sanctioned "soft delete" is cancel, which preserves every contribution.
--  * `generate_goal_reminders` produces deadline (30 / 7 / 1 days before)
--    and completion reminder rows exactly once per (goal, target_date,
--    kind) — consumed by the in-app center and the goal-reminder engine
--    without ever duplicating. "Falling behind" checks run client-side.
-- ============================================================

-- ------------------------------------------------------------
-- 1. financial_goals — the goals themselves.
-- ------------------------------------------------------------
create table if not exists public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  target_amount numeric(12,2) not null check (target_amount > 0),
  -- Goal progress only — recomputed from goal_contributions by the RPCs.
  current_amount numeric(12,2) not null default 0 check (current_amount >= 0),
  target_date date not null,
  -- Category snapshot (renaming a category must not rewrite history) plus an
  -- FK for deletion protection, mirroring bills / recurring_transactions.
  category text,
  category_id uuid references public.categories(id) on delete set null,
  icon text not null default 'target',
  theme text not null default 'accent',
  status text not null default 'active'
    check (status in ('active', 'completed', 'paused', 'cancelled')),
  reminder_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_goals_user_status_idx
  on public.financial_goals (user_id, status, target_date);
create index if not exists financial_goals_user_target_idx
  on public.financial_goals (user_id, target_date);

-- ------------------------------------------------------------
-- 2. goal_contributions — append-only contribution history.
--    ON DELETE RESTRICT on goal_id: a goal with contributions can never be
--    deleted, so the money trail survives. Users read their own rows; all
--    writes go through the SECURITY DEFINER RPCs below.
-- ------------------------------------------------------------
create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.financial_goals(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists goal_contributions_user_goal_idx
  on public.goal_contributions (user_id, goal_id, created_at desc);
create index if not exists goal_contributions_goal_idx
  on public.goal_contributions (goal_id, created_at desc);

-- ------------------------------------------------------------
-- 3. goal_reminders — deduplicated reminder feed.
--    unique (goal_id, target_date, kind) is the hard anti-spam guarantee:
--    a given reminder fires once, no matter how many times the client or
--    the scheduler asks for it.
-- ------------------------------------------------------------
create table if not exists public.goal_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.financial_goals(id) on delete cascade,
  kind text not null check (kind in ('deadline', 'completion')),
  days_before integer not null default 7 check (days_before between 0 and 30),
  target_date date not null,
  fired_at timestamptz not null default now(),
  unique (goal_id, target_date, kind)
);

create index if not exists goal_reminders_user_fired_idx
  on public.goal_reminders (user_id, fired_at desc);

-- ------------------------------------------------------------
-- 4. Row Level Security — own-row policies for users, is_admin()
--    overrides for administrators (matching every other table).
--    Contributions and reminders are append-only for users: writes happen
--    exclusively through the SECURITY DEFINER RPCs.
-- ------------------------------------------------------------
alter table public.financial_goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.goal_reminders enable row level security;

create policy "financial_goals: read own" on public.financial_goals
  for select using (auth.uid() = user_id);
create policy "financial_goals: insert own" on public.financial_goals
  for insert with check (auth.uid() = user_id);
create policy "financial_goals: update own" on public.financial_goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "financial_goals: delete own" on public.financial_goals
  for delete using (auth.uid() = user_id);

create policy "financial_goals: admin read" on public.financial_goals
  for select using (public.is_admin());
create policy "financial_goals: admin update" on public.financial_goals
  for update using (public.is_admin()) with check (public.is_admin());
create policy "financial_goals: admin delete" on public.financial_goals
  for delete using (public.is_admin());

create policy "goal_contributions: read own" on public.goal_contributions
  for select using (auth.uid() = user_id);
create policy "goal_contributions: admin read" on public.goal_contributions
  for select using (public.is_admin());
create policy "goal_contributions: admin delete" on public.goal_contributions
  for delete using (public.is_admin());

create policy "goal_reminders: read own" on public.goal_reminders
  for select using (auth.uid() = user_id);
create policy "goal_reminders: admin read" on public.goal_reminders
  for select using (public.is_admin());
create policy "goal_reminders: admin delete" on public.goal_reminders
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 5. _goal_total — internal helper: recompute current_amount from the
--    contribution ledger for a goal owned by `p_user_id`.
-- ------------------------------------------------------------
create or replace function public._goal_total(p_goal_id uuid, p_user_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(amount), 0)
    from public.goal_contributions
   where goal_id = p_goal_id and user_id = p_user_id;
$$;

-- ------------------------------------------------------------
-- 6. contribute_to_goal — the only way to add a contribution.
--    Row-locks the goal, verifies ownership + state, appends to the
--    contribution ledger and recomputes current_amount from the sum
--    (single source of truth). Auto-completes at target. No money moves.
-- ------------------------------------------------------------
create or replace function public.contribute_to_goal(
  p_goal_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_goal public.financial_goals%rowtype;
  v_total numeric;
  v_status text;
begin
  if p_goal_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_goal
    from public.financial_goals
   where id = p_goal_id
   for update;

  if not found then
    raise exception 'goal_not_found';
  end if;
  if v_goal.user_id is distinct from auth.uid() then
    raise exception 'goal_not_found';
  end if;
  if v_goal.status = 'cancelled' then
    raise exception 'goal_cancelled';
  end if;

  insert into public.goal_contributions (user_id, goal_id, amount, note)
  values (auth.uid(), p_goal_id, p_amount, nullif(trim(coalesce(p_note, '')), ''));

  v_total := public._goal_total(p_goal_id, v_goal.user_id);
  v_status := case
    when v_goal.status = 'cancelled' then 'cancelled'
    when v_total >= v_goal.target_amount then 'completed'
    else v_goal.status
  end;

  update public.financial_goals
     set current_amount = v_total,
         status = v_status,
         updated_at = now()
   where id = p_goal_id;

  return jsonb_build_object(
    'goal_id', p_goal_id,
    'current_amount', v_total,
    'target_amount', v_goal.target_amount,
    'status', v_status
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. remove_goal_contribution — the correction path. Deletes one
--    contribution row and recomputes current_amount from the ledger.
--    A completed goal falls back to 'active' when it drops below target;
--    cancelled goals stay cancelled (history preserved).
-- ------------------------------------------------------------
create or replace function public.remove_goal_contribution(
  p_goal_id uuid,
  p_contribution_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_goal public.financial_goals%rowtype;
  v_total numeric;
  v_status text;
begin
  if p_goal_id is null or p_contribution_id is null then
    raise exception 'invalid_request';
  end if;

  select * into v_goal
    from public.financial_goals
   where id = p_goal_id
   for update;

  if not found then
    raise exception 'goal_not_found';
  end if;
  if v_goal.user_id is distinct from auth.uid() then
    raise exception 'goal_not_found';
  end if;

  delete from public.goal_contributions
   where id = p_contribution_id
     and goal_id = p_goal_id
     and user_id = auth.uid();

  v_total := public._goal_total(p_goal_id, v_goal.user_id);
  v_status := case
    when v_goal.status = 'cancelled' then 'cancelled'
    when v_total >= v_goal.target_amount then 'completed'
    when v_goal.status = 'completed' then 'active'
    else v_goal.status
  end;

  update public.financial_goals
     set current_amount = v_total,
         status = v_status,
         updated_at = now()
   where id = p_goal_id;

  return jsonb_build_object(
    'goal_id', p_goal_id,
    'current_amount', v_total,
    'target_amount', v_goal.target_amount,
    'status', v_status
  );
end;
$$;

-- ------------------------------------------------------------
-- 8. generate_goal_reminders — create the deadline (30/7/1 days before)
--    and completion reminder rows that are due. ON CONFLICT DO NOTHING
--    makes it fully idempotent; it returns only the newly created rows
--    (with the joined goal name/amount for messages).
-- ------------------------------------------------------------
create or replace function public.generate_goal_reminders(
  p_user_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  goal_id uuid,
  kind text,
  days_before integer,
  target_date date,
  fired_at timestamptz,
  goal_name text,
  target_amount numeric,
  current_amount numeric
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

  return query
  with eligible as (
    select g.*
      from public.financial_goals g
     where g.user_id = v_uid
       and g.status <> 'cancelled'
  ),
  created as (
    insert into public.goal_reminders (user_id, goal_id, kind, days_before, target_date)
    select
      g.user_id,
      g.id,
      'deadline',
      d.days_before,
      g.target_date
    from eligible g
    cross join (values (30), (7), (1)) as d(days_before)
    where g.reminder_enabled
      and g.status <> 'completed'
      and g.target_date >= v_today
      and (g.target_date - d.days_before) <= v_today
    union all
    select
      g.user_id,
      g.id,
      'completion',
      0,
      g.target_date
    from eligible g
    where g.current_amount >= g.target_amount
      and g.status = 'active'
    on conflict (goal_id, target_date, kind) do nothing
    returning id, user_id, goal_id, kind, days_before, target_date, fired_at
  )
  select
    c.id,
    c.user_id,
    c.goal_id,
    c.kind,
    c.days_before,
    c.target_date,
    c.fired_at,
    g.name,
    g.target_amount,
    g.current_amount
  from created c
  join public.financial_goals g on g.id = c.goal_id
  order by g.target_date asc;
end;
$$;

-- generate_all_goal_reminders — service-role batch entry for the scheduler.
-- Refuses calls that carry a user session (clients must use the per-user
-- function so RLS-equivalent scoping always applies).
create or replace function public.generate_all_goal_reminders()
returns table (
  id uuid,
  user_id uuid,
  goal_id uuid,
  kind text,
  days_before integer,
  target_date date,
  fired_at timestamptz,
  goal_name text,
  target_amount numeric,
  current_amount numeric
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
    select distinct user_id from public.financial_goals
  loop
    return query
      select * from public.generate_goal_reminders(v_user_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 9. Grants. Internal helpers stay private; the user-visible surface is
--     contribute_to_goal, remove_goal_contribution and
--     generate_goal_reminders (client) plus the service-role batch entry.
-- ------------------------------------------------------------
revoke all on function public._goal_total(uuid, uuid) from public;
revoke all on function public.contribute_to_goal(uuid, numeric, text) from public;
revoke all on function public.remove_goal_contribution(uuid, uuid) from public;
revoke all on function public.generate_goal_reminders(uuid) from public;
revoke all on function public.generate_all_goal_reminders() from public;

grant execute on function public.contribute_to_goal(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.remove_goal_contribution(uuid, uuid) to authenticated, service_role;
grant execute on function public.generate_goal_reminders(uuid) to authenticated, service_role;
grant execute on function public.generate_all_goal_reminders() to service_role;
