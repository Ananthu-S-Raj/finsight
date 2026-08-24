# FinSight — API Reference

## Overview

All API routes return JSON. Authenticated routes require `Authorization: Bearer <jwt>` header. Error responses follow the shape `{ error: string, code: string, status: number }`.

## Application Endpoints

### GET /api/health

Liveness check. No authentication.

```
Response: { "status": "ok" }
Source: src/app/api/health/route.ts
```

### GET /api/app/status

Public maintenance mode status.

```
Response: { "maintenance": boolean, "app_name": string }
Source: src/app/api/app/status/route.ts
```

## Health Probes

### GET /api/v1/health/live

Kubernetes/Docker liveness probe. No authentication.

```
Response: { "status": "ok" }
Source: src/app/api/v1/health/live/route.ts
```

### GET /api/v1/health/ready

Readiness probe. Pings Supabase database.

```
Response (200): { "status": "ok", "db": "ok", "latency_ms": number }
Response (503): { "status": "not_ready", "db": "unavailable" }
Source: src/app/api/v1/health/ready/route.ts
```

## Authentication Endpoints

### POST /api/v1/auth/forgot-password

Initiates password reset. Public, rate-limited.

```
Request: { "email": string }
Response: { "message": "If an account exists with this email, a password reset link has been sent." }
Rate limit: 5/hour per IP and per email
Source: src/app/api/v1/auth/forgot-password/route.ts
```

### POST /api/v1/auth/reset-password

Completes password reset with token. Public, rate-limited.

```
Request: { "token": string, "new_password": string }
Response: { "message": "Password reset successful." }
Rate limit: 10/hour per IP
Source: src/app/api/v1/auth/reset-password/route.ts
```

### POST /api/v1/auth/change-password

Changes password for signed-in user. Bearer token required.

```
Request: { "current_password": string, "new_password": string }
Response: { "message": "Password changed successfully." }
Source: src/app/api/v1/auth/change-password/route.ts
```

## Finance Endpoints

### GET /api/v1/transactions

Paginated, filtered transaction list. Bearer token required.

```
Query params: search, range, type, category, min, max, order, direction, limit, after (cursor)
Response: Paginated transaction list
Source: src/app/api/v1/transactions/route.ts
```

### GET /api/v1/categories

Returns the admin-managed category tree. Bearer token required.

```
Response: Array of category objects with nested children
Source: src/app/api/v1/categories/route.ts
```

### DELETE /api/v1/categories/:id

Stub. Always returns 405. Categories are admin-managed.

```
Response (405): { "error": "Categories are admin-managed.", "code": "method_not_allowed" }
Source: src/app/api/v1/categories/[id]/route.ts
```

## Bills Endpoints

