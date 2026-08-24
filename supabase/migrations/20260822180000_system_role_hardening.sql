-- ============================================================================
-- WS-A: system-role hardening + profiles.role foreign key
-- ----------------------------------------------------------------------------
-- Two additive database-hardening steps, no application-behaviour change:
--
-- A. The two seeded system roles ('admin', 'user') become immutable rows.
--    Until now only the API layer (loadManageableRole) refused to modify them;
--    any direct UPDATE/DELETE by an is_admin() principal went through. This
--    guard closes that gap for EVERY principal — including service_role and
--    postgres — so it fails closed by construction (no trusted-principal
--    bypass). Protected operations on a system row:
--      * DELETE
--      * renaming (name drift)
--      * un-flagging (is_system true -> false)
--    Description edits and all writes to non-system rows stay untouched.
--
-- B. profiles.role swaps its binary CHECK constraint for a real FK to
--    public.roles(name) (roles.name is UNIQUE, so it serves as natural key).
--    Every existing profile holds 'user' or 'admin', both seeded, so the
--    constraint validates immediately with zero data rewrites. ON DELETE
--    RESTRICT keeps a referenced role from being dropped while profiles
--    still point at it (defence-in-depth alongside trigger A).
--
-- Out of scope by mandate: RLS policy changes, authentication semantics,
-- permission-matrix data, custom-role CRUD.
-- ============================================================================

-- A. System-role immutability ------------------------------------------------

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

-- B. profiles.role: CHECK -> FK ----------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_fkey
  foreign key (role)
  references public.roles(name)
  on delete restrict;
