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
