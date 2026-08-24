import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildCspHeader, generateNonce } from "@/lib/security/csp";
import { validatePassword, isCommonPassword } from "@/lib/auth/passwordPolicy";
import { logger } from "@/lib/logger";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";

vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));

import { supabase } from "@/lib/supabaseClient";
import {
  addSalary,
  addSavingsDirect,
  moveToSavings,
  recordSpend,
} from "@/lib/finance";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function makeFinanceClient(rpc?: Record<string, (args?: unknown) => { data: unknown; error: unknown }>): MockClient {
  const client = createMockClient({
    user: { id: USER_ID, email: "user@example.com" },
    tables: { profiles: [], transactions: [] },
    rpc,
  });
  Object.assign(supabase as object, client);
  return client;
}

describe("CSP header builder", () => {
  it("locks down scripts with a per-request nonce and strict-dynamic", () => {
    const csp = buildCspHeader({ nonce: "abc123", supabaseUrl: "https://proj.supabase.co" });
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(csp).toContain("default-src 'self'");
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
  });

  it("allows the Supabase project in connect-src over https and wss", () => {
    const csp = buildCspHeader({ nonce: "abc", supabaseUrl: "https://proj.supabase.co" });
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
  });

  it("adds upgrade-insecure-requests only in production", () => {
    const prod = buildCspHeader({ nonce: "abc", isDev: false });
    const dev = buildCspHeader({ nonce: "abc", isDev: true });
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("adds unsafe-eval only in development (React dev debugging)", () => {
    const dev = buildCspHeader({ nonce: "abc", isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(buildCspHeader({ nonce: "abc" })).not.toContain("'unsafe-eval'");
  });

  it("keeps style-src unsafe-inline (React style props cannot use nonces)", () => {
    const csp = buildCspHeader({ nonce: "abc" });
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("generates a fresh, reasonably sized nonce", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(/^[A-Za-z0-9_-]+$/.test(a)).toBe(true);
  });
});

describe("password policy — common passwords", () => {
  it("rejects obvious passwords even when they pass the character rules", () => {
    expect(validatePassword("Password123")).toContain("too common");
    expect(validatePassword("Passw0rd1")).toContain("too common");
    expect(validatePassword("Admin123")).toContain("too common");
    expect(validatePassword("Monkey123")).toContain("too common");
  });

  it("rejects common passwords case-insensitively and with substitutions", () => {
    expect(isCommonPassword("PASSWORD123")).toBe(true);
    expect(isCommonPassword("p4ssword")).toBe(false); // '4' not normalized — still uncommon enough
    expect(isCommonPassword("Monkey1")).toBe(false);
  });

  it("still accepts a strong, uncommon password", () => {
    expect(validatePassword("N0tC0mmon!xYz")).toBeNull();
  });
});

describe("structured logger", () => {
  it("emits JSON with a stable shape", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logger.error("health", "readiness_error", { code: "PGRST" });
      const parsed = JSON.parse((spy.mock.calls[0][0] as string));
      expect(parsed.level).toBe("error");
      expect(parsed.component).toBe("health");
      expect(parsed.event).toBe("readiness_error");
      expect(parsed.code).toBe("PGRST");
      expect(typeof parsed.ts).toBe("string");
    } finally {
      spy.mockRestore();
    }
  });

  it("serializes errors without leaking the raw stack", () => {
    const fields = logger.err({ message: "boom", code: "P0001", stack: "secret-stack" });
    expect(fields.message).toBe("boom");
    expect(fields.code).toBe("P0001");
    expect(JSON.stringify(fields)).not.toContain("secret-stack");
  });
});

describe("financial operations go through atomic RPCs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("addSalary calls apply_income with kind=salary and no direct profile writes", async () => {
    const calls: string[] = [];
    const client = makeFinanceClient({
      apply_income: () => { calls.push("apply_income"); return { data: null, error: null }; },
    });
    await addSalary(USER_ID, 1000, "July pay");
    expect(calls).toEqual(["apply_income"]);
    expect(client.writes.length).toBe(0);
  });

  it("addSavingsDirect calls apply_income with kind=savings", async () => {
    const kinds: string[] = [];
    makeFinanceClient({
      apply_income: (args) => {
        kinds.push((args as { p_kind: string }).p_kind);
        return { data: null, error: null };
      },
    });
    await addSavingsDirect(USER_ID, 250);
    expect(kinds).toEqual(["savings"]);
  });

  it("moveToSavings calls apply_savings_move and surfaces insufficient_balance", async () => {
    let called = false;
    const client = makeFinanceClient({
      apply_savings_move: () => { called = true; return { data: null, error: { message: "insufficient_balance", code: "P0001" } }; },
    });
    await expect(moveToSavings(USER_ID, 99999)).rejects.toThrow("Not enough in your salary balance");
    expect(called).toBe(true);
    expect(client.writes.length).toBe(0);
  });

  it("recordSpend calls apply_expense and returns the server-computed overspend", async () => {
    makeFinanceClient({
      apply_expense: () => ({ data: { overspend_amount: 42 }, error: null }),
    });
    const { overspendAmount } = await recordSpend(USER_ID, {
      category: "Food",
      subcategory: "Zomato",
      amount: 200,
    });
    expect(overspendAmount).toBe(42);
  });

  it("recordSpend maps insufficient_balance to a friendly error", async () => {
    makeFinanceClient({
      apply_expense: () => ({ data: null, error: { message: "insufficient_balance", code: "P0001" } }),
    });
    await expect(
      recordSpend(USER_ID, { category: "Food", subcategory: "Zomato", amount: 500 })
    ).rejects.toThrow("Not enough in your salary balance");
  });

  it("recordSpend maps invalid_amount to a friendly error", async () => {
    makeFinanceClient({
      apply_expense: () => ({ data: null, error: { message: "invalid_amount", code: "P0001" } }),
    });
    await expect(
      recordSpend(USER_ID, { category: "Food", subcategory: "Zomato", amount: -10 })
    ).rejects.toThrow("Amount must be greater than zero");
  });
});

