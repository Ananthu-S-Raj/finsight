-- ============================================================================
-- WS-C1: define the ADMIN_CONSOLE_ACCESS capability
-- ----------------------------------------------------------------------------
-- Additive seed-only change. Semantics (normative, docs/capability-semantics.md):
--   ADMIN_CONSOLE_ACCESS means "this role is authorized to enter the
--   administrative console". It does NOT confer full-admin authority,
--   unrestricted data access, permission granting, role assignment, or
--   system-role modification.
--
-- Until WS-C3 relocates console admission, the literal role === "admin"
-- check remains authoritative; this permission has no gate effect yet.
-- ============================================================================

insert into public.permissions (code, description)
values
  ('ADMIN_CONSOLE_ACCESS', 'Enter the administrative console')
on conflict (code) do nothing;

-- The seeded system admin role receives the capability; the user role does
-- not. Natural-key join matches the established seeding convention.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
  and p.code = 'ADMIN_CONSOLE_ACCESS'
on conflict do nothing;
