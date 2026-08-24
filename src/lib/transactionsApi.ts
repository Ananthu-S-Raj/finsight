"use client";

import { supabase } from "./supabaseClient";
import type {
  ListCursor,
  TransactionFilters,
  TransactionListResult,
  TransactionRow,
} from "./transactions";

export class TransactionsApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "TransactionsApiError";
    this.status = status;
    this.code = code;
  }
}

async function transactionsFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/v1/transactions${path}`, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    status?: number;
  };

  if (!res.ok) {
    throw new TransactionsApiError(
      body.error ?? "FinSight couldn't load transactions.",
      res.status,
      body.code ?? "error"
    );
  }
  return body as T;
}

export function listTransactions(
  filters: TransactionFilters,
  after?: string | null,
  limit = 25
): Promise<TransactionListResult> {
  const params = new URLSearchParams();
  if (filters.range) params.set("range", filters.range);
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.min !== undefined) params.set("min", String(filters.min));
  if (filters.max !== undefined) params.set("max", String(filters.max));
  if (filters.search) params.set("search", filters.search);
  if (filters.order) params.set("order", filters.order);
  if (filters.direction) params.set("direction", filters.direction);
  if (after) params.set("after", after);
  params.set("limit", String(limit));

  return transactionsFetch(`/?${params.toString()}`, { method: "GET" });
}

export type { ListCursor, TransactionFilters, TransactionListResult, TransactionRow };
