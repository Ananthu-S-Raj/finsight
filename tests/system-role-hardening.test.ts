import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WS-A — system-role hardening + profiles.role FK (static schema assertions).
 *
 * Test-infrastructure limitation (documented per phase mandate): vitest runs
 * against the supabase-mock, not a live Postgres instance, so real
 * constraint/trigger behaviour cannot be executed here. These tests pin the
 * migration's DDL text — the strongest available assertion layer in this repo
 * (same precedent as bills/goals/recurring/security-harden static scans) —
 * while behavioural guarantees (existing role grants keep working, admin/user
 * authentication unchanged) are covered by the existing suites staying green:
 *   - tests/role-permissions.test.ts        (grant/revoke + RLS-shape pins)
 *   - tests/role-grant-elevation.test.ts    (G-08 elevation guard)
 *   - tests/security-harden.test.ts         (loadPermissions fail-closed)
 *   - tests/auth-*.test.ts                  (authentication ordering)
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const HARDENING = "20260822180000_system_role_hardening.sql";

function sqlFile(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
}

function bodyBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) return "";
  const end = source.indexOf(endMarker, start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

describe("WS-A hardening migration ships", () => {
  it("adds 20260822180000_system_role_hardening.sql to the migration set", () => {
    expect(existsSync(resolve(MIGRATIONS_DIR, HARDENING))).toBe(true);
  });
});

describe("A. system roles are immutable at the database level", () => {
  let src = "";
  beforeEach(() => {
    src = sqlFile(HARDENING);
  });
  const fnBody = () => bodyBetween(src, "create or replace function public.guard_roles_system_rows", "$$;");

  it("installs a guard function on public.roles", () => {
    expect(fnBody()).toContain("guard_roles_system_rows");
  });

  it("attaches a BEFORE UPDATE OR DELETE row-level trigger", () => {
    expect(src).toMatch(/create trigger roles_guard_system_rows\s+before update or delete on public\.roles\s+for each row/i);
  });

  it("blocks deleting a system role", () => {
    expect(fnBody()).toMatch(/tg_op\s*=\s*'DELETE'/i);
    expect(fnBody()).toMatch(/old\.is_system[\s\S]{0,80}raise exception/i);
  });

  it("blocks renaming a system role", () => {
    expect(fnBody()).toMatch(/new\.name is distinct from old\.name/i);
  });

  it("blocks un-flagging a system role (is_system true -> false)", () => {
    expect(fnBody()).toMatch(/new\.is_system is distinct from old\.is_system/i);
  });

  it("raises a dedicated exception (fails closed for EVERY principal)", () => {
    expect(fnBody()).toMatch(/raise exception 'cannot_modify_system_role'/i);
    // Fail-closed mandate: no trusted-principal bypass may exist in the guard.
    expect(fnBody()).not.toMatch(/current_user|service_role|supabase_admin|postgres|is_admin\(\)/i);
  });

  it("leaves non-system rows and description edits untouched", () => {
    // The guard must key exclusively off old.is_system + name/is_system drift.
    expect(fnBody()).toMatch(/if old\.is_system\s+and \(\s*new\.name is distinct from old\.name\s+or new\.is_system is distinct from old\.is_system\s*\)/i);
  });
});

describe("B. profiles.role CHECK replaced by FK to public.roles(name)", () => {
  let src = "";
  beforeEach(() => {
    src = sqlFile(HARDENING);
  });

  it("drops the binary check constraint by its exact name", () => {
    expect(src).toMatch(/drop constraint if exists profiles_role_check/i);
  });

  it("adds profiles.role -> public.roles(name) foreign key", () => {
    expect(src).toMatch(/foreign key \(role\)\s+references public\.roles\(name\)/i);
  });

  it("prevents dangling references with ON DELETE RESTRICT", () => {
    expect(src).toMatch(/references public\.roles\(name\)[^;]*on delete restrict/i);
  });

  it("is additive/safe: rewrites no profile data", () => {
    expect(src).not.toMatch(/update\s+public\.profiles/i);
    expect(src).not.toMatch(/insert\s+into\s+public\.profiles/i);
  });
});

describe("scope guards — WS-A changes nothing else", () => {
  let src = "";
  beforeEach(() => {
    src = sqlFile(HARDENING);
  });

  it("touches no RLS policies", () => {
    expect(src).not.toMatch(/create policy|drop policy|alter policy|enable row level security|disable row level security/i);
  });

  it("touches no permission-matrix data", () => {
    expect(src).not.toMatch(/insert into public\.permissions|delete from public\.permissions|insert into public\.role_permissions|delete from public\.role_permissions/i);
  });

  it("does not redefine authentication semantics (is_admin / handle_new_user / guards)", () => {
    expect(src).not.toMatch(/create or replace function public\.(is_admin|handle_new_user|guard_profile_protected_columns|guard_transactions_protected_columns)\b/i);
  });

  it("keeps both seeded system roles intact in admin.sql", () => {
    const seeds = sqlFile("20260807000000_admin.sql");
    expect(seeds).toMatch(/\('user',\s*'Standard user[^']*',\s*true\)/i);
    expect(seeds).toMatch(/\('admin',\s*'Administrator[^']*',\s*true\)/i);
  });
});

describe("schema.sql mirrors the resulting schema exactly", () => {
  let mirror = "";
  beforeEach(() => {
    mirror = readFileSync(resolve(process.cwd(), "supabase/schema.sql"), "utf8");
  });

  it("no longer carries the binary role CHECK", () => {
    expect(mirror).not.toMatch(/check \(role in \('user', 'admin'\)\)/i);
  });

  it("carries the FK to roles(name)", () => {
    expect(mirror).toMatch(/foreign key \(role\)\s+references public\.roles\(name\)/i);
  });

  it("carries the system-role guard function and trigger", () => {
    expect(mirror).toContain("guard_roles_system_rows");
    expect(mirror).toMatch(/create trigger roles_guard_system_rows\s+before update or delete on public\.roles/i);
  });
});