Catch-all route at `/api/v1/bills/*`. Bearer token required. All writes are maintenance-mode aware.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/bills` | List bills (optional `?status=` filter) |
| POST | `/api/v1/bills` | Create a bill |
| GET | `/api/v1/bills/payments` | Payment history |
| GET | `/api/v1/bills/reminders` | Fired reminders (`?since=ISO`) |
| POST | `/api/v1/bills/:id/paid` | Mark paid (`{ create_expense: boolean }`) |
| POST | `/api/v1/bills/:id/cancel` | Cancel a bill |
| GET | `/api/v1/bills/:id` | Get one bill |
| PATCH | `/api/v1/bills/:id` | Update a bill |
| DELETE | `/api/v1/bills/:id` | Delete (blocked if payment history exists) |

Source: `src/app/api/v1/bills/[[...slug]]/route.ts`

## Goals Endpoints

Catch-all route at `/api/v1/goals/*`. Bearer token required. All writes are maintenance-mode aware.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/goals` | List goals (optional `?status=` filter) |
| POST | `/api/v1/goals` | Create a goal |
| GET | `/api/v1/goals/reminders` | Fired reminders (`?since=ISO`) |
| GET | `/api/v1/goals/:id` | Get one goal |
| PATCH | `/api/v1/goals/:id` | Update a goal |
| DELETE | `/api/v1/goals/:id` | Delete (blocked with history) |
| POST | `/api/v1/goals/:id/contribute` | Add contribution (`{ amount, note }`) |
| GET | `/api/v1/goals/:id/contributions` | Contribution history |
| DELETE | `/api/v1/goals/:id/contributions/:cid` | Remove contribution |
| POST | `/api/v1/goals/:id/status` | Set status (`active`/`paused`/`completed`/`cancelled`) |

Source: `src/app/api/v1/goals/[[...slug]]/route.ts`

## Recurring Endpoints

Catch-all route at `/api/v1/recurring/*`. Bearer token required. All writes are maintenance-mode aware.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/recurring` | List rules (`?type=expense\|income\|transfer`) |
| POST | `/api/v1/recurring` | Create a rule (triggers processing) |
| GET | `/api/v1/recurring/pending` | Pending confirmation occurrences |
| POST | `/api/v1/recurring/pending/:id/confirm` | Confirm occurrence |
| POST | `/api/v1/recurring/pending/:id/skip` | Skip occurrence |
| GET | `/api/v1/recurring/:id` | Get one rule |
| PATCH | `/api/v1/recurring/:id` | Update a rule |
| DELETE | `/api/v1/recurring/:id` | Delete a rule |
| POST | `/api/v1/recurring/:id/status` | Change status (`paused`/`active`/`cancelled`) |

Source: `src/app/api/v1/recurring/[[...slug]]/route.ts`

## Notifications Endpoints

Catch-all route at `/api/v1/notifications/*`. Bearer token required.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/notifications` | List sent broadcasts (paginated) |
| POST | `/api/v1/notifications/:id/read` | Mark broadcast as read |

Source: `src/app/api/v1/notifications/[[...slug]]/route.ts`

## AI Endpoints

### POST /api/v1/ai/insights

Server-generated AI spending insights. Bearer token required. Rate-limited.

```
Request (optional): { "month": "YYYY-MM" }
Response (success): { "available": true, "insights": string, "provider": string, "model": string, "latency_ms": number }
Response (fallback): { "available": false, "message": string, "code": string }
Rate limit: 12/hour per user, 30/hour per IP
Source: src/app/api/v1/ai/insights/route.ts
```

## Admin Endpoints

All admin endpoints are served by a single catch-all route at `/api/admin/*`. Every request goes through `authenticateRequest()` which verifies:

1. Valid Bearer token
2. Admin role
3. Active account status
4. Session freshness (iat guard)
5. Rate limiting (IP + user)
6. Audit logging

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/admin/whoami` | (admin) | Returns current admin's id, email, role, permissions |
| GET | `/api/admin/overview` | `REPORT_VIEW` | Platform-wide aggregate dashboard |
| GET | `/api/admin/users` | `USER_VIEW` | List/search/filter users (supports `?verified=false`) |
| GET | `/api/admin/users/:id` | `USER_VIEW` | Single user detail |
| PATCH | `/api/admin/users/:id` | `USER_EDIT`/`USER_SUSPEND`/`ROLE_MANAGE` | Update user profile/status/role |
| POST | `/api/admin/users/:id/sessions/revoke` | `USER_SUSPEND` | Revoke all user sessions |
| POST | `/api/admin/users/:id/password-reset` | `USER_EDIT` | Send password reset email |
| GET | `/api/admin/roles` | (admin) | List all roles |
| GET | `/api/admin/roles/:id/permissions` | `ROLE_MANAGE` | Get role permissions |
| POST | `/api/admin/roles/:id/permissions` | `ROLE_MANAGE` | Grant permission to role |
| DELETE | `/api/admin/roles/:id/permissions/:permissionId` | `ROLE_MANAGE` | Revoke permission |
| GET | `/api/admin/transactions` | `TRANSACTION_VIEW` | List all transactions across users |
| PATCH | `/api/admin/transactions/:id` | `TRANSACTION_EDIT` | Correct a transaction |
| POST | `/api/admin/transactions/:id/flag` | `TRANSACTION_EDIT` | Flag a transaction |
| POST | `/api/admin/transactions/:id/unflag` | `TRANSACTION_EDIT` | Unflag a transaction |
| DELETE | `/api/admin/transactions/:id` | `TRANSACTION_DELETE` | Delete a transaction |
| GET | `/api/admin/categories` | (admin) | List all categories |
| POST | `/api/admin/categories` | `CATEGORY_MANAGE` | Create a category |
| PATCH | `/api/admin/categories/:id` | `CATEGORY_MANAGE` | Update a category |
| DELETE | `/api/admin/categories/:id` | `CATEGORY_MANAGE` | Delete a category |
| GET | `/api/admin/notifications` | `NOTIFICATION_MANAGE` | List broadcasts |
| POST | `/api/admin/notifications` | `NOTIFICATION_MANAGE` | Create a broadcast |
| PATCH | `/api/admin/notifications/:id` | `NOTIFICATION_MANAGE` | Update a broadcast |
| POST | `/api/admin/notifications/:id/send` | `NOTIFICATION_MANAGE` | Send a broadcast |
| POST | `/api/admin/notifications/:id/cancel` | `NOTIFICATION_MANAGE` | Cancel a broadcast |
| DELETE | `/api/admin/notifications/:id` | `NOTIFICATION_MANAGE` | Delete a broadcast |
| GET | `/api/admin/push-subscriptions` | `USER_EDIT` | List push subscriptions |
| DELETE | `/api/admin/push-subscriptions/:id` | `USER_EDIT` | Remove a subscription |
| GET | `/api/admin/audit-logs` | `AUDIT_LOG_VIEW` | List audit logs |
| GET | `/api/admin/settings` | `SYSTEM_SETTINGS` | Get all settings |
| PATCH | `/api/admin/settings/:group` | `SYSTEM_SETTINGS` | Update a settings group |
| GET | `/api/admin/system` | `SYSTEM_SETTINGS` | Runtime status + service health |
| POST | `/api/admin/system/maintenance` | `SYSTEM_SETTINGS` | Toggle maintenance mode |
| GET | `/api/admin/ai/status` | `AI_SETTINGS` | AI config + provider health |

Source: `src/lib/admin/handlers/index.ts`, `src/lib/admin/server.ts`
