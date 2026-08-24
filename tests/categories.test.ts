import { describe, it, expect, vi } from "vitest";
import { createMockClient, type MockClient } from "./helpers/supabase-mock";
import { dbListCategories } from "@/lib/categoriesServer";
import { toCategoryOptions } from "@/lib/categories";
import { DELETE as deleteCategoryRoute } from "@/app/api/v1/categories/[id]/route";

vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));

const CANONICAL = [
  { id: "cat-bank", name: "Bank interest", type: "income", parent_id: null, is_disabled: false, sort_order: 1 },
  { id: "cat-salary", name: "Salary", type: "income", parent_id: null, is_disabled: false, sort_order: 2 },
  { id: "cat-food", name: "Food", type: "expense", parent_id: null, is_disabled: false, sort_order: 10 },
  { id: "cat-travel", name: "Travel", type: "expense", parent_id: null, is_disabled: false, sort_order: 20 },
  { id: "cat-shopping", name: "Shopping", type: "expense", parent_id: null, is_disabled: false, sort_order: 30 },
  { id: "cat-restaurants", name: "Restaurants", type: "expense", parent_id: "cat-food", is_disabled: false, sort_order: 40 },
  { id: "cat-zomato", name: "Zomato", type: "expense", parent_id: "cat-food", is_disabled: false, sort_order: 41 },
  { id: "cat-bus", name: "Bus", type: "expense", parent_id: "cat-travel", is_disabled: false, sort_order: 42 },
  { id: "cat-uber", name: "Uber", type: "expense", parent_id: "cat-travel", is_disabled: false, sort_order: 43 },
  { id: "cat-old", name: "Old merchant", type: "expense", parent_id: "cat-food", is_disabled: true, sort_order: 99 },
];

function client(rows: Record<string, unknown>[] = CANONICAL): MockClient {
  return createMockClient({
    tables: { categories: rows.map((r) => ({ ...r })) },
  });
}

describe("dbListCategories", () => {
  it("returns all canonical rows ordered by sort_order", async () => {
    const list = await dbListCategories(client() as never);
    expect(list).toHaveLength(CANONICAL.length);
    expect(list.map((c) => c.id)).toEqual([
      "cat-bank",
      "cat-salary",
      "cat-food",
      "cat-travel",
      "cat-shopping",
      "cat-restaurants",
      "cat-zomato",
      "cat-bus",
      "cat-uber",
      "cat-old",
    ]);
  });

  it("maps load failures to a friendly auth error", async () => {
    const failing = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
      }),
    } as never;
    await expect(dbListCategories(failing)).rejects.toMatchObject({
      status: 502,
      code: "db_error",
    });
  });
});

describe("toCategoryOptions", () => {
  it("returns enabled top-level expense categories with their children, sorted", () => {
    const options = toCategoryOptions(CANONICAL as never);
    expect(options.map((o) => o.name)).toEqual(["Food", "Travel", "Shopping"]);
    expect(options[0].children).toEqual(["Restaurants", "Zomato"]);
    expect(options[1].children).toEqual(["Bus", "Uber"]);
  });

  it("excludes disabled categories and subcategories, and income categories", () => {
    const options = toCategoryOptions(CANONICAL as never);
    expect(options.some((o) => o.name === "Bank interest" || o.name === "Salary")).toBe(false);
    expect(options.every((o) => o.children.every((s) => s !== "Old merchant"))).toBe(true);
  });

  it("treats rows with a missing parent as roots instead of dropping them", () => {
    const rows = [
      { id: "r1", name: "Orphan", type: "expense", parent_id: "gone", is_disabled: false, sort_order: 1 },
    ];
    const options = toCategoryOptions(rows as never);
    expect(options.map((o) => o.name)).toEqual(["Orphan"]);
    expect(options[0].children).toEqual([]);
  });

  it("sorts root options by sort_order then name", () => {
    const rows = [
      { id: "a", name: "Zebra", type: "expense", parent_id: null, is_disabled: false, sort_order: 50 },
      { id: "b", name: "Apple", type: "expense", parent_id: null, is_disabled: false, sort_order: 10 },
      { id: "c", name: "Mango", type: "expense", parent_id: null, is_disabled: false, sort_order: 10 },
    ];
    expect(toCategoryOptions(rows as never).map((o) => o.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("returns an empty list when there are no enabled expense categories", () => {
    expect(toCategoryOptions([])).toEqual([]);
  });
});

describe("user-facing categories API is read-only (no custom categories)", () => {
  it("DELETE /api/v1/categories/[id] always refuses — categories are admin-managed", async () => {
    const res = await deleteCategoryRoute();
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toMatchObject({ code: "method_not_allowed" });
  });

  it("the collection route exports GET only — no create/update/delete endpoint", async () => {
    const mod = (await import("@/app/api/v1/categories/route")) as Record<string, unknown>;
    expect(typeof mod.GET).toBe("function");
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(mod[verb]).toBeUndefined();
    }
  });

  it("the client lib ships only listCategories — no createCategory/deleteCategory", async () => {
    const mod = (await import("@/lib/categoriesApi")) as Record<string, unknown>;
    expect(typeof mod.listCategories).toBe("function");
    expect(mod.createCategory).toBeUndefined();
    expect(mod.deleteCategory).toBeUndefined();
  });
});
