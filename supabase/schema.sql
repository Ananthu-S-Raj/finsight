-- ============================================================
-- FinSight — Smart Personal Finance & Expense Tracker schema
-- Run this in Supabase: Project → SQL Editor → New query → Run
-- ============================================================

-- 1. Profiles: one row per user, holds live balances
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  monthly_budget numeric(12,2) not null default 0,
  salary_balance numeric(12,2) not null default 0,
  savings_balance numeric(12,2) not null default 0,
  date_of_birth date null,
  created_at timestamptz not null default now()
);

-- 2. Transactions: every add/move/spend is one row, nothing is ever overwritten
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in (
    'salary_add', 'savings_add', 'savings_move',
    'expense', 'credit_card', 'loan_add'
  )),
  category text,        -- e.g. Travel, Food, Shopping, Other
  subcategory text,      -- e.g. Uber, Zomato, Myntra
  amount numeric(12,2) not null,
  overspend_amount numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);

-- 3. Push subscriptions, for daily reminder / overspend web-push notifications
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

-- Keep only one subscription per endpoint per user (multi-device friendly:
-- each device has its own endpoint, so distinct rows are preserved).
create unique index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions ((subscription ->> 'endpoint'));

-- ============================================================
-- Row Level Security — every user only ever sees their own rows
-- ============================================================
alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "transactions: read own" on public.transactions
  for select using (auth.uid() = user_id);
create policy "transactions: insert own" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "transactions: update own" on public.transactions
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "transactions: delete own" on public.transactions
  for delete using (auth.uid() = user_id);

create policy "push: read own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push: insert own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "push: delete own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ============================================================
-- Auto-create a profile row the moment someone signs up
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, date_of_birth)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'date_of_birth', '')::date
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Optional: daily reminder schedule via pg_cron + pg_net
-- Enable both extensions first: Database → Extensions → pg_cron, pg_net
-- Then run this once, replacing the URL with your deployed Edge Function URL,
-- <ANON_KEY> with your project's anon key, and — if you set CRON_SECRET on the
-- function (recommended) — <CRON_SECRET> with that same value. The secret is
-- sent as `x-cron-secret`; the Edge Function rejects callers without it.
-- ============================================================
-- select cron.schedule(
--   'daily-expense-reminder',
--   '0 19 * * *', -- 7pm UTC every day — adjust to your timezone
--   $$
--   select net.http_post(
--     url := 'https://<your-project-ref>.supabase.co/functions/v1/daily-reminder',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <ANON_KEY>',
--       'x-cron-secret', '<CRON_SECRET>',
--       'Content-Type', 'application/json'
--     )
--   );
--   $$
-- );

-- ============================================================
-- FinSight Admin Console (migration 20260807000000_admin)
-- ============================================================
-- FinSight Admin Console — migration
-- Run in Supabase: Project → SQL Editor → New query → Run
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles: role, account status, activity tracking
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'user';
alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'disabled', 'suspended'));
alter table public.profiles
  add column if not exists last_login_at timestamptz;
alter table public.profiles
  add column if not exists last_active_at timestamptz;

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (account_status);

-- ------------------------------------------------------------
-- 2. is_admin() — the single server-side authority check.
--    Invoker security so RLS still scopes it to the caller.
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ------------------------------------------------------------
-- 3. Roles & permissions (RBAC)
-- ------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Seed roles (system roles must never be deleted).
insert into public.roles (name, description, is_system)
values
  ('user',  'Standard user with access to their own finance data.', true),
  ('admin', 'Administrator with console access and elevated permissions.', true)
on conflict (name) do nothing;

