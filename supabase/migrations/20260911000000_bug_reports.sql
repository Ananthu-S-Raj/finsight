-- ============================================================
-- "Report a Bug" feature.
--
-- Adds a first-class, RLS-secured bug report ledger plus the
-- BUG_REPORT_MANAGE permission for the Admin Console.
--
-- Security model (fail closed):
--   * Users INSERT only through public.submit_bug_report(...), a
--     SECURITY DEFINER RPC that pins user_id to the caller and sets
--     status = 'open'. There is deliberately NO user INSERT policy, so
--     a direct table insert from the browser is impossible.
--   * Users SELECT only their own rows (auth.uid() = user_id). There is
--     NO user UPDATE/DELETE policy.
--   * Administrators SELECT all rows and UPDATE status/admin_notes, gated
--     on public.has_permission('BUG_REPORT_MANAGE') — the same check the
--     Admin Console API enforces in code.
--   * No DELETE policy at all: bug reports are permanent. The anon role
--     has no access to the table and no EXECUTE on the RPC.
--
-- Idempotent like the rest of the migration history: every statement is
-- CREATE IF NOT EXISTS / CREATE OR REPLACE / guarded, so it is safe to
-- apply on both a fresh database and an existing one.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  category text,
  severity text,
  steps_to_reproduce text,
  expected_behavior text,
  actual_behavior text,
  page_url text,
  user_agent text,
  status text not null default 'open',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bug_reports_title_len check (char_length(title) between 1 and 120),
  constraint bug_reports_description_len check (char_length(description) between 1 and 4000),
  constraint bug_reports_category_ck check (
    category is null or category in ('bug', 'performance', 'privacy', 'usability', 'billing', 'other')
  ),
  constraint bug_reports_severity_ck check (
    severity is null or severity in ('low', 'medium', 'high', 'critical')
  ),
  constraint bug_reports_status_ck check (
    status in ('open', 'in_progress', 'resolved', 'closed')
  ),
  constraint bug_reports_steps_len check (char_length(steps_to_reproduce) <= 2000),
  constraint bug_reports_expected_len check (char_length(expected_behavior) <= 2000),
  constraint bug_reports_actual_len check (char_length(actual_behavior) <= 2000),
  constraint bug_reports_page_url_len check (char_length(page_url) <= 2000),
  constraint bug_reports_user_agent_len check (char_length(user_agent) <= 300),
  constraint bug_reports_admin_notes_len check (char_length(admin_notes) <= 4000)
);

-- ------------------------------------------------------------
-- 2. Indexes for the admin triage surfaces
-- ------------------------------------------------------------
create index if not exists bug_reports_user_id_idx on public.bug_reports (user_id);
create index if not exists bug_reports_status_idx on public.bug_reports (status);
create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at desc);

-- ------------------------------------------------------------
-- 3. Row Level Security
-- ------------------------------------------------------------
alter table public.bug_reports enable row level security;

drop policy if exists "bug_reports: user read own" on public.bug_reports;
create policy "bug_reports: user read own" on public.bug_reports
  for select using (auth.uid() = user_id);

drop policy if exists "bug_reports: admin read all" on public.bug_reports;
create policy "bug_reports: admin read all" on public.bug_reports
  for select using (public.has_permission('BUG_REPORT_MANAGE'));

drop policy if exists "bug_reports: admin update" on public.bug_reports;
create policy "bug_reports: admin update" on public.bug_reports
  for update using (public.has_permission('BUG_REPORT_MANAGE'))
  with check (public.has_permission('BUG_REPORT_MANAGE'));

-- Deliberately absent:
--   * no user INSERT policy -> all user writes go through submit_bug_report()
--   * no user/anon UPDATE or DELETE policy -> reports are permanent

-- ------------------------------------------------------------
-- 4. submit_bug_report() — the ONLY way users create reports.
--    SECURITY DEFINER pins user_id = auth.uid() and status = 'open',
--    validates + truncates every field server-side, so a client can never
--    forge ownership, status or admin notes.
-- ------------------------------------------------------------
create or replace function public.submit_bug_report(
  p_title text,
  p_description text,
  p_category text,
  p_severity text,
  p_steps_to_reproduce text,
  p_expected_behavior text,
  p_actual_behavior text,
  p_page_url text,
  p_user_agent text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_title       text;
  v_description text;
  v_category    text;
  v_severity    text;
begin
  v_title := trim(both from coalesce(p_title, ''));
  v_description := trim(both from coalesce(p_description, ''));

  if char_length(v_title) = 0 or char_length(v_description) = 0 then
    raise exception 'invalid_report';
  end if;

  if char_length(v_title) > 120 then
    v_title := left(v_title, 120);
  end if;
  if char_length(v_description) > 4000 then
    v_description := left(v_description, 4000);
  end if;

  v_category := lower(trim(both from coalesce(p_category, '')));
  if v_category = '' then
    v_category := null;
  elsif v_category not in ('bug', 'performance', 'privacy', 'usability', 'billing', 'other') then
    raise exception 'invalid_category';
  end if;

  v_severity := lower(trim(both from coalesce(p_severity, '')));
  if v_severity = '' then
    v_severity := null;
  elsif v_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'invalid_severity';
  end if;

  insert into public.bug_reports (
    user_id, title, description, category, severity,
    steps_to_reproduce, expected_behavior, actual_behavior,
    page_url, user_agent, status
  )
  values (
    auth.uid(),
    v_title,
    v_description,
    v_category,
    v_severity,
    nullif(left(coalesce(p_steps_to_reproduce, ''), 2000), ''),
    nullif(left(coalesce(p_expected_behavior, ''), 2000), ''),
    nullif(left(coalesce(p_actual_behavior, ''), 2000), ''),
    nullif(left(coalesce(p_page_url, ''), 2000), ''),
    nullif(left(coalesce(p_user_agent, ''), 300), ''),
    'open'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text
) to authenticated, service_role;

-- ------------------------------------------------------------
-- 5. BUG_REPORT_MANAGE — Admin Console permission (view + triage).
--    The admin RLS policies above rely on this code, so seeding it and
--    granting it to the admin role is part of the same migration.
-- ------------------------------------------------------------
insert into public.permissions (name, code, description)
values
  ('BUG_REPORT_MANAGE', 'BUG_REPORT_MANAGE', 'View and manage bug reports')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
  and p.code = 'BUG_REPORT_MANAGE'
on conflict do nothing;