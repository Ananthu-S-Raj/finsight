import { ApiError, requirePermission, writeAudit, type Handler } from "../server";
import { parsePage, requireUuid } from "./helpers";

type SubRow = {
  id: string;
  user_id: string;
  subscription: { endpoint?: string; keys?: unknown } | null;
  prefs: Record<string, unknown>;
  created_at: string;
};

export const listPushSubscriptions: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "USER_VIEW");
  const { from, to, page, pageSize } = parsePage(params);

  const { data, count, error } = await ctx.client
    .from("push_subscriptions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new ApiError(502, "Could not load push subscriptions.", "db_error");

  const rows = (data ?? []) as SubRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const users = new Map<string, { email: string | null; full_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profileRows } = await ctx.client
      .from("profiles")
      .select("id,email,full_name")
      .in("id", userIds);
    for (const row of profileRows ?? []) {
      users.set(row.id as string, {
        email: row.email as string | null,
        full_name: row.full_name as string | null,
      });
    }
  }

  return {
    items: rows.map((row) => {
      const endpoint = (row.subscription as { endpoint?: string } | null)?.endpoint ?? null;
      return {
        id: row.id,
        user_id: row.user_id,
        user: users.get(row.user_id) ?? null,
        endpoint: endpoint ? `${endpoint.slice(0, 48)}…` : null,
        prefs: row.prefs ?? {},
        created_at: row.created_at,
      };
    }),
    total: count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
};

export const deletePushSubscription: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "USER_EDIT");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== "DELETE") {
    throw new ApiError(400, "Confirmation required: set confirm to 'DELETE'.", "confirmation_required");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("push_subscriptions")
    .select("id,user_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the subscription.", "db_error");
  if (!existing) throw new ApiError(404, "Push subscription not found.", "not_found");

  const { error } = await ctx.client.from("push_subscriptions").delete().eq("id", id);
  if (error) throw new ApiError(502, "Could not delete the subscription.", "db_error");

  await writeAudit(ctx, {
    action: "push.delete",
    resource_type: "push_subscription",
    resource_id: id,
    target_user_id: existing.user_id as string,
  });

  return { id, deleted: true };
};
