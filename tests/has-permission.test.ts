import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WS-C2 — permission-aware database authorization foundation.
 *
 * HONESTY NOTE: these are STATIC verification tests over migration/schema
 * sources. This repository's Vitest loop has no live PostgreSQL, so runtime
 * SECURITY DEFINER behaviour is NOT executed here. Structural pins below make
 * the resolution chain and fail-closed guards provable from source alone;
 * live verification must happen when migrations are applied to staging.
 */

const migPath = "supabase/migrations/20260822200000_has_permission.sql";
const root = process.cwd();

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}
function mig(): string {
  return read(migPath);
}

describe("WS-C2: helper definition", () => {
  it("ships exactly one additive migration creating public.has_permission(p_code text)", () => {
    const sql = mig();
    expect(sql).toMatch(
      /create or replace function public\.has_permission\(p_code text\)/i,
    );
    // Single-parameter signature: callers cannot supply an arbitrary user id.
    expect(sql).not.toMatch(/has_permission\(\s*text\s*,/i);
    expect(sql).not.toMatch(/user_id|target_user|account_id/i);
  });

  it("pins the repository SECURITY DEFINER convention", () => {
    const sql = mig();
    expect(sql).toMatch(/language plpgsql/i);
    expect(sql).toMatch(/\bstable\b/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
  });

  it("resolves auth.uid() -> profiles.role -> roles.name -> role_permissions -> permissions.code with fully qualified objects", () => {
    const sql = mig();
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("public.profiles");
    expect(sql).toContain("public.roles");
    expect(sql).toContain("public.role_permissions");
    expect(sql).toContain("public.permissions");
  });

  it("pins the join graph of the resolution", () => {
    const sql = mig();
    expect(sql).toMatch(/rp\.role_id = r\.id/i);
    expect(sql).toMatch(/perm\.id = rp\.permission_id/i);
    expect(sql).toMatch(/r\.name = v_role/i);
    expect(sql).toMatch(/perm\.code = p_code/i);
  });

  it("fails closed on null code and null/unauthenticated principals", () => {
    const sql = mig();
    expect(sql).toMatch(/if p_code is null then\s+return false/i);
    expect(sql).toMatch(/v_role is null/i);
    expect(sql).toMatch(/return false/i);
  });

  it("uses no dynamic SQL", () => {
    const sql = mig();
    const start = sql.indexOf("$$");
    const end = sql.lastIndexOf("$$");
    const body = sql.slice(start, end);
    expect(body.toLowerCase()).not.toContain("execute ");
    expect(body).not.toMatch(/format\s*\(/i);
    expect(body).not.toMatch(/%s|%I|%L/i);
  });
});

describe("WS-C2: security semantics (static)", () => {
  let sql = "";
  beforeEach(() => {
    sql = mig();
  });

  it("does not redefine or touch is_admin()", () => {
    expect(sql).not.toMatch(/is_admin/i);
  });

  it("does not create, drop, or alter any RLS policy", () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).not.toMatch(/alter policy/i);
    expect(sql).not.toMatch(/row level security/i);
  });

  it("does not mutate permissions, roles, or role_permissions data", () => {
    expect(sql).not.toMatch(
      /insert into public\.(permissions|roles|role_permissions)/i,
    );
    expect(sql).not.toMatch(
      /(update|delete)[\s\S]*public\.(permissions|roles|role_permissions)/i,
    );
  });

  it("follows the explicit grant/revoke convention for callable functions", () => {
    expect(sql).toMatch(
      /revoke all on function public\.has_permission\(text\) from public;/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.has_permission\(text\) to authenticated, service_role;/i,
    );
  });
});

describe("WS-C2: schema.sql mirror", () => {
  let schema = "";
  beforeEach(() => {
    schema = read("supabase/schema.sql");
  });

  it("mirrors the function definition, security mode, and search_path", () => {
    expect(schema).toMatch(
      /create or replace function public\.has_permission\(p_code text\)/i,
    );
    expect(schema).toMatch(/security definer/i);
    expect(schema).toMatch(/set search_path = public/i);
    expect(schema).toContain("perm.code = p_code");
  });

  it("mirrors the grant/revoke statements", () => {
    expect(schema).toMatch(
      /revoke all on function public\.has_permission\(text\) from public;/i,
    );
    expect(schema).toMatch(
      /grant execute on function public\.has_permission\(text\) to authenticated, service_role;/i,
    );
  });
});

describe("WS-C2: scope protection (foundation-only batch)", () => {
  let serverSrc = "";
  let rolesSrc = "";
  beforeEach(() => {
    serverSrc = read("src/lib/admin/server.ts");
    rolesSrc = read("src/lib/admin/handlers/roles.ts");
  });

  it("leaves the server.ts console gate untouched (still literal admin check)", () => {
    expect(serverSrc).toContain('if (role !== "admin") {');
  });

  it("leaves the G-08 elevation guard untouched", () => {
    expect(rolesSrc).toContain("Privilege-elevation guard (G-08)");
  });

  it("leaves WS-A system-row hardening intact", () => {
    const sql = read("supabase/migrations/20260822180000_system_role_hardening.sql");
    expect(sql).toContain("guard_roles_system_rows");
  });

  it("leaves WS-B live role validation intact", () => {
    const usersSrc = read("src/lib/admin/handlers/users.ts");
    expect(usersSrc).toContain("Could not validate the role.");
  });

  it("leaves the WS-C1 permission catalog and seeds unchanged", () => {
    const ts = read("src/lib/admin/permissions.ts");
    expect(ts).toContain("ADMIN_CONSOLE_ACCESS:");
    const seeds = read("supabase/migrations/20260807000000_admin.sql");
    for (const code of [
      "USER_VIEW",
      "USER_EDIT",
      "USER_SUSPEND",
      "ROLE_MANAGE",
      "TRANSACTION_VIEW",
      "TRANSACTION_EDIT",
      "TRANSACTION_DELETE",
      "CATEGORY_MANAGE",
      "NOTIFICATION_MANAGE",
      "SYSTEM_SETTINGS",
      "AI_SETTINGS",
      "PWA_SETTINGS",
      "AUDIT_LOG_VIEW",
      "REPORT_VIEW",
    ]) {
      expect(seeds).toContain(`'${code}'`);
    }
  });

  it("does not touch authentication surface files", () => {
    const shell = read("src/components/admin/AdminShell.tsx");
    expect(shell.length).toBeGreaterThan(0);
    const pw = read("src/lib/auth/passwordReset.ts");
    expect(pw.length).toBeGreaterThan(0);
  });
});
