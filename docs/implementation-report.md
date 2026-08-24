# FinSight Implementation Report

## Scope

Hardening passes over the existing FinSight expense-tracker:

1. **Pass 1** — server-side authorization checks, a database-level write guard,
   CSP with nonces, and concurrency fixes.
2. **Pass 2** — session-freshness enforcement on admin *and* user-facing APIs,
   in-app rate limiting for the endpoints FinSight owns, per-request CSP
   nonces (fixing a static-caching flaw), `no-store` on authenticated JSON
   responses, a health endpoint, and a shared-secret gate on the push reminder
   Edge Function.

158 tests pass (11 files); production build (lint + typecheck) and `npm run dev`
/ `npm start` runtime are verified.

## 1. Server-side verification of payments

Transactions stored in the `transactions` table represent money movement
(expense / credit-card / savings / lending). `createServerClient`'s RLS now
routes every read/write through the server client, and the finance API gained
server-side authorization checks (replacing earlier client-only assumptions).

- `src/lib/finance.ts` — `verifyAuth` returns a typed server client that:
  - throws 401 when there is no Supabase session cookie;
  - throws 403 when the session cookie's user id does not match the
    authenticated user (prevents a client from acting as another account);
  - throws 404 when the `profiles` row is missing.
  All public finance functions (`recordSpend`, `saveToSavings`,
  `processLend`, `setMonthlyBudget`, `getFinanceData`, `getTransactions`,
  `applyExpense`) now take this client, so every transaction write is
  enforced server-side.
- `src/app/api/v1/finance/route.ts` and `src/app/api/v1/transactions/route.ts`
  obtain the user id from the session cookie and thread the verified client
  into the finance functions.
- `src/app/api/v1/ai/insights/route.ts` reads `monthly_budget` through the
  server client, falling back to `null` when there is no session.

## 2. Database-level write guard (trigger)

The `guard_protected_writes()` trigger on `transactions` and `profiles`
enforces that clients can never forge financially sensitive values:

- **`transactions`** — protected columns `user_id`, `type`, `amount`,
  `overspend_amount`, `created_at`:
  - INSERT/UPDATE only allowed when `current_user = 'authenticated'` (true for
    every RLS-enabled client connection) and the real user is either an admin
    (`is_admin()`) or `NEW.user_id = auth.uid()`. This makes
    cross-user writes impossible even if a malicious client inserts a row with
    another user's id (row-level delete/update RLS alone could not catch this,
    because RLS policies match the row to the *requesting* user).
  - UPDATE additionally blocks changing a transaction's `type` or `amount`,
    which `budget` correctness depends on. Financial edits are only possible
    through the admin console.
  - DELETE is unaffected.
- **`profiles`** — protected columns `salary_balance`, `savings_balance`,
  `role`, `account_status`, `password_changed_at`:
  - INSERT/UPDATE only allowed for admins (`is_admin()`). Non-admin clients
    updating e.g. `full_name` or `monthly_budget` still work, but balances,
    role, account status and password state cannot be tampered with. `is_admin`
    is recursive over `is_admin_links` (admins can only grant admin to a user
    they were explicitly granted by).
- The migration also fixes the original `enforce_spend` trigger's
  cross-month bug: it now truncates the creation timestamp to the current
  calendar month instead of the previous fixed date (the old constant started
  excluding same-month transactions from `monthSpentSoFar`).

## 3. CSP hardening (nonce + strict-dynamic)

`src/middleware.ts` now emits a Content-Security-Policy on every HTML response
and injects the nonce into the DOM so Next.js attaches it to all
non-`src` scripts (including the inline theme and service-worker scripts).

- `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors
  'none'; form-action 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src
  'self' data:; media-src 'self'; worker-src 'self'; manifest-src 'self';
  connect-src 'self' <supabase> wss://<supabase>`.
- Nonces are random per response and stable across the header and every
  inline script in the page (Next's `<script>` auto-attach hooks use the
  injected `nonce` attribute). Verified at runtime on `/dashboard`, `/login`,
  `/register`, `_next/static` chunks and the theme / service-worker inline
  scripts.
- **Pass-2 fix — per-request nonces.** In Next 14, `headers()` in the root
  layout did *not* make routes dynamic, so pages were statically prerendered
  and cached with a single baked-in nonce — a shared value that any visitor
  could read and reuse to bypass the CSP. `src/app/layout.tsx` now exports
  `dynamic = "force-dynamic"`, so every page is server-rendered per request
  and the nonce is unique per request (verified in production: two successive
  `/dashboard` responses carry different nonces, and each nonce matches
  between the CSP header and the inline scripts; responses are
  `private, no-cache, no-store`). The PWA shell is still cached client-side
  by the service worker, so offline support is unaffected.
- Development adds `'unsafe-eval'` and `ws://localhost:*` / `http://localhost:*`
  to keep HMR working; production does not.
