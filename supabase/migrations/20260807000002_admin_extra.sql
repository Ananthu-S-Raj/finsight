-- ============================================================
-- FinSight Admin Console — extra columns & policies
-- ============================================================

-- Transaction flagging (admin review). Existing rows are unaffected.
alter table public.transactions
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_reason text;

create index if not exists transactions_flagged_idx on public.transactions (flagged);
create index if not exists transactions_type_idx on public.transactions (type);

-- admin_notifications: admins may also delete (e.g. removing a mistake before send).
create policy "notifications: admin delete" on public.admin_notifications
  for delete using (public.is_admin());
