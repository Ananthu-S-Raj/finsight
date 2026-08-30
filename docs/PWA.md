# FinSight — PWA

## Overview

FinSight is a Progressive Web App with offline support, installability, and push notifications.

## Manifest

Located at `/manifest.json`:

```json
{
  "name": "FinSight — Smart Personal Finance",
  "short_name": "FinSight",
  "id": "/dashboard",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0B0F14",
  "theme_color": "#0B0F14",
  "orientation": "portrait-primary",
  "categories": ["finance", "productivity"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Add expense", "url": "/dashboard?add=expense" },
    { "name": "Transactions", "url": "/transactions" },
    { "name": "Budgets", "url": "/budgets" }
  ]
}
```

Source: `public/manifest.json`

## Service Worker

Located at `/sw.js`. Cache version: `finsight-v4`.

### Caching Strategy

| Request Type | Strategy | Details |
|---|---|---|
| Supabase requests (`*.supabase.co`) | Network only, offline → 503 | Never cached; sensitive financial data |
| API routes (`/api/*`) | Network only | Excluded from all caches; carries auth tokens |
| Navigation requests | Network first, cache fallback | Falls back to cached page or `/dashboard` |
| `/_next/*` build chunks | Network first, cache fallback | Serves cached chunks when offline |
| Same-origin static assets | Cache first, then network | Non-API, non-`_next` requests |
| Everything else | Network only | Default fallback |

### Why API Responses Are Not Cached

- API routes carry `Authorization: Bearer <jwt>` headers
- Responses contain user-specific financial data
- Caching a 401/403 would break authenticated sessions
- Shared caches/CDNs could serve one user's data to another

### Cache Management

- On install: pre-caches `/dashboard`, `/login`, `/register`, `/manifest.json`, `/favicon.svg`, icons
- On activate: deletes old cache versions (only `finsight-v4` is kept)
- On fetch: updates cache with network responses for navigation and `_next` chunks

### Push Notifications

The service worker handles:

- `push` event: displays notification with title, body, icon, badge, tag, actions
- `notificationclick` event: focuses or opens the relevant window
- `notificationclose` event: reserved for future quiet-hour tracking
- Bridge: posts `finsight-push` messages to open windows for in-app sync

Delivery comes from three **Supabase Edge Functions** that read the VAPID
secrets stored in the project dashboard:

| Function | Trigger | Purpose |
|---|---|---|
| `test-notification` | Authenticated click in Settings → Notifications | One-off test to the caller's own devices |
| `daily-reminder` | pg_cron (commented schedule in `schema.sql`) | Daily / budget / card / savings nudges |
| `bill-reminder` | pg_cron (commented schedule in `20260812000000_bills_and_calendar.sql`) | Advance / due / overdue bill alerts |
| `process-recurring` | pg_cron (commented schedule in `20260811000001_recurring.sql`) | Recurring-transaction follow-ups |

The `push_subscriptions` table and its RLS policies are migration-first since
`20260902000000_push_subscriptions.sql` (previously they existed only in
`schema.sql`), so `supabase db push` deployments get the full ledger.

Every subscription row is scoped to `auth.uid()`. When a user logs out and
another logs in on the same device, the app shows the new user's registration
state only — the previous user's rows are never readable or claimable by the
new session (RLS + the per-endpoint unique index keep them isolated).

The client never holds a private key; it only re-sends the public VAPID value
it was built with. Stale subscriptions (HTTP 410/404) are removed from
`push_subscriptions` automatically.

Source: `public/sw.js` + `supabase/functions/*/index.ts`

## Icons

| File | Size | Purpose |
|---|---|---|
| `public/icons/icon-192.png` | 192×192 | Standard display |
| `public/icons/icon-512.png` | 512×512 | Large display |
| `public/icons/icon-512-maskable.png` | 512×512 | Maskable (adaptive icons) |
| `public/apple-touch-icon.png` | 180×180 | iOS home screen |
| `public/favicon.svg` | SVG | Browser tab |

## Registration

Service worker registration happens in the root layout (`src/app/layout.tsx`):

```typescript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
```

This runs on every page load. No localhost assumption.

## Install Prompt

`src/components/InstallAppPrompt.tsx` provides:

- Native `beforeinstallprompt` handling (Chrome, Edge, Android)
- iOS Safari instructions (manual Add to Home Screen)
- Dismissal cooldown (7 days)
- `NEXT_PUBLIC_APP_VERSION` displayed in install card

## Offline Behavior

When offline:

- Navigation falls back to cached pages (or `/dashboard`)
- `/_next/*` assets served from cache
- Supabase requests fail fast with 503
- API requests fail (no cache)
- `OfflineIndicator` component shows offline status
- In-app banner shows overspend alerts (when app is open)

## HTTPS

- Render provides HTTPS by default
- HSTS header added in production mode (`next.config.js`)
- CSP `upgrade-insecure-requests` in production
- Service workers require HTTPS (or localhost for development)

## Production Verification Checklist

- [ ] `manifest.json` loads correctly
- [ ] `sw.js` loads and registers
- [ ] Icons are accessible
- [ ] Install prompt appears on supported browsers
- [ ] Offline navigation works
- [ ] `/api/*` responses are never cached
- [ ] `_next/*` assets work offline
- [ ] Push notifications work (when VAPID is configured)
