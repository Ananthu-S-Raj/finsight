# FinSight — Testing

## Overview

FinSight uses Vitest as the test framework. The test suite covers authentication, API routes, components, hooks, database logic, and integration flows.

## Running Tests

```bash
npm test              # Full test suite
npx vitest --watch    # Watch mode
npx vitest run <file> # Single file
npx vitest --reporter=verbose  # Verbose output
```

**Current status**: 799 tests passing across 56 test suites.

## Test Configuration

Source: `vitest.config.mts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
    },
  },
});
```

## Test Setup

Source: `tests/setup.ts`

- Mocks `window.matchMedia`
- Mocks `IntersectionObserver`
- Mocks `ResizeObserver`
- Mocks `navigator.serviceWorker`
- Mocks `HTMLFormElement.prototype.requestSubmit`
- Sets `NODE_ENV=test`

## Test Structure

```
tests/
├── auth/                    # Auth and session tests
│   ├── auth-flow.test.ts
│   ├── auth-change-password-api.test.ts
│   ├── auth-signup-api.test.ts
│   └── session-freshness-api.test.ts
├── admin/                   # Admin API and permission tests
│   ├── admin-api-authentication.test.ts
│   ├── admin-rbac-permissions.test.ts
│   ├── admin-rbac-routes.test.ts
│   ├── admin-system-maintenance-api.test.ts
│   ├── admin-maintenance-auth.test.ts
│   └── admin-route-visibility.test.ts
├── api/                     # User-facing API route tests
│   ├── finance-api-auth-flow.test.ts
│   ├── finance-api-authentication.test.ts
│   ├── bills-api-comprehensive.test.ts
│   ├── goals-api-comprehensive.test.ts
│   ├── recurring-api-comprehensive.test.ts
│   ├── notifications-api-edge-cases.test.ts
│   ├── ai-insights-api-authorization.test.ts
│   ├── transactions-api.test.ts
│   └── categories-api.test.ts
├── components/              # React component rendering tests
│   ├── FinancialTransactionList.test.tsx
│   ├── SettingsPage.test.tsx
│   ├── NotificationInbox.test.tsx
│   ├── NotificationBell.test.tsx
│   └── BottomNav.test.tsx
├── hooks/                   # Custom hook tests
│   ├── useDebounce.test.ts
│   └── useSwipe.test.ts
├── database/                # Database function tests
│   ├── finance-helpers-integration.test.ts
│   ├── database-stat-functions-integration.test.ts
│   └── database-rpc-unit.test.ts
├── security/                # Security feature tests
│   ├── csp-header-integration.test.ts
│   ├── auth-password-policy.test.ts
│   ├── rate-limit-auth-api.test.ts
│   ├── rate-limit-ai-insights-api.test.ts
│   └── routes-are-compiled.test.ts
├── integration/             # End-to-end integration tests
│   ├── offline-mode-integration.test.ts
│   ├── install-prompt-integration.test.ts
│   └── notification-foreground-integration.test.ts
└── *.test.ts(x)             # Root-level test files
```

## Test Categories

### Authentication Tests

- Registration flow validation
- Login/logout flows
- Password policy enforcement
- Session freshness checks
- Password change/reset endpoints
- Error message handling (no email enumeration)

### API Route Tests

- Authenticated access (valid/invalid tokens)
- Maintenance mode enforcement (POST/PATCH/DELETE blocked)
- Query parameter validation
- Rate limiting behavior
- Response format consistency
- CRUD operations on bills, goals, recurring transactions

### Component Tests

- Component rendering without errors
- Props handling
- User interaction simulation
- Error boundary behavior
- Loading states

### Database Tests

- RPC function calls
- Stat function output
- Finance helper calculations

### Security Tests

- CSP header generation
- Password policy rules
- Rate limiter sliding window
- Route compilation (all pages build successfully)

### Integration Tests

- Offline mode detection
- Install prompt behavior
- Push notification foreground handling

## Writing Tests

### Naming Convention

- Files: `*.test.ts` or `*.test.tsx`
- Co-located with source or in `tests/` directory
- Descriptive names: `auth-flow.test.ts`, `useDebounce.test.ts`

### Mocking Patterns

```typescript
// Mock Supabase client
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  },
}));

// Mock API responses
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data, init) => ({ json: () => data, status: init?.status || 200 }),
  },
  NextRequest: vi.fn().mockImplementation((url, opts) => ({
    url,
    method: opts?.method || 'GET',
    headers: new Map(Object.entries(opts?.headers || {})),
    json: () => Promise.resolve(opts?.body),
  })),
}));
```

### Test Helpers

Source: `tests/helpers.ts`

- `createTestClient(sessionToken?)` — Creates a mock Supabase client
- `createAuthenticatedSession(token?)` — Creates authenticated session mocks

## CI

Source: `.github/workflows/ci.yml`

Runs on push and PR to main:

1. Install dependencies
2. Build the project
3. Run the full test suite
4. Run ESLint