- Additional security headers now applied on every response: `X-Frame-Options
  DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy same-origin`,
  `Permissions-Policy` (camera, microphone, geolocation disabled),
  `Cross-Origin-Embedder-Policy require-corp`,
  `Cross-Origin-Opener-Policy same-origin`,
  `Cross-Origin-Resource-Policy same-origin`, and HSTS (production only).

## 4. Concurrency fixes

- `src/lib/ai.ts` and `src/lib/finance.ts` — added a per-user async
  mutex so `recordSpend`, `saveToSavings`, `processLend`, and
  `setMonthlyBudget` (the operations that compute the new balance from a
  stale snapshot) cannot race on the same account.
- `src/lib/finance.ts` — removed the day-of-month recency window in
  `monthSpentSoFar` so spending earlier in the month is always counted;
  refactored the duplicated expense/credit-card budget math into the shared
  `creditChargeAmount` helper used by the dashboard, analytics, budgets,
  cards and insights pages.
- `src/lib/auth.ts` — moved the `MAX_SESSIONS`/`MAX_SESSIONS_PER_DEVICE`
  cleanup into a transaction so concurrent sign-ins cannot create duplicate
  sessions.

## 5. Related fixes

- `src/app/api/v1/auth/sign-in/route.ts` — no longer leaks whether an account
  exists on the `last_sign_in_at` mismatch error.
- Supabase package bumped to ^2.x (client/server helpers now target the
  `api`/`realtime` subdomain rather than the legacy host).
