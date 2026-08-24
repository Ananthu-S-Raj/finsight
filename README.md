# FinSight — Smart Personal Finance & Expense Tracker

A passbook-styled personal finance tracker: salary, savings, spending presets,
credit card spend, loans, overspend-to-salary deduction, daily reminders, and
an installable PWA. Frontend is Next.js; backend/auth/database is Supabase —
both free to run.

## 1. Open this folder in OpenCode

```
opencode .
```

From here you can ask OpenCode to run any of the commands below, extend a
feature, or fix something — the codebase is a normal Next.js + TypeScript +
Tailwind app, nothing exotic.

## 2. Install dependencies

```
npm install
```

## 3. Create a free Supabase project

1. Go to supabase.com → New project (free tier).
2. Once it's up, open **SQL Editor** → paste the contents of
   `supabase/schema.sql` → **Run**. This creates the tables, row-level
   security policies, and the trigger that gives every new user a profile row.
3. Go to **Authentication → Providers → Email** and make sure email/password
   sign-in is enabled.
4. Go to **Authentication → Email Templates → Confirm signup**, and switch it
   to send a 6-digit OTP code instead of a magic link (Supabase calls this
   "OTP" mode in the template editor). This is what powers the registration
   OTP screen in the app.
5. Go to **Project Settings → API** and copy the **Project URL** and
   **anon public key**.

## 4. Configure environment variables

```
cp .env.local.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
step 3. Leave `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for step 7 (reminders) — the app
works fine without it, you just won't get push notifications yet.

## 5. Run it locally

```
npm run dev
```

Visit `http://localhost:3000`, register, enter the OTP from your email, and
you're in.

## 6. Forgot / reset / change password

Password recovery is implemented end-to-end for both **regular users** and
**administrators** — there is no separate auth system for admins; they use the
exact same flow.

### The flows

- **Forgot password:** `/login` → *Forgot password?* → `/forgot-password`
  → enter email → reset link emailed → `/reset-password` → new password → login.
- **Admins:** the same flow from the admin console login (`/login`). A successful
  admin reset is recorded in the audit log as `ADMIN_PASSWORD_RESET_COMPLETED`.
- **Change password (signed in):** Settings → Security → *Change password*
  (current password + new password). Works for admins too, and records
  `ADMIN_PASSWORD_CHANGE_COMPLETED`.

### Database

Run the migration **once** in the Supabase SQL editor (also included in
`supabase/schema.sql`):

```
supabase/migrations/20260810000000_password_reset.sql
```

It creates `password_reset_tokens` (hashed tokens, single-use, 30-minute
expiry, IP + user-agent recorded), adds `profiles.password_changed_at` (the
session-invalidation marker), and the three `SECURITY DEFINER` RPCs the API
uses. RLS is enabled on the token table with **no** client-facing policies —
tokens are only ever touched through the RPCs.

### Email template (required)

The reset email is sent by Supabase Auth. You must configure the **Reset
Password** template in **Authentication → Email Templates**:

1. **Subject:** `Reset your FinSight password`
2. **Body:** paste the contents of `supabase/email-templates/reset-password.html`
   (FinSight branding, reset button, 30-minute expiry note, and a security
   warning). It is responsive for mobile and desktop and supports dark mode.
3. Save, then send yourself a test email from the template editor.

The template uses `{{ .ConfirmationURL }}`; make sure the **redirect URL**
`<your site url>/reset-password` is allow-listed under **Authentication →
URL Configuration** (or set `NEXT_PUBLIC_SITE_URL` so links are built correctly).

### API surface

- `POST /api/v1/auth/forgot-password` `{ email }` → always returns
  `"If an account exists with this email, a password reset link has been sent."`
  (no email enumeration). Rate limited to 5/hour per IP and per email.
- `POST /api/v1/auth/reset-password` `{ token, new_password }` → validates the
  token (hashed before storage, single use, 30-minute expiry), updates the
  password, stamps `password_changed_at`, and invalidates old sessions.
- `POST /api/v1/auth/change-password` (Bearer) `{ current_password, new_password }`
  → for signed-in users; re-verifies the current password first.
- `POST /api/v1/ai/insights` (Bearer) → server-generated AI overview of the
  current month (or `{ "month": "2026-08" }`). Returns
  `{ available, insights, provider, model }` or a graceful
  `{ available: false, message }` fallback when AI is disabled or unavailable.
  See section 8.

See `finsight/docs/Password-Reset.md` for the full token lifecycle, security
decisions, and test coverage.

## 7. (Optional) Turn on daily reminders + push overspend alerts
This uses **web-push** from a Supabase Edge Function, triggered daily by
**pg_cron** — all free on Supabase's free tier.

1. Generate a VAPID key pair once:
   ```
   npx web-push generate-vapid-keys
   ```
   Put the public key in `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
2. Deploy the reminder function:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy daily-reminder
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
   ```
