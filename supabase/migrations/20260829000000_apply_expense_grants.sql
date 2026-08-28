-- ============================================================
-- apply_expense: ensure authenticated users can execute the RPC
-- ============================================================

revoke all on function public.apply_expense(
  text,
  text,
  numeric,
  text,
  boolean
) from public;

grant execute on function public.apply_expense(
  text,
  text,
  numeric,
  text,
  boolean
) to authenticated, service_role;