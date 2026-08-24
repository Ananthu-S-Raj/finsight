-- ============================================================
-- FinSight Admin Console — migration
-- Run in Supabase: Project → SQL Editor → New query → Run
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles: role, account status, activity tracking
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'user'
    check (role in ('user', 'admin'));
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
  ('REPORT_VIEW',         'View aggregate analytics')
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
create policy "settings: admin read" on public.app_settings
  for select using (public.is_admin());
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

-- categories: read for all authenticated users, admin manage.
create policy "categories: read" on public.categories
  for select to authenticated using (true);
create policy "categories: admin insert" on public.categories
  for insert with check (public.is_admin());
create policy "categories: admin update" on public.categories
  for update using (public.is_admin());
create policy "categories: admin delete" on public.categories
  for delete using (public.is_admin());
