/**
 * Shared types and pure helpers for the categories feature.
 *
 * Categories are a single admin-managed canonical list (see
 * `src/lib/admin/handlers/categories.ts`). They form a two-level tree:
 * top-level categories (`parent_id` null) with optional children that serve as
 * subcategories (e.g. Travel → Bus, Uber, Rapido). The money layer snapshots
 * `name`/`subcategory` onto every transaction, so renaming or disabling a
 * category never rewrites history.
 */

export type Category = {
  id: string;
  name: string;
  type: "expense" | "income";
  parent_id: string | null;
  is_default: boolean;
  is_disabled: boolean;
  sort_order: number;
  created_at: string;
};

export type CategoryOption = {
  id: string | null;
  name: string;
  children: string[];
};

function bySortOrder(a: Category, b: Category): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

/**
 * Flattens the canonical category list into picker options: enabled top-level
 * expense categories with their enabled children (subcategories) attached.
 * Rows whose parent is missing from the list are treated as top-level.
 */
export function toCategoryOptions(categories: Category[]): CategoryOption[] {
  const active = (categories ?? []).filter((c) => !c.is_disabled);
  const byId = new Map(active.map((c) => [c.id, c]));
  const roots = active
    .filter((c) => c.type === "expense" && !(c.parent_id && byId.has(c.parent_id)))
    .sort(bySortOrder);
  return roots.map((c) => ({
    id: c.id,
    name: c.name,
    children: active
      .filter((ch) => ch.parent_id === c.id)
      .sort(bySortOrder)
      .map((ch) => ch.name),
  }));
}
