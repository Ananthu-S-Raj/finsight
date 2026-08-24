/**
 * Server-side operations for the bills feature. These run against a
 * user-scoped Supabase client (never the service role), so RLS scoping is
 * enforced by the database for every read and write. Paying a bill is the
 * exception: it goes through the SECURITY DEFINER `mark_bill_paid` RPC so the
 * money-layer invariants (row locking, payment dedup, expense booking) hold
 * exactly as for manual entries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthApiError } from "@/lib/auth/errors";
import {
  normalizeBillInput,
  dayOfMonth,
  type Bill,
  type BillInput,
  type BillPaidResult,
  type BillPayment,
  type BillReminder,
  type BillStatus,
} from "./bills";

export type BillRoute =
  | { kind: "list"; status?: BillStatus }
  | { kind: "create" }
  | { kind: "payments" }
  | { kind: "reminders"; since?: string }
  | { kind: "get"; id: string }
  | { kind: "update"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "paid"; id: string }
  | { kind: "cancel"; id: string };

/**
 * Maps a request to an operation. `slug` is the path segments after
 * `/api/v1/bills`. Literal segments ("payments") take precedence over
 * resource ids.
 */
export function matchBillRoute(method: string, slug: string[]): BillRoute | null {
  const s = slug ?? [];
  const m = method.toUpperCase();

  if (m === "GET" && s.length === 0) return { kind: "list" };
  if (m === "POST" && s.length === 0) return { kind: "create" };
  if (m === "GET" && s.length === 1 && s[0] === "payments") return { kind: "payments" };
  if (m === "GET" && s.length === 1 && s[0] === "reminders") return { kind: "reminders" };
  if (m === "POST" && s.length === 2 && s[1] === "paid") return { kind: "paid", id: s[0] };
  if (m === "POST" && s.length === 2 && s[1] === "cancel") return { kind: "cancel", id: s[0] };
  if (m === "GET" && s.length === 1) return { kind: "get", id: s[0] };
  if (m === "PATCH" && s.length === 1) return { kind: "update", id: s[0] };
  if (m === "DELETE" && s.length === 1) return { kind: "delete", id: s[0] };

  return null;
}

export function parseListStatus(raw: string | null): BillStatus | undefined {
  if (raw === "upcoming" || raw === "due" || raw === "paid" || raw === "overdue" || raw === "cancelled") {
    return raw;
  }
  return undefined;
}

/** Rejects non-uuid ids so malformed slugs never reach the database. */
function assertId(id: string): void {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    throw new AuthApiError(400, "Invalid id.", "bad_request");
  }
}

async function insertBill(
  client: SupabaseClient,
  userId: string,
  input: BillInput
): Promise<Bill> {
  const { data, error } = await client
    .from("bills")
    .insert({
      user_id: userId,
      name: input.name,
      amount: input.amount,
      due_date: input.due_date,
      frequency: input.frequency,
      category: input.category,
      category_id: input.category_id ?? null,
      subcategory: input.subcategory,
      is_credit_card: input.is_credit_card,
      reminder_enabled: input.reminder_enabled,
      reminder_days_before: input.reminder_days_before,
      notes: input.notes,
      anchor_day: dayOfMonth(input.due_date),
    })
    .select("*")
    .single();

  if (error) {
    throw new AuthApiError(500, "Couldn't create the bill.", "db_error");
  }
  return data as Bill;
}

export async function dbListBills(
  client: SupabaseClient,
  userId: string,
  status?: BillStatus
): Promise<Bill[]> {
  let query = client.from("bills").select("*").eq("user_id", userId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("due_date", { ascending: true });
  if (error) throw new AuthApiError(500, "Couldn't load bills.", "db_error");
  return (data ?? []) as Bill[];
}

export async function dbGetBill(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<Bill> {
  assertId(id);
  const { data, error } = await client
    .from("bills")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AuthApiError(500, "Couldn't load the bill.", "db_error");
  if (!data || data.user_id !== userId) {
    throw new AuthApiError(404, "Bill not found.", "not_found");
  }
  return data as Bill;
}

export async function dbCreateBill(
  client: SupabaseClient,
  userId: string,
  raw: Record<string, unknown>
): Promise<Bill> {
  return insertBill(client, userId, normalizeBillInput(raw));
}

const EDITABLE_FIELDS = [
  "name",
  "amount",
  "due_date",
  "frequency",
  "category",
  "category_id",
  "subcategory",
  "is_credit_card",
  "reminder_enabled",
  "reminder_days_before",
  "notes",
] as const;

export async function dbUpdateBill(
  client: SupabaseClient,
  userId: string,
  id: string,
  raw: Record<string, unknown>
): Promise<Bill> {
  assertId(id);
  const existing = await dbGetBill(client, userId, id);

  if (existing.status === "paid" || existing.status === "cancelled") {
    throw new AuthApiError(400, "A paid or cancelled bill can't be edited.", "bill_closed");
  }

  // Patch semantics: only listed fields are accepted.
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in raw) patch[key] = raw[key];
  }

  const input = normalizeBillInput({ ...existing, ...patch });

  const update: Record<string, unknown> = {
    ...input,
    updated_at: new Date().toISOString(),
  };
  if (input.due_date !== existing.due_date || input.frequency !== existing.frequency) {
    // A new due date (or schedule) establishes a new anchor for recurrence.
    update.anchor_day = dayOfMonth(input.due_date);
  }

  const { data, error } = await client
    .from("bills")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new AuthApiError(500, "Couldn't update the bill.", "db_error");
  return data as Bill;
}

