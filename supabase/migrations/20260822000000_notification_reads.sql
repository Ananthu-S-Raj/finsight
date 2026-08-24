-- ============================================================
-- FinSight — Per-user read state for admin broadcast notifications
-- ============================================================
-- Additive join table: each user tracks which sent broadcasts they have
-- read. Visibility of the broadcasts themselves remains governed by the
-- existing "notifications: read sent" policy on admin_notifications.

create table if not exists public.notification_reads (
  notification_id uuid not null references public.admin_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;

-- A user may see and create ONLY their own read markers. The composite
-- primary key makes duplicates impossible; the with-check clause makes
-- cross-user markers impossible.
create policy "notification_reads: select own"
  on public.notification_reads for select
  using (auth.uid() = user_id);

create policy "notification_reads: insert own"
  on public.notification_reads for insert
  with check (auth.uid() = user_id);

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id);
