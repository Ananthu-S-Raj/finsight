"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { BugReport } from "@/lib/bugReports";

export type Whoami = {
  id: string;
  email: string | null;
  role: string;
  permissions: string[];
};

export class ApiClientError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function adminFetch<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/admin${path}`, { cache: "no-store", ...opts, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      (body as { error?: string }).error ?? "Request failed.",
      (body as { code?: string }).code ?? "error"
    );
  }
  return body as T;
}

export type AdminAuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "ready"; whoami: Whoami };

/** Client-side admin gate. The server remains the authority; this hook only
 *  drives the UI. Any request the client makes is independently re-checked
 *  server-side. */
export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        setState({ status: "unauthenticated" });
        return;
      }
      try {
        const whoami = await adminFetch<Whoami>("/whoami");
        if (!active) return;
        setState({ status: "ready", whoami });
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && err.status === 401) {
          setState({ status: "unauthenticated" });
        } else {
          setState({ status: "forbidden" });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Shared response types (mirror the API handlers)
// ---------------------------------------------------------------------------

export type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  account_status: string;
  monthly_budget: number;
  created_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
};

export type UserDetail = AdminUser & {
  salary_balance: number;
  savings_balance: number;
  auth_created_at: string | null;
  transaction_count: number;
  push_count: number;
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number };

export type AdminOverview = {
  users: Record<string, number>;
  finance: Record<string, number>;
  notifications: { sent_last_7_days: number };
  push: { subscribers: number };
  health: {
    database: boolean;
    backend: boolean;
    ai: boolean;
    notifications: boolean;
    pwa: boolean;
    maintenance: boolean;
    app_name: string;
  };
};

/** Response of GET /api/admin/ai/status — never contains API keys. */
export type AdminAIStatus = {
  config: {
    enabled: boolean;
    admin_toggle: boolean;
    provider: string;
    model: string | null;
    configured: boolean;
    features: Record<string, unknown>;
    last_health_check: string | null;
  };
  health: {
    reachable: boolean;
    latency_ms: number | null;
    model: string | null;
    detail: string | null;
  };
};

export type AdminTransaction = {
  id: string;
  user_id: string;
  user: { id: string; email: string | null; full_name: string | null } | null;
  type: string;
  category: string | null;
  subcategory: string | null;
  amount: number;
  overspend_amount: number;
  note: string | null;
  flagged: boolean;
  flag_reason: string | null;
  created_at: string;
};

export type CategoryNode = {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  is_default: boolean;
  is_disabled: boolean;
  sort_order: number;
  children: CategoryNode[];
};

export type RoleWithPermissions = {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
};

export type AuditEntry = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  target_user_id: string | null;
  target_email: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  result: string;
  reason: string | null;
  created_at: string;
};

export type AdminNotification = {
  id: string;
  title: string;
  body: string;
  audience: string;
  target_user_ids: string[] | null;
  channel: string;
  status: string;
  error: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  user: { email: string | null; full_name: string | null } | null;
  endpoint: string | null;
  prefs: Record<string, unknown>;
  created_at: string;
};

export type AdminBugReport = BugReport & {
  user: { id: string; email: string | null; full_name: string | null } | null;
};
