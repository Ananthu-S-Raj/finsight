-- ============================================================================
-- WS-C2-PILOT: first permission-aware RLS surface
-- ----------------------------------------------------------------------------
-- Pilot policy: "settings: admin read" on public.app_settings.
--
--   OLD: for select using (public.is_admin())
--   NEW: for select using (public.has_permission('SYSTEM_SETTINGS'))
--
-- Selection rationale (WS-C2 final report + this phase's inspection):
--   * app_settings is a small configuration table with no user-owned rows;
--     every current reader is an admin, so blast radius is minimal.
--   * Read-only command; write policies ("settings: admin insert/update")
--     remain is_admin()-based and untouched.
--   * Exact capability match: SYSTEM_SETTINGS = "Read and change system
--     settings".
--   * Independent of console authentication; trivially reversible (restore
--     the old one-line policy).
--
-- Semantics:
--   * Admin behavior preserved WITHOUT any role-name shortcut in the policy:
--     the seeded admin role holds SYSTEM_SETTINGS via the original cross-join
--     grant, so has_permission('SYSTEM_SETTINGS') is true for admins.
--   * Plain users are unchanged: the user role holds no permissions.
--   * A custom role gains SELECT on app_settings exactly when it holds
--     SYSTEM_SETTINGS via role_permissions. Unrelated permissions grant
--     nothing here. This is NOT "any permission => admin".
--   * No recursion: has_permission() is SECURITY DEFINER with pinned
--     search_path, so its reads of profiles/roles/role_permissions/permissions
--     bypass RLS instead of re-entering policy evaluation.
--
-- Scope: this migration rewrites EXACTLY ONE policy. Every other
-- is_admin()-based policy, every RPC guard, and is_admin() itself are
-- untouched.
-- ============================================================================

drop policy if exists "settings: admin read" on public.app_settings;

create policy "settings: admin read" on public.app_settings
  for select using (public.has_permission('SYSTEM_SETTINGS'));
