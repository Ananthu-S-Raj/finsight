import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { supabase } from "@/lib/supabaseClient";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import { addSalary, recordSpend, moveToSavings, addSavingsDirect } from "@/lib/finance";
import { USER_A_ID } from "./helpers/fixtures";

vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

function sql(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
}

function makeClient(opts: Parameters<typeof createMockClient>[0] = {}): MockClient {
  const client = createMockClient(opts);
  Object.assign(supabase, client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("migration set", () => {
  it("ships all expected migrations", () => {
    expect(migrations).toEqual(
      expect.arrayContaining([
        "20260807000000_admin.sql",
        "20260807000001_admin_stats.sql",
        "20260807000002_admin_extra.sql",
        "20260810000000_password_reset.sql",
        "20260811000000_security_hardening.sql",
        "20260811000001_recurring.sql",
        "20260812000000_bills_and_calendar.sql",
        "20260813000000_financial_goals.sql",
        "20260612_add_custom_categories_and_transaction_search.sql",
      ])
    );
  });
});

describe("password-reset tokens — single use, expiring, hashed", () => {
  const resetSql = sql("20260810000000_password_reset.sql");

  it("stores only a token hash (unique), never the raw token", () => {
    expect(resetSql).toMatch(/token_hash text unique/i);
    expect(resetSql).toMatch(/-- SHA-256 of the recovery token/i);
  });

  it("locks the token table behind row-level security", () => {
    expect(resetSql).toMatch(/enable row level security/i);
  });

  it("links tokens to auth.users with cascade delete", () => {
    expect(resetSql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  });

  it("expires tokens and enforces single-use atomically", () => {
    expect(resetSql).toMatch(/expires_at timestamptz not null/i);
    // A token is usable only once: pending row (null hash) is claimed by the
    // single UPDATE, and a reused hash is rejected because it no longer
    // matches a pending row.
    expect(resetSql).toContain("token_hash is null");
    expect(resetSql).toContain("expires_at > now()");
    expect(resetSql).toMatch(/update public\.password_reset_tokens/i);
  });
});

describe("password-reset token hashing (lib level)", () => {
  it("hashes to the standard SHA-256 hex (deterministic, non-reversible)", async () => {
    const { sha256Hex } = await import("@/lib/auth/passwordReset");
    // Known NIST vector for "abc".
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("admin schema — referential integrity and uniqueness", () => {
  const adminSql = sql("20260807000000_admin.sql");

  it("roles and permissions have unique names/codes", () => {
    expect(adminSql).toMatch(/name text not null unique/i);
    expect(adminSql).toMatch(/code text not null unique/i);
  });

  it("role_permissions references roles and permissions with cascade", () => {
    expect(adminSql).toContain("role_id uuid not null references public.roles(id) on delete cascade");
    expect(adminSql).toContain("permission_id uuid not null references public.permissions(id) on delete cascade");
  });

  it("categories prevent duplicate names within a parent", () => {
    expect(adminSql).toContain("unique (parent_id, name)");
  });

  it("audit_logs links actors and targets to auth.users", () => {
    expect(adminSql).toContain("actor_id uuid not null references auth.users(id) on delete set null");
    expect(adminSql).toContain("target_user_id uuid references auth.users(id) on delete set null");
  });
});

describe("financial atomicity — failed RPCs leave no partial writes", () => {
  it("a rejected expense RPC throws (defensive mapping) and records no transaction row", async () => {
    // apply_expense never rejects for insufficient_balance under the
    // full-deduction model, but the RPC layer maps ANY server rejection
    // faithfully — a rejected spend must error and write nothing, never be
    // silently swallowed.
    const client = makeClient({
      tables: { transactions: [], profiles: [] },
      rpc: { apply_expense: () => ({ data: null, error: { message: "insufficient_balance" } }) },
    });
    await expect(
      recordSpend(USER_A_ID, { category: "Food", subcategory: "Restaurants", amount: 999999 })
    ).rejects.toThrow(/Not enough in your salary balance/);
    expect(client.writes.filter((w) => w.table === "transactions")).toHaveLength(0);
  });

  it("a rejected savings move throws and writes nothing", async () => {
    const client = makeClient({
      tables: { profiles: [], transactions: [] },
      rpc: { apply_savings_move: () => ({ data: null, error: { message: "invalid_amount" } }) },
    });
    await expect(moveToSavings(USER_A_ID, -5)).rejects.toThrow(/greater than zero/);
    expect(client.writes).toHaveLength(0);
  });

  it("salary/savings income writes go through apply_income (single atomic path), never direct profile writes", async () => {
    const client = makeClient({
      tables: { profiles: [], transactions: [] },
      rpc: {
        apply_income: () => {
          client.writes.push({ table: "profiles", kind: "update", payload: { salary_balance: 1 }, filters: [] });
          return { data: null, error: null };
        },
      },
    });
    // Simulating the RPC doing the balance update internally is the server's
    // job; the client must NOT bypass it. addSalary may only call the RPC.
    const rpcCalls: string[] = [];
    const client2 = makeClient({
      tables: { profiles: [], transactions: [] },
      rpc: {
        apply_income: (a: { p_kind: string }) => {
          rpcCalls.push(a.p_kind);
          return { data: null, error: null };
        },
      },
    });
    await addSalary(USER_A_ID, 1000);
    await addSavingsDirect(USER_A_ID, 500);
    expect(rpcCalls).toEqual(["salary", "savings"]);
    expect(client2.writes.filter((w) => w.table === "profiles")).toHaveLength(0);
  });

  it("concurrent spends each route through the atomic RPC (no direct table writes)", async () => {
    const rpcCalls: unknown[] = [];
    makeClient({
      tables: { transactions: [], profiles: [] },
      rpc: {
        apply_expense: (a: unknown) => {
          rpcCalls.push(a);
          return { data: { overspend_amount: 0 }, error: null };
        },
      },
    });
    await Promise.all([
      recordSpend(USER_A_ID, { category: "Food", subcategory: "Zomato", amount: 100 }),
      recordSpend(USER_A_ID, { category: "Travel", subcategory: "Uber", amount: 200 }),
    ]);
    expect(rpcCalls).toHaveLength(2);
  });
});
