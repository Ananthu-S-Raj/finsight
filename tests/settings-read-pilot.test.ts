import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WS-C2-PILOT — first permission-aware RLS surface.
 *
 * Selected pilot: policy "settings: admin read" on public.app_settings.
 * Old: for select using (public.is_admin())
 * New: for select using (public.has_permission('SYSTEM_SETTINGS'))
 *
 * HONESTY NOTE: static verification only. This repository's Vitest loop has
 * no live PostgreSQL; RLS execution is NOT verified here. The staging query
 * sequence for live verification ships in the phase report.
 */

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}
function mig(): string {
  return read("supabase/migrations/20260822210000_settings_read_pilot_rls.sql");
}
function migCode(): string {
  return mig()
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
function schema(): string {
  return read("supabase/schema.sql");
}

describe("WS-C2-PILOT: pilot policy definition", () => {
  it("ships exactly one additive migration", () => {
    expect(mig()).toContain("WS-C2-PILOT");
  });

  it("rewrites ONLY the settings read policy onto the permission-aware helper", () => {
    const sql = mig();
    expect(sql).toMatch(
      /drop policy if exists "settings: admin read" on public\.app_settings/i,
    );
    expect(sql).toMatch(
      /create policy "settings: admin read" on public\.app_settings\s+for select using \(public\.has_permission\('SYSTEM_SETTINGS'\)\);/i,
    );
    // No other policy name may appear anywhere in this migration.
    const names = [
      ...sql.matchAll(/(?:drop|create) policy (?:if exists )?"([^"]+)"/gi),
    ].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(["settings: admin read"]));
  });

  it("does not touch write paths on app_settings", () => {
    const code = migCode();
    expect(code).not.toMatch(/settings: admin insert/i);
    expect(code).not.toMatch(/settings: admin update/i);
    expect(code).not.toMatch(/for update|for insert|for delete/i);
  });
});

describe("WS-C2-PILOT: semantics preserved and granted narrowly", () => {
  it("preserves admin behavior through the seeded SYSTEM_SETTINGS grant", () => {
    // Admin keeps access because the WS-C0 seed cross-join grants every
    // permission (incl. SYSTEM_SETTINGS) to the admin role — not because of
    // any remaining role-name shortcut in this policy.
    const seeds = read("supabase/migrations/20260807000000_admin.sql");
    expect(seeds).toContain("'SYSTEM_SETTINGS'");
    expect(seeds).toMatch(/r\.name = 'admin'/i);
    const code = migCode();
    expect(code).not.toMatch(/is_admin/i);
  });

  it("keeps plain users denied (user role holds no permissions)", () => {
    const seeds = read("supabase/migrations/20260807000000_admin.sql");
    expect(seeds).not.toMatch(/name = 'user'[\s\S]{0,400}insert into[\s\S]{0,200}role_permissions/i);
    const sql = mig();
    expect(sql).not.toMatch(/name = 'user'/i);
  });

  it("grants capability strictly via role_permissions resolution (custom-role ready)", () => {
    const helper = read("supabase/migrations/20260822200000_has_permission.sql");
    // Custom role + grant -> true; custom role without grant -> false;
    // unrelated codes -> false: all three follow from the code-equality join.
    expect(helper).toMatch(/perm\.code = p_code/i);
    expect(helper).toMatch(/rp\.role_id = r\.id/i);
    expect(helper).toMatch(/perm\.id = rp\.permission_id/i);
  });

  it("resolves the principal from auth.uid(), never a caller-supplied id", () => {
    const helper = read("supabase/migrations/20260822200000_has_permission.sql");
    expect(helper).toContain("p.id = auth.uid()");
    expect(helper).not.toMatch(/user_id|target_user/i);
    const policy = mig();
    expect(policy).not.toMatch(/auth\.uid/);
  });

  it("introduces no privilege-escalation mutation surface", () => {
    const code = migCode();
    expect(code).not.toMatch(
      /insert into|update |delete from|grant |revoke /i,
    );
  });
});

describe("WS-C2-PILOT: blast-radius containment", () => {
  it("leaves is_admin() itself and every unrelated is_admin()-based policy intact", () => {
    const s = schema();
    // is_admin() definition survives exactly once, unchanged.
    expect(s.match(/create or replace function public\.is_admin/g)?.length).toBe(
      1,
    );
    // Baseline 37 usages = 31 policy expressions + 6 RPC/function guards.
    // Exactly one migrates off is_admin(): "settings: admin read" -> 36.
    const uses = s.match(/public\.is_admin\(\)/g)?.length ?? 0;
    expect(uses).toBe(36);
    // Every sibling admin policy remains is_admin()-based, by name.
    const siblings = [
      ["profiles: admin read", "public.profiles"],
      ["profiles: admin update", "public.profiles"],
      ["transactions: admin read", "public.transactions"],
      ["transactions: admin delete", "public.transactions"],
      ["push: admin read", "public.push_subscriptions"],
      ["push: admin delete", "public.push_subscriptions"],
      ["roles: admin insert", "public.roles"],
      ["roles: admin update", "public.roles"],
      ["roles: admin delete", "public.roles"],
      ["audit: admin insert", "public.audit_logs"],
      ["audit: admin read", "public.audit_logs"],
      ["settings: admin insert", "public.app_settings"],
      ["settings: admin update", "public.app_settings"],
      ["notifications: admin select", "public.admin_notifications"],
      ["notifications: admin delete", "public.admin_notifications"],
      ["categories: admin insert", "public.categories"],
      ["categories: admin update", "public.categories"],
      ["categories: admin delete", "public.categories"],
    ];
    for (const [name, table] of siblings) {
      const re = new RegExp(
        `create policy "${name}" on ${table.replace(".", "\\.")}[\\s\\S]{0,120}public\\.is_admin\\(\\)`,
        "i",
      );
      expect(re.test(s)).toBe(true);
    }
  });

  it("keeps the recursion-proofing of the helper (definer + pinned search_path)", () => {
    const helper = read("supabase/migrations/20260822200000_has_permission.sql");
    expect(helper).toMatch(/security definer/i);
    expect(helper).toMatch(/set search_path = public/i);
  });

  it("mirrors the resulting policy state into schema.sql", () => {
    const s = schema();
    expect(s).toMatch(
      /create policy "settings: admin read" on public\.app_settings\s+for select using \(public\.has_permission\('SYSTEM_SETTINGS'\)\);/i,
    );
    expect(s).not.toMatch(
      /create policy "settings: admin read" on public\.app_settings\s+for select using \(public\.is_admin\(\)\);/i,
    );
  });
});

describe("WS-C2-PILOT: scope protection", () => {
  it("touches neither console gate nor authentication nor assignment surfaces", () => {
    expect(read("src/lib/admin/server.ts")).toContain('if (role !== "admin") {');
    expect(read("src/lib/admin/handlers/users.ts")).toContain(
      "Could not validate the role.",
    );
    expect(read("src/lib/admin/handlers/roles.ts")).toContain(
      "Privilege-elevation guard (G-08)",
    );
  });

  it("modifies no seed or catalog data", () => {
    const ts = read("src/lib/admin/permissions.ts");
    expect(ts).toContain("ADMIN_CONSOLE_ACCESS:");
    const seeds = read("supabase/migrations/20260807000000_admin.sql");
    expect(seeds).toContain("'REPORT_VIEW'");
  });
});
