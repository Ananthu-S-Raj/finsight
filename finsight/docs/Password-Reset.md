# Password Reset & Security

Covers the three password flows in FinSight and the security decisions behind
them. Same flows apply to regular users and administrators — there is a single
auth system.

## Flows

### 1. Forgot password (unauthenticated)

```
/login → "Forgot password?" → /forgot-password
  → enter email → POST /api/v1/auth/forgot-password
  → Supabase sends recovery email (template in supabase/email-templates/)
  → /reset-password?token_hash=<token> → POST /api/v1/auth/reset-password
  → success → /login
```

- `POST /api/v1/auth/forgot-password` looks the email up in `profiles`.
- If the account exists, it stores a **hashed** token (SHA-256, single use,
  30-minute expiry) in `password_reset_tokens` and calls
  `supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL + "/reset-password" })`
  so Supabase sends the recovery email with the one-time `token_hash` link.
- The response is identical whether the account exists or not:
  `"If an account exists with this email, a password reset link has been sent."`
  → **no email enumeration.**
- Rate limiting: 5 requests / hour per IP **and** per email (both keys are
  checked independently). The per-email key prevents using the endpoint to
  spam a victim's inbox; the per-IP key prevents a scripted sweep of emails.

### 2. Complete the reset (token → password)

- `POST /api/v1/auth/reset-password` with `{ token, new_password }`. The
  `token` is the `token_hash` query parameter from the email link.
- Verification happens in this order:
  1. `supabase.auth.verifyOtp({ type: "recovery", token_hash: token })` — proves
     the token is real, unexpired, and matches the requested user.
  2. `mark_password_reset_token_used(token_hash, user_id)` — the RPC marks the
     stored row `used_at` **and only returns true if the row existed, had not
     been used, and was not expired**. This is the single-use + expiry guard,
     enforced in the database (a token can never be replayed).
  3. `supabase.auth.updateUser({ password })` — the actual change.
  4. `set_password_changed_at()` — stamps `profiles.password_changed_at = now()`
     (session invalidation).
- Error responses: `400 weak_password`, `400 invalid_token`
  (invalid / expired / already-used). Rate-limited per IP (10 attempts / 15 min).
- If the resetting user is an admin, an audit event
  `ADMIN_PASSWORD_RESET_COMPLETED` is written.

### 3. Change password (authenticated)

- Settings → Security → Change password. `POST /api/v1/auth/change-password`
  (Bearer) with `{ current_password, new_password }`.
- The current password is re-verified via `signInWithPassword` **before**
  anything changes — so a stolen session cannot be used to silently set a new
  password without knowing the old one.
- Rejects `400 same_password` (must differ) and `400 weak_password`.
- Stamps `password_changed_at`, and writes `ADMIN_PASSWORD_CHANGE_COMPLETED`
  when the actor is an admin.
- Works for both regular users and admins through the same endpoint.

## Token lifecycle

```
request_password_reset                     mark_password_reset_token_used
      │                                            │
      ▼                                            ▼
 ┌────────────┐  sha256(token)   ┌─────────────────────────────┐
 │ raw token  │ ───────────────▶ │ password_reset_tokens       │
 │ (email only)│                  │ token_hash   (never raw)    │
 └────────────┘                  │ user_id      (FK profiles)  │
                                 │ expires_at   (now + 30 min) │
                                 │ used_at      (null until    │
                                 │              single use)    │
                                 │ ip, user_agent (forensics)  │
                                 └─────────────────────────────┘
```

- **Only the SHA-256 hash is stored** — a database leak does not yield usable
  reset tokens.
- **Single use:** `mark_password_reset_token_used` is `SECURITY DEFINER` and
  returns true only on the first successful claim; the second claim sees
  `used_at` set and fails. `verifyOtp` alone is not enough for the guard
  because Supabase may permit the same `token_hash` more than once; the RPC is
  the authoritative replay protection.
