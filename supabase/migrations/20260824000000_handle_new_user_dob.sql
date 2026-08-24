-- Extend handle_new_user() to extract date_of_birth from Supabase signup
-- metadata so birthday greetings work from the moment a new user registers.
--
-- Safe for production:
--   • CREATE OR REPLACE only — no DROP, no truncation, no RLS changes.
--   • Existing users are untouched (trigger only fires on new auth.users inserts).
--   • New signups without DOB continue to produce NULL date_of_birth
--     (nullif('', '') → null, and null::date → null).
--   • SECURITY DEFINER and search_path are preserved by CREATE OR REPLACE.
--   • The date_of_birth column already exists on profiles (migration 20260821).

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, date_of_birth)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'date_of_birth', '')::date
  );
  return new;
end;
$$ language plpgsql security definer;
