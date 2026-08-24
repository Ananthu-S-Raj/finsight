"use client";

import { supabase } from "./supabaseClient";
import type {
  RecurringInput,
  RecurringOccurrence,
  RecurringResult,
  RecurringStatus,
  RecurringTransaction,
  RecurringType,
} from "./recurring";

/**
 * Typed client for the /api/v1/recurring/* endpoints. Every call attaches the
 * current session JWT as a Bearer token (the app's own auth, separate from
 * the admin console), so route handlers can verify the session server-side.
 */

export class RecurringApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "RecurringApiError";
    this.status = status;
    this.code = code;
  }
}

async function recurringFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/v1/recurring${path}`, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    status?: number;
  };

  if (!res.ok) {
    throw new RecurringApiError(
      body.error ?? "FinSight couldn't complete that request.",
      res.status,
      body.code ?? "error"
    );
  }
  return body as T;
}

export function listRecurring(type?: RecurringType): Promise<RecurringTransaction[]> {
  const q = type ? `?type=${encodeURIComponent(type)}` : "";
  return recurringFetch(`/${q}`, { method: "GET" });
}

export function getRecurring(id: string): Promise<RecurringTransaction> {
  return recurringFetch(`/${encodeURIComponent(id)}`, { method: "GET" });
}

export function createRecurring(input: RecurringInput): Promise<RecurringTransaction> {
  return recurringFetch("/", { method: "POST", body: JSON.stringify(input) });
}

export function updateRecurring(
  id: string,
  patch: Partial<RecurringInput>
): Promise<RecurringTransaction> {
  return recurringFetch(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteRecurring(id: string): Promise<{ deleted: boolean }> {
  return recurringFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setRecurringStatus(
  id: string,
  status: Exclude<RecurringStatus, "completed">
): Promise<RecurringTransaction> {
  return recurringFetch(`/${encodeURIComponent(id)}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function listPendingOccurrences(): Promise<RecurringOccurrence[]> {
  return recurringFetch("/pending", { method: "GET" });
}

export function confirmOccurrence(
  id: string
): Promise<{ transaction_id: string | null }> {
  return recurringFetch(`/pending/${encodeURIComponent(id)}/confirm`, { method: "POST" });
}

export function skipOccurrence(id: string): Promise<{ skipped: boolean }> {
  return recurringFetch(`/pending/${encodeURIComponent(id)}/skip`, { method: "POST" });
}

/**
 * Runs the catch-up scheduler for the signed-in user directly through the
 * database RPC (no HTTP hop). Idempotent — safe to call on every app load.
 */
export async function processRecurringDue(): Promise<RecurringResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return { processed: 0, generated: 0, pending: 0, skipped: 0, failed: 0 };
  const { data, error } = await supabase.rpc("process_recurring_due", { p_user_id: userId });
  if (error) throw error;
  return (data ?? { processed: 0, generated: 0, pending: 0, skipped: 0, failed: 0 }) as RecurringResult;
}
