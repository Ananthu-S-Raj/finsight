"use client";

import { supabase } from "./supabaseClient";
import type {
  Goal,
  GoalContribution,
  GoalContributionResult,
  GoalInput,
  GoalReminder,
  GoalStatus,
} from "./goals";

/**
 * Typed client for the /api/v1/goals/* endpoints. Every call attaches the
 * current session JWT as a Bearer token (the app's own auth, separate from
 * the admin console), so route handlers can verify the session server-side.
 */

export class GoalApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "GoalApiError";
    this.status = status;
    this.code = code;
  }
}

async function goalsFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/v1/goals${path}`, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    status?: number;
  };

  if (!res.ok) {
    throw new GoalApiError(
      body.error ?? "FinSight couldn't complete that request.",
      res.status,
      body.code ?? "error"
    );
  }
  return body as T;
}

export function listGoals(status?: GoalStatus): Promise<Goal[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return goalsFetch(`/${q}`, { method: "GET" });
}

export function getGoal(id: string): Promise<Goal> {
  return goalsFetch(`/${encodeURIComponent(id)}`, { method: "GET" });
}

export function createGoal(input: GoalInput): Promise<Goal> {
  return goalsFetch("/", { method: "POST", body: JSON.stringify(input) });
}

export function updateGoal(id: string, patch: Partial<GoalInput>): Promise<Goal> {
  return goalsFetch(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteGoal(id: string): Promise<{ deleted: boolean }> {
  return goalsFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function contributeToGoal(
  id: string,
  amount: number,
  note?: string | null
): Promise<GoalContributionResult> {
  return goalsFetch(`/${encodeURIComponent(id)}/contribute`, {
    method: "POST",
    body: JSON.stringify({ amount, note: note ?? null }),
  });
}

export function removeContribution(
  goalId: string,
  contributionId: string
): Promise<GoalContributionResult> {
  return goalsFetch(
    `/${encodeURIComponent(goalId)}/contributions/${encodeURIComponent(contributionId)}`,
    { method: "DELETE" }
  );
}

export function setGoalStatus(id: string, status: GoalStatus): Promise<Goal> {
  return goalsFetch(`/${encodeURIComponent(id)}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function listContributions(goalId: string): Promise<GoalContribution[]> {
  return goalsFetch(`/${encodeURIComponent(goalId)}/contributions`, { method: "GET" });
}

/** Fired goal reminders, newest first. `since` narrows to reminders after it. */
export function listGoalReminders(since?: string): Promise<GoalReminder[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return goalsFetch(`/reminders${q}`, { method: "GET" });
}

/**
 * Generates the signed-in user's goal reminders directly through the
 * database RPC (no HTTP hop). Idempotent — the unique (goal, target_date,
 * kind) index means each reminder fires exactly once.
 */
export async function generateGoalReminders(): Promise<GoalReminder[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase.rpc("generate_goal_reminders", { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as GoalReminder[];
}
