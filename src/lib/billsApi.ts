"use client";

import { supabase } from "./supabaseClient";
import type {
  Bill,
  BillInput,
  BillPaidResult,
  BillPayment,
  BillReminder,
  BillStatus,
} from "./bills";

/**
 * Typed client for the /api/v1/bills/* endpoints. Every call attaches the
 * current session JWT as a Bearer token (the app's own auth, separate from
 * the admin console), so route handlers can verify the session server-side.
 */

export class BillApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BillApiError";
    this.status = status;
    this.code = code;
  }
}

async function billsFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/v1/bills${path}`, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    status?: number;
  };

  if (!res.ok) {
    throw new BillApiError(
      body.error ?? "FinSight couldn't complete that request.",
      res.status,
      body.code ?? "error"
    );
  }
  return body as T;
}

export function listBills(status?: BillStatus): Promise<Bill[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return billsFetch(`/${q}`, { method: "GET" });
}

export function getBill(id: string): Promise<Bill> {
  return billsFetch(`/${encodeURIComponent(id)}`, { method: "GET" });
}

export function createBill(input: BillInput): Promise<Bill> {
  return billsFetch("/", { method: "POST", body: JSON.stringify(input) });
}

export function updateBill(id: string, patch: Partial<BillInput>): Promise<Bill> {
  return billsFetch(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteBill(id: string): Promise<{ deleted: boolean }> {
  return billsFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function markBillPaid(id: string, createExpense: boolean): Promise<BillPaidResult> {
  return billsFetch(`/${encodeURIComponent(id)}/paid`, {
    method: "POST",
    body: JSON.stringify({ create_expense: createExpense }),
  });
}

export function cancelBill(id: string): Promise<Bill> {
  return billsFetch(`/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function listPayments(): Promise<BillPayment[]> {
  return billsFetch("/payments", { method: "GET" });
}

/**
 * Fired bill reminders for the signed-in user, newest first. `since` (ISO
 * timestamp) narrows to reminders fired after that moment. Rows include the
 * joined bill name / amount so clients can build messages without a second
 * round-trip.
 */
export function listReminders(since?: string): Promise<BillReminder[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return billsFetch(`/reminders${q}`, { method: "GET" });
}

/**
 * Generates the signed-in user's bill reminders directly through the
 * database RPC (no HTTP hop). Idempotent — the unique (bill, due_date, kind)
 * index means each reminder fires exactly once. Returns the rows created by
 * this call.
 */
export async function generateBillReminders(): Promise<Array<{
  id: string;
  user_id: string;
  bill_id: string;
  kind: "advance" | "due" | "overdue";
  days_before: number;
  due_date: string;
  fired_at: string;
  bill_name: string | null;
  amount: number;
  is_credit_card: boolean;
}>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase.rpc("generate_bill_reminders", { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    user_id: string;
    bill_id: string;
    kind: "advance" | "due" | "overdue";
    days_before: number;
    due_date: string;
    fired_at: string;
    bill_name: string | null;
    amount: number;
    is_credit_card: boolean;
  }>;
}
