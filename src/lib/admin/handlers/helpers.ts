import { ApiError, type RouteParams } from "../server";

export type PageOptions = { from: number; to: number; page: number; pageSize: number };

export function parsePage(params: RouteParams): PageOptions {
  const rawSize = parseInt(params.pageSize ?? "20", 10);
  const pageSize = Number.isFinite(rawSize) ? Math.min(Math.max(rawSize, 1), 100) : 20;
  const rawPage = parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1;
  return { from: (page - 1) * pageSize, to: page * pageSize - 1, page, pageSize };
}

export function parseSort(
  params: RouteParams,
  allowed: readonly string[],
  defaultColumn = "created_at",
  defaultAscending = false
): { column: string; ascending: boolean } {
  let column = (params.sort || defaultColumn) as string;
  if (!allowed.includes(column)) column = defaultColumn;
  const order = (params.order || (defaultAscending ? "asc" : "desc")).toLowerCase();
  return { column, ascending: order !== "desc" };
}

export function isUuid(value: string | undefined): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "");
}

export function requireUuid(params: RouteParams, name = "id"): string {
  const value = params[name];
  if (!isUuid(value)) throw new ApiError(400, `Invalid or missing ${name}.`, "bad_request");
  return value;
}

const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const SCRIPT_BLOCK = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style[\s\S]*?<\/style>/gi;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE = /\s+/g;

/** Strip markup (including the content of script/style blocks), control
 *  characters and excessive whitespace from user-supplied text. */
export function sanitizeText(input: unknown, maxLength: number): string {
  let text = String(input ?? "");
  text = text.replace(SCRIPT_BLOCK, "").replace(STYLE_BLOCK, "");
  text = text.replace(HTML_TAG, "").replace(CONTROL_CHARS, "").replace(WHITESPACE, " ");
  text = text.trim();
  if (text.length > maxLength) text = text.slice(0, maxLength).trim();
  return text;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Parse a strict ISO-8601 date ("YYYY-MM-DD") or timestamp from a query
 * param. Date-only values are expanded to the start (edge="start") or end
 * (edge="end") of that day in UTC so range filters behave inclusively.
 * Returns undefined when the param is absent; throws ApiError(400) when it
 * is present but malformed.
 */
export function parseIsoDateParam(
  value: unknown,
  name: string,
  edge: "start" | "end"
): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  if (DATE_ONLY.test(raw)) {
    return edge === "start" ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`;
  }
  if (ISO_TIMESTAMP.test(raw)) return raw;
  throw new ApiError(
    400,
    `Invalid ${name}. Expected an ISO date (YYYY-MM-DD) or ISO timestamp.`,
    "bad_request"
  );
}

/** Optional UUID query param; throws ApiError(400) when malformed. */
export function parseOptionalUuidParam(value: unknown, name: string): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  if (!isUuid(raw)) throw new ApiError(400, `Invalid ${name}. Expected a UUID.`, "bad_request");
  return raw;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}
