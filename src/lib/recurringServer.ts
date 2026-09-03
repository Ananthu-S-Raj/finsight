/**
 * Server-side operations for the recurring-transactions feature. These run
 * against a user-scoped Supabase client (never the service role), so RLS
 * scoping is enforced by the database for every read. Balance-affecting
 * writes are delegated to SECURITY DEFINER RPCs so the money-layer invariants
 * (row locking, idempotent generation) hold exactly as for manual entries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthApiError } from "@/lib/auth/errors";
import {
  dayOfMonth,
  nextRecurringDateStr,
  normalizeRecurringInput,
  type Frequency,
  type RecurringInput,
  type RecurringOccurrence,
  type RecurringResult,
  type RecurringStatus,
  type RecurringTransaction,
  type RecurringType,
} from "./recurring";

const RULE_SELECT = "*";

export type RecurringRoute =
  | { kind: "list"; type?: RecurringType }
  | { kind: "create" }
  | { kind: "pending" }
  | { kind: "confirm"; occurrenceId: string }
  | { kind: "skip"; occurrenceId: string }
  | { kind: "get"; id: string }
  | { kind: "update"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "status"; id: string };

/**
 * Maps a request to an operation. `slug` is the path segments after
 * `/api/v1/recurring`. Literal segments ("pending") take precedence over
 * resource ids, so a rule can never collide with the pending endpoint.
 */
export function matchRecurringRoute(
  method: string,
  slug: string[]
): RecurringRoute | null {
  const s = slug ?? [];
  const m = method.toUpperCase();

  if (m === "GET" && s.length === 0) {
    return { kind: "list" };
  }
  if (m === "POST" && s.length === 0) {
    return { kind: "create" };
  }
  if (m === "GET" && s.length === 1 && s[0] === "pending") {
    return { kind: "pending" };
  }
  if (m === "POST" && s.length === 3 && s[0] === "pending" && s[2] === "confirm") {
    return { kind: "confirm", occurrenceId: s[1] };
  }
  if (m === "POST" && s.length === 3 && s[0] === "pending" && s[2] === "skip") {
    return { kind: "skip", occurrenceId: s[1] };
  }
  if (m === "POST" && s.length === 2 && s[1] === "status") {
    return { kind: "status", id: s[0] };
  }
  if (m === "GET" && s.length === 1) return { kind: "get", id: s[0] };
  if (m === "PATCH" && s.length === 1) return { kind: "update", id: s[0] };
  if (m === "DELETE" && s.length === 1) return { kind: "delete", id: s[0] };

  return null;
}

export function parseListType(raw: string | null): RecurringType | undefined {
  if (raw === "expense" || raw === "income" || raw === "transfer") return raw;
  return undefined;
}

/** Rejects non-uuid ids so malformed slugs never reach the database. */
function assertId(id: string): void {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    throw new AuthApiError(400, "Invalid id.", "bad_request");
  }
}

async function insertRule(
  client: SupabaseClient,
  userId: string,
  input: RecurringInput
): Promise<RecurringTransaction> {
  const { data, error } = await client
    .from("recurring_transactions")
    .insert({
      user_id: userId,
      type: input.type,
      amount: input.amount,
      frequency: input.frequency,
      start_date: input.start_date,
      end_date: input.end_date,
      description: input.description,
      category: input.category,
      category_id: input.category_id ?? null,
      subcategory: input.subcategory,
      account: input.account,
      destination_account: input.destination_account,
      requires_confirmation: input.requires_confirmation,
      next_occurrence: input.start_date,
      anchor_day: dayOfMonth(input.start_date),
    })
    .select(RULE_SELECT)
    .single();

  if (error) {
    throw new AuthApiError(500, "Couldn't create the recurring transaction.", "db_error");
  }
  return data as RecurringTransaction;
}

export async function dbListRules(
  client: SupabaseClient,
  userId: string,
  type?: RecurringType
): Promise<RecurringTransaction[]> {
  let query = client
    .from("recurring_transactions")
    .select(RULE_SELECT)
    .eq("user_id", userId);
  if (type) query = query.eq("type", type);
  const { data, error } = await query.order("next_occurrence", { ascending: true });
  if (error) throw new AuthApiError(500, "Couldn't load recurring transactions.", "db_error");
  return (data ?? []) as RecurringTransaction[];
}

