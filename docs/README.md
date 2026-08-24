# FinSight — Documentation

Welcome to the FinSight documentation. This directory contains comprehensive documentation covering architecture, deployment, development, and operations.

## Quick Links

| Document | Description |
|---|---|
| [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md) | High-level project overview |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture and design |
| [FEATURES.md](FEATURES.md) | Feature inventory |
| [DATABASE.md](DATABASE.md) | Database schema, tables, functions, triggers |
| [AUTHENTICATION.md](AUTHENTICATION.md) | Auth flows, sessions, security |
| [RBAC.md](RBAC.md) | Role-based access control |
| [ADMIN-CONSOLE.md](ADMIN-CONSOLE.md) | Admin console documentation |
| [API.md](API.md) | API reference |
| [PWA.md](PWA.md) | Progressive Web App documentation |
| [SECURITY.md](SECURITY.md) | Security measures and practices |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Environment variables |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Development setup and workflow |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment guide |
| [TESTING.md](TESTING.md) | Testing framework and patterns |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and fixes |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributing guide |

## Architecture at a Glance

```
Browser → Next.js (Render Free Web Service) → Supabase (PostgreSQL + Auth + Edge Functions)
                ↓                                        ↓
        Service Worker (cache)                  Row Level Security (65 policies)
                ↓                                        ↓
        Push Notifications ←─────────────────── Supabase Edge Functions (cron)
```

## Key Technologies

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

## Documentation Standards

- All documentation is source-of-truth based
- Unverifiable items are explicitly marked
- No secrets or credentials are included
- Code references include file paths and line numbers
- Documentation is generated from actual source code inspection
