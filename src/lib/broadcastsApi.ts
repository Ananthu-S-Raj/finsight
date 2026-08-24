"use client";

import { supabase } from "./supabaseClient";
import type { BroadcastList } from "./notificationsServer";

/**
 * Typed client for the /api/v1/notifications/* endpoints (admin broadcast
 * inbox). Every call attaches the current session JWT as a Bearer token, so
 * route handlers can verify the session server-side; audience targeting and
 * read-marker ownership are enforced by RLS in the database.
 */

export class BroadcastApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BroadcastApiError";
    this.status = status;
    this.code = code;
  }
}

async function broadcastsFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/v1/notifications${path}`, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    status?: number;
  };

  if (!res.ok) {
    throw new BroadcastApiError(
      body.error ?? "FinSight couldn't complete that request.",
      res.status,
      body.code ?? "error"
    );
  }
  return body as T;
}

export function listBroadcasts(page = 1, pageSize = 20): Promise<BroadcastList> {
  const q = `?page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}`;
  return broadcastsFetch(q, { method: "GET" });
}

export function markBroadcastRead(id: string): Promise<{ id: string; read: boolean }> {
  return broadcastsFetch(`/${encodeURIComponent(id)}/read`, { method: "POST" });
}
