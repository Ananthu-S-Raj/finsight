# FinSight — Contributing

## Welcome

Thanks for considering contributing to FinSight! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js ≥ 18
- npm
- Supabase project (free tier is sufficient)

### Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd finsight

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your Supabase credentials

# Start development server
npm run dev
```

The dev server runs at `http://localhost:3000`.

## Project Structure

```
src/
├── app/           # Next.js App Router pages and API routes
├── components/    # React components
├── lib/           # Utilities, helpers, auth, admin, AI
tests/             # Vitest test suite
supabase/          # Database schema and migrations
docs/              # Documentation
public/            # Static assets, service worker, manifest
```

## Making Changes

### Code Style

- **Components**: PascalCase, `.tsx` extension
- **Utilities**: camelCase, `.ts` extension
- **Tests**: `*.test.ts` / `*.test.tsx` next to source files or in `tests/`
- **No comments**: Code is self-documenting; documentation goes in `docs/`

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

### Adding a New Component

1. Look at existing components for patterns
2. Use existing UI primitives from `src/components/ui/`
3. Add tests if the component has complex logic
4. Export from the component's directory

## Testing

```bash
npm test              # Full test suite
npx vitest --watch    # Watch mode
npx vitest run <file> # Single file
```

**Current status**: 799 tests passing across 56 test suites.

### Writing Tests

- Use Vitest globals (`describe`, `it`, `expect`, `vi`)
- Mock external dependencies (Supabase, Next.js)
- Test both success and error paths
- Keep tests isolated (no shared state)

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run the full test suite: `npm test`
5. Run the linter: `npm run lint`
6. Ensure the build succeeds: `npm run build`
7. Submit a pull request

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] New features have tests
- [ ] Documentation is updated (if applicable)
- [ ] No secrets or credentials are committed

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include steps to reproduce for bugs
- Include expected vs actual behavior
- Include environment details (OS, browser, Node version)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Welcome newcomers

## Questions?

If you have questions about contributing, feel free to open a GitHub Issue or reach out to the maintainers.
