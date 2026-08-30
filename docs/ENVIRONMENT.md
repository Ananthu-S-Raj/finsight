# FinSight — Environment Variables

## Required for Build

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key | `eyJ...` |

## Required for Runtime (Server-Only)

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key for push notifications | `BM...` |
| `OPENAI_API_KEY` | OpenAI API key for AI insights (optional) | `sk-...` |

### VAPID public key requirements

- Must be the **public half** of the VAPID keypair whose private half lives in
  the Supabase Edge Function secrets (`VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY`
  below). The browser `pushManager.subscribe()` and the server-sent web pushes
  must reference the same pair.
- Must be a **65-byte, URL-safe base64-encoded P-256 point** (~87 chars, `A-Za-z0-9-_`).
- The app **rejects** missing, placeholder (`generated-vapid-public-key`) and
  malformed values up front so the Settings UI can report the real cause. The
  client placeholder lives only in `.env.local.example` and is never a real key.
- Generate a pair with: `npx web-push generate-vapid-keys --json` (put the
  `publicKey` in this variable, and both halves in the Edge Function secrets).

## Render Service Environment

| Variable | Description |
|---|---|
| `PORT` | Server port (set automatically by Render) |
| `RENDER_EXTERNAL_URL` | Falls back to `http://localhost:${PORT}` when unset |

Source: `src/lib/auth/supabaseServer.ts`

## Supabase Secrets (Edge Functions)

These are configured in the Supabase dashboard, not in the Next.js app:

| Secret | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role access (bypasses RLS) |
| `CRON_SECRET` | Authentication for scheduled Edge Function calls |
| `VAPID_PUBLIC_KEY` | VAPID public key (server half of the pair used by `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) |
| `VAPID_PRIVATE_KEY` | VAPID private key — **never** exposed to the client |
| `VAPID_SUBJECT` | A `mailto:you@example.com` contact for the push provider |

All of `daily-reminder`, `bill-reminder` and `test-notification` refuse to run
without the three `VAPID_*` secrets set.

## Public vs Server-Only

| Environment | Exposure |
|---|---|
| `NEXT_PUBLIC_*` | Bundled into browser JS (by design; these are non-secret) |
| All others | Server-side only (never in browser bundle) |

The application code (`"use client"` files) never references `process.env` for non-`NEXT_PUBLIC_*` variables. Verified by grep: all `OPENAI_API_KEY` references are in server-side API routes.

## .env.local Template

Located at `.env.local.example`. Contains only safe placeholders — no real secrets.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
OPENAI_API_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
```

To use:

```bash
cp .env.local.example .env.local
# Edit .env.local with your real values
```

## Configuration Notes

- `.env.local` is gitignored and never committed
- `.env.local.example` must contain only placeholders (never real secrets)
- The production build will fail if required `NEXT_PUBLIC_*` variables are missing
- Development mode (`npm run dev`) is more permissive with missing env vars
- Service role key is **never** used in the Next.js application code
- All secrets are stored in Supabase secrets or Render environment variables