- **Expiry:** `expires_at` is checked in the RPC. Supabase's own recovery-token
  lifetime is short too, so `verifyOtp` is a second gate.
- **Forensics:** `ip` and `user_agent` from the reset request are stored so
  account-takeover attempts leave an audit trail.

## Session invalidation after a password change

Changing the password (reset *or* in-app change) invalidates every session
issued **before** the change, without touching Supabase's refresh tokens:

1. `set_password_changed_at()` sets `profiles.password_changed_at = now()` and
   returns the timestamp.
2. Every JWT has an `iat` (issued-at) claim. A JWT issued before
   `password_changed_at` is stale:
   - **Client (user app):** `useAuth` runs `isStaleSession()` on load —
     compares the access token's `iat` against `password_changed_at`, and
     signs the session out if stale (`src/lib/useAuth.ts:43`).
   - **Server (admin API):** `authenticateRequest` makes the same comparison
     and rejects stale tokens (`src/lib/admin/server.ts:122`).
3. Comparison is done locally on the unverified payload (see
   `src/lib/jwt.ts`); actual token verification stays with Supabase.

### Manual setup note (go-live only)

Supabase does not persist custom JWT claims from `profiles` unless you attach a
`pg_net` webhook/trigger that re-signs JWTs on `password_changed_at` changes.
Without that, `iat`-based comparison (which needs no configuration) is the
enforcement point. The `password_changed_at` column is wired into the schema so
the webhook can be added later without code changes.

## Database objects

Created by `supabase/migrations/20260810000000_password_reset.sql` (and merged
into `supabase/schema.sql`):

| Object | Purpose |
| --- | --- |
| `password_reset_tokens` | Hashed, single-use, expiring reset tokens (RLS enabled, no client policies — only the RPCs touch the table). |
| `profiles.password_changed_at` | Session-invalidation marker. |
| `request_password_reset(...)` | `SECURITY DEFINER`; inserts the hashed token. |
| `mark_password_reset_token_used(...)` | `SECURITY DEFINER`; atomic single-use + expiry guard. |
| `set_password_changed_at()` | `SECURITY DEFINER`; stamps the marker and returns it. |

## Email template

`supabase/email-templates/reset-password.html` — paste into Supabase
**Authentication → Email Templates → Reset Password** (subject:
"Reset your FinSight password"). It is responsive for mobile + desktop, has a
dark-mode variant, shows a 30-minute expiry warning, and uses `{{ .ConfirmationURL }}`
for the button link. Configure the redirect URL `<site>/reset-password` under
**Authentication → URL Configuration**.

## Security decisions (recap)

- **Anti-enumeration:** identical responses for existing/non-existing emails.
- **Hashed tokens at rest**, single-use, 30-minute expiry, DB-enforced.
- **IP/user-agent captured** for reset attempts.
- **No OTPs.** Recovery links are preferred: single-use, time-boxed, and
  phishing-resistant when combined with the email provider.
- **Re-verify current password** on in-app change to stop session-takeover abuse.
- **Old sessions die immediately** after a change via `password_changed_at`.
- **Rate limiting** on both public endpoints (per-IP and per-email) with
  `429` + `retryAfterSeconds`.
- **Admins are audited:** resets and changes write audit-log events through the
  same RBAC-audit path used elsewhere in the admin console.

## Test coverage

`tests/password-reset.test.ts` (29 tests) covers:

- Forgot password: message, anti-enumeration, no raw token leaked to
  Supabase's `resetPasswordForEmail` (only a hashed token is stored), token
  expiry enforced.
- Complete reset: success, token hash stored (never the raw token), single use
  (replay rejected), expired token rejected, session invalidation triggered.
- Admin reset: audit event written only when the resetter has the admin role;
  no audit for regular users.
- Change password: wrong current password rejected, weak password rejected,
  same-password rejected, success + session invalidation.
- HTTP endpoints: correct status codes, JSON envelopes, and rate limits
  (per-IP, per-email, per-reset-IP) returning `429`.
