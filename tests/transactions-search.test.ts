import { describe, it, expect } from "vitest";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import { dbListTransactions } from "@/lib/transactionsServer";
import {
  parseSearchParams,
  encodeCursor,
  decodeCursor,
  type TransactionFilters,
  type ListCursor,
} from "@/lib/transactions";
import { USER_A_ID, USER_B_ID } from "./helpers/fixtures";

type SeedRow = Record<string, unknown>;

function tx(
  id: string,
  date: string,
  type: string,
  amount: number,
  note: string | null,
  category: string | null,
  subcategory: string | null,
  user: string = USER_A_ID
): SeedRow {
  return {
    id,
    user_id: user,
    date,
    created_at: `${date}T10:00:00.000Z`,
    type,
    amount,
    overspend_amount: 0,
    note,
    category,
    subcategory,
    recurring_id: null,
  };
}

const SEED: SeedRow[] = [
  tx("t1", "2026-02-15", "expense", 500, "dinner with friends", "Food", "Restaurants"),
  tx("t2", "2026-02-16", "credit_card", 1500, "amazon order", "Shopping", "Amazon"),
  tx("t3", "2026-01-30", "expense", 120, "bus to office", "Travel", "Bus"),
  tx("t4", "2026-03-01", "salary_add", 80000, "March salary", "Salary", null),
  tx("t5", "2026-02-01", "expense", 90, "swiggy lunch", "Food", "Zomato"),
  tx("t6", "2026-02-20", "savings_move", 10000, null, "Savings", null),
  tx("t7", "2026-02-28", "expense", 200, "laundry", "Other", "Other expense"),
  tx("u1", "2026-02-15", "expense", 999, "swiggy for b", "Food", "Zomato", USER_B_ID),
];

function client(): MockClient {
  return createMockClient({ tables: { transactions: SEED.map((r) => ({ ...r })) } });
}

const page = async (c: MockClient, filters: TransactionFilters, cursor: ListCursor | null = null, limit = 10) =>
  dbListTransactions(c as never, USER_A_ID, filters, cursor, limit);

describe("dbListTransactions — filtering", () => {
  it("lists the caller's transactions newest-first by default", async () => {
    const res = await page(client(), {});
    expect(res.items.map((r) => r.id)).toEqual(["t4", "t7", "t6", "t2", "t1", "t5", "t3"]);
    expect(res.items.every((r) => r.amount === Number(r.amount))).toBe(true);
    // Another user's rows are never visible.
    expect(res.items.map((r) => r.id)).not.toContain("u1");
  });

  it("filters by type", async () => {
    const res = await page(client(), { type: "expense" });
    expect(res.items.map((r) => r.id)).toEqual(["t7", "t1", "t5", "t3"]);
  });

  it("filters by category name", async () => {
    const res = await page(client(), { category: "Food" });
    expect(res.items.map((r) => r.id)).toEqual(["t1", "t5"]);
  });

  it("filters by amount range", async () => {
    const res = await page(client(), { min: 1000 });
    expect(res.items.map((r) => r.id)).toEqual(["t4", "t6", "t2"]);
    const band = await page(client(), { min: 100, max: 600 });
    expect(band.items.map((r) => r.id)).toEqual(["t7", "t1", "t3"]);
  });

  it("filters by date range (open-ended and bounded)", async () => {
    const open = await page(client(), { range: "[2026-02-01" });
    expect(open.items.map((r) => r.id)).toEqual(["t4", "t7", "t6", "t2", "t1", "t5"]);
    const bounded = await page(client(), { range: "[2026-02-01,2026-02-28)" });
    expect(bounded.items.map((r) => r.id)).toEqual(["t6", "t2", "t1", "t5"]);
  });

  it("searches notes with multiple terms (any match)", async () => {
    const res = await page(client(), { search: "swiggy" });
    expect(res.items.map((r) => r.id)).toEqual(["t5"]);
    const multi = await page(client(), { search: "dinner friends" });
    expect(multi.items.map((r) => r.id)).toEqual(["t1"]);
  });
});

describe("dbListTransactions — sorting & pagination", () => {
  it("sorts by amount when requested", async () => {
    const desc = await page(client(), { order: "amount", direction: "desc" });
    expect(desc.items.map((r) => r.id)).toEqual(["t4", "t6", "t2", "t1", "t7", "t3", "t5"]);
    const asc = await page(client(), { order: "amount", direction: "asc" });
    expect(asc.items.map((r) => r.id)).toEqual(["t5", "t3", "t7", "t1", "t2", "t6", "t4"]);
  });

  it("paginates with stable, non-overlapping pages", async () => {
    const c = client();
    const first = await page(c, {}, null, 3);
    expect(first.items.map((r) => r.id)).toEqual(["t4", "t7", "t6"]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const cursor = decodeCursor(first.nextCursor);
    expect(cursor).not.toBeNull();

    const second = await page(c, {}, cursor, 3);
    expect(second.items.map((r) => r.id)).toEqual(["t2", "t1", "t5"]);
    expect(second.hasMore).toBe(true);

    const third = await page(c, {}, decodeCursor(second.nextCursor), 3);
    expect(third.items.map((r) => r.id)).toEqual(["t3"]);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });

  it("freezes filter state inside the cursor", async () => {
    const c = client();
    const first = await page(c, { type: "expense" }, null, 2);
    expect(first.items.map((r) => r.id)).toEqual(["t7", "t1"]);
    const second = await page(c, { type: "expense" }, decodeCursor(first.nextCursor), 2);
    expect(second.items.map((r) => r.id)).toEqual(["t5", "t3"]);
  });
});

describe("parseSearchParams & cursors", () => {
  it("accepts valid daterange formats", () => {
    expect(parseSearchParams(new URLSearchParams("range=[2026-01-01")).valid).toBe(true);
    expect(parseSearchParams(new URLSearchParams("range=[2026-01-01,2026-02-01)")).valid).toBe(true);
    expect(parseSearchParams(new URLSearchParams("range=2026-01-01")).valid).toBe(true); // invalid value dropped
    const parsed = parseSearchParams(new URLSearchParams("range=[2026-01-01,2026-02-01)"));
    expect(parsed.filters.range).toBe("[2026-01-01,2026-02-01)");
  });

  it("round-trips a cursor", () => {
    const cursor: ListCursor = { filters: { type: "expense", order: "amount" }, offset: 50 };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded).toEqual(cursor);
  });

  it("rejects malformed cursors", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    const p = parseSearchParams(new URLSearchParams("after=%%%"));
    expect(p.valid).toBe(false);
  });

  it("cursor filters override URL filters", () => {
    const cursor = encodeCursor({ filters: { type: "credit_card" }, offset: 10 });
    const p = parseSearchParams(new URLSearchParams(`after=${cursor}&type=expense`));
    expect(p.valid).toBe(true);
    expect(p.filters.type).toBe("credit_card");
    expect(p.cursor?.offset).toBe(10);
  });
});
