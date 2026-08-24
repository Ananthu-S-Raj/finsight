import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WS-C1 — capability-semantics lock-in.
 *
 * This phase intentionally changes NO production behaviour. These tests are
 * static/read-only architectural assertions that pin (a) the documented
 * semantics every later WS-C phase must honour, and (b) the current code
 * facts those semantics were derived from, so drift in either direction is
 * caught before WS-C2+ build on top of them.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const DOC_PATH = "docs/capability-semantics.md";

describe("WS-C1: capability-semantics document exists and locks the invariants", () => {
  const doc = () => read(DOC_PATH);

  it("ships docs/capability-semantics.md", () => {
    expect(existsSync(resolve(process.cwd(), DOC_PATH))).toBe(true);
  });

  it("records the delegation invariant: permissions(R) ⊆ effectivePermissions(actor)", () => {
    const d = doc();
    expect(d).toMatch(/permissions\(R\)\s*⊆\s*effectivePermissions\(actor\)/);
    expect(d).toMatch(/loadPermissions/i);
    expect(d).toMatch(/role_permissions/i);
  });

  it("records the admin invariant: ROLE_MANAGE alone must not mint admins", () => {
    const d = doc();
    expect(d).toMatch(/ROLE_MANAGE[\s\S]{0,200}must NOT[\s\S]{0,200}assign(?:ing)?[\s\S]{0,80}admin/i);
    expect(d).toMatch(/system role/i);
    expect(d).toMatch(/WS-C5/);
  });

  it("documents the current three-layer architecture verbatim", () => {
    const d = doc();
    expect(d).toContain('profile.role === "admin"');
    expect(d).toContain("loadPermissions(role)");
    expect(d).toContain("is_admin()");
  });

  it("maps the enforcement phases without promising early enforcement", () => {
    const d = doc();
    for (const phase of ["WS-C2", "WS-C3", "WS-C4", "WS-C5", "WS-C6"]) {
      expect(d).toContain(phase);
    }
    expect(d).toMatch(/DO NOT implement|not implemented in this phase|enforcement belongs to/i);
  });
});

describe("WS-C1: current-code facts the semantics were derived from", () => {
  it("console admission remains the literal binary role check", () => {
    expect(read("src/lib/admin/server.ts")).toMatch(/if \(role !== "admin"\)/);
  });

  it("the G-08 grant-time elevation guard remains in place", () => {
    expect(read("src/lib/admin/handlers/roles.ts")).toMatch(
      /if \(!ctx\.permissions\.includes\(permission\.code\)\)/
    );
  });

  it("role assignment validates against the live roles table (WS-B)", () => {
    const src = read("src/lib/admin/handlers/users.ts");
    expect(src).toMatch(/That role does not exist\./);
    expect(src).not.toMatch(/ALLOWED_ROLES\.includes\(role\)/);
  });

  it("documents the known assignment gap honestly: no runtime admin/delegation guard exists yet", () => {
    // The invariant is DECIDED but deliberately NOT enforced until WS-C5.
    // This pin makes the interim gap explicit instead of silent.
    const src = read("src/lib/admin/handlers/users.ts");
    expect(src).not.toMatch(/permission_escalation/); // guard lives only in roles.ts grants today
    const doc = read(DOC_PATH);
    expect(doc).toMatch(/known gap|interim|deferred to WS-C5|not yet enforced/i);
  });

  it("keeps the WS-A hardening markers intact", () => {
    const sql = read("supabase/migrations/20260822180000_system_role_hardening.sql");
    expect(sql).toContain("guard_roles_system_rows");
    expect(sql).toMatch(/references public\.roles\(name\)/i);
  });

  it("keeps the permission catalog in sync between DB seeds and the TS union", () => {
    // Combined DB seed state = original catalogue + WS-C1 capability seed.
    const sql =
      read("supabase/migrations/20260807000000_admin.sql") +
      read("supabase/migrations/20260822190000_admin_console_capability.sql");
    const ts = read("src/lib/admin/permissions.ts");
    // WS-C1 added ADMIN_CONSOLE_ACCESS to both sides (15 codes total).
    const seeded = [...sql.matchAll(/\('(USER_VIEW|USER_EDIT|USER_SUSPEND|ROLE_MANAGE|TRANSACTION_VIEW|TRANSACTION_EDIT|TRANSACTION_DELETE|CATEGORY_MANAGE|NOTIFICATION_MANAGE|SYSTEM_SETTINGS|AI_SETTINGS|PWA_SETTINGS|AUDIT_LOG_VIEW|REPORT_VIEW|ADMIN_CONSOLE_ACCESS)',/g)].map((m) => m[1]);
    expect(new Set(seeded).size).toBe(15);
    for (const code of seeded) {
      expect(ts).toContain(`${code}:`);
    }
  });
});
