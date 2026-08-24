/**
 * Shared types and pure parsing helpers for the transaction list API.
 *
 * Importable from client, server and tests. The query parameter grammar
 * mirrors the filter builder in `src/lib/transactionsServer.ts`; keep the
 * two in sync.
 */

export type TransactionType =
  | "expense"
  | "credit_card"
  | "salary_add"
  | "savings_add"
  | "savings_move"
  | "loan_add";

export const TRANSACTION_TYPE_ORDER: TransactionType[] = [
  "expense",
  "credit_card",
  "salary_add",
  "savings_add",
  "savings_move",
  "loan_add",
];

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  expense: "Expense",
  credit_card: "Credit card",
  salary_add: "Salary added",
  savings_add: "Savings added",
  savings_move: "Moved to savings",
  loan_add: "Loan added",
};

/** Wire shape of a transaction as returned by /api/v1/transactions. */
export type TransactionRow = {
  id: string;
  user_id: string;
  created_at: string;
  date: string;
  type: TransactionType;
  amount: number;
  overspend_amount: number;
  note: string | null;
  category: string | null;
  subcategory: string | null;
  recurring_id: string | null;
};

/** Server query params; every field is optional. */
export type TransactionFilters = {
  range?: string;
  type?: TransactionType;
  category?: string;
  min?: number;
  max?: number;
  search?: string;
  order?: "date" | "amount";
  direction?: "asc" | "desc";
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type TransactionListResult = {
  items: TransactionRow[];
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * Opaque client cursor. Encodes the frozen filter state plus a row offset so
 * every page describes the same slice the first page described.
 */
export type ListCursor = {
  filters: TransactionFilters;
  offset: number;
};

const TYPE_SET = new Set<TransactionType>(TRANSACTION_TYPE_ORDER);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const SEARCH_MAX_LENGTH = 80;

export function isValidType(v: unknown): v is TransactionType {
  return typeof v === "string" && TYPE_SET.has(v as TransactionType);
}

export function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidDaterange(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.match(/^\[(\d{4}-\d{2}-\d{2})(?:,(\d{4}-\d{2}-\d{2}))?\)?$/);
  if (!m) return false;
  return isIsoDate(m[1]) && (m[2] === undefined || isIsoDate(m[2]));
}

export function isTransactionOrder(v: unknown): v is "date" | "amount" {
  return v === "date" || v === "amount";
}

export function isDirection(v: unknown): v is "asc" | "desc" {
  return v === "asc" || v === "desc";
}

export type ParsedSearchQuery = {
  filters: TransactionFilters;
  cursor: ListCursor | null;
  after: string | null;
  limit: number;
  valid: boolean;
};

/** Compact cursor string; opaque to the client. Portable across browser + node. */
function toBase64Url(s: string): string {
  if (typeof btoa === "function") {
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(s, "utf8").toString("base64url");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function encodeCursor(c: ListCursor): string {
  return toBase64Url(JSON.stringify(c));
}

export function decodeCursor(raw: string | null): ListCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(raw)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as { filters?: unknown; offset?: unknown };
    if (!p.filters || typeof p.filters !== "object" || typeof p.offset !== "number" || p.offset < 0) {
      return null;
    }
    return parsed as ListCursor;
  } catch {
    return null;
  }
}

function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(v)) return fallback;
  return Math.min(Math.max(v, min), max);
}

function cleanToken(v: string): string {
  const t = v.trim();
  return t.length > SEARCH_MAX_LENGTH ? t.slice(0, SEARCH_MAX_LENGTH) : t;
}

/**
 * Parses and validates the raw search params for the list endpoint.
 * Invalid values are dropped (never fatal), so the client can build URLs
 * out of user input and the server stays lenient.
 */
export function parseSearchParams(
  params: URLSearchParams,
  now = new Date()
): ParsedSearchQuery {
  const filters: TransactionFilters = {};

  const range = params.get("range");
  if (range && isValidDaterange(range)) filters.range = range;

  const type = params.get("type");
  if (type && isValidType(type)) filters.type = type;

  const category = params.get("category");
  if (category) filters.category = cleanToken(category);

  const min = Number(params.get("min"));
  if (Number.isFinite(min)) filters.min = min;

  const max = Number(params.get("max"));
  if (Number.isFinite(max)) filters.max = max;

  const search = params.get("search");
  if (search) filters.search = cleanToken(search);

  const order = params.get("order");
  if (isTransactionOrder(order)) filters.order = order;

  const direction = params.get("direction");
  if (isDirection(direction)) filters.direction = direction;

  const limit = clampInt(Number(params.get("limit")), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);

  const after = params.get("after");
  const cursor = decodeCursor(after);

  // A cursor freezes the filter state: if the client loads a later page we
  // must keep applying the same filters, so cursor filters override any that
  // happened to change in the URL in the meantime.
  const filtersFromCursor = cursor?.filters ?? {};
  return {
    filters: { ...filters, ...filtersFromCursor },
    cursor,
    after,
    limit,
    valid: cursor !== null || after === null,
  };
}