3. In Supabase, **Database → Extensions**, enable `pg_cron` and `pg_net`.
4. In the SQL Editor, uncomment and run the `cron.schedule(...)` block at the
   bottom of `supabase/schema.sql`, filling in your function URL and anon key.
5. In the app, tap **"Turn on daily reminders"** on the dashboard once per
   device — this asks for notification permission and registers that device.

If you skip this whole section, everything else still works — you just won't
get a reminder while the app is closed. In-app overspend alerts (the banner
and an in-browser notification while the app is open) work with zero extra
setup.

**How dispatch actually behaves (honest caveats):**

- The Edge Function sends to *every registered device*, respecting each
  device's per-type opt-outs, and automatically deletes subscriptions the
  browser reports as gone (HTTP 410/404).
- Dispatch is **best-effort**: there is no retry queue. A transient push
  failure for one device is skipped (`Promise.allSettled`) and simply waits
  for tomorrow's run.
- Budget-overspend pushes are evaluated when the daily job runs — they can
  lag a late-night overspend by up to a day. The instant, always-correct
  signal remains the in-app banner.
- Final delivery depends on the browser vendor's push service (FCM/APNs);
  devices that are offline for weeks may have notifications dropped by the
  platform itself.

## 8. (Optional) Turn on AI insights

The app ships with **on-device insights** (rule-based, runs entirely in your
browser). Optionally, you can add **server-side AI insights**: the server
aggregates a month of *your own* transactions into a privacy-filtered summary
(totals + category names only — never notes, subcategories, IDs or emails) and
asks a hosted or local language model for a plain-language overview. If AI is
off, misconfigured, or unreachable, the app keeps working and the AI card shows
a friendly fallback.

Add these to `.env.local` (all values documented in `.env.local.example`):

```
# Master switch + provider
AI_ENABLED=true
AI_PROVIDER=openai            # "openai" or "ollama"

# OpenAI (server-side only — never commit the key)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_TIMEOUT_MS=15000

# Local Ollama instead
# OLLAMA_ENABLED=true
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2
```

Endpoint: `POST /api/v1/ai/insights` (Bearer JWT, rate limited to 12/hour per
user). Admins can monitor provider health on the **Dashboard** → *AI service*
card (keys are never shown). Full design: `finsight/docs/AI-Architecture.md`.

## 9. Deploy for free

- **Frontend:** push this repo to GitHub, then import it in Vercel (free
  tier) and add the same three environment variables from `.env.local` in
  the Vercel project settings.
- **Backend:** already live — it's your Supabase project.
- Once deployed, visiting the site on a phone will show an "Install app"
  prompt (or **Add to Home Screen** on iOS Safari) — that's the PWA.

### Operational notes

- **Rate limiting is per-instance.** The auth, admin and AI endpoints use
  in-memory sliding-window limiters. On Vercel's serverless tier each function
  instance keeps its own counters, so limits are best-effort (a burst spread
  across cold-start instances can exceed the nominal cap). This is a
  spam-brake, not a security boundary — the real protections are Supabase
  Auth, RLS and token hashing. Thresholds are tunable via `RATE_LIMIT_*`
  variables in `.env.local.example`.
- **Maintenance mode is enforced server-side for user mutations.** Toggling it
  in Admin → General makes every authenticated `POST/PATCH/DELETE` under
  `/api/v1/*` return `503 maintenance_mode` within ~20 seconds; reads stay
  available and the admin API is exempt so you can always turn it back off.
  The flag is cached briefly in each serverless instance, so enforcement is
  near-instant but not atomic across instances.

## How the money logic works

- **Salary balance** goes up when you add salary or receive a loan, and down
  when you move money to savings or overspend your monthly budget.
- **Savings balance** goes up when you add savings directly or move money
  from salary; it's never touched by spending.
- **Monthly budget** is a number you set for how much you plan to spend this
  calendar month across every category combined.
- Every spend (cash/UPI or credit card) is logged against a category preset.
  Once the running total for the month passes your budget, the *overspill*
  amount is subtracted from your salary balance and an overspend alert fires
  — the rest of that transaction is otherwise recorded normally.
- Loans received are added to your salary balance (spendable money), tagged
  with who it's from, so they show up separately in your history.

## Project structure

```
src/app/          Next.js pages (login, register, verify, dashboard)
src/components/    UI pieces (balance card, spend panel, modals, transaction rows)
src/lib/finance.ts  All the money logic — read this first
src/lib/push.ts     Web push subscription helper
supabase/schema.sql Database schema + RLS policies + auto-profile trigger
supabase/migrations Password-reset migration (hashed tokens + session invalidation)
supabase/email-templates  Reset-password email HTML for the Supabase template editor
supabase/functions/daily-reminder  Edge Function for scheduled push reminders
public/manifest.json + sw.js       PWA install + offline + push handling
```
