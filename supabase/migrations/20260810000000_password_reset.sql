-- ============================================================
-- FinSight — Forgot / Reset Password
-- (migration 20260810000000_password_reset)
-- Run in Supabase: Project → SQL Editor → New query → Run
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. password_reset_tokens — reset token audit & single-use guard.
--    Only a SHA-256 hash of the raw token is ever stored. RLS is enabled
--    with NO policies, so direct client access is denied entirely; all
--    interaction happens through the SECURITY DEFINER RPCs below.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2. profiles.password_changed_at — session invalidation marker.
--    Every session whose JWT `iat` predates this value is stale and rejected.
--    Default NULL so existing sessions are not affected by the migration.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists password_changed_at timestamptz;

-- ------------------------------------------------------------
-- 3. request_password_reset(email, expires_at, ip, user_agent)
--    SECURITY DEFINER so it may read auth.users by email without exposing it.
--    Creates a pending token row ONLY when the email belongs to a real user.
--    Returns whether the user exists; callers ignore it and always answer
--    with the same generic message (no email enumeration).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4. mark_password_reset_token_used(user_id, token_hash, ip, user_agent)
--    Binds an incoming recovery token to the most recent *pending* request
--    for that user. Only succeeds when the row is still unused AND not
--    expired. Enforces single use and the 30-minute window at our layer.
--    Only the caller's own user id may be stamped (no token hijacking).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. set_password_changed_at() — stamps the caller's own profile.
--    SECURITY DEFINER so users cannot self-manipulate the marker through the
--    ordinary "profiles: update own" policy; it can only ever be set to now().
-- ------------------------------------------------------------
create or replace function public.set_password_changed_at()
returns timestamptz
language sql security definer set search_path = public
as $$
  update public.profiles p
     set password_changed_at = now()
   where p.id = auth.uid()
  returning p.password_changed_at;
$$;
