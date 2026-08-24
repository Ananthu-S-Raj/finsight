# FinSight — Role-Based Access Control

## Overview

FinSight implements a two-tier authorization model:

1. **Authentication** — verifies the user's identity via Supabase JWT
2. **Authorization** — determines what the authenticated user can do via RBAC

## Roles

| Role | System | Description |
|---|---|---|
| `user` | Yes | Standard user with access to own finance data |
| `admin` | Yes | Administrator with console access and elevated permissions |

System roles are protected by a database trigger (`roles_guard_system_rows`) that prevents UPDATE and DELETE operations.

Source: `supabase/migrations/20260807000000_admin.sql`

## Permissions

15 granular permission codes:

| Code | Description |
|---|---|
| `USER_VIEW` | View user accounts |
| `USER_EDIT` | Edit user profile fields |
| `USER_SUSPEND` | Suspend, activate or deactivate accounts |
| `ROLE_MANAGE` | Change user roles and manage role permissions |
| `TRANSACTION_VIEW` | View transactions across accounts |
| `TRANSACTION_EDIT` | Correct or flag transactions |
| `TRANSACTION_DELETE` | Delete transactions |
| `CATEGORY_MANAGE` | Manage categories, subcategories and presets |
| `NOTIFICATION_MANAGE` | Create and send system notifications |
| `SYSTEM_SETTINGS` | Read and change system settings |
| `AI_SETTINGS` | Enable or disable AI features |
| `PWA_SETTINGS` | Manage PWA behaviour |
| `AUDIT_LOG_VIEW` | View audit logs |
| `REPORT_VIEW` | View aggregate analytics |
| `ADMIN_CONSOLE_ACCESS` | Enter the administrative console |

Source: `src/lib/admin/permissions.ts`

## Permission Matrix

| Permission | admin | user |
|---|:---:|:---:|
| `USER_VIEW` | ✓ | ✗ |
| `USER_EDIT` | ✓ | ✗ |
| `USER_SUSPEND` | ✓ | ✗ |
| `ROLE_MANAGE` | ✓ | ✗ |
| `TRANSACTION_VIEW` | ✓ | ✗ |
| `TRANSACTION_EDIT` | ✓ | ✗ |
| `TRANSACTION_DELETE` | ✓ | ✗ |
| `CATEGORY_MANAGE` | ✓ | ✗ |
| `NOTIFICATION_MANAGE` | ✓ | ✗ |
| `SYSTEM_SETTINGS` | ✓ | ✗ |
| `AI_SETTINGS` | ✓ | ✗ |
| `PWA_SETTINGS` | ✓ | ✗ |
| `AUDIT_LOG_VIEW` | ✓ | ✗ |
| `REPORT_VIEW` | ✓ | ✗ |
| `ADMIN_CONSOLE_ACCESS` | ✓ | ✗ |

All 15 permissions are granted to the `admin` role via a cross-join seed in the migration. The `user` role receives none.

## Authorization Layers

### 1. API Authorization (Application Routes)

User-facing API routes (`/api/v1/*`) use:

```
readBearer(req) → extract JWT
verifyActiveSession(token) → JWT validation + status check + iat guard
```

RLS then enforces row ownership at the database level. No permission checks are performed — every authenticated user can access their own data.

Source: `src/app/api/v1/*/route.ts`

### 2. API Authorization (Admin Routes)

Admin API routes (`/api/admin/*`) use:

```
authenticateRequest(req) → JWT validation
  → verifySession(token) → user ID
  → loadProfile(client, userId) → role, account_status
  → Check: role === 'admin'
  → loadPermissions(client, 'admin') → permission codes
  → Rate limiting (IP + user)
  → Audit logging
```

Then each handler calls `requirePermission(ctx, "CODE")` before accessing data.

Source: `src/lib/admin/server.ts`

### 3. Database Authorization (RLS)

Every table has Row Level Security enabled. The pattern:

- **User-owned rows**: `auth.uid() = user_id` — users can only read/write their own data
- **Admin cross-user**: `public.is_admin()` — admins bypass row ownership
- **Shared reference data**: `true` for authenticated users (categories, roles, permissions)

65 RLS policies across 18 tables.

### 4. Database Write Guards (Triggers)

- `profiles_guard_protected_columns` — prevents clients from forging `role`, `account_status`, `password_changed_at`
- `transactions_guard_protected_columns` — prevents clients from forging `user_id`, `type`, `amount`, `overspend_amount`
- `roles_guard_system_rows` — prevents modification of system roles

## Admin Authentication Model

An admin is recognized by:

1. Valid JWT (verified by Supabase auth)
2. `profiles.role === 'admin'`
3. `profiles.account_status === 'active'`
4. JWT `iat` ≥ `profiles.password_changed_at` (session freshness)

The admin console client (`src/lib/admin/client.ts`) attaches the session JWT to every request. The server (`src/lib/admin/server.ts`) independently verifies the JWT and role on every request — the client-side check is not a security boundary.

## Permission Enforcement

### Server-side

```typescript
// In admin handler
export const listUsers: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "USER_VIEW");  // throws 403 if missing
  // ... data access
};
```

### Client-side

```tsx
// In admin page
<PermissionGate code="USER_VIEW">
  <UserList />
</PermissionGate>
```

The `PermissionGate` component hides UI elements but does not enforce security — the server always re-checks.

Source: `src/components/admin/AdminPage.tsx`

## Custom Roles

The RBAC system supports custom roles beyond the seeded `admin` and `user`:

1. Admin creates a new role via `POST /api/admin/roles`
2. Admin grants permissions via `POST /api/admin/roles/:id/permissions`
3. Admin assigns the role to a user via `PATCH /api/admin/users/:id`

Custom roles are validated against the live `roles` table (not a hardcoded allowlist). A role change fails if it would leave zero active admins.

Source: `src/app/admin/roles/page.tsx`, `src/lib/admin/handlers/roles.ts`