-- Seed permissions. Admin gets every permission below; user gets none.
insert into public.permissions (code, description)
values
  ('USER_VIEW',           'View user accounts'),
  ('USER_EDIT',           'Edit user profile fields'),
  ('USER_SUSPEND',        'Suspend, activate or deactivate accounts'),
  ('ROLE_MANAGE',         'Change user roles and manage role permissions'),
  ('TRANSACTION_VIEW',    'View transactions across accounts'),
  ('TRANSACTION_EDIT',    'Correct or flag transactions'),
  ('TRANSACTION_DELETE',  'Delete transactions'),
  ('CATEGORY_MANAGE',     'Manage categories, subcategories and presets'),
  ('NOTIFICATION_MANAGE', 'Create and send system notifications'),
  ('SYSTEM_SETTINGS',     'Read and change system settings'),
  ('AI_SETTINGS',         'Enable or disable AI features'),
  ('PWA_SETTINGS',        'Manage PWA behaviour'),
  ('AUDIT_LOG_VIEW',      'View audit logs'),
  ('REPORT_VIEW',         'View aggregate analytics'),
  -- WS-C1: console-admission capability. Granted to admin via the cross-join
  -- below; the user role receives nothing. Not yet gate-authoritative (WS-C3).
  ('ADMIN_CONSOLE_ACCESS','Enter the administrative console')
on conflict (code) do nothing;

-- Grant every permission to the admin role.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
on conflict do nothing;

-- ------------------------------------------------------------
-- 4. audit_logs — append-only. No UPDATE/DELETE policy exists,
--    so even administrators cannot delete history via the app.
-- ------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  resource_type text not null,
  resource_id text,
  target_user_id uuid references auth.users(id) on delete set null,
  target_email text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  result text not null default 'success' check (result in ('success', 'denied', 'error')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
create index if not exists audit_logs_resource_idx on public.audit_logs (resource_type);
create index if not exists audit_logs_target_idx on public.audit_logs (target_user_id);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);

-- ------------------------------------------------------------
-- 5. app_settings — key/value JSON for system configuration.
--    Holds ONLY non-secret settings. Secrets stay in the
--    hosting environment and are never stored or exposed here.
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('general', jsonb_build_object(
    'app_name', 'FinSight',
    'app_description', 'Smart money, beautifully simple.',
    'maintenance_mode', false
  )),
  ('finance', jsonb_build_object(
    'default_currency', 'INR',
    'default_categories', 'Travel,Food,Shopping,Other'
  )),
  ('notifications', jsonb_build_object(
    'daily_reminder_enabled', true,
    'budget_alert_threshold', 90,
    'card_reminder_enabled', true
  )),
  ('ai', jsonb_build_object(
    'ai_enabled', true,
    'provider', 'ollama',
    'features', jsonb_build_object(
      'insights', true,
      'smart_hints', true,
      'categorization', false
    ),
    'last_health_check', null
  )),
  ('pwa', jsonb_build_object(
    'install_prompt_enabled', true,
    'notification_prompt_enabled', true
  ))
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 6. admin_notifications — system broadcasts
-- ------------------------------------------------------------
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all'
    check (audience in ('all', 'users', 'admins', 'selected')),
  target_user_ids uuid[],
  channel text not null default 'both'
    check (channel in ('inapp', 'push', 'both')),
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'failed', 'cancelled')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists admin_notifications_status_idx on public.admin_notifications (status);
create index if not exists admin_notifications_created_idx on public.admin_notifications (created_at desc);

-- ------------------------------------------------------------
-- 7. categories — admin-managed canonical list. Prefer
--    disable/archive over destructive deletion; existing
--    transactions keep referencing their snapshot strings.
-- ------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'expense' check (type in ('expense', 'income')),
  parent_id uuid references public.categories(id) on delete cascade,
  is_default boolean not null default false,
  is_disabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (parent_id, name)
);

insert into public.categories (name, type, is_default, sort_order) values
  ('Travel', 'expense', true, 1),
  ('Food', 'expense', true, 2),
  ('Shopping', 'expense', true, 3),
  ('Other', 'expense', true, 4)
on conflict do nothing;

insert into public.categories (name, type, parent_id, is_default, sort_order)
select s.name, 'expense', c.id, true, s.ord
from (values
  ('Travel', 'Bus', 1), ('Travel', 'Uber', 2), ('Travel', 'Rapido', 3),
  ('Food', 'Restaurants', 1), ('Food', 'Zomato', 2), ('Food', 'Swiggy', 3),
  ('Shopping', 'Shops', 1), ('Shopping', 'Flipkart', 2), ('Shopping', 'Amazon', 3),
  ('Shopping', 'Myntra', 4), ('Shopping', 'Meesho', 5)
) as s(parent, name, ord)
join public.categories c on c.name = s.parent and c.parent_id is null
on conflict (parent_id, name) do nothing;

