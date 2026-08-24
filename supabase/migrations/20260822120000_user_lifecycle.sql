-- ============================================================
-- FinSight — Admin force logout for user lifecycle administration
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
