/**
 * Server-side operations for the transaction list API. `dbListTransactions`
 * runs against a user-scoped Supabase client (RLS enforces row ownership).
 *
 * Pagination is cursor-based and offset-stable: the cursor freezes the filter
 * state and carries the row offset, so later pages always describe the same
 * slice the first page described.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthApiError } from "@/lib/auth/errors";
import {
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  isValidDaterange,
  isTransactionOrder,
  isDirection,
  isValidType,
  SEARCH_MAX_LENGTH,
  type ListCursor,
  type TransactionFilters,
  type TransactionListResult,
  type TransactionRow,
  type TransactionType,
} from "./transactions";

export type DbTransactionRow = {
  id: string;
  user_id: string;
  created_at: string;
  /** Scheduled day; only set on rows generated from a recurring rule. */
  occurrence_date: string | null;
  type: TransactionType;
  amount: string | number;
  overspend_amount: string | number;
  note: string | null;
  category: string | null;
  subcategory: string | null;
  recurring_transaction_id: string | null;
};

/**
 * Maps a database row to the wire shape. The table has no plain `date`
 * column, so the logical transaction date is derived: the scheduled day for
 * recurring rows, the creation day otherwise.
 */
function toRow(row: DbTransactionRow): TransactionRow {
  return {
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    date: row.occurrence_date ?? row.created_at.slice(0, 10),
    type: row.type,
    amount: Number(row.amount),
    overspend_amount: Number(row.overspend_amount ?? 0),
    note: row.note,
    category: row.category,
    subcategory: row.subcategory,
    recurring_id: row.recurring_transaction_id ?? null,
  };
}

/** Rejects malformed filter params before they reach the database. */
export function assertFilters(filters: TransactionFilters, cursor: ListCursor | null): void {
  if (filters.range !== undefined && !isValidDaterange(filters.range)) {
    throw new AuthApiError(400, "Invalid date range.", "bad_request");
  }
  if (filters.type !== undefined && !isValidType(filters.type)) {
    throw new AuthApiError(400, "Invalid type.", "bad_request");
  }
  if (filters.min !== undefined && !Number.isFinite(filters.min)) {
    throw new AuthApiError(400, "Invalid minimum amount.", "bad_request");
  }
  if (filters.max !== undefined && !Number.isFinite(filters.max)) {
    throw new AuthApiError(400, "Invalid maximum amount.", "bad_request");
  }
  if (
    filters.search !== undefined &&
    (typeof filters.search !== "string" || filters.search.length > SEARCH_MAX_LENGTH)
  ) {
    throw new AuthApiError(400, "Search term is too long.", "bad_request");
  }
  if (filters.order !== undefined && !isTransactionOrder(filters.order)) {
    throw new AuthApiError(400, "Invalid sort field.", "bad_request");
  }
  if (filters.direction !== undefined && !isDirection(filters.direction)) {
    throw new AuthApiError(400, "Invalid sort direction.", "bad_request");
  }
  if (filters.category !== undefined && (typeof filters.category !== "string" || filters.category.length > 60)) {
    throw new AuthApiError(400, "Category is too long.", "bad_request");
  }
  if (filters.min !== undefined && filters.max !== undefined && filters.min > filters.max) {
    throw new AuthApiError(400, "Minimum amount can't exceed the maximum.", "bad_request");
  }
}

/** Order for the SQL query; defaults to date desc. */
export function orderSpec(filters: TransactionFilters): {
  column: "date" | "amount";
  ascending: boolean;
} {
  return {
    column: filters.order === "amount" ? "amount" : "date",
    ascending: filters.direction === "asc",
  };
}

/**
 * Applies filters + order to a (mockable) query object. The query object
 * exposes the PostgREST chain methods used by the real client and by the
 * test mock, so the full request path is exercisable without a database.
 */
export function applyToQuery(
  query: any,
  userId: string,
  filters: TransactionFilters,
  order: { column: "date" | "amount"; ascending: boolean }
): any {
  let q = query;
  q = q.eq("user_id", userId);

  if (filters.range) {
    const m = filters.range.match(/^\[(\d{4}-\d{2}-\d{2})(?:,(\d{4}-\d{2}-\d{2}))?\)?$/);
    if (m) {
      // The table stores timestamps, not a date column; PostgREST casts the
      // bare date strings to midnight boundaries, preserving half-open ranges.
      if (m[1] && m[1] !== "0001-01-01") q = q.gte("created_at", m[1]);
      if (m[2]) q = q.lt("created_at", m[2]);
    }
  }
  if (filters.type) q = q.eq("type", filters.type);
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.min !== undefined) q = q.gte("amount", filters.min);
  if (filters.max !== undefined) q = q.lt("amount", filters.max + 0.005);

  if (filters.search) {
    const escaped = filters.search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const ors = escaped
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((tok) => `note.ilike.${encodeURIComponent(`%${tok}%`)}`)
      .join(",");
    q = q.or(ors);
  }

  // "date" is the logical sort key; the physical column is the timestamp.
  q = q.order(order.column === "amount" ? "amount" : "created_at", {
    ascending: order.ascending,
  });
  return q;
}

/**
 * Runs a filtered, paginated transaction query. `filters` have already been
 * merged with the cursor's frozen filter state by the caller.
 */
export async function dbListTransactions(
  client: SupabaseClient,
  userId: string,
  filters: TransactionFilters,
  cursor: ListCursor | null,
  limit: number
): Promise<TransactionListResult> {
  assertFilters(filters, cursor);

  const safeLimit = Math.min(Math.max(1, Math.floor(limit) || DEFAULT_PAGE_SIZE), 100);
  const offset = cursor ? Math.max(0, Math.floor(cursor.offset)) : 0;
  const order = orderSpec(filters);

  // Select one extra row so we can report whether another page exists.
  let query = client.from("transactions").select("*");
  query = applyToQuery(query, userId, filters, order);
  query = query.range(offset, offset + safeLimit);

  const { data, error } = await query;
  if (error) {
    throw new AuthApiError(500, "Couldn't load transactions.", "db_error");
  }

  const rows = (data ?? []) as DbTransactionRow[];
  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;

  const nextCursor: ListCursor | null = hasMore
    ? { filters: { ...filters, order: order.column, direction: order.ascending ? "asc" : "desc" }, offset: offset + page.length }
    : null;

  return {
    items: page.map(toRow),
    hasMore,
    nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
  };
}
