-- Birthday greeting feature: optional date of birth on the user profile.
-- Nullable on purpose — users who never set a birthday simply never see
-- the greeting. No RLS changes needed; existing table policies already
-- govern this column.

alter table public.profiles
  add column if not exists date_of_birth date null;
