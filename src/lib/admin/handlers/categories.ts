import { ApiError, requirePermission, writeAudit, type Handler } from "../server";
import { asBoolean, asString, requireUuid, sanitizeText } from "./helpers";

type CategoryRow = {
  id: string;
  name: string;
  type: "expense" | "income";
  parent_id: string | null;
  is_default: boolean;
  is_disabled: boolean;
  sort_order: number;
  created_at: string;
};

type TreeNode = CategoryRow & { children: TreeNode[] };

function buildTree(rows: CategoryRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export const listCategories: Handler = async (ctx) => {
  const { data, error } = await ctx.client
    .from("categories")
    .select("*")
    .order("sort_order");
  if (error) throw new ApiError(502, "Could not load categories.", "db_error");
  return { items: buildTree((data ?? []) as CategoryRow[]) };
};
export const createCategory: Handler = async (ctx, req) => {
  requirePermission(ctx, "CATEGORY_MANAGE");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = sanitizeText(body.name, 60);
  if (!name) throw new ApiError(400, "Category name is required.", "bad_request");

  const type = asString(body.type) === "income" ? "income" : "expense";
  const parentId = body.parent_id ? requireUuid({ id: String(body.parent_id) }) : null;
  const sortOrder = typeof body.sort_order === "number" ? Math.max(0, Math.floor(body.sort_order)) : 0;
  const icon = sanitizeText(body.icon, 30) || null;

  const { data, error } = await ctx.client
    .from("categories")
    .insert({ name, type, parent_id: parentId, sort_order: sortOrder, is_default: false })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "A category with this name already exists.", "duplicate");
    throw new ApiError(502, "Could not create the category.", "db_error");
  }

  await writeAudit(ctx, {
    action: "category.create",
    resource_type: "category",
    resource_id: data.id as string,
    metadata: { name, type, parent_id: parentId, icon },
  });

  return data;
};

export const updateCategory: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "CATEGORY_MANAGE");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const changes: Record<string, unknown> = {};
  if ("name" in body) {
    const name = sanitizeText(body.name, 60);
    if (!name) throw new ApiError(400, "Category name is required.", "bad_request");
    changes.name = name;
  }
  if ("parent_id" in body) {
    const parentId = body.parent_id ? requireUuid({ id: String(body.parent_id) }) : null;
    if (parentId === id) throw new ApiError(400, "A category cannot be its own parent.", "bad_request");
    changes.parent_id = parentId;
  }
  if ("sort_order" in body && typeof body.sort_order === "number") {
    changes.sort_order = Math.max(0, Math.floor(body.sort_order));
  }
  if ("is_disabled" in body) changes.is_disabled = asBoolean(body.is_disabled) ?? false;

  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "No supported fields provided.", "bad_request");
  }

  const { data: updated, error } = await ctx.client
    .from("categories")
    .update(changes)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "A category with this name already exists.", "duplicate");
    throw new ApiError(502, "Could not update the category.", "db_error");
  }
  if (!updated) throw new ApiError(404, "Category not found.", "not_found");

  await writeAudit(ctx, {
    action: "category.update",
    resource_type: "category",
    resource_id: id,
    metadata: changes,
  });

  return updated;
};

export const deleteCategory: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "CATEGORY_MANAGE");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== "DELETE") {
    throw new ApiError(400, "Confirmation required: set confirm to 'DELETE'.", "confirmation_required");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("categories")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the category.", "db_error");
  if (!existing) throw new ApiError(404, "Category not found.", "not_found");

  const { count: usage } = await ctx.client
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("category", existing.name as string);

  if ((usage ?? 0) > 0) {
    // Soft-disable instead: transactions reference the category string.
    await ctx.client.from("categories").update({ is_disabled: true }).eq("id", id);
    await writeAudit(ctx, {
      action: "category.disable",
      resource_type: "category",
      resource_id: id,
      metadata: { reason: "category_in_use" },
    });
    return { id, disabled: true, reason: "in_use" };
  }

  const { error } = await ctx.client.from("categories").delete().eq("id", id);
  if (error) throw new ApiError(502, "Could not delete the category.", "db_error");

  await writeAudit(ctx, {
    action: "category.delete",
    resource_type: "category",
    resource_id: id,
    metadata: { name: existing.name },
  });

  return { id, deleted: true };
};
