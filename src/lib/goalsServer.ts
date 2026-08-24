/**
 * Server-side operations for the goals feature. These run against a
 * user-scoped Supabase client (never the service role), so RLS scoping is
 * enforced by the database for every read and write. Contributions are the
 * exception: they go through the SECURITY DEFINER `contribute_to_goal` /
 * `remove_goal_contribution` RPCs so the goal ledger stays the single source
 * of truth for `current_amount` and no client arithmetic can drift it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthApiError } from "@/lib/auth/errors";
import {
  normalizeContributionAmount,
  normalizeGoalInput,
  GOAL_STATUSES,
  type Goal,
  type GoalContribution,
  type GoalContributionResult,
  type GoalInput,
  type GoalReminder,
  type GoalStatus,
} from "./goals";

export type GoalRoute =
  | { kind: "list"; status?: GoalStatus }
  | { kind: "create" }
  | { kind: "reminders"; since?: string }
  | { kind: "get"; id: string }
  | { kind: "update"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "contribute"; id: string }
  | { kind: "contributions"; id: string }
  | { kind: "remove_contribution"; id: string; contributionId: string }
  | { kind: "set_status"; id: string };

/**
 * Maps a request to an operation. `slug` is the path segments after
 * `/api/v1/goals`. Literal segments ("reminders") take precedence over
 * resource ids.
 */
export function matchGoalRoute(method: string, slug: string[]): GoalRoute | null {
  const s = slug ?? [];
  const m = method.toUpperCase();

  if (m === "GET" && s.length === 0) return { kind: "list" };
  if (m === "POST" && s.length === 0) return { kind: "create" };
  if (m === "GET" && s.length === 1 && s[0] === "reminders") return { kind: "reminders" };
  if (m === "POST" && s.length === 2 && s[1] === "contribute") {
    return { kind: "contribute", id: s[0] };
  }
  if (m === "GET" && s.length === 2 && s[1] === "contributions") {
    return { kind: "contributions", id: s[0] };
  }
  if (m === "DELETE" && s.length === 3 && s[1] === "contributions") {
    return { kind: "remove_contribution", id: s[0], contributionId: s[2] };
  }
  if (m === "POST" && s.length === 2 && s[1] === "status") {
    return { kind: "set_status", id: s[0] };
  }
  if (m === "GET" && s.length === 1) return { kind: "get", id: s[0] };
  if (m === "PATCH" && s.length === 1) return { kind: "update", id: s[0] };
  if (m === "DELETE" && s.length === 1) return { kind: "delete", id: s[0] };

  return null;
}