-- ------------------------------------------------------------
-- 8. admin RPC — safe auth.user metadata for admins only.
--    SECURITY DEFINER so it may read auth.users, but it refuses
--    anyone who is not an admin. Returns only safe fields.
-- ------------------------------------------------------------
create or replace function public.admin_auth_infos(ids uuid[])
returns table (user_id uuid, email_confirmed_at timestamptz, auth_created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'insufficient_permission';
  end if;
  return query
    select u.id::uuid, u.email_confirmed_at, u.created_at, u.last_sign_in_at
    from auth.users u
    where u.id = any(ids);
end;
$$;

-- Public app-status RPC (no admin check — exposes only a boolean).
create or replace function public.app_status()
returns table (maintenance boolean, app_name text)
language plpgsql security definer set search_path = public
as $$
begin
  return query
    select
      coalesce((select (value->>'maintenance_mode')::boolean from public.app_settings where key = 'general'), false),
      coalesce((select value->>'app_name' from public.app_settings where key = 'general'), 'FinSight');
end;
$$;

-- ------------------------------------------------------------
-- 9. Row Level Security — extend for admins.
--    Normal users are completely unaffected (their existing
--    own-row policies remain first-class).
-- ------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.categories enable row level security;

-- profiles: admins may read and update every profile.
create policy "profiles: admin read" on public.profiles
  for select using (public.is_admin());
create policy "profiles: admin update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- transactions: admins may read/update/delete every transaction.
create policy "transactions: admin read" on public.transactions
  for select using (public.is_admin());
create policy "transactions: admin update" on public.transactions
  for update using (public.is_admin()) with check (public.is_admin());
create policy "transactions: admin delete" on public.transactions
  for delete using (public.is_admin());

-- push_subscriptions: admins may read and delete (never write).
create policy "push: admin read" on public.push_subscriptions
  for select using (public.is_admin());
create policy "push: admin delete" on public.push_subscriptions
  for delete using (public.is_admin());

-- roles/permissions: read for any authenticated user (needed to render
-- permission-aware UI); write is admin-only.
create policy "roles: read" on public.roles
  for select to authenticated using (true);
create policy "permissions: read" on public.permissions
  for select to authenticated using (true);
create policy "role_permissions: read" on public.role_permissions
  for select to authenticated using (true);

create policy "roles: admin insert" on public.roles
  for insert with check (public.is_admin());
create policy "roles: admin update" on public.roles
  for update using (public.is_admin());
create policy "roles: admin delete" on public.roles
  for delete using (public.is_admin());

create policy "permissions: admin insert" on public.permissions
  for insert with check (public.is_admin());
create policy "permissions: admin update" on public.permissions
  for update using (public.is_admin());
create policy "permissions: admin delete" on public.permissions
  for delete using (public.is_admin());

create policy "role_permissions: admin insert" on public.role_permissions
  for insert with check (public.is_admin());
create policy "role_permissions: admin delete" on public.role_permissions
  for delete using (public.is_admin());

-- audit_logs: append-only. Admin can insert + select. No update/delete.
create policy "audit: admin insert" on public.audit_logs
  for insert with check (public.is_admin());
create policy "audit: admin read" on public.audit_logs
  for select using (public.is_admin());

-- app_settings: admin read/write.
-- WS-C2-PILOT: SELECT migrated to the permission-aware helper. Admin access
-- is preserved via the seeded admin SYSTEM_SETTINGS grant; write policies
-- remain is_admin()-based. See migration 20260822210000_settings_read_pilot_rls.
create policy "settings: admin read" on public.app_settings
  for select using (public.has_permission('SYSTEM_SETTINGS'));
create policy "settings: admin insert" on public.app_settings
  for insert with check (public.is_admin());
create policy "settings: admin update" on public.app_settings
  for update using (public.is_admin());

-- admin_notifications: admins full CRUD; normal users may only read
-- already-sent broadcasts addressed to them.
create policy "notifications: admin select" on public.admin_notifications
  for select using (public.is_admin());
create policy "notifications: admin insert" on public.admin_notifications
  for insert with check (public.is_admin());
create policy "notifications: admin update" on public.admin_notifications
  for update using (public.is_admin()) with check (public.is_admin());
create policy "notifications: read sent" on public.admin_notifications
  for select using (
    status = 'sent' and (
      audience in ('all', 'users')
      or (audience = 'selected' and target_user_ids @> array[auth.uid()])
    )
  );

-- notification_reads: per-user read state for broadcasts. Users may only
-- ever see/create markers for themselves; visibility of the broadcast row
-- itself is governed by the "notifications: read sent" policy above.
create table if not exists public.notification_reads (
  notification_id uuid not null references public.admin_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;

create policy "notification_reads: select own"
  on public.notification_reads for select
  using (auth.uid() = user_id);
create policy "notification_reads: insert own"
  on public.notification_reads for insert
  with check (auth.uid() = user_id);

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id);

-- categories: read for all authenticated users, admin manage.
create policy "categories: read" on public.categories
  for select to authenticated using (true);
create policy "categories: admin insert" on public.categories
  for insert with check (public.is_admin());
create policy "categories: admin update" on public.categories
  for update using (public.is_admin());
create policy "categories: admin delete" on public.categories
  for delete using (public.is_admin());

-- ============================================================
-- FinSight Admin Console — aggregate stats RPCs
-- (migration 20260807000001_admin_stats)
-- ============================================================
-- FinSight Admin Console — aggregate stats RPCs
-- SECURITY DEFINER so they can compute platform-wide numbers
-- efficiently, but every function refuses non-admins.
-- ============================================================

create or replace function public.admin_user_stats()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'insufficient_permission';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where p.account_status = 'active'),
    'disabled', count(*) filter (where p.account_status = 'disabled'),
    'suspended', count(*) filter (where p.account_status = 'suspended'),
    'admins', count(*) filter (where p.role = 'admin'),
    'verified', count(u.id),
    'unverified', count(*) - count(u.id)
  )
  into result
  from public.profiles p
  left join auth.users u on u.id = p.id and u.email_confirmed_at is not null;

  return result;