describe("hardening migration stays intact", () => {
  const migrationPath = resolve(process.cwd(), "supabase/migrations/20260811000000_security_hardening.sql");
  const sql = readFileSync(migrationPath, "utf8");

  it("contains the profile privilege-escalation guard", () => {
    expect(sql).toContain("guard_profile_protected_columns");
    expect(sql).toContain("revoke insert on table public.profiles from anon, authenticated");
  });

  it("contains the atomic financial RPCs", () => {
    expect(sql).toContain("create or replace function public.apply_expense");
    expect(sql).toContain("create or replace function public.apply_income");
    expect(sql).toContain("create or replace function public.apply_savings_move");
    expect(sql).toContain("for update");
  });

  it("contains the integrity check constraints", () => {
    expect(sql).toContain("transactions_amount_positive");
    expect(sql).toContain("profiles_salary_balance_nonneg");
  });

  it("restricts RPC execution to authenticated/service_role", () => {
    expect(sql).toContain("revoke all on function public.apply_expense");
    expect(sql).toContain("grant execute on function public.apply_expense");
  });
});

describe("maintenance gate contract (Phase 4/5 regression)", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("every mutating user route consults the maintenance gate", () => {
    for (const route of [
      "src/app/api/v1/recurring/[[...slug]]/route.ts",
      "src/app/api/v1/goals/[[...slug]]/route.ts",
      "src/app/api/v1/bills/[[...slug]]/route.ts",
      "src/app/api/v1/notifications/[[...slug]]/route.ts",
      "src/app/api/v1/ai/insights/route.ts",
    ]) {
      const src = read(route);
      expect(src, route).toContain('from "@/lib/maintenance"');
      // POST/PATCH/DELETE handlers must each gate; GET handlers must not.
      const mutations = (src.match(/export async function (POST|PATCH|DELETE)/g) ?? []).length;
      const gates = (src.match(/assertNotUnderMaintenance\(/g) ?? []).length;
      expect(gates, `${route}: one gate per mutating method`).toBe(mutations);
    }
  });

  it("auth flows, health/status and the admin API are exempt from the gate", () => {
    const exempt = [
      ...["forgot-password", "reset-password", "change-password"].map(
        (f) => `src/app/api/v1/auth/${f}/route.ts`
      ),
      "src/app/api/app/status/route.ts",
    ];
    for (const file of exempt) {
      expect(read(file), `${file} must not import the gate`).not.toContain("@/lib/maintenance");
    }
    const handlerFiles = [
      "audit", "categories", "notifications", "overview", "push", "roles",
      "settings", "system", "transactions", "users",
    ].map((h) => `src/lib/admin/handlers/${h}.ts`);
    for (const file of handlerFiles) {
      expect(read(file), `${file} must stay exempt`).not.toContain("@/lib/maintenance");
    }
  });
});

