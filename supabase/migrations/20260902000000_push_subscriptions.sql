-- ============================================================
-- push_subscriptions: guarantee the Web Push ledger exists on
-- every deployment.
--
-- The table, its `prefs` column, RLS policies and the per-endpoint unique
-- index previously lived ONLY in supabase/schema.sql. Projects provisioned
-- with `supabase db push` (migrations only) therefore had no
-- push_subscriptions table, so the app's subscription insert failed and the
-- Settings → Notifications toggle fell back to the generic
-- "Couldn't enable notifications right now." This migration makes the table a
-- first-class, idempotent migration target like every other ledger table.
--
-- Safe on any existing database:
--   * fresh DBs get the full table + policies,
--   * DBs created from an older schema.sql keep their rows (only `prefs` is
--     added if it is missing),
--   * policies are dropped + recreated so re-running cannot conflict.
-- ============================================================

-- 1. Table (pattern matches supabase/schema.sql).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  -- Per-user notification preferences synced from Settings → Notifications.
  -- The server respects these before sending; older rows default to `{}` which
  -- means "send everything".
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 2. Add the prefs column on databases that predate it (schema.sql-aligned).
alter table public.push_subscriptions
  add column if not exists prefs jsonb not null default '{}'::jsonb;

-- 3. One row per endpoint (multi-device: each device has its own endpoint).
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and indexname = 'push_subscriptions_endpoint_idx'
  ) then
    create unique index push_subscriptions_endpoint_idx
      on public.push_subscriptions ((subscription ->> 'endpoint'));
  end if;
end $$;

-- 4. Row Level Security — every user only ever manages their own rows.
alter table public.push_subscriptions enable row level security;

drop policy if exists "push: read own" on public.push_subscriptions;
create policy "push: read own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: delete own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- 5. Admins may read (and clean up) subscriptions, never write.
drop policy if exists "push: admin read" on public.push_subscriptions;
create policy "push: admin read" on public.push_subscriptions
  for select using (public.is_admin());
drop policy if exists "push: admin delete" on public.push_subscriptions;
create policy "push: admin delete" on public.push_subscriptions
  for delete using (public.is_admin());