end;
$$;

create or replace function public.admin_finance_stats()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'insufficient_permission';
  end if;

  select jsonb_build_object(
    'transactions', count(*),
    'income', coalesce(sum(t.amount) filter (where t.type in ('salary_add', 'loan_add', 'savings_add')), 0),
    'expenses', coalesce(sum(t.amount) filter (where t.type in ('expense', 'credit_card')), 0),
    'savings', coalesce((select sum(savings_balance) from public.profiles), 0),
    'active_budgets', (select count(*) from public.profiles where monthly_budget > 0),
    'credit_cards', count(*) filter (where t.type = 'credit_card'),
    'loans', coalesce(sum(t.amount) filter (where t.type = 'loan_add'), 0),
    'borrow_lend_entries', count(*) filter (where t.type = 'loan_add')
  )
  into result
  from public.transactions t;

  return result;
end;
$$;

-- ============================================================
-- FinSight Admin Console — extra columns & policies
-- (migration 20260807000002_admin_extra)
-- ============================================================
-- FinSight Admin Console — extra columns & policies
-- ============================================================

-- Transaction flagging (admin review). Existing rows are unaffected.
alter table public.transactions
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_reason text;

create index if not exists transactions_flagged_idx on public.transactions (flagged);
create index if not exists transactions_type_idx on public.transactions (type);

-- admin_notifications: admins may also delete (e.g. removing a mistake before send).
create policy "notifications: admin delete" on public.admin_notifications
  for delete using (public.is_admin());

-- ============================================================
-- FinSight — Forgot / Reset Password
-- (migration 20260810000000_password_reset)
-- ============================================================

-- password_reset_tokens — reset token audit & single-use guard.
-- Only a SHA-256 hash of the raw token is ever stored. RLS is enabled with
-- NO policies, so direct client access is denied entirely; all interaction
-- happens through the SECURITY DEFINER RPCs below.
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text unique,          -- SHA-256 of the recovery token (null while pending)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null, -- request time + 30 minutes
  used_at timestamptz,             -- set the moment the token is consumed
  ip_address text,
  user_agent text
);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens (user_id, created_at desc);
create index if not exists password_reset_tokens_expires_idx
  on public.password_reset_tokens (expires_at);
create index if not exists password_reset_tokens_used_idx
  on public.password_reset_tokens (used_at);

alter table public.password_reset_tokens enable row level security;

-- profiles.password_changed_at — session invalidation marker.
-- Every session whose JWT `iat` predates this value is stale and rejected.
alter table public.profiles
  add column if not exists password_changed_at timestamptz;

-- request_password_reset: reads auth.users by email (security definer) and
-- creates a pending row only when the user exists. Callers ignore the boolean
-- and always answer with the same generic message (no email enumeration).
create or replace function public.request_password_reset(
  p_email text,
  p_expires_at timestamptz,
  p_ip text,
  p_user_agent text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
    from auth.users u
   where lower(u.email) = lower(p_email)
   limit 1;

  if v_user_id is null then
    return false;
  end if;

  insert into public.password_reset_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
  values (v_user_id, null, p_expires_at, p_ip, p_user_agent);

  return true;
end;
$$;

-- mark_password_reset_token_used: binds an incoming recovery token to the most
-- recent pending request for the caller. Enforces single use + the 30-minute
-- window at our layer, and only for the caller's own user id.
create or replace function public.mark_password_reset_token_used(
  p_user_id uuid,
  p_token_hash text,
  p_ip text,
  p_user_agent text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    return false;
  end if;

  select t.id into v_id
    from public.password_reset_tokens t
   where t.user_id = p_user_id
     and t.token_hash is null
     and t.used_at is null
     and t.expires_at > now()
   order by t.created_at desc
   limit 1;

  if v_id is null then
    return false;
  end if;

  update public.password_reset_tokens t
     set token_hash = p_token_hash,
         used_at = now(),
         ip_address = coalesce(p_ip, t.ip_address),
         user_agent = coalesce(p_user_agent, t.user_agent)
   where t.id = v_id;

  return true;
end;
$$;

-- set_password_changed_at: stamps the caller's own profile. Security definer
-- so users cannot self-manipulate the marker via "profiles: update own".
create or replace function public.set_password_changed_at()
returns timestamptz
language sql security definer set search_path = public
as $$
  update public.profiles p
     set password_changed_at = now()
   where p.id = auth.uid()
  returning p.password_changed_at;
$$;

-- ============================================================
-- FinSight — Admin force logout for user lifecycle administration
-- (migration 20260822120000_user_lifecycle)
-- ============================================================
-- Additive SECURITY DEFINER RPC that stamps another user's
-- session-invalidation marker (profiles.password_changed_at). It reuses the
-- existing JWT-iat guard architecture — no Supabase session-server calls,
-- no service-role key, and no changes to RLS policies or guard triggers.
--
-- Safety properties:
--   * refuses any caller who is not an admin (same pattern as
--     admin_auth_infos), so a plain authenticated client cannot revoke
--     someone else's sessions;
--   * explicitly targets p_user_id — it never derives the target from
--     auth.uid(), unlike the self-service set_password_changed_at();
--   * monotonic via greatest(existing, now()), so clock skew can never move
--     a marker backwards and un-invalidate stale tokens;
--   * touches ONLY password_changed_at — balances, roles, status and all
--     other columns are untouched, and profiles_guard_protected_columns
--     still fires (definer owner passes its allow-list).

create or replace function public.admin_revoke_sessions(p_user_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_stamped timestamptz;
begin
  if not public.is_admin() then
    raise exception 'insufficient_permission';
  end if;

  update public.profiles p
     set password_changed_at = greatest(p.password_changed_at, now())
   where p.id = p_user_id
  returning p.password_changed_at into v_stamped;

  return v_stamped;
end;
$$;

-- ============================================================
-- FinSight — Security & financial integrity hardening
-- (migration 20260811000000_security_hardening)
-- ============================================================
-- Closes the privilege-escalation hole (users could UPDATE their own
-- `profiles` row to set role='admin' / rewrite balances), turns
-- transactions into a guarded ledger, and moves every balance-affecting
-- write into atomic SECURITY DEFINER RPCs.
-- ============================================================

-- Profiles: direct INSERT revoked (created only by the definer-rights
-- handle_new_user trigger). Insert policy dropped as redundant.
revoke insert on table public.profiles from anon, authenticated;
drop policy if exists "profiles: insert own" on public.profiles;

-- Guard trigger: only admins (or trusted server code) may change
-- role / account_status / balances / password_changed_at.
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

-- Transactions: users may update only category / subcategory / note.
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

-- Check constraints (NOT VALID: legacy rows untouched, every new write enforced).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_salary_balance_nonneg') then
    alter table public.profiles add constraint profiles_salary_balance_nonneg check (salary_balance >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_savings_balance_nonneg') then
    alter table public.profiles add constraint profiles_savings_balance_nonneg check (savings_balance >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_amount_positive') then
    alter table public.transactions add constraint transactions_amount_positive check (amount > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_overspend_nonneg') then
    alter table public.transactions add constraint transactions_overspend_nonneg check (overspend_amount >= 0) not valid;
  end if;
end;
$$;

-- Atomic financial RPCs — the single trusted path for anything that
-- moves money. Locks the caller's profile row so concurrent writes
-- serialize instead of losing updates. Errors: invalid_amount,
-- profile_not_found, insufficient_balance, invalid_kind.
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

revoke all on function public.apply_expense(text, text, numeric, text, boolean) from public;
revoke all on function public.apply_income(text, numeric, text) from public;
revoke all on function public.apply_savings_move(numeric) from public;

grant execute on function public.apply_expense(text, text, numeric, text, boolean) to authenticated, service_role;
grant execute on function public.apply_income(text, numeric, text) to authenticated, service_role;
grant execute on function public.apply_savings_move(numeric) to authenticated, service_role;

-- ============================================================
-- WS-A: system-role hardening + profiles.role FK
-- Run in Supabase: Project → SQL Editor → New query → Run
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The seeded system roles ('admin', 'user') become immutable
--    rows. Fails closed for EVERY principal (no trusted bypass):
--    system roles cannot be renamed, un-flagged, or deleted.
--    Description edits and non-system rows stay untouched.
-- ------------------------------------------------------------
create or replace function public.guard_roles_system_rows()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'cannot_modify_system_role';
    end if;
    return old;
  end if;

  if old.is_system
     and (
       new.name is distinct from old.name
       or new.is_system is distinct from old.is_system
     ) then
    raise exception 'cannot_modify_system_role';
  end if;

  return new;
end;
$$;

drop trigger if exists roles_guard_system_rows on public.roles;
create trigger roles_guard_system_rows
  before update or delete on public.roles
  for each row execute function public.guard_roles_system_rows();

-- ------------------------------------------------------------
-- 2. profiles.role: binary CHECK -> foreign key to
--    public.roles(name) (roles.name is UNIQUE; every existing
--    value is a seeded role). ON DELETE RESTRICT keeps referenced
--    roles from being dropped while profiles point at them.
-- ------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_role_fkey
      foreign key (role)
      references public.roles(name)
      on delete restrict;
  end if;
end;
$$;

-- ============================================================================
-- WS-C2 FOUNDATION: permission-aware authorization primitive
-- ----------------------------------------------------------------------------
-- Resolution: auth.uid() -> profiles.role -> roles.name -> role_permissions
--             -> permissions.code. NOT "is admin": a role holds exactly what
--             role_permissions grants it.
-- SECURITY DEFINER so future RLS consumers cannot recurse through policies on
-- the referenced tables; search_path pinned and all objects schema-qualified.
-- Fail closed: NULL code, unauthenticated caller, missing profile/role row,
-- or unknown code all return false. No dynamic SQL, no user-id parameter.
-- Zero callers in this phase: no existing role-based policy has been rewritten.
-- ============================================================================

create or replace function public.has_permission(p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_code is null then
    return false;
  end if;

  select p.role
    into v_role
    from public.profiles p
   where p.id = auth.uid();

  if v_role is null then
    return false;
  end if;

  return exists (
    select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions perm on perm.id = rp.permission_id
     where r.name = v_role
       and perm.code = p_code
  );
end;
$$;

revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated, service_role;
