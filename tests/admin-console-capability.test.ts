import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_LABELS } from "@/lib/admin/permissions";
import { createMockClient } from "./helpers/supabase-mock";
import { loadPermissions } from "@/lib/admin/server";

/**
 * WS-C1 — ADMIN_CONSOLE_ACCESS capability definition.
 *
 * Semantics (normative, docs/capability-semantics.md):
 *   "This role is authorized to enter the administrative console."
 * It does NOT confer full-admin authority, RLS bypass, permission granting,
 * role assignment, or system-role modification.
 *
 * This batch is seed/catalog only: until WS-C3, console admission remains the
 * literal role === "admin" check in server.ts and this permission has no gate
 * effect. Test-infrastructure note: vitest runs against supabase-mock (no live
 * Postgres), so seed state is pinned via the established static SQL assertions;
 * the one behavioural test proves loadPermissions treats the new code like any
 * other matrix entry.
 */

const MIGRATION = "20260822190000_admin_console_capability.sql";
const CODE = "ADMIN_CONSOLE_ACCESS";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const mig = () => read(`supabase/migrations/${MIGRATION}`);

describe("WS-C1: permission definition", () => {
  it("ships an additive migration", () => {
    expect(existsSync(resolve(process.cwd(), "supabase/migrations", MIGRATION))).toBe(true);
  });

  it("inserts exactly ADMIN_CONSOLE_ACCESS into the permissions catalogue", () => {
    expect(mig()).toMatch(/insert into public\.permissions \(code, description\)/i);
    expect(mig()).toMatch(/\('ADMIN_CONSOLE_ACCESS',/);
    expect(PERMISSIONS.ADMIN_CONSOLE_ACCESS).toBe(CODE);
  });

  it("carries a console-access description (not admin-omnipotence)", () => {
    const desc = mig().match(/'ADMIN_CONSOLE_ACCESS',\s*'([^']+)'/)?.[1] ?? "";
    expect(desc.toLowerCase()).toMatch(/console/);
    expect(desc.toLowerCase()).not.toMatch(/full|unrestricted|bypass|all permissions/);
    expect(PERMISSION_LABELS[CODE]).toBeTruthy();
  });

  it("uses the established natural-key idempotency convention", () => {
    expect(mig()).toMatch(/on conflict \(code\) do nothing/i);
  });
});

describe("WS-C1: seed assignment", () => {
  it("grants ADMIN_CONSOLE_ACCESS to the seeded admin role via natural-key join", () => {
    const grantBlock = mig().match(/insert into public\.role_permissions[\s\S]*?;/i)?.[0] ?? "";
    expect(grantBlock).toMatch(/where r\.name = 'admin'/i);
    expect(grantBlock).toMatch(/p\.code = 'ADMIN_CONSOLE_ACCESS'/i);
    expect(grantBlock).toMatch(/on conflict do nothing/i);
  });

  it("does NOT grant ADMIN_CONSOLE_ACCESS to the user role", () => {
    const grantBlock = mig().match(/insert into public\.role_permissions[\s\S]*?;/i)?.[0] ?? "";
    expect(grantBlock.toLowerCase()).not.toMatch(/name = 'user'/);
  });

  it("schema.sql mirrors the resulting seed state", () => {
    const mirror = read("supabase/schema.sql");
    expect(mirror).toMatch(/\('ADMIN_CONSOLE_ACCESS',/);
    // The blanket admin cross-join grant picks up the new row automatically;
    // there must be no user-targeted grant anywhere in the mirror.
    expect(mirror).not.toMatch(/r\.name = 'user'[^;]*ADMIN_CONSOLE_ACCESS/is);
  });

  it("loadPermissions treats the new code as a normal matrix entry", async () => {
    const client = createMockClient({
      tables: {
        roles: [{ id: "00000000-0000-4000-8000-000000000031", name: "admin" }],
        permissions: [
          { id: "00000000-0000-4000-8000-000000000401", code: "USER_VIEW" },
          { id: "00000000-0000-4000-8000-000000000402", code: CODE },
        ],
        role_permissions: [
          { role_id: "00000000-0000-4000-8000-000000000031", permission_id: "00000000-0000-4000-8000-000000000401" },
          { role_id: "00000000-0000-4000-8000-000000000031", permission_id: "00000000-0000-4000-8000-000000000402" },
        ],
      },
    });
    const perms = await loadPermissions(client as never, "admin");
    expect(perms).toContain(CODE);
    expect(perms).toContain("USER_VIEW");
  });
});

describe("WS-C1: existing catalogue preserved", () => {
  const LEGACY = [
    "USER_VIEW", "USER_EDIT", "USER_SUSPEND", "ROLE_MANAGE",
    "TRANSACTION_VIEW", "TRANSACTION_EDIT", "TRANSACTION_DELETE",
    "CATEGORY_MANAGE", "NOTIFICATION_MANAGE", "SYSTEM_SETTINGS",
    "AI_SETTINGS", "PWA_SETTINGS", "AUDIT_LOG_VIEW", "REPORT_VIEW",
  ] as const;

  it("keeps every existing permission code (no renames, no deletions)", () => {
    for (const code of LEGACY) expect(PERMISSIONS[code as keyof typeof PERMISSIONS]).toBe(code);
  });

  it("catalogue grows to exactly 16 codes (14 legacy + ADMIN_CONSOLE_ACCESS + BUG_REPORT_MANAGE)", () => {
    expect(ALL_PERMISSIONS.length).toBe(16);
    expect(new Set(ALL_PERMISSIONS).size).toBe(16);
  });

  it("adds only rows: no permission or relationship is modified or removed", () => {
    expect(mig()).not.toMatch(/delete from public\.(permissions|role_permissions)/i);
    expect(mig()).not.toMatch(/update public\.(permissions|role_permissions)/i);
    expect(mig()).toMatch(/on conflict/i); // additive upserts only
  });
});

describe("WS-C1: scope protection (definition-only batch)", () => {
  let src = "";
  beforeEach(() => {
    src = mig();
  });

  it("touches no RLS policies, triggers, or functions", () => {
    expect(src).not.toMatch(/create policy|drop policy|enable row level security/i);
    expect(src).not.toMatch(/create or replace function|create trigger|drop trigger/i);
    expect(src).not.toMatch(/is_admin/i);
  });

  it("touches no authentication or assignment behavior", () => {
    expect(src).not.toMatch(/profiles|auth\.users|jwt|session/i);
    const serverTs = read("src/lib/admin/server.ts");
    expect(serverTs).toMatch(/if \(role !== "admin"\)/); // literal gate still authoritative
    expect(read("src/lib/admin/handlers/users.ts")).not.toMatch(/ADMIN_CONSOLE_ACCESS/);
  });

  it("creates no role CRUD routes or custom-role behavior", () => {
    expect(read("src/lib/admin/handlers/index.ts")).not.toMatch(/ADMIN_CONSOLE_ACCESS|"POST", segments: \["roles"\]/i);
    const handlersDir = read("src/lib/admin/handlers/roles.ts");
    expect(handlersDir).not.toMatch(/ADMIN_CONSOLE_ACCESS/);
  });

  it("keeps the semantics document authoritative about the deferred gate swap", () => {
    const doc = read("docs/capability-semantics.md");
    expect(doc).toContain(CODE);
    expect(doc).toMatch(/WS-C3/);
    expect(doc).toMatch(/NOT YET authoritative|not yet authoritative|until WS-C3/i);
  });
});