export async function dbCancelBill(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<Bill> {
  assertId(id);
  const existing = await dbGetBill(client, userId, id);

  if (existing.status === "cancelled") return existing;
  if (existing.status === "paid") {
    throw new AuthApiError(400, "A paid bill can't be cancelled.", "bill_closed");
  }

  const { data, error } = await client
    .from("bills")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new AuthApiError(500, "Couldn't cancel the bill.", "db_error");
  return data as Bill;
}

export async function dbDeleteBill(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  assertId(id);
  const existing = await dbGetBill(client, userId, id);

  const { count, error: countError } = await client
    .from("bill_payments")
    .select("id", { count: "exact", head: true })
    .eq("bill_id", id);
  if (countError) throw new AuthApiError(500, "Couldn't check the bill's payment history.", "db_error");
  if ((count ?? 0) > 0) {
    // The database also enforces this (ON DELETE RESTRICT) — history is
    // never destroyed. The user should cancel the bill instead.
    throw new AuthApiError(409, "This bill has payment history and can't be deleted. Cancel it instead.", "in_use");
  }

  const { error } = await client.from("bills").delete().eq("id", id);
  if (error) throw new AuthApiError(500, "Couldn't delete the bill.", "db_error");
  return { deleted: true };
}

export async function dbMarkPaid(
  client: SupabaseClient,
  userId: string,
  id: string,
  createExpense: boolean
): Promise<BillPaidResult> {
  assertId(id);
  const { data, error } = await client.rpc("mark_bill_paid", {
    p_bill_id: id,
    p_create_expense: Boolean(createExpense),
  });

  if (error) {
    switch (error.message) {
      case "bill_not_found":
        throw new AuthApiError(404, "Bill not found.", "not_found");
      case "unauthorized":
        throw new AuthApiError(403, "This bill belongs to another account.", "forbidden");
      case "bill_cancelled":
        throw new AuthApiError(400, "A cancelled bill can't be paid.", "bill_closed");
      case "bill_already_paid":
        throw new AuthApiError(409, "This bill has already been paid.", "bill_already_paid");
      case "duplicate_payment":
        throw new AuthApiError(409, "This payment has already been recorded.", "bill_already_paid");
      case "insufficient_balance":
        throw new AuthApiError(400, "Your salary balance is too low to cover the overspend.", "insufficient_balance");
      default:
        throw new AuthApiError(500, "Couldn't mark the bill as paid.", "db_error");
    }
  }

  return {
    payment_id: String((data as Record<string, unknown>).payment_id ?? ""),
    transaction_id: ((data as Record<string, unknown>).transaction_id as string | null) ?? null,
    overspend_amount: Number((data as Record<string, unknown>).overspend_amount ?? 0),
    next_due_date: ((data as Record<string, unknown>).next_due_date as string | null) ?? null,
    status: ((data as Record<string, unknown>).status as BillStatus) ?? "paid",
  };
}

export async function dbListPayments(
  client: SupabaseClient,
  userId: string
): Promise<BillPayment[]> {
  const { data, error } = await client
    .from("bill_payments")
    .select("*")
    .eq("user_id", userId)
    .order("paid_at", { ascending: false })
    .limit(100);
  if (error) throw new AuthApiError(500, "Couldn't load payment history.", "db_error");

  const rows = (data ?? []) as Array<Omit<BillPayment, "bill_name" | "bill_category">>;
  if (rows.length === 0) return [];

  const billIds = [...new Set(rows.map((r) => r.bill_id))];
  const { data: bills, error: billsErr } = await client
    .from("bills")
    .select("id, name, category")
    .in("id", billIds);
  if (billsErr) throw new AuthApiError(500, "Couldn't load bill details.", "db_error");

  const nameById = new Map(
    ((bills ?? []) as Array<{ id: string; name: string; category: string | null }>).map((b) => [
      b.id,
      { name: b.name, category: b.category },
    ])
  );

  return rows.map((r) => ({
    ...r,
    bill_name: nameById.get(r.bill_id)?.name ?? null,
    bill_category: nameById.get(r.bill_id)?.category ?? null,
  }));
}

export async function dbListReminders(
  client: SupabaseClient,
  userId: string,
  since?: string
): Promise<BillReminder[]> {
  let query = client
    .from("bill_reminders")
    .select("*")
    .eq("user_id", userId);
  if (since) query = query.gt("fired_at", since);
  const { data, error } = await query.order("fired_at", { ascending: false }).limit(50);
  if (error) throw new AuthApiError(500, "Couldn't load bill reminders.", "db_error");

  const rows = (data ?? []) as Array<Omit<BillReminder, "bill_name" | "amount" | "is_credit_card">>;
  if (rows.length === 0) return [];

  const billIds = [...new Set(rows.map((r) => r.bill_id))];
  const { data: bills, error: billsErr } = await client
    .from("bills")
    .select("id, name, amount, is_credit_card")
    .in("id", billIds);
  if (billsErr) throw new AuthApiError(500, "Couldn't load bill details.", "db_error");

  const infoById = new Map(
    ((bills ?? []) as Array<{ id: string; name: string; amount: number; is_credit_card: boolean }>).map(
      (b) => [b.id, { name: b.name, amount: b.amount, is_credit_card: b.is_credit_card }]
    )
  );

  return rows.map((r) => {
    const info = infoById.get(r.bill_id);
    return {
      ...r,
      bill_name: info?.name ?? null,
      amount: Number(info?.amount ?? 0),
      is_credit_card: Boolean(info?.is_credit_card ?? false),
    };
  });
}
