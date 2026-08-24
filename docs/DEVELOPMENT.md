# FinSight — Development

## Prerequisites

- Node.js ≥ 18
- npm (package manager)
- Supabase project (free tier is sufficient)

## Quick Start

```bash
# Clone and install
cd finsight
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your Supabase credentials

# Start development server
npm run dev
```

The dev server runs at `http://localhost:3000`.

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm test` | Run Vitest test suite |
| `npm run lint` | ESLint across the project |

## Project Structure

```
finsight/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (nonce, providers, metadata)
│   │   ├── globals.css             # Tailwind imports + brand tokens
│   │   ├── page.tsx                # Public landing page
│   │   ├── login/page.tsx          # Email + password login
│   │   ├── register/page.tsx       # Registration with password policy
│   │   ├── verify/page.tsx         # Email verification (OTP or magic link)
│   │   ├── dashboard/page.tsx      # Main dashboard
│   │   ├── transactions/page.tsx   # Transaction list + detail
│   │   ├── budgets/page.tsx        # Budget tracking
│   │   ├── goals/page.tsx          # Financial goals
│   │   ├── bills/page.tsx          # Bills management
│   │   ├── recurring/page.tsx      # Recurring transactions
│   │   ├── insights/page.tsx       # AI insights
│   │   ├── notifications/page.tsx  # Notifications inbox
│   │   ├── settings/page.tsx       # User settings + change password
│   │   ├── admin/                  # Admin console (12 sub-pages)
│   │   └── api/                    # All API routes
│   ├── components/
│   │   ├── ui/                     # Generic primitives
│   │   ├── admin/                  # Admin-specific UI
│   │   ├── charts/                 # Recharts wrappers
│   │   └── forms/                  # Recurring, bills, goals forms
│   └── lib/
│       ├── admin/                  # Admin server, client, handlers
│       ├── auth/                   # Auth, RBAC, sessions, password reset
│       ├── ai/                     # OpenAI / Ollama provider
│       ├── security/               # CSP builder
│       ├── hooks/                  # useDebounce, useSwipe
│       └── helpers.ts              # Date, number, and category helpers
├── supabase/
│   ├── schema.sql                  # Base schema
│   └── migrations/                 # 16 migration files
├── tests/                          # Vitest test suite (56 files)
├── public/
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service worker
│   └── icons/                      # PWA icons
└── docs/                           # This documentation
```

## Development Workflow

### Adding a New API Route

1. Create the route file in `src/app/api/v1/<path>/route.ts`
2. Extract the JWT from the Authorization header
3. Create a user-scoped Supabase client
4. Verify the session with `getUser(token)`
5. Use `handleRoute()` for consistent error handling
6. The route is automatically protected by RLS

### Adding a New Admin Handler

1. Create the handler in `src/lib/admin/handlers/<name>.ts`
2. Register it in `src/lib/admin/handlers/index.ts` with a path and allowed methods
3. Use `requirePermission(ctx, "CODE")` for authorization
4. Use `auditLog(ctx, action, resourceType, targetUserId?, resourceId?, metadata?)` for audit
5. Create the page in `src/app/admin/<page>/page.tsx`

### Adding a New Database Column

1. Create a new migration file in `supabase/migrations/`
2. Add the column with a safe default for existing rows
3. Update RLS policies if needed
4. Update the relevant TypeScript types

## Type System

Types are auto-generated from the database schema:

```bash
npx supabase gen types typescript --project-id <project-id> > src/lib/types/supabase.ts
```

The type file is referenced in:

- `src/lib/supabaseClient.ts`
- `src/lib/supabaseServer.ts`
- `src/lib/admin/server.ts`
- `src/lib/auth/supabaseServer.ts`

## Code Style

- **Components**: PascalCase, `.tsx` extension
- **Utilities**: camelCase, `.ts` extension
- **Tests**: `*.test.ts` / `*.test.tsx` next to source files
- **Admin handlers**: Registered in `handlers/index.ts` with path/method mapping
- **No comments**: Code is self-documenting; docs go in `docs/`

## Testing

```bash
npm test              # Full test suite
npx vitest --watch    # Watch mode
npx vitest run <file> # Single file
```

56 test files across: auth, admin, API routes, components, hooks, database, security, rate limiting, and integration.

Source: `vitest.config.mts`
