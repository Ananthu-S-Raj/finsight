-- ============================================================
-- push_subscriptions: let a user update only their own subscription.
--
-- syncPushPrefs() writes a user's notification preferences (budget alerts,
-- daily reminders, credit-card reminders, savings notifications, bill
-- reminders) to the subscription rows they own. The original migration only
-- granted SELECT / INSERT / DELETE policies — an UPDATE with no policy is
-- silently dropped by RLS (0 rows changed, no error), so opt-outs never
-- reached the server and the Edge Functions kept sending.
--
-- This adds the missing, user-scoped UPDATE policy: `using` and `with check`
-- both require auth.uid() = user_id, so a caller can update only their own
-- rows and can never rewrite a row to (or from) another user. Existing
-- read/insert/delete and admin policies are untouched.
-- ============================================================

drop policy if exists "push: update own" on public.push_subscriptions;

create policy "push: update own"
on public.push_subscriptions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);