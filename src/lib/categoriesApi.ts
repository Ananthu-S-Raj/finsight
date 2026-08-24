"use client";

import { supabase } from "./supabaseClient";
import type { Category } from "./categories";

export class CategoriesApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "CategoriesApiError";
    this.status = status;
    this.code = code;
  }
}

async function categoriesFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/v1/categories${path}`, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    status?: number;
  };

  if (!res.ok) {
    throw new CategoriesApiError(
      body.error ?? "FinSight couldn't load categories.",
      res.status,
      body.code ?? "error"
    );
  }
  return body as T;
}

export function listCategories(): Promise<Category[]> {
  return categoriesFetch("/", { method: "GET" });
}