export function parseGoalListStatus(raw: string | null): GoalStatus | undefined {
  if (raw === "active" || raw === "completed" || raw === "paused" || raw === "cancelled") {
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

export async function dbListGoals(
  client: SupabaseClient,
  userId: string,
  status?: GoalStatus
): Promise<Goal[]> {
  let query = client.from("financial_goals").select("*").eq("user_id", userId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("target_date", { ascending: true });
  if (error) throw new AuthApiError(500, "Couldn't load your goals.", "db_error");
  return (data ?? []) as Goal[];
}

export async function dbGetGoal(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<Goal> {
  assertId(id);
  const { data, error } = await client
    .from("financial_goals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AuthApiError(500, "Couldn't load the goal.", "db_error");
  if (!data || data.user_id !== userId) {
    throw new AuthApiError(404, "Goal not found.", "not_found");
  }
  return data as Goal;
}

async function insertGoal(
  client: SupabaseClient,
  userId: string,
  input: GoalInput
): Promise<Goal> {
  const { data, error } = await client
    .from("financial_goals")
    .insert({
      user_id: userId,
      name: input.name,
      target_amount: input.target_amount,
      current_amount: input.current_amount,
      target_date: input.target_date,
      description: input.description,
      category: input.category,
      category_id: input.category_id,
      icon: input.icon,
      theme: input.theme,
      reminder_enabled: input.reminder_enabled,
      status: "active",
    })
    .select("*")
    .single();

  if (error) throw new AuthApiError(500, "Couldn't create the goal.", "db_error");
  return data as Goal;
}

export async function dbCreateGoal(
  client: SupabaseClient,
  userId: string,
  raw: Record<string, unknown>
): Promise<Goal> {
  return insertGoal(client, userId, normalizeGoalInput(raw));
}

const EDITABLE_FIELDS = [
  "name",
  "target_amount",
  "target_date",
  "description",
  "category",
  "category_id",
  "icon",
  "theme",
  "reminder_enabled",
] as const;

export async function dbUpdateGoal(
  client: SupabaseClient,
  userId: string,
  id: string,
  raw: Record<string, unknown>
): Promise<Goal> {
  assertId(id);
  const existing = await dbGetGoal(client, userId, id);

  if (existing.status === "cancelled") {
    throw new AuthApiError(400, "A cancelled goal can't be edited.", "goal_closed");
  }

  // Patch semantics: only listed fields are accepted. `current_amount` is
  // deliberately NOT editable — the contribution ledger is the single source
  // of truth for progress.
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in raw) patch[key] = raw[key];
  }

  const input = normalizeGoalInput({ ...existing, ...patch });

  const update: Record<string, unknown> = {
    ...input,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("financial_goals")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new AuthApiError(500, "Couldn't update the goal.", "db_error");
  return data as Goal;
}

const TRANSITIONS: Partial<Record<GoalStatus, GoalStatus[]>> = {
  active: ["paused", "cancelled"],
  paused: ["active", "cancelled"],
  completed: ["active"],
};

/**
 * Pause / resume / cancel. Cancelling is the sanctioned soft delete — the
 * goal disappears from default listings but its contribution history is
 * preserved forever. Completed goals can only be reopened as active.
 */
export async function dbSetGoalStatus(
  client: SupabaseClient,
  userId: string,
  id: string,
  status: GoalStatus
): Promise<Goal> {
  assertId(id);
  const existing = await dbGetGoal(client, userId, id);

  if (!GOAL_STATUSES.includes(status)) {
    throw new AuthApiError(400, "That goal state isn't allowed.", "invalid_status");
  }
  const allowed = TRANSITIONS[existing.status];
  if (!allowed || !allowed.includes(status)) {
    throw new AuthApiError(
      400,
      `A ${existing.status} goal can't be ${status === "cancelled" ? "cancelled" : `set to ${status}`}.`,
      "invalid_transition"
    );
  }

  const { data, error } = await client
    .from("financial_goals")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new AuthApiError(500, "Couldn't update the goal.", "db_error");
  return data as Goal;
}

export async function dbDeleteGoal(
  client: SupabaseClient,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  assertId(id);
  const existing = await dbGetGoal(client, userId, id);

  const { count, error: countError } = await client
    .from("goal_contributions")
    .select("id", { count: "exact", head: true })
    .eq("goal_id", id);
  if (countError) throw new AuthApiError(500, "Couldn't check the goal's contribution history.", "db_error");
  if ((count ?? 0) > 0) {
    // The database also enforces this (ON DELETE RESTRICT) — money history is
    // never destroyed. Cancel the goal instead (it disappears from the list).
    throw new AuthApiError(
      409,
      "This goal has contribution history and can't be deleted. Cancel it instead.",
      "in_use"
    );
  }

  const { error } = await client.from("financial_goals").delete().eq("id", id);
  if (error) throw new AuthApiError(500, "Couldn't delete the goal.", "db_error");
  return { deleted: true };
}

/** Adds a contribution via the SECURITY DEFINER RPC (no money moves). */
export async function dbContributeToGoal(
  client: SupabaseClient,
  userId: string,
  id: string,
  raw: Record<string, unknown>
): Promise<GoalContributionResult> {
  assertId(id);
  const amount = normalizeContributionAmount(raw.amount);
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 300) : null;

  const { data, error } = await client.rpc("contribute_to_goal", {
    p_goal_id: id,
    p_amount: amount,
    p_note: note,
  });

  if (error) {
    switch (error.message) {
      case "goal_not_found":
        throw new AuthApiError(404, "Goal not found.", "not_found");
      case "goal_cancelled":
        throw new AuthApiError(400, "A cancelled goal can't receive contributions.", "goal_closed");
      case "invalid_amount":
        throw new AuthApiError(400, "Contribution must be greater than zero.", "invalid_amount");
      default:
        throw new AuthApiError(500, "Couldn't record the contribution.", "db_error");
    }
  }

  return {
    goal_id: String((data as Record<string, unknown>).goal_id ?? ""),
    current_amount: Number((data as Record<string, unknown>).current_amount ?? 0),
    target_amount: Number((data as Record<string, unknown>).target_amount ?? 0),
    status: ((data as Record<string, unknown>).status as GoalStatus) ?? "active",
  };
}

/** Removes a contribution (correction) via the SECURITY DEFINER RPC. */
export async function dbRemoveContribution(
  client: SupabaseClient,
  userId: string,
  id: string,
  contributionId: string
): Promise<GoalContributionResult> {
  assertId(id);
  assertId(contributionId);

  const { data, error } = await client.rpc("remove_goal_contribution", {
    p_goal_id: id,
    p_contribution_id: contributionId,
  });

  if (error) {
    switch (error.message) {
      case "goal_not_found":
        throw new AuthApiError(404, "Goal not found.", "not_found");
      case "invalid_request":
        throw new AuthApiError(400, "Invalid contribution id.", "bad_request");
      default:
        throw new AuthApiError(500, "Couldn't remove the contribution.", "db_error");
    }
  }

  return {
    goal_id: String((data as Record<string, unknown>).goal_id ?? ""),
    current_amount: Number((data as Record<string, unknown>).current_amount ?? 0),
    target_amount: Number((data as Record<string, unknown>).target_amount ?? 0),
    status: ((data as Record<string, unknown>).status as GoalStatus) ?? "active",
  };
}

export async function dbListContributions(
  client: SupabaseClient,
  userId: string,
  goalId: string
): Promise<GoalContribution[]> {
  assertId(goalId);
  const { data, error } = await client
    .from("goal_contributions")
    .select("*")
    .eq("goal_id", goalId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new AuthApiError(500, "Couldn't load contribution history.", "db_error");
  return (data ?? []) as GoalContribution[];
}

export async function dbListReminders(
  client: SupabaseClient,
  userId: string,
  since?: string
): Promise<GoalReminder[]> {
  let query = client
    .from("goal_reminders")
    .select("*")
    .eq("user_id", userId);
  if (since) query = query.gt("fired_at", since);
  const { data, error } = await query.order("fired_at", { ascending: false }).limit(50);
  if (error) throw new AuthApiError(500, "Couldn't load goal reminders.", "db_error");

  const rows = (data ?? []) as Array<Omit<GoalReminder, "goal_name" | "target_amount" | "current_amount">>;
  if (rows.length === 0) return [];

  const goalIds = [...new Set(rows.map((r) => r.goal_id))];
  const { data: goals, error: goalsErr } = await client
    .from("financial_goals")
    .select("id, name, target_amount, current_amount")
    .in("id", goalIds);
  if (goalsErr) throw new AuthApiError(500, "Couldn't load goal details.", "db_error");

  const infoById = new Map(
    ((goals ?? []) as Array<{ id: string; name: string; target_amount: number; current_amount: number }>).map(
      (g) => [g.id, { name: g.name, target_amount: g.target_amount, current_amount: g.current_amount }]
    )
  );

  return rows.map((r) => {
    const info = infoById.get(r.goal_id);
    return {
      ...r,
      goal_name: info?.name ?? null,
      target_amount: Number(info?.target_amount ?? 0),
      current_amount: Number(info?.current_amount ?? 0),
    };
  });
}
