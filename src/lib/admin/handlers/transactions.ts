import { ApiError, requirePermission, writeAudit, type Handler } from "../server";
import {
  asNumber,
  asString,
  parsePage,
  parseSort,
  requireUuid,
  sanitizeText,
} from "./helpers";

const TX_SORTABLE = ["created_at", "amount", "type", "category"];
const TX_TYPES = ["salary_add", "savings_add", "savings_move", "expense", "credit_card", "loan_add"];

type TxUserRow = { id: string; email: string | null; full_name: string | null };

async function loadTxUser(ctx: HandlerContext, id: string): Promise<TxUserRow | null> {
  const { data } = await ctx.client.from("profiles").select("id,email,full_name").eq("id", id).maybeSingle();
  return data ? (data as TxUserRow) : null;
}

type HandlerContext = Parameters<Handler>[0];

export const listTransactions: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "TRANSACTION_VIEW");
  const { from, to, page, pageSize } = parsePage(params);
  const sort = parseSort(params, TX_SORTABLE, "created_at", false);

  let query = ctx.client.from("transactions").select("*", { count: "exact" });

  if (params.type && TX_TYPES.includes(params.type as string)) {
    query = query.eq("type", params.type as string);
  }
  if (params.userId && requireUuid({ id: params.userId })) {
    query = query.eq("user_id", params.userId as string);
  }
  if (params.flagged === "true") query = query.eq("flagged", true);
  const search = asString(params.search);
  if (search) {
    query = query.or(`note.ilike.%${search}%,category.ilike.%${search}%,subcategory.ilike.%${search}%`);
  }
  query = query.order(sort.column, { ascending: sort.ascending }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new ApiError(502, "Could not load transactions.", "db_error");

  const userIds = [...new Set((data ?? []).map((t) => t.user_id as string))];
  const users = new Map<string, TxUserRow>();
  for (const uid of userIds) {
    const row = await loadTxUser(ctx, uid);
    if (row) users.set(uid, row);
  }

  return {
    items: (data ?? []).map((tx) => ({
      id: tx.id,
      user_id: tx.user_id,
      user: users.get(tx.user_id as string) ?? null,
      type: tx.type,
      category: tx.category,
      subcategory: tx.subcategory,
      amount: Number(tx.amount),
      overspend_amount: Number(tx.overspend_amount ?? 0),
      note: tx.note,
      flagged: Boolean(tx.flagged),
      flag_reason: tx.flag_reason ?? null,
      created_at: tx.created_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
};

export const correctTransaction: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "TRANSACTION_EDIT");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const changes: Record<string, unknown> = {};
  const auditMeta: Record<string, unknown> = {};

  if ("amount" in body) {
    const amount = asNumber(body.amount);
    if (amount === undefined || amount < 0) {
      throw new ApiError(400, "Amount must be a non-negative number.", "bad_request");
    }
    changes.amount = amount;
    auditMeta.amount = amount;
  }
  if ("type" in body) {
    const type = asString(body.type);
    if (!type || !TX_TYPES.includes(type)) {
      throw new ApiError(400, `Type must be one of: ${TX_TYPES.join(", ")}.`, "bad_request");
    }
    changes.type = type;
    auditMeta.type = type;
  }
  if ("category" in body) changes.category = sanitizeText(body.category, 50) || null;
  if ("subcategory" in body) changes.subcategory = sanitizeText(body.subcategory, 50) || null;
  if ("note" in body) changes.note = sanitizeText(body.note, 500) || null;

  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "No supported fields provided.", "bad_request");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("transactions")
    .select("id,user_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the transaction.", "db_error");
  if (!existing) throw new ApiError(404, "Transaction not found.", "not_found");

  const { data: updated, error } = await ctx.client
    .from("transactions")
    .update(changes)
    .eq("id", id)
    .select("id,user_id")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not update the transaction.", "db_error");

  const target = await loadTxUser(ctx, existing.user_id as string);
  await writeAudit(ctx, {
    action: "transaction.correct",
    resource_type: "transaction",
    resource_id: id,
    target_user_id: existing.user_id as string,
    target_email: target?.email ?? null,
    metadata: auditMeta,
  });

  return { id, ...changes };
};

export const flagTransaction: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "TRANSACTION_EDIT");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const reason = sanitizeText(body.reason, 300);
  if (!reason) throw new ApiError(400, "A flag reason is required.", "bad_request");

  const { data: existing, error: fetchError } = await ctx.client
    .from("transactions")
    .select("id,user_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the transaction.", "db_error");
  if (!existing) throw new ApiError(404, "Transaction not found.", "not_found");

  const { data: updated, error } = await ctx.client
    .from("transactions")
    .update({ flagged: true, flag_reason: reason })
    .eq("id", id)
    .select("id,user_id")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not flag the transaction.", "db_error");

  const target = await loadTxUser(ctx, existing.user_id as string);
  await writeAudit(ctx, {
    action: "transaction.flag",
    resource_type: "transaction",
    resource_id: id,
    target_user_id: existing.user_id as string,
    target_email: target?.email ?? null,
    metadata: { reason },
  });

  return { id, flagged: true };
};

/**
 * Removes a moderation flag. Idempotent by design: unflagging a row that is
 * not flagged still succeeds and still audits (with previous_flagged:false)
 * so the action trail stays complete either way.
 */
export const unflagTransaction: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "TRANSACTION_EDIT");
  const id = requireUuid(params);

  const { data: existing, error: fetchError } = await ctx.client
    .from("transactions")
    .select("id,user_id,flagged,flag_reason")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the transaction.", "db_error");
  if (!existing) throw new ApiError(404, "Transaction not found.", "not_found");

  const { error } = await ctx.client
    .from("transactions")
    .update({ flagged: false, flag_reason: null })
    .eq("id", id)
    .select("id,user_id")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not unflag the transaction.", "db_error");

  const target = await loadTxUser(ctx, existing.user_id as string);
  await writeAudit(ctx, {
    action: "transaction.unflag",
    resource_type: "transaction",
    resource_id: id,
    target_user_id: existing.user_id as string,
    target_email: target?.email ?? null,
    metadata: {
      previous_flagged: Boolean(existing.flagged),
      previous_reason: (existing.flag_reason as string | null) ?? null,
    },
  });

  return { id, flagged: false };
};

export const deleteTransaction: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "TRANSACTION_DELETE");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.confirm !== "DELETE") {
    throw new ApiError(400, "Confirmation required: set confirm to 'DELETE'.", "confirmation_required");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("transactions")
    .select("id,user_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the transaction.", "db_error");
  if (!existing) throw new ApiError(404, "Transaction not found.", "not_found");

  const { error } = await ctx.client.from("transactions").delete().eq("id", id);
  if (error) throw new ApiError(502, "Could not delete the transaction.", "db_error");

  const target = await loadTxUser(ctx, existing.user_id as string);
  await writeAudit(ctx, {
    action: "transaction.delete",
    resource_type: "transaction",
    resource_id: id,
    target_user_id: existing.user_id as string,
    target_email: target?.email ?? null,
  });

  return { id, deleted: true };
};