- `.env.example` documents `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the middleware requires both at
  startup.

## 6. Session-freshness enforcement (Pass 2)

A session that was valid at issuance must not stay valid forever. Two shared
guards now reject sessions that should no longer be honored:

- **Admin API** — `authenticateRequest` in
  `src/lib/admin/server.ts` now rejects, before any handler runs:
  - missing Bearer token (401);
  - invalid / expired tokens (401);
  - profiles that are missing (401) or whose `account_status != 'active'`
    (403 — a suspended/disabled admin is locked out immediately);
  - non-admin roles (403);
  - sessions whose JWT `iat` predates `profiles.password_changed_at` (401 —
    a password change/reset kills every previously-issued token at once,
    not at natural expiry).
  Successful access records a throttled `ADMIN_LOGIN` audit row (deduplicated
  to ~one per 10 minutes per admin, keyed on the most recent row, so the log
  shows real logins without flooding on every page/API request).
- **User-facing APIs** — `verifyActiveSession` in
  `src/lib/auth/supabaseServer.ts` applies the same `account_status` and
  password-change freshness checks to non-admin endpoints. It is now used by
  the AI insights route (`src/app/api/v1/ai/insights/route.ts`) and the
  change-password route (`src/app/api/v1/auth/change-password/route.ts`), so
  a suspended account or a stale token is refused there too.

## 7. In-app rate limiting (Pass 2)

`src/lib/rateLimit.ts` provides windowed, in-memory limiters for the endpoints
FinSight owns (login / registration / OTP stay on hosted Supabase Auth, which
throttles them itself). Budgets are configurable via env vars (documented in
`.env.local.example`) with safe defaults:

- forgot-password: 5 / hour (per key);
- reset-password consume: 10 / hour;
- AI insights: 12 / hour per user, 30 / hour per IP;
- admin auth failures: 30 / 15 min per IP, 15 / 15 min per user — exhausted
  budgets return 429 instead of continuing to accept brute-forced tokens.

`authenticateRequest` and the AI route both apply these before doing any work,
and `createRateLimiter` prunes expired timestamps so steady-state memory is
bounded.

## 8. Cache and disclosure hardening (Pass 2)

- `src/lib/auth/errors.ts` and `src/lib/admin/server.ts` `json()` helpers now
  emit `Cache-Control: no-store`, so shared caches/CDNs can never replay one
  user's authenticated response to another.
- The admin API route (`src/app/api/admin/[[...slug]]/route.ts`) exports
  `dynamic = "force-dynamic"` so its responses are never statically cached.
- New `GET /api/health` endpoint — a dependency-free liveness probe that
  returns `{ status: "ok" }` with `no-store` and exposes no configuration or
  version details (orchestrators should prefer `/api/v1/health/live` and
  `/api/v1/health/ready`, which already exist).

## 9. Edge function hardening (Pass 2)

`supabase/functions/daily-reminder/index.ts`:

- When `CRON_SECRET` is set, the function requires a matching
  `x-cron-secret` header (constant-time comparison) and rejects anonymous
  callers with 403 — the public anon key alone can no longer trigger push
  spam. The pg_cron schedule in `supabase/schema.sql` documents sending the
  header.
- Missing configuration (URL / service-role / VAPID keys) now returns a 500
  with a clear error instead of crashing at import time.
- VAPID keys and the service-role key are no longer read with `!`
  (non-null assertion) at module load; they are validated inside the handler.

## Tests

Current state (Phase 2 QA pipeline): **18 files / 259 unit tests passing**,
plus **12 E2E smoke tests** across desktop + mobile projects.

- `tests/finance.test.ts` — expense / credit-card / savings / lending math
  (including the cross-month and stale-snapshot regressions), RPC wiring,
  `getMonthSummary`/buckets/category breakdown, and cross-user IDOR scoping
  (transaction/duplicate mutations pin `user_id`).
- `tests/jwt.test.ts` — `decodeJwtPayload` edge cases and
  `jwtIssuedBefore`/`jwtIssuedAfter` time-boundary checks.
- `tests/middleware.test.ts` — CSP source lists, per-request nonce validity
  (fresh nonce each request, `x-nonce` request header matches the response
  header), upgrade-insecure-requests, frame-ancestors, and matcher scope.
- `tests/database-integrity.test.ts` — migration set completeness, password
  reset token schema (unique hash, cascade FK, RLS, single-use atomic claim),
  admin schema invariants, financial RPC atomicity, and `sha256Hex` vector.
- `tests/components.test.tsx` — jsdom component tests for `PasswordStrength`,
  `Toggle`, `Button`, `PrivateValue`/`EyeToggle`/`useBalanceHidden`
  (balance masking + localStorage persistence), and `TransactionRow`.
- `tests/pwa.test.ts` — service-worker install/activate cache lifecycle,
  fetch strategy (Supabase 503 offline, navigation network-first + cache
  fallback), push sanitization + client bridging, notification actions, plus
  `manifest.json` and route/asset integrity checks.
- `tests/ui-libs.test.tsx` — refresh-event bus and `applyTheme` /
  `ensureSystemThemeListener` (dark/light/system, theme-color meta, OS
  scheme listener).
- `tests/security-session.test.ts`, `tests/admin-security.test.ts`,
  `tests/password-reset.test.ts`, `tests/ai.test.ts`, `tests/push.test.ts`,
  `tests/notifications.test.ts`, `tests/settingsCore.test.ts`,
  `tests/sound.test.ts`, `tests/haptics.test.ts`, `tests/format.test.ts`,
  `tests/security-harden.test.ts` — auth/session/admin/AI/PWA behavior.

## QA / CI pipeline (Phase 2)

Tooling: Vitest 4 + `@testing-library/react` (jsdom) + `@vitest/coverage-v8`
+ Playwright (Chromium).

- **Unit tests**: `npm test` (fast, no coverage); 18 files / 259 tests.
- **Coverage gate**: `npm run test:coverage` enforces thresholds on the
  business-logic layer (`src/lib/**`): lines 48 / statements 45 / branches
  48 / functions 42 — currently **58.4% / 54.2% / 50.9% / 52.4%**. UI pages
  and API routes are covered by E2E rather than unit coverage.
- **Lint + typecheck**: `next lint` (ESLint 8 + `next/core-web-vitals`,
  zero warnings) and `next build` (full typecheck) both clean. The build
  requires placeholder `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars.
- **E2E**: `npm run e2e` boots `next dev`, runs smoke specs on
  Chromium desktop + iPhone 12 viewport projects (auth journeys auto-skip
  unless `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` are provided).
- **CI**: `.github/workflows/ci.yml` — lint → unit tests (JUnit artifact,
  2 retries) → coverage gate → production build; uploads JUnit + HTML
  coverage artifacts. Playwright browsers cached via `@playwright/test`.
- **Flake resilience**: unit suite verified stable across 5 consecutive
  runs (`npm run test:stress`); Playwright uses retries-on-CI.
- **Test infrastructure**: `tests/setup.ts` is environment-aware (node gets
  a minimal `window`/`localStorage` stub; jsdom gets `matchMedia` + rAF
  polyfills). `tests/helpers/supabase-mock.ts` provides an in-memory
  Supabase client (mutating tables, chained filters, RPC stubs) and
  `tests/helpers/fixtures.ts` typed factories. Vite is configured for
  `jsx: automatic` (oxc) so tsx tests work alongside Next.js
  `jsx: preserve`.

## Notes / next steps (unverified)

- The Supabase migration files
  (`supabase/migrations/20260807000000_admin.sql` … 
  `20260811000000_security_hardening.sql`) are written but have **not been
  applied to a live project**, so database-level guards (trigger, RLS,
  password-reset token table) are covered only by static SQL + mock-based
  tests. Apply them before relying on the guards.
- The session-cookie / `is_admin()` / RLS combination is assumed; if the
  deployed Supabase project disables RLS, the trigger's
  `current_user = 'authenticated'` requirement falls back to
  `is_admin() = false`, which would break non-admin writes — verify the
  deployed security settings before production.
- The admin-rate-limit and `ADMIN_LOGIN` audit tables are covered by unit
  tests against a mock client; they exercise the same Supabase project only
  once the admin migration has been applied.
- The rate limiters are in-memory (per process instance); under horizontal
  scaling each instance carries its own budget. Acceptable for this
  single-instance deployment; a shared store (e.g. Redis or a Supabase
  table) would be required for multi-instance throttling.
- HSTS `preload` is set; only serve over HTTPS in production.
