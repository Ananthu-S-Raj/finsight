# FinSight — Authentication

## Registration

### Flow

1. User visits `/register`
2. Fills in: full name, email, password (validated against policy: ≥8 chars, mixed case/digit/special)
3. Client calls `supabase.auth.signUp()` with `emailRedirectTo: ${window.location.origin}/verify`
4. Supabase creates the auth user and triggers `handle_new_user()` which auto-creates a `profiles` row
5. User is redirected to `/verify?email=<email>`

### Email Verification

The verify page supports **two flows** depending on Supabase Dashboard configuration:

**OTP Mode** (default documented flow):
1. User receives a 6-digit code via email
2. User enters the code on `/verify`
3. Client calls `supabase.auth.verifyOtp({ email, token, type: "signup" })`
4. On success, session is established and user is redirected to `/dashboard`

**Magic Link Mode**:
1. User clicks the confirmation link in the email
2. Supabase exchanges the token for a session
3. `detectSessionInUrl` (enabled by default) picks up the session from the URL hash
4. The verify page detects the session and redirects to `/dashboard`

**Resend**: User can request a new OTP/code from the verify page via `supabase.auth.resend({ type: "signup", email })`.

> **Note**: Which mode is active depends on Supabase Dashboard configuration under Authentication → Email Templates. The application code supports both.

Source: `src/app/register/page.tsx`, `src/app/verify/page.tsx`

## Login

### Flow

1. User visits `/login`
2. Enters email and password
3. Client calls `supabase.auth.signInWithPassword({ email, password })`
4. On success, session is persisted in localStorage and user is redirected to `/dashboard`
5. On failure, a generic error message is shown (no email enumeration)

Source: `src/app/login/page.tsx`

## Password Reset

### Request Flow

1. User visits `/forgot-password` (from login page link)
2. Enters email address
3. Client sends `POST /api/v1/auth/forgot-password` with `{ email }`
4. Server always returns the same generic message regardless of email existence
5. Supabase sends a reset email with a recovery token
6. Rate limited: 5 requests/hour per IP and per email

### Reset Flow

1. User clicks the reset link → redirected to `/reset-password?token=<token>`
2. Enters new password (validated against password policy)
3. Client sends `POST /api/v1/auth/reset-password` with `{ token, new_password }`
4. Server validates token (SHA-256 hashed, single-use, 30-minute expiry)
5. Password is updated via Supabase auth
6. `password_changed_at` is stamped on the profile, invalidating all old sessions
7. User is redirected to `/login`

### Change Password (Signed In)

1. User navigates to Settings → Security → Change password
2. Enters current password + new password
3. Client sends `POST /api/v1/auth/change-password` with `{ current_password, new_password }`
4. Server re-verifies current password via `signInWithPassword`
5. New password is set, `password_changed_at` is updated
6. Current session stays valid; all other sessions are invalidated

Source: `src/lib/auth/passwordReset.ts`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/app/settings/page.tsx`

## Session Handling

### Supabase Session

- Sessions are managed by Supabase Auth client (`@supabase/supabase-js`)
- `persistSession: true` in browser client — stored in localStorage
- `autoRefreshToken: true` — token refresh is automatic
- Session contains: `access_token` (JWT), `refresh_token`, `user`

### JWT Handling

- `src/lib/jwt.ts` provides `decodeJwtPayload()` and `jwtIssuedBefore()`
- Only reads the unverified payload (real validation is done by Supabase)
- The `iat` claim is compared against `profiles.password_changed_at` for session freshness

### Bearer Token Flow

All authenticated API routes follow this pattern:

1. Extract token from `Authorization: Bearer <jwt>` header
2. Create a Supabase client scoped to that JWT (user-scoped, not service-role)
3. Call `client.auth.getUser(token)` to verify the token
4. Check `profiles.account_status === 'active'`
5. Check JWT `iat` against `password_changed_at` (freshness guard)
6. Proceed with RLS-enforced data access

Source: `src/lib/auth/supabaseServer.ts`, `src/lib/admin/server.ts`

## Security

### Account Status

- `profiles.account_status` can be: `active`, `disabled`, `suspended`
- `verifyActiveSession()` rejects non-active accounts
- Admin can change status via `PATCH /api/admin/users/:id`

### Session Invalidation

- Setting `password_changed_at` to `now()` invalidates all JWTs issued before that timestamp
- The `jwtIssuedBefore()` function compares JWT `iat` against this timestamp
- This happens on: password reset, password change, admin-initiated session revocation

### Admin Sessions

- Admin endpoints use `authenticateRequest()` which performs the same checks plus:
  - Role must be `admin`
  - Permission matrix is loaded
  - IP and user rate limiting is applied
  - Successful access is audit-logged (throttled to 1 per 10 minutes)

### Password Policy

Enforced by `src/lib/auth/passwordPolicy.ts`:
- Minimum 8 characters
- Must contain uppercase, lowercase, digit, and special character

Source: `src/lib/auth/passwordPolicy.ts`
