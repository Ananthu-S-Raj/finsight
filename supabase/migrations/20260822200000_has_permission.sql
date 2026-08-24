-- ============================================================================
-- WS-C2 FOUNDATION: public.has_permission(p_code text)
-- ----------------------------------------------------------------------------
-- Permission-aware authorization primitive for future RLS consumption.
--
-- Resolution:
--   auth.uid() -> profiles.role -> roles.name
--              -> role_permissions.role_id -> permissions.id -> permissions.code
--
-- Semantics:
--   * Answers "does the CURRENT authenticated principal's effective role hold
--     this capability". It is NOT "is admin": a role holds exactly what
--     role_permissions grants it, and admin holds exactly its granted rows.
--   * SECURITY DEFINER so that, once consumed inside RLS policies, evaluation
--     cannot recurse through policies on profiles/roles/permissions.
--   * search_path is pinned to public and every object is schema-qualified,
--     matching the repository convention for privileged helpers.
--   * Fail closed: NULL code, NULL/unauthenticated principal, missing profile
--     row, unknown role name, or unknown permission code all yield false.
--   * No dynamic SQL; no parameters other than the permission code; callers
--     cannot target another user.
--
-- This phase does NOT rewrite any existing role-based RLS policy. The helper
-- has zero callers until a pilot policy migrates in a later step of WS-C2.
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

-- Callable functions follow the security-hardening grant convention: not
-- executable by default, explicit grants to the roles that may use it inside
-- policy expressions or direct checks.
revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated, service_role;