export async function dbGetRule(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<RecurringTransaction> {
  assertId(id);
  const { data, error } = await client
    .from("recurring_transactions")
    .select(RULE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AuthApiError(500, "Couldn't load the recurring transaction.", "db_error");
  if (!data || data.user_id !== userId) {
    throw new AuthApiError(404, "Recurring transaction not found.", "not_found");
  }
  return data as RecurringTransaction;
}

export async function dbCreateRule(
  client: SupabaseClient,
  userId: string,
  raw: Record<string, unknown>
): Promise<RecurringTransaction> {
  return insertRule(client, userId, normalizeRecurringInput(raw));
}

export async function dbUpdateRule(
  client: SupabaseClient,
  userId: string,
  id: string,
  raw: Record<string, unknown>
): Promise<RecurringTransaction> {
  assertId(id);
  const existing = await dbGetRule(client, userId, id);

  // A full rule body is optional; patch semantics. Fields we never let the
  // client overwrite directly are dropped from the patch.
  const patch: Record<string, unknown> = {};
  for (const key of [
    "type",
    "amount",
    "frequency",
    "start_date",
    "end_date",
    "description",
    "category",
    "category_id",
    "subcategory",
    "account",
    "destination_account",
    "requires_confirmation",
  ] as const) {
    if (key in raw) patch[key] = raw[key];
  }

  const input = normalizeRecurringInput({ ...existing, ...patch });
  if (input.type !== existing.type) {
    // Type is fixed once the rule has produced history — money has already
    // been moved under the old semantics.
    throw new AuthApiError(400, "A transaction's type can't be changed after it's created.", "invalid_type_change");
  }

  const startDateChanged = input.start_date !== existing.start_date;
  const frequencyChanged = input.frequency !== existing.frequency;

  const update: Record<string, unknown> = {
    ...input,
    requires_confirmation: input.requires_confirmation,
  };
  if (startDateChanged || frequencyChanged) {
    update.next_occurrence = input.start_date;
    update.anchor_day = dayOfMonth(input.start_date);
  }

  const { data, error } = await client
    .from("recurring_transactions")
    .update(update)
    .eq("id", id)
    .select(RULE_SELECT)
    .single();

  if (error) throw new AuthApiError(500, "Couldn't update the recurring transaction.", "db_error");
  return data as RecurringTransaction;
}

export async function dbDeleteRule(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  assertId(id);
  // Ownership check first (RLS would also block, but we want a clean 404).
  await dbGetRule(client, userId, id);
  const { error } = await client.from("recurring_transactions").delete().eq("id", id);
  if (error) throw new AuthApiError(500, "Couldn't delete the recurring transaction.", "db_error");
  return { deleted: true };
}

const STATUS_TRANSITIONS: Record<RecurringStatus, RecurringStatus[]> = {
  active: ["paused", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function dbSetStatus(
  client: SupabaseClient,
  userId: string,
  id: string,
  rawStatus: unknown
): Promise<RecurringTransaction> {
  assertId(id);
  const existing = await dbGetRule(client, userId, id);
  const status = rawStatus as RecurringStatus;
  if (status !== "active" && status !== "paused" && status !== "completed" && status !== "cancelled") {
    throw new AuthApiError(400, "Invalid status.", "invalid_status");
  }
  if (status === existing.status) {
    return existing;
  }
  if (!STATUS_TRANSITIONS[existing.status].includes(status)) {
    throw new AuthApiError(
      400,
      `Can't change a ${existing.status} transaction to ${status}.`,
      "invalid_status_transition"
    );
  }

  const { data, error } = await client
    .from("recurring_transactions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(RULE_SELECT)
    .single();

  if (error) throw new AuthApiError(500, "Couldn't update the recurring transaction.", "db_error");
  return data as RecurringTransaction;
}

export async function dbListPending(
  client: SupabaseClient,
  userId: string
): Promise<RecurringOccurrence[]> {
  const { data: occs, error: occErr } = await client
    .from("recurring_occurrences")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("occurrence_date", { ascending: true });
  if (occErr) throw new AuthApiError(500, "Couldn't load pending occurrences.", "db_error");

  const rows = (occs ?? []) as Array<Omit<RecurringOccurrence, "rule">>;
  const ruleIds = [...new Set(rows.map((o) => o.recurring_transaction_id))];
  if (ruleIds.length === 0) return [];

  const { data: rules, error: rulesErr } = await client
    .from("recurring_transactions")
    .select(RULE_SELECT)
    .in("id", ruleIds);
  if (rulesErr) throw new AuthApiError(500, "Couldn't load recurring transactions.", "db_error");

  const ruleMap = new Map(
    ((rules ?? []) as RecurringTransaction[]).map((r) => [r.id, r])
  );
  return rows
    .filter((o) => ruleMap.has(o.recurring_transaction_id))
    .map((o) => ({ ...o, rule: ruleMap.get(o.recurring_transaction_id) as RecurringTransaction }));
}

export async function dbConfirmOccurrence(
  client: SupabaseClient,
  occurrenceId: string
): Promise<{ transaction_id: string | null }> {
  // Surfaces the underlying DB error so a specific failure (e.g. the occurrence
  // was already paid) is never masked as a generic "db_error". Meaningful
  // sentinel errors map to clear, actionable messages.
  assertId(occurrenceId);
  const { data, error } = await client.rpc("confirm_recurring_occurrence", {
    p_occurrence_id: occurrenceId,
  });
  if (error) {
    switch (error.message) {
      case "occurrence_not_found":
        throw new AuthApiError(404, "Pending occurrence not found.", "not_found");
      case "unauthorized":
        throw new AuthApiError(403, "This occurrence belongs to another account.", "forbidden");
      case "rule_not_found":
        throw new AuthApiError(404, "The recurring transaction for this occurrence no longer exists.", "not_found");
      case "duplicate_payment":
        throw new AuthApiError(409, "This occurrence's payment was already recorded.", "conflict");
      case "invalid_amount":
        throw new AuthApiError(400, "The recurring amount is invalid.", "bad_request");
      case "invalid_rule_type":
        throw new AuthApiError(400, "This recurring rule type can't be confirmed.", "bad_request");
      default:
        throw new AuthApiError(500, "Couldn't confirm the occurrence.", "db_error");
    }
  }
  return (data ?? { transaction_id: null }) as { transaction_id: string | null };
}

export async function dbSkipOccurrence(
  client: SupabaseClient,
  occurrenceId: string
): Promise<{ skipped: boolean }> {
  assertId(occurrenceId);
  const { data, error } = await client.rpc("skip_recurring_occurrence", {
    p_occurrence_id: occurrenceId,
  });
  if (error) throw new AuthApiError(500, "Couldn't skip the occurrence.", "db_error");
  return { skipped: Boolean(data) };
}

export async function dbProcessDue(
  client: SupabaseClient,
  userId: string
): Promise<RecurringResult> {
  const { data, error } = await client.rpc("process_recurring_due", {
    p_user_id: userId,
  });
  if (error) throw new AuthApiError(500, "Couldn't process recurring transactions.", "db_error");
  const fallback: RecurringResult = { processed: 0, generated: 0, pending: 0, skipped: 0, failed: 0 };
  if (!data || typeof data !== "object") return fallback;
  return {
    processed: Number((data as Record<string, unknown>).processed ?? 0),
    generated: Number((data as Record<string, unknown>).generated ?? 0),
    pending: Number((data as Record<string, unknown>).pending ?? 0),
    skipped: Number((data as Record<string, unknown>).skipped ?? 0),
    failed: Number((data as Record<string, unknown>).failed ?? 0),
  };
}

/** Preview helper used by the API when a client asks what a schedule produces. */
export function previewSchedule(
  frequency: Frequency,
  start: string,
  anchorDay: number,
  count = 3
): string[] {
  const out: string[] = [];
  let current = start;
  for (let i = 0; i < count; i += 1) {
    out.push(current);
    current = nextRecurringDateStr(frequency, current, anchorDay);
  }
  return out;
}
