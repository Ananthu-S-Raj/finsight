# FinSight — Security

## Authentication Security

- **Password policy**: ≥8 characters, mixed case, digit, and special character
- **Session persistence**: Supabase-managed JWT with auto-refresh
- **Session invalidation**: `password_changed_at` timestamp checked against JWT `iat`
- **No email enumeration**: Password reset always returns the same message
- **Token hashing**: Reset tokens are SHA-256 hashed before storage
- **Single-use tokens**: Reset tokens are marked as used after consumption
- **Token expiry**: 30-minute TTL on password reset tokens

Source: `src/lib/auth/passwordPolicy.ts`, `src/lib/auth/passwordReset.ts`

## Authorization

- **RLS**: Every database table has Row Level Security enabled
- **User isolation**: `auth.uid() = user_id` policies on all user data
- **Admin bypass**: `is_admin()` function allows cross-user read/write
- **RBAC**: 15 granular permission codes, role-based grants
- **Write guards**: Database triggers prevent column forgery on profiles and transactions

Source: `supabase/schema.sql`, `src/lib/admin/server.ts`

## Content Security Policy

Nonce-based CSP applied per-request via middleware:

```
default-src 'self'
base-uri 'self'
object-src 'none'
frame-ancestors 'none'
form-action 'self'
script-src 'self' 'nonce-{random}' 'strict-dynamic'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self' data:
media-src 'self'
worker-src 'self'
manifest-src 'self'
connect-src 'self' https://{supabase-host} wss://{supabase-host}
upgrade-insecure-requests (production only)
```

- `unsafe-eval` only in development
- Development WebSocket entries (`ws://localhost:*`) only in development CSP
- `unsafe-inline` only for styles (required for React inline styles)

Source: `src/lib/security/csp.ts`, `src/middleware.ts`

## Security Headers

Applied via `next.config.js`:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-DNS-Prefetch-Control` | `off` |
| `Permissions-Policy` | camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), sync-xhr=(), accelerometer=(), gyroscope=(), magnetometer=() |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (production only) |

## Token Handling

- JWTs are extracted from `Authorization: Bearer <jwt>` header
- User-scoped Supabase client created per request (not service-role)
- `verifySession()` validates JWT via Supabase auth.getUser()
- `verifyActiveSession()` adds status + iat freshness checks
- Service role key is **never** used in the Next.js application

Source: `src/lib/auth/supabaseServer.ts`, `src/lib/admin/server.ts`

## Secret Management

| Secret | Storage | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Env var | Public (designed for browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Env var | Public (anon key, RLS-enforced) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Env var | Public (push subscription) |
| `OPENAI_API_KEY` | Env var | Server-only (API routes only) |
| `CRON_SECRET` | Supabase secrets | Edge Functions only |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secrets | Edge Functions only |

- No secrets in client bundles (verified: `"use client"` files never reference `process.env`)
- `.env.local` is gitignored
- `.env.local.example` contains only placeholders

## API Protection

- **Maintenance mode**: All user-facing `POST/PATCH/DELETE` under `/api/v1/*` return 503 when enabled
- **Rate limiting**: In-memory sliding-window limiters on auth, AI, and admin endpoints
- **Error handling**: `handleRoute()` catches errors, logs via structured logger, returns generic 500
- **No stack traces**: Internal errors never exposed to clients
- **Cache-Control**: `no-store` on all authenticated JSON responses

Source: `src/lib/rateLimit.ts`, `src/lib/admin/server.ts`

## Audit Logging

All admin mutations are recorded in `audit_logs`:

- Actor: user ID, email
- Action: e.g., `user.update`, `maintenance.toggle`, `ADMIN_LOGIN`
- Resource type + ID
- Target user (if applicable)
- IP address, user agent
- Result: success/denied/error
- Metadata: action-specific details

Audit entries are append-only. The `writeAudit()` function throws if the audit cannot be recorded, ensuring mutations are never left unaudited.

Source: `src/lib/admin/server.ts`

## Service Worker Security

- Supabase requests (`*.supabase.co`) are never cached — network only
- API routes (`/api/*`) are excluded from all caches
- Non-GET requests are ignored by the service worker
- Push notification payloads are sanitized (title length 120, body length 300)
- Notification URLs must start with `/` (no external redirects)

Source: `public/sw.js`

## Input Validation

- Password policy enforced client-side and server-side
- Transaction amounts validated (CHECK > 0 in database)
- Bill names length-checked (1-80 chars in database)
- Goal names length-checked (1-80 chars in database)
- Notes length-checked (≤500 chars for bills, ≤300 for goals)
- UUID parameters validated with regex before database queries
- ISO date parameters validated with strict patterns
- HTML sanitization on user-supplied text (`sanitizeText()`)

Source: `src/lib/admin/handlers/helpers.ts`, `src/lib/auth/passwordPolicy.ts`

## Database Write Guards

Triggers prevent clients from forging protected columns:

- `profiles_guard_protected_columns`: Blocks changes to `role`, `account_status`, `password_changed_at` unless the caller is an admin
- `transactions_guard_protected_columns`: Blocks changes to `user_id`, `type`, `amount`, `overspend_amount` unless the caller owns the row or is an admin
- `roles_guard_system_rows`: Blocks UPDATE/DELETE on system roles (`user`, `admin`)

Source: `supabase/migrations/20260811000000_security_hardening.sql`
