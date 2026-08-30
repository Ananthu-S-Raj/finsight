import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Behavior + contract tests for the push_subscriptions migration. The table and
// its policies previously existed only in schema.sql, so projects provisioned
// from migrations alone had no push_subscriptions table — this migration makes
// the schema migration-first and idempotent.
const MIGRATION = join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260902000000_push_subscriptions.sql"
);

const sql = readFileSync(MIGRATION, "utf8");

describe("push_subscriptions migration (20260902000000)", () => {
  it("creates the table if it does not exist (safe on schema.sql databases)", () => {
    expect(sql).toMatch(/create table if not exists public\.push_subscriptions/);
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(sql).toMatch(/subscription jsonb not null/);
    expect(sql).toMatch(/prefs jsonb not null default '{}'::jsonb/);
  });

  it("adds the prefs column on databases that predate it", () => {
    expect(sql).toMatch(/alter table public\.push_subscriptions\s+add column if not exists prefs/);
  });

  it("enforces one row per endpoint via an expression unique index", () => {
    expect(sql).toMatch(/unique index push_subscriptions_endpoint_idx/);
    expect(sql).toMatch(/\(\(subscription ->> 'endpoint'\)\)/);
    // The index is guarded so an existing schema.sql index cannot conflict.
    expect(sql).toMatch(/if not exists \(/);
    expect(sql).toMatch(/indexname = 'push_subscriptions_endpoint_idx'/);
  });

  it("enables row level security", () => {
    expect(sql).toMatch(/alter table public\.push_subscriptions enable row level security/);
  });

  it("scopes user policies to the caller (auth.uid() = user_id) — no weaker policy", () => {
    for (const op of ["read", "insert", "delete"]) {
      expect(sql).toMatch(new RegExp(`create policy "push: ${op} own" on public\\.push_subscriptions`, "i"));
    }
    expect(sql).toMatch(/for select using \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/for insert with check \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/for delete using \(auth\.uid\(\) = user_id\)/);
    // The endpoint index is expression-based; per-user isolation is enforced by
    // RLS, so a second user can never read or delete another user's row.
  });

  it("gives admins read + delete only (never write)", () => {
    expect(sql).toMatch(/create policy "push: admin read" on public\.push_subscriptions\s+for select using \(public\.is_admin\(\)\)/);
    expect(sql).toMatch(/create policy "push: admin delete" on public\.push_subscriptions\s+for delete using \(public\.is_admin\(\)\)/);
    expect(sql).not.toMatch(/push: admin update/);
    expect(sql).not.toMatch(/push: admin insert/);
  });

  it("is idempotent — policies are dropped before being recreated", () => {
    for (const name of ["push: read own", "push: insert own", "push: delete own", "push: admin read", "push: admin delete"]) {
      expect(sql).toMatch(new RegExp(`drop policy if exists "${name}" on public\\.push_subscriptions`));
      expect(sql).toMatch(new RegExp(`create policy "${name}" on public\\.push_subscriptions`));
    }
  });

  it("does not grant execute/table access it should not (DLP: nothing extra)", () => {
    expect(sql).not.toMatch(/grant /i);
  });
});