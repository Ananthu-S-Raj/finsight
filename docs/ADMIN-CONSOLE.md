# FinSight — Admin Console

## Overview

The admin console is a full-featured platform management interface accessible at `/admin`. It uses a separate authorization layer with role + permission checks.

## Access Control

- Entry: `/admin` redirects to `/admin/dashboard`
- Authentication: `useAdminAuth()` hook verifies JWT + admin role via `/api/admin/whoami`
- UI enforcement: `PermissionGate` component hides elements based on permission codes
- Server enforcement: Every API call goes through `authenticateRequest()` + `requirePermission()`

Source: `src/lib/admin/client.ts`, `src/lib/admin/server.ts`

## Pages

### Dashboard (`/admin/dashboard`)

Platform overview with aggregate statistics.

- **User stats**: total, active, disabled, suspended, admins, verified, unverified
- **Finance stats**: transactions, income, expenses, savings, active budgets, credit cards, loans
- **Health checks**: database, backend, AI, notifications, PWA, maintenance
- **Recent audit**: last 10 admin actions
- Permissions: `REPORT_VIEW`, `AI_SETTINGS`, `AUDIT_LOG_VIEW`

Source: `src/app/admin/dashboard/page.tsx`, `src/lib/admin/handlers/overview.ts`

### Users (`/admin/users`)

User management with search, filter, sort, and pagination.

- List all users with email, name, role, status, creation date
- Filter by: role, status, verified/unverified
- Sort by: created_at, last_active_at, email, full_name, role, account_status
- Search by: email, full_name
- Actions: promote/demote role, suspend/disable/activate, revoke sessions, send password reset
- Permissions: `USER_VIEW`, `ROLE_MANAGE`, `USER_SUSPEND`, `USER_EDIT`

Source: `src/app/admin/users/page.tsx`, `src/lib/admin/handlers/users.ts`

### User Detail (`/admin/users/[id]`)

Single user view with comprehensive information.

- Financial snapshot: balances, budget, transaction count
- Activity: last login, last active
- Auth info: email confirmed, sign-in history
- Audit history: admin actions targeting this user
- Actions: edit profile, change role, change status, revoke sessions, password reset
- Permissions: `ROLE_MANAGE`, `USER_SUSPEND`, `USER_EDIT`, `AUDIT_LOG_VIEW`, `TRANSACTION_VIEW`

Source: `src/app/admin/users/[id]/page.tsx`

### Transactions (`/admin/transactions`)

Cross-user transaction browser.

- Browse all transactions across all users
- Search by: note, category, subcategory
- Filter by: type, user
- Sort by: created_at, amount, type, category
- Actions: flag/unflag, correct, delete
- CSV export
- Permissions: `TRANSACTION_VIEW`, `TRANSACTION_EDIT`, `TRANSACTION_DELETE`

Source: `src/app/admin/transactions/page.tsx`, `src/lib/admin/handlers/transactions.ts`

### Categories (`/admin/categories`)

Category tree management.

- View full category tree (top-level + subcategories)
- Create new categories (expense/income type)
- Rename, disable, enable categories
- Add subcategories
- Delete (only if no transactions reference it)
- Permissions: `CATEGORY_MANAGE`

Source: `src/app/admin/categories/page.tsx`, `src/lib/admin/handlers/categories.ts`

### Roles (`/admin/roles`)

Permission matrix and role management.

- View all roles with their permissions
- Grant/revoke permissions on custom roles
- System roles (`user`, `admin`) cannot be modified
- Permissions: `ROLE_MANAGE`

Source: `src/app/admin/roles/page.tsx`, `src/lib/admin/handlers/roles.ts`

### Notifications (`/admin/notifications`)

Broadcast notification management.

- Compose notifications with title, body, audience, channel
- Audience: all, users, admins, selected users
- Channel: in-app, push, both
- Send, cancel, delete notifications
- View delivery status and errors
- Permissions: `NOTIFICATION_MANAGE`

Source: `src/app/admin/notifications/page.tsx`, `src/lib/admin/handlers/notifications.ts`

### Audit Log (`/admin/audit`)

Append-only audit trail.

- View all admin actions with actor, target, action, timestamp
- Filter by: action type, resource type, result, date range
- Export to CSV
- Resource types: app_settings, category, notification, push_subscription, role, system, transaction, user
- Permissions: `AUDIT_LOG_VIEW`

Source: `src/app/admin/audit/page.tsx`, `src/lib/admin/handlers/audit.ts`

### Push Subscriptions (`/admin/push`)

Push subscription management.

- View all registered push subscriptions
- See user email and subscription details
- Remove subscriptions
- Permissions: `USER_EDIT`

Source: `src/app/admin/push/page.tsx`, `src/lib/admin/handlers/push.ts`

### Settings (`/admin/settings`)

System configuration editor.

- Groups: general, finance, notifications, ai, pwa
- Edit key-value settings with JSON editor
- Change detection and diff display
- Permissions: `SYSTEM_SETTINGS`

Source: `src/app/admin/settings/page.tsx`, `src/lib/admin/handlers/settings.ts`

### System (`/admin/system`)

Runtime status and maintenance control.

- View: app version, runtime, node_env, build time
- Service health: database, settings
- Maintenance mode toggle
- Permissions: `SYSTEM_SETTINGS`

Source: `src/app/admin/system/page.tsx`, `src/lib/admin/handlers/system.ts`

## Admin Components

| Component | Purpose |
|---|---|
| `AdminPage` | Layout wrapper for admin pages |
| `AdminShell` | Admin chrome with navigation |
| `ConfirmDialog` | Confirmation dialog for destructive actions |
| `ui.tsx` | Admin-specific UI primitives (StatCard, HealthRow, StatusBadge, etc.) |
| `PermissionGate` | Conditionally renders content based on permission |
| `Pagination` | Paginated navigation |

## Client Library

`src/lib/admin/client.ts` provides:

- `adminFetch<T>(path, opts)` — authenticated fetch to `/api/admin/*`
- `useAdminAuth()` — hook returning admin auth state
- Shared response types: `AdminUser`, `AdminOverview`, `AdminTransaction`, etc.

## Data Hook

`src/lib/admin/useAdminData.ts` provides:

- `useAdminData()` — hook for admin data fetching with maintenance mode polling
- Polls `/api/app/status` every 60 seconds
- Provides `isMaintenance` state
