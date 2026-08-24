# FinSight — Features

## Dashboard

- Real-time financial overview with balance cards (salary, savings, monthly budget)
- Income vs. expense trend charts (Recharts)
- Category-wise spending breakdown with progress bars
- Recent transactions list with type icons
- Maintenance mode banner (polls `/api/app/status` every 60s)
- PWA install prompt (native + iOS instructions)

## Transactions

- Paginated list with infinite scroll (cursor-based)
- Search by note, category, subcategory
- Filter by type (expense, income, transfer)
- Filter by date range
- Sort by date, amount
- CSV export
- Detail view with overspend tracking
- Transaction type badges with color coding

## Budgets

- Monthly budget tracking with category breakdown
- Spending velocity (daily/weekly/monthly rate)
- Savings progress toward goals
- Budget utilization percentages

## Bills

- One-time and recurring bill management
- Payment history tracking
- Advance/due/overdue reminder system
- Mark paid (optionally creates expense transaction)
- Cancel bills
- Anchor day for monthly recurrence
- Credit card flag

## Goals

- Financial savings goals with target amounts and dates
- Contribution tracking with history
- Progress visualization
- Goal status management (active, paused, completed, cancelled)
- Deadline reminders (30, 7, 1 day before)
- Multi-currency support (₹, $, €, £, ¥)

## Recurring Transactions

- Calendar-correct recurrence engine (daily, weekly, biweekly, monthly, quarterly, yearly)
- Anchor day handling (e.g., "15th of every month")
- Pending confirmation workflow
- Skip occurrence
- Status management (active, paused, cancelled)
- Cross-account transfers

## Notifications

- In-app notification inbox
- Read/unread tracking
- Broadcast notifications from admin
- Push notifications (Web Push API)
- Notification preferences
- Bell indicator with unread count

## Settings

- Profile management (name, email, date of birth)
- Password change
- Notification preferences
- Account status display

## Admin Console

### Dashboard
- User statistics (total, active, disabled, suspended, admins, verified/unverified)
- Finance statistics (transactions, income, expenses, savings, budgets, credit cards, loans)
- Health checks (database, backend, AI, notifications, PWA, maintenance)
- Recent audit activity

### User Management
- List/search/filter/sort users
- Promote/demote role
- Suspend/disable/activate accounts
- Revoke all sessions
- Send password reset email
- User detail with financial snapshot and audit history

### Transaction Browser
- Cross-user transaction view
- Search, filter by type/user, sort
- Flag/unflag transactions
- Correct transaction amounts
- Delete transactions
- CSV export

### Category Management
- Category tree with top-level and subcategories
- Create new categories (expense/income)
- Rename, disable, enable categories
- Add subcategories
- Delete (only if no transactions reference it)

### Role & Permission Management
- View all roles with permission matrix
- Grant/revoke permissions on custom roles
- System roles (`user`, `admin`) are immutable

### Notification Management
- Compose broadcast notifications
- Audience targeting (all, users, admins, selected)
- Channel selection (in-app, push, both)
- Send, cancel, delete notifications
- Delivery status and error tracking

### Audit Log
- Append-only audit trail
- Filter by action, resource type, result, date range
- Export to CSV

### Push Subscription Management
- View all registered push subscriptions
- User email and subscription details
- Remove subscriptions

### Settings Editor
- System configuration editor (general, finance, notifications, AI, PWA)
- JSON editor for key-value settings
- Change detection and diff display

### System Status
- Runtime information (version, environment, build time)
- Service health checks
- Maintenance mode toggle

## PWA

- Offline support (service worker with cache strategies)
- Installability (native install prompt + iOS instructions)
- Push notifications (Web Push API + VAPID)
- Background sync
- App version display

## AI Insights

- Server-generated spending insights
- OpenAI integration (primary)
- Ollama fallback (local)
- Rate-limited (12/hour per user)
- Provider health checks
- Monthly insight reports

## Security

- Nonce-based Content Security Policy
- HSTS in production
- Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Input validation
- Rate limiting (auth, AI, admin)
- Audit logging
- No secrets in browser bundles
- Row Level Security on all tables
- Database write guards (column forgery prevention)
