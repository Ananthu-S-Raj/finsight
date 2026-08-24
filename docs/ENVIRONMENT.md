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
