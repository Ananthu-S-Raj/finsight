# FinSight — Project Overview

## Purpose

FinSight is a premium personal finance tracker that helps users manage salary, savings, spending, credit cards, loans, budgets, and financial goals in a single, installable web application.

## Goals

- Provide a clean, fast, passbook-styled finance tracker
- Run entirely on free-tier infrastructure (Next.js + Supabase)
- Work offline as an installable PWA
- Offer optional AI-powered spending insights
- Include a full admin console for platform management

## Target Users

- Individual users tracking personal finances
- Administrators managing the platform and its users

## Major Features

| Feature | Description |
|---|---|
| Authentication | Email/password registration, OTP verification, password reset, session management |
| Dashboard | Balance overview, budget progress, recent transactions, goals, birthday greetings |
| Transactions | Create, search, filter, sort, paginate transactions with 6 types |
| Categories | Admin-managed category tree with 15 default categories |
| Budgets | Monthly budget tracking with overspend detection and salary deduction |
| Savings | Dedicated savings balance with add/move functionality |
| Goals | Financial goals with contributions, reminders, and status tracking |
| Recurring | Scheduled income/expense/transfer rules with confirmation workflow |
| Bills | Bill tracking with due dates, payment history, and reminders |
| Calendar | Monthly view with transactions, recurring events, and bills |
| Analytics | Expense trend charts, category breakdowns, CSV export |
| AI Insights | Optional server-side LLM analysis with on-device fallback |
| Notifications | In-app broadcast inbox with admin management |
| Push Notifications | Web push for daily reminders and overspend alerts |
| PWA | Installable, offline-capable with service worker caching |
| Admin Console | Platform management: users, roles, permissions, audit logs, settings |
| RBAC | Role-based access control with 15 granular permissions |
| Security | CSP nonces, RLS, rate limiting, session invalidation, audit logging |

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14.2 (App Router), React 18, TypeScript 5.5, Tailwind CSS 3.4 |
| Backend | Next.js API routes (Node.js runtime) |
| Database | Supabase (PostgreSQL 15+) |
| Authentication | Supabase Auth (email/password, OTP) |
| Hosting | Render Web Service (or Vercel) |
| PWA | Service worker, Web App Manifest, Web Push (VAPID) |
| AI | OpenAI API / Ollama (optional) |
| Testing | Vitest 4.1, Playwright 1.62 |
| CI/CD | GitHub Actions |

## Architecture Summary

```
Browser
  ↓
Next.js (App Router + API routes)
  ↓
Supabase Client (anon key + RLS)
  ↓
Supabase (PostgreSQL + Auth + Edge Functions)
```

- **Client-side rendering** for all pages (nonce-based CSP requires dynamic rendering)
- **RLS-enforced data access** — every query is scoped to the authenticated user
- **Admin routes** use a separate authorization layer with role + permission checks
- **No service-role key** in the Next.js application — only Edge Functions use it

## Security Model

- Per-request CSP nonces prevent XSS
- RLS ensures users can only access their own data
- Admin endpoints require JWT + admin role + granular permissions
- Session invalidation via `password_changed_at` JWT iat guard
- Rate limiting on auth, AI, and admin endpoints
- Audit logging for all admin mutations
- No secrets in client bundles

## Deployment Model

- **Frontend + API**: Render Web Service (single process)
- **Database + Auth**: Supabase (managed PostgreSQL + GoTrue)
- **Scheduled tasks**: Supabase Edge Functions triggered by pg_cron
- **CI**: GitHub Actions (lint, test, build)

## Current Status

- 799 tests passing across 56 test suites
- Production build verified
- Deployment-ready for Render
- All security hardening passes completed

## Known Limitations

- Rate limiting is per-process (single-instance deployment on Render Free)
- Render Free tier spins down after 15 minutes of inactivity (cold start ~30-60s)
- AI insights depend on external API availability (OpenAI/Ollama)
- Push notifications depend on browser push service delivery
- Email template behavior (OTP vs magic link) depends on Supabase Dashboard configuration