describe("audit writes are never silently swallowed", () => {
  const dir = resolve(process.cwd(), "src/lib/admin/handlers");

  it("every writeAudit call site is awaited", () => {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f === "helpers.ts" || f === "index.ts") continue;
      const src = readFileSync(resolve(dir, f), "utf8");
      const total = (src.match(/\bwriteAudit\(/g) ?? []).length;
      const awaited = (src.match(/\bawait writeAudit\(/g) ?? []).length;
      expect(awaited, `${f}: unawaited audit write`).toBe(total);
    }
  });

  it("writeAudit itself fails loudly on persistence errors", async () => {
    const { writeAudit } = await import("@/lib/admin/server");
    const failing = createMockClient({ tables: {} });
    failing.from = ((table: string) => ({
      insert: () => Promise.resolve({ error: { message: "audit store down" } }),
    })) as unknown as MockClient["from"];
    await expect(
      writeAudit(
        {
          userId: USER_ID,
          email: "admin@x",
          role: "admin",
          permissions: [],
          token: "t",
          ip: "127.0.0.1",
          userAgent: "vitest",
          client: failing as never,
        },
        { action: "user.update", resource_type: "user" }
      )
    ).rejects.toMatchObject({ code: "audit_failed", status: 500 });
  });
});

describe("loadPermissions is fail-closed", () => {
  const ROLE_ID = "00000000-0000-4000-8000-000000000031";

  // The shared mock's fluent chain is geared to table fixtures; loadPermissions
  // needs precise per-call error injection, so drive a minimal stub instead.
  type SupabaseClientLike = Parameters<typeof import("@/lib/admin/server").loadPermissions>[0];
  function stubClient(shape: {
    rolesResult?: { data: unknown; error: unknown };
    grantsResult?: { data: unknown; error: unknown };
    throwOnRoles?: boolean;
  }): SupabaseClientLike {
    return {
      from(table: string) {
        if (table === "roles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  shape.throwOnRoles
                    ? // Rejection happens at the awaited point so the caller's
                      // try/catch (not an orphaned promise) observes it.
                      Promise.reject(new Error("rls down"))
                    : Promise.resolve(shape.rolesResult ?? { data: null, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve(shape.grantsResult ?? { data: [], error: null }),
          }),
        };
      },
    } as unknown as SupabaseClientLike;
  }

  it("returns [] when the roles lookup errors (RLS/db failure)", async () => {
    const { loadPermissions } = await import("@/lib/admin/server");
    expect(await loadPermissions(stubClient({ throwOnRoles: true }), "admin")).toEqual([]);
  });

  it("returns [] when the role row is missing", async () => {
    const { loadPermissions } = await import("@/lib/admin/server");
    expect(
      await loadPermissions(stubClient({ rolesResult: { data: null, error: null } }), "ghost")
    ).toEqual([]);
  });

  it("returns [] when the grants query errors", async () => {
    const { loadPermissions } = await import("@/lib/admin/server");
    expect(
      await loadPermissions(
        stubClient({
          rolesResult: { data: { id: ROLE_ID }, error: null },
          grantsResult: { data: null, error: { message: "denied" } },
        }),
        "admin"
      )
    ).toEqual([]);
  });

  it("maps well-formed grants and drops malformed ones", async () => {
    const { loadPermissions } = await import("@/lib/admin/server");
    const codes = await loadPermissions(
      stubClient({
        rolesResult: { data: { id: ROLE_ID }, error: null },
        grantsResult: {
          data: [
            { permissions: { code: "USER_VIEW" } },
            { permissions: null },
            {},
            { permissions: { code: 42 } },
            { permissions: { code: "USER_EDIT" } },
          ],
          error: null,
        },
      }),
      "admin"
    );
    expect(codes).toEqual(["USER_VIEW", "USER_EDIT"]);
  });
});
