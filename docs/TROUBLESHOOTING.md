# FinSight — Troubleshooting

## Build Issues

### `next build` fails with missing env var

**Symptom**: Build error about undefined environment variable.

**Fix**: Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in your environment before building. These are required at build time.

### Stale `.next` cache causes build failures

**Symptom**: Weird errors during `next build` that don't make sense.

**Fix**: Delete the `.next` directory before building:

```bash
rm -rf .next
npm run build
```

### TypeScript errors from `tests/` directory

**Symptom**: `tsc` shows errors in test files.

**Explanation**: Pre-existing. The test type errors don't affect the production build. `tsconfig.json` includes `tests/` via `**/*.ts`. The build uses `next build` which handles this differently than `tsc`.

## Runtime Issues

### Service worker serves stale content

**Symptom**: Old version of the app is shown after deployment.

**Fix**:
1. Clear browser cache for the site
2. Unregister the old service worker in DevTools → Application → Service Workers
3. Reload the page
4. Optionally update `CACHE_VERSION` in `public/sw.js` to force cache bust

### Push notifications not working

**Symptom**: Notifications don't arrive.

**Checklist**:
1. VAPID keys are configured (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` in env, private key in Supabase secrets)
2. Browser notification permission is granted
3. The `push_subscriptions` migration has been applied (`supabase db push`) and the table has the `prefs` column
4. Push subscription was registered (check Supabase `push_subscriptions` table)
5. Service worker is active (DevTools → Application → Service Workers)
6. Supabase Edge Functions `test-notification` / `daily-reminder` / `bill-reminder` / `process-recurring` are deployed and their `VAPID_*` secrets match the client public key

If the Settings toggle turns OFF after enabling, the app now reports the exact
reason (blocked permission, pending prompt, missing/misconfigured VAPID,
unable to register the service worker, unable to save the subscription).

### Admin console shows "Access Denied"

**Symptom**: `/admin` redirects to `/dashboard` or shows error.

**Checklist**:
1. User is logged in
2. `profiles.role` is set to `admin` in Supabase database
3. `profiles.account_status` is `active`
4. JWT is fresh (not issued before `password_changed_at`)

### Maintenance mode won't turn off

**Symptom**: App stays in maintenance mode after disabling.

**Check**:
1. `app_settings` table has `maintenance` key set to `false`
2. Browser cache doesn't have a cached maintenance response
3. Service worker isn't caching the maintenance status
4. Try hard refresh (`Ctrl+Shift+R`)

## API Issues

### All API routes return 401

**Symptom**: Every authenticated request fails.

**Checklist**:
1. `Authorization: Bearer <jwt>` header is present
2. JWT is valid (not expired, correct audience)
3. Supabase project is accessible
4. `NEXT_PUBLIC_SUPABASE_ANON_KEY` matches the project

### API routes return 503 in development

**Symptom**: POST/PATCH/DELETE routes return maintenance mode error.

**Fix**: Check `app_settings` table in Supabase — the `maintenance` key might be set to `true`. Update it via admin console or direct database query.

### Rate limit errors (429)

**Symptom**: Requests return "rate limit exceeded".

**Explanation**: In-memory rate limiters track requests per IP and per user. The limits reset after the sliding window expires (typically 1 hour). In development, restarting the dev server clears the rate limit state.

## Database Issues

### RLS policy blocking access

**Symptom**: Queries return empty results or permission denied.

**Check**: RLS policies are enforced on every table. Make sure:
1. User is authenticated (JWT is valid)
2. The query is accessing rows owned by the authenticated user
3. Or the user has admin role for cross-user access

### Migration not applied

**Symptom**: Table or column doesn't exist.

**Fix**: Check `supabase/migrations/` for pending migrations. Apply via Supabase dashboard or CLI:

```bash
npx supabase db push
```

## Development Issues

### Dev server port already in use

**Symptom**: `EADDRINUSE` error on port 3000.

**Fix**: Kill the process using the port:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

### Hot reload not working

**Symptom**: Changes don't reflect in the browser.

**Fix**:
1. Check if file watching is enabled
2. Try restarting the dev server
3. Clear browser cache
4. Check `.next` directory permissions

## Getting Help

If none of these solutions work:

1. Check the [GitHub Issues](https://github.com/anomalyco/opencode/issues) for similar problems
2. Run `npm test` to verify the test suite passes
3. Check browser DevTools console for client-side errors
4. Check server logs for API-level errors
