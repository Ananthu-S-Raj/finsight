# Capability Semantics — Custom Roles & Delegation (locked by WS-C1)

Status: **DECIDED / NORMATIVE** for all WS-C phases · Date: 2026-08-22 · Scope: authorization semantics only. No behaviour change is implemented in WS-C1; this document plus `tests/capability-semantics.test.ts` are the contract that WS-C2…WS-C8 must honour.

---

## 1. Current state (authoritative as of WS-B/WS-A)

```text
profile.role === "admin"
        ↓
admin console admission          (src/lib/admin/server.ts:256)
        ↓
permission matrix                (loadPermissions(role) → ctx.permissions → requirePermission)
        ↓
handler authorization            (per-endpoint permission codes)

profile.role === "admin"
        ↓
is_admin()                       (public.is_admin() ≡ profiles.role = 'admin')
        ↓
RLS / RPC authorization          (~46 policies + 4 SECURITY DEFINER RPC guards + 2 column-guard triggers)
```

Consequences of the current layering:

- The permission matrix (`roles` → `role_permissions` → `permissions`) is **secondary**: it only narrows what an already-admitted `admin` may do inside handlers. It never grants access at the console gate or the data layer.
- A non-`admin` custom role can authenticate, use ordinary ownership-scoped user APIs, and holds **zero** admin-console or admin-RLS capability — regardless of what permissions are granted to it in `role_permissions`.
- Console admission and data-layer authority are both keyed on the literal string `'admin'`, via two independent mechanisms (`server.ts:256` and `public.is_admin()`).

## 2. Decision D1 — assignment of the `admin` system role (RESOLVED)

> **`ROLE_MANAGE` alone must NOT permit assigning the `admin` role.** `admin` is a privileged **system role** representing full console/data-layer authority; minting or transferring it requires an explicit elevated capability that does not exist yet and must be designed before enforcement.

Rationale: `ROLE_MANAGE`'s seeded description ("Change user roles and manage role permissions") has been operationally conflated with "may create admins" only because the seeded admin happens to hold every permission. Under a delegation-aware model that conflation becomes a privilege-escalation path (any narrowed ROLE_MANAGE holder could mint a full admin) and is therefore closed by decision, not by convention.

Interim status: **behaviour unchanged** — `updateUser` still accepts `role = "admin"` under `ROLE_MANAGE`. This is a **known gap**, deliberately left open; **enforcement belongs to WS-C5** (assignment guard) after the capability model exists to express the replacement authority. WS-C1 neither rejects `admin` assignments nor adds any new capability.

## 3. Decision D2 — the custom-role delegation invariant (RESOLVED)

For any **non-system** role R and actor A:

```text
permissions(R) ⊆ effectivePermissions(actor)
```

where `permissions(R)` is R's set in `role_permissions` and `effectivePermissions(actor)` is exactly the set resolved by the existing mechanism: `loadPermissions(client, profile.role)` → `ctx.permissions` (fail-closed `[]`). No second resolution mechanism may be introduced.

An actor may assign R only if **every** permission granted to R is already held by the actor. This closes:

- assigning a richer existing role,
- indirect delegation through a role the actor did not create but can assign,
- using assignment as a privilege-escalation bypass around the G-08 grant-time guard.

G-08 (grant-time: `ctx.permissions.includes(permission.code)` in `handlers/roles.ts`) and D2 (assignment-time) together form a closed delegation model: no path may move a permission from the matrix to a principal unless the acting administrator already holds it.

## 4. Decision D3 — the `admin` invariant (RESOLVED)

- `admin` is a **system row**; it cannot be renamed, un-flagged, or deleted (WS-A trigger `guard_roles_system_rows`).
- It represents *current* full console + data-layer authority — an implementation fact, not a product guarantee to preserve forever.
- Custom-role delegation must never implicitly grant `admin`: no permission code implies the `admin` role, and no role assignment may target `admin` except through the future explicit privileged capability (D1).
- `ROLE_MANAGE` must never be re-interpreted as "may create/assign full admins".

## 5. Target architecture (future state — NOT implemented in this phase)

```text
identity (any authenticated user)
        ↓
ADMIN_CONSOLE_ACCESS permission?   ← console admission becomes capability-driven (replaces server.ts:256 literal)
        ↓
permission matrix (ctx.permissions) ← authoritative for handler authorization
        ↓
has_permission(code)               ← SECURITY DEFINER bridge for relocated RLS policies
        ↓
data-layer authorization           (is_admin() shrinks to bootstrap/system-admin surfaces)
```

Custom roles become meaningful exactly when capabilities are delegated onto them; until each surface migrates, its existing `is_admin()` policy remains authoritative and custom roles remain inert there.

**WS-C1 seed status:** `ADMIN_CONSOLE_ACCESS` ("Enter the administrative console") is defined and granted to the seeded `admin` role only. It is **NOT YET authoritative for console admission** — the literal `role === "admin"` gate in `server.ts` remains in force until **WS-C3** swaps it, so the new code currently has no gate effect and grants custom roles nothing.

## 6. Phase map

| Phase | Delivers | Key constraint |
|---|---|---|
| WS-C1 | This semantics lock-in | zero behaviour change |
| WS-C2 | `has_permission()` helper + first relocated RLS policies + live-Postgres verification on staging | static mocks cannot prove RLS |
| WS-C3 | Console-gate swap (`ADMIN_CONSOLE_ACCESS`) + whoami/AppShell/passwordReset alignment | no silent capability gain |
| WS-C4 | Role lifecycle CRUD (create/edit/delete) behind `ROLE_MANAGE` + audits | name rules, RESTRICT/FK/trigger respected |
| WS-C5 | Assignment guard enforcing D1 + D2 | replaces today's known gap |
| WS-C6 | UI: role selector replaces binary promote/demote | server remains authoritative |
| WS-C7/C8 | Integration + E2E suites (provisioned credentials) | honest skip gates |

## 7. Known-gap register (interim, not yet enforced)

1. Assignment of `admin` under bare `ROLE_MANAGE` (D1) — deferred to WS-C5.
2. Assignment of any role whose permission set exceeds the actor's own (D2) — reachable since WS-B live validation; deferred to WS-C5.
3. Permission bundles on custom roles have no effect outside handlers until WS-C2 relocates specific policies — inert-by-construction today, documented to prevent mis-operation.
