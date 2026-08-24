# FinSight — Changelog

## [0.1.0] — 2026-08-24

### Added

#### Core Features
- **Dashboard**: Real-time financial overview with balance cards, income/expense trends, category breakdown, recent transactions
- **Transactions**: Paginated list with search, filter, sort, date range, CSV export, detail view with overspend tracking
- **Budgets**: Monthly budget tracking with category breakdown, spending velocity, savings progress
- **Bills**: Bill management with one-time and recurring frequencies, payment history, advance/due/overdue reminders
- **Goals**: Financial goals with contributions, progress tracking, deadline reminders, multi-currency support
- **Recurring**: Recurring transaction rules with calendar-correct recurrence, pending confirmation workflow
- **Notifications**: In-app notification inbox with read/unread tracking, broadcast support
- **Settings**: Profile management, password change, notification preferences

#### Authentication
- Email/password registration with password policy (≥8 chars, mixed case/digit/special)
- Email verification (OTP or magic link, Supabase-configurable)
- Password reset flow (hashed tokens, 30-minute expiry, single-use)
- Password change (signed-in users, session invalidation)
- Account status management (active/disabled/suspended)
- Session freshness via `iat` guard against `password_changed_at`

#### Authorization
- Role-based access control (admin, user, custom roles)
- 15 granular permission codes
- Admin console access control
- Row Level Security on all 18 database tables (65 policies)
- Database write guards (column forgery prevention via triggers)

#### Admin Console
- **Dashboard**: Platform-wide aggregate statistics (users, finances, health)
- **Users**: List/search/filter/sort users, promote/demote, suspend/disable, revoke sessions
- **User Detail**: Financial snapshot, activity, auth info, audit history
- **Transactions**: Cross-user transaction browser with flagging, correction, CSV export
- **Categories**: Category tree management with CRUD, disable, hierarchy
- **Roles**: Permission matrix and role management
- **Notifications**: Broadcast compose, send, cancel, delete
- **Audit Log**: Append-only audit trail with filters and CSV export
- **Push Subscriptions**: View and manage push subscriptions
- **Settings**: System configuration editor (general, finance, notifications, AI, PWA)
- **System**: Runtime status, health checks, maintenance mode toggle

#### PWA
- Service worker with offline support (network-first navigation, cache-first static assets)
- Web app manifest with installability
- Push notifications (Web Push API + VAPID)
- iOS and Android install prompts
- Offline indicator

#### Security
- Nonce-based Content Security Policy (per-request)
- HSTS in production
- Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Input validation (password policy, transaction amounts, text lengths)
- Rate limiting (auth, AI, admin endpoints)
- Audit logging for all admin mutations
- No secrets in browser bundles

#### AI
- OpenAI integration for spending insights
- Local Ollama fallback
- Provider health checks
- Rate-limited (12/hour per user, 30/hour per IP)

#### Database
- 18 tables with full RLS
- 16 migrations
- Database functions for: auth, finance operations, recurring processing, goal contributions, reminders, admin stats
- Triggers for: profile creation, column protection, system role protection
- Seed data: roles, permissions, categories, app settings

#### Infrastructure
- Render deployment support (HTTPS, HSTS)
- Supabase Edge Functions for reminders
- CI pipeline (GitHub Actions)
- Health probes (liveness, readiness)

### Known Issues
- Test TypeScript errors exist in `tests/` directory (don't affect build)
- `tsconfig.json` includes `tests/` via `**/*.ts`
- Build requires stale `.next` cache cleanup before `npm run build` succeeds
