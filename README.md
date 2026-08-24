# FinSight — Smart Personal Finance & Expense Tracker

A passbook-styled personal finance tracker: salary, savings, spending presets, credit card spend, loans, overspend-to-salary deduction, daily reminders, and an installable PWA. Frontend is Next.js; backend/auth/database is Supabase — both free to run.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your Supabase credentials

# Start development server
npm run dev
```

Visit `http://localhost:3000`, register, enter the OTP from your email, and you're in.

## Documentation

| Document | Description |
|---|---|
| [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md) | High-level project overview |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design |
| [docs/FEATURES.md](docs/FEATURES.md) | Feature inventory |
| [docs/DATABASE.md](docs/DATABASE.md) | Database schema, tables, functions, triggers |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Auth flows, sessions, security |
| [docs/RBAC.md](docs/RBAC.md) | Role-based access control |
| [docs/ADMIN-CONSOLE.md](docs/ADMIN-CONSOLE.md) | Admin console documentation |
| [docs/API.md](docs/API.md) | API reference |
| [docs/PWA.md](docs/PWA.md) | Progressive Web App documentation |
| [docs/SECURITY.md](docs/SECURITY.md) | Security measures and practices |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Environment variables |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Development setup and workflow |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment guide |
| [docs/TESTING.md](docs/TESTING.md) | Testing framework and patterns |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and fixes |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Version history |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Contributing guide |

## Features

- **Dashboard**: Real-time financial overview with balance cards, income/expense trends, category breakdown
- **Transactions**: Paginated list with search, filter, sort, CSV export, overspend tracking
- **Budgets**: Monthly budget tracking with category breakdown, spending velocity
- **Bills**: One-time and recurring bill management with payment history and reminders
- **Goals**: Financial savings goals with contributions, progress tracking, deadline reminders
- **Recurring**: Calendar-correct recurrence engine with pending confirmation workflow
- **Notifications**: In-app notification inbox with push notification support
- **Admin Console**: Platform management (users, transactions, categories, roles, notifications, audit, settings)
- **PWA**: Offline support, installability, push notifications
- **AI Insights**: Server-generated spending analysis (OpenAI/Ollama)
- **Security**: Nonce-based CSP, RLS on all tables, RBAC, audit logging

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, Recharts |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL with RLS) |
| Auth | Supabase Auth (JWT-based) |
| AI | OpenAI API / Ollama (local fallback) |
| PWA | Service Worker, Web Push API, VAPID |
| Testing | Vitest |
| Deployment | Render Free Web Service |
| CI | GitHub Actions |

## Setup Guides

### Supabase Setup

1. Go to supabase.com → New project (free tier)
2. Open SQL Editor → paste contents of `supabase/schema.sql` → Run
3. Enable email/password sign-in under Authentication → Providers → Email
4. Configure email templates under Authentication → Email Templates
5. Copy Project URL and anon public key from Project Settings → API

### Environment Variables

```bash
cp .env.local.example .env.local
```

Required:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key

Optional:
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — For push notifications
- `OPENAI_API_KEY` — For AI insights

See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for full reference.

### Push Notifications (Optional)

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Deploy the Edge Function: `npx supabase functions deploy daily-reminder`
3. Enable `pg_cron` and `pg_net` extensions in Supabase
4. Run the cron schedule from `supabase/schema.sql`

### AI Insights (Optional)

Add to `.env.local`:
```
AI_ENABLED=true
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for details.

## How the Money Logic Works

- **Salary balance** goes up when you add salary or receive a loan, and down when you move money to savings or overspend your monthly budget
- **Savings balance** goes up when you add savings directly or move money from salary; it's never touched by spending
- **Monthly budget** is a number you set for how much you plan to spend this calendar month across every category combined
- Every spend is logged against a category preset. Once the running total for the month passes your budget, the overspill amount is subtracted from your salary balance
- Loans received are added to your salary balance, tagged with who it's from

## Project Structure

```
src/
├── app/              Next.js pages (login, register, verify, dashboard, admin, settings)
├── components/       UI pieces (balance card, spend panel, modals, transaction rows, admin)
├── lib/              Utilities, auth, admin, AI, helpers
tests/                Vitest test suite (56 files, 799 tests)
supabase/
├── schema.sql        Database schema + RLS policies + auto-profile trigger
├── migrations/       16 migration files
public/
├── manifest.json     PWA manifest
├── sw.js             Service worker
└── icons/            PWA icons
docs/                 This documentation
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm test` | Run test suite |
| `npm run lint` | Run ESLint |

## License

Private — All rights reserved.
