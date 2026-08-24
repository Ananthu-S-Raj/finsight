-- Custom per-user categories + transaction search optimizations.

-- 1. Categories: allow user-owned rows alongside system rows.
alter table public.categories
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Restrict uniqueness per owner (system rows keep user_id null).
drop index if exists categories_name_key;
create unique index categories_name_owner_key
  on public.categories (lower(name), coalesce(user_id, '00000000-0000-0000-0000-000000000000'));

-- 2. Search index over the text a user is most likely to type.
create index if not exists transactions_note_tsv_idx
  on public.transactions using gin (to_tsvector('simple', coalesce(note, '') || ' ' || coalesce(category, '') || ' ' || coalesce(subcategory, '')));

-- 3. API helper: apply filter/order clauses against a base query.
--    This is a normalized reference implementation. The app re-implements
--    this in JS in src/server/db/transactions.ts (see filterToWhere); keep
--    both in sync.
create or replace function public.transactions_apply(
  p_user uuid,
  p_range daterange,
  p_type text,
  p_category text,
  p_min numeric,
  p_max numeric,
  p_search text,
  p_order text default 'date',
  p_direction text default 'desc',
  p_cursor text default null
) returns table (
  id uuid, created_at timestamptz, date date, type text, amount numeric,
  note text, category text, subcategory text, category_id uuid,
  recurring_id uuid, tx_prev_ts timestamptz, tx_next_ts timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select
      t.id, t.created_at, t.date, t.type, t.amount,
      t.note, t.category, t.subcategory, t.category_id,
      t.recurring_id, t.tx_prev_ts, t.tx_next_ts
    from public.transactions t
    where t.user_id = p_user
      and (p_range is null or t.date <@ p_range)
      and (p_type is null or t.type = p_type)
      and (p_category is null or t.category = p_category)
      and (p_min is null or t.amount >= p_min)
      and (p_max is null or t.amount <= p_max)
      and (
        p_search is null or p_search = ''
        or to_tsvector('simple', coalesce(t.note, '') || ' ' || coalesce(t.category, '') || ' ' || coalesce(t.subcategory, ''))
           @@ to_tsquery('simple', p_search)
      )
    order by
      case when p_order = 'amount' and p_direction = 'desc' then t.amount end desc nulls last,
      case when p_order = 'amount' and p_direction = 'asc'  then t.amount end asc  nulls last,
      case when p_order <> 'amount' and p_direction = 'desc' then t.date end desc nulls last,
      case when p_order <> 'amount' and p_direction = 'asc'  then t.date end asc  nulls last,
      t.created_at desc;
end $$;

-- 4. Re-define apply_expense to accept an optional category_id so expenses
--    booked against a user's custom category keep the FK for deletion
--    protection and reporting. Snapshot columns stay as the source of truth
--    for reporting/grouping (custom categories are renamed freely).
create or replace function public.apply_expense(
  p_category text default null,
  p_subcategory text default null,
  p_amount numeric default 0,
  p_note text default '',
  p_is_credit_card boolean default false,
  p_category_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_spent numeric;
  v_overspend numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories
    where id = p_category_id
      and (user_id = auth.uid() or user_id is null)
  ) then
    raise exception 'category_invalid';
  end if;

  select * into v_profile
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  select coalesce(sum(amount), 0) into v_spent
    from public.transactions
   where user_id = auth.uid()
     and type in ('expense', 'credit_card')
     and created_at >= date_trunc('month', now());

  v_overspend := greatest(0, v_spent + p_amount - greatest(v_profile.monthly_budget, v_spent));

  if v_overspend > 0 then
    if v_profile.salary_balance < v_overspend then
      raise exception 'insufficient_balance';
    end if;
    update public.profiles
       set salary_balance = v_profile.salary_balance - v_overspend
     where id = auth.uid();
  end if;

  insert into public.transactions (user_id, type, category, subcategory, category_id, amount, overspend_amount, note)
  values (
    auth.uid(),
    case when coalesce(p_is_credit_card, false) then 'credit_card' else 'expense' end,
    p_category,
    p_subcategory,
    p_category_id,
    p_amount,
    v_overspend,
    coalesce(p_note, '')
  );

  return jsonb_build_object('overspend_amount', v_overspend);
end;
$$;

-- 5. Categories RPCs for the app API.
--    SECURITY DEFINER so users can read the max-custom setting from
--    app_settings (users have no direct read access to that table) and
--    so ownership checks run in a single atomic query.

create or replace function public.categories_create(p_name text, p_user uuid)
returns public.categories language plpgsql security definer set search_path = public as $$
declare
  v_cap int;
  v_count int;
  v_result public.categories;
begin
  p_name := lower(btrim(p_name));
  if p_name = '' then
    raise exception 'Category name cannot be empty';
  end if;
  if length(p_name) > 40 then
    raise exception 'Category name is too long';
  end if;

  if exists (
    select 1 from public.categories
    where lower(name) = p_name
      and user_id is not distinct from p_user
  ) then
    raise exception 'Category already exists';
  end if;

  v_cap := coalesce((
    select (s.value ->> 'max_custom_per_user')::int
    from public.app_settings s
    where s.key = 'categories'
    limit 1
  ), 20);

  select count(*) into v_count from public.categories where user_id = p_user;
  if v_count >= v_cap then
    raise exception 'Custom category limit reached';
  end if;

  insert into public.categories (name, user_id)
  values (p_name, p_user)
  returning * into v_result;

  return v_result;
end $$;

create or replace function public.categories_delete(p_id uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_row public.categories;
begin
  select * into v_row
  from public.categories
  where id = p_id and user_id = p_user
  for update;

  if v_row.id is null then
    raise exception 'Category not found';
  end if;

  v_name := lower(v_row.name);

  -- Refuse deletion while transactions still reference the category.
  if exists (
    select 1 from public.transactions
    where user_id = p_user and category_id = p_id
  ) then
    raise exception 'Category is in use';
  end if;

  -- Recurring transactions referencing the category lose their pointer
  -- (the snapshot in category remains).
  update public.recurring_transactions
  set category_id = null
  where user_id = p_user and category_id = p_id;

  delete from public.categories where id = p_id and user_id = p_user;
  return true;
end $$;

revoke all on function public.apply_expense(text, text, numeric, text, boolean, uuid) from public;
revoke all on function public.transactions_apply(uuid, daterange, text, text, numeric, numeric, text, text, text, text) from public;
revoke all on function public.categories_create(text, uuid) from public;
revoke all on function public.categories_delete(uuid, uuid) from public;
