# FinSight — Deployment

## Overview

FinSight deploys to **Render Free Web Service** for the Next.js application, with data hosted on **Supabase**.

## Deploy Stack

| Layer | Technology |
|---|---|
| Hosting | Render Free Web Service |
| Database | Supabase (PostgreSQL + RLS + Edge Functions) |
| AI | OpenAI API (primary) / local Ollama (fallback) |
| Auth | Supabase Auth (email/password, JWTs) |
| CDN | Render (automatic) |
| Runtime | Node.js |

## Environment Requirements

### Required for Build

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### Required for Runtime (Server-Only)

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BM...
OPENAI_API_KEY=sk-...           # Optional, for AI insights
```

### Supabase Secrets (Edge Functions)

```
SUPABASE_SERVICE_ROLE_KEY=eyJ...
CRON_SECRET=your-cron-secret
VAPID_PUBLIC_KEY=BM...      # public half — must match NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=...       # private half — never expose to clients
VAPID_SUBJECT=mailto:you@example.com
```

### VAPID keys (push notifications)

Push requires one matching keypair in two places:

1. **Client** (Render env): `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the public key.
   Without a real key the app refuses to subscribe and Settings reports
   "Push is misconfigured (invalid VAPID key)" instead of claiming success.
2. **Server** (Supabase Edge Function secrets): `VAPID_PUBLIC_KEY` +
   `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT`, consumed by `daily-reminder`,
   `bill-reminder`, `process-recurring` and `test-notification`.

Generate once with:

```bash
npx web-push generate-vapid-keys --json
```

or the project helper (print-only, never persists the private key):

```bash
node scripts/generate-vapid-keys.mjs
```

Put the `publicKey` value into `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and both the
`publicKey`/`privateKey` values into the Supabase secrets. The Edge Functions
refuse to run (HTTP 500 `vapid_not_configured`) until `VAPID_*` are set.

Apply the database migration (creates/upgrades the `push_subscriptions` table
with RLS + the prefs column on projects that only ran migrations):

```bash
supabase db push
```

Deploy the sender functions:

```bash
supabase functions deploy test-notification daily-reminder bill-reminder process-recurring
```

After deployment, verify push end-to-end from Settings → Notifications:
**Send test notification** should deliver "Test notification received
successfully." to every registered device.

#### Testing push on Android

1. Open the deployed app in **Chrome on Android** (mobile site or the installed
   PWA via Add to Home Screen).
2. Settings → Notifications → toggle **Push notifications** ON. Chrome prompts
   for permission — choose **Allow**.
3. Settings shows **This device is registered for push** and a **Send test
   notification** button appears.
4. Tap it. A notification **FinSight — "Test notification received
   successfully."** appears even with the app closed (Android may group it in
   the notification drawer).
5. Chrome DevTools (desktop, same account) → Application → Service Workers →
   "Push" simulation verifies the worker handles the event.

## Render Service Setup

1. Create a new Web Service on Render
2. Connect your Git repository
3. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment Variables**: Set all required env vars in Render dashboard
4. Deploy

## Build Behavior

- The `build` script runs `next build`
- Stale `.next` cache can cause build failures — delete `.next` before building
- The production build succeeds with test-only TypeScript errors (they don't block the build)
- `tsconfig.json` includes `tests/` via `**/*.ts` — pre-existing test type errors exist

## Runtime Behavior

- The app reads `PORT` from the environment (set by Render)
- `getBaseUrl()` falls back to `http://localhost:${PORT}` when `RENDER_EXTERNAL_URL` is not set
- Service worker is served from `/sw.js` and registered on every page load
- HTTPS is provided by Render automatically
- HSTS header is enabled in production mode

## Post-Deploy Verification

1. Health check: `GET /api/health` → `{"status":"ok"}`
2. Landing page loads at root URL
3. Login page renders at `/login`
4. Registration flow works end-to-end
5. Admin console accessible at `/admin` (after promoting a user)
6. Service worker registers (check Application tab in DevTools)
7. Manifest loads at `/manifest.json`
8. No critical console errors

## Static Assets

- SVG favicon (`/favicon.svg`) is never cached by service worker
- PNG icons (`/icons/icon-192.png`, `/icons/icon-512.png`) are in manifest and cache on install
- `apple-touch-icon.png` is available for iOS home screen
- Manifest (`/manifest.json`) and robots.txt are public

## Common Build Failures

| Symptom | Fix |
|---|---|
| `next build` fails with missing env var | Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set |
| TypeScript errors from `tests/` directory | Pre-existing; don't block production build |
| Stale `.next` cache causes weird errors | Delete `.next` directory before building |
| Service worker caches stale content | Clear browser cache; update `CACHE_VERSION` in `sw.js` |
