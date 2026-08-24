import { ApiError, requirePermission, writeAudit, type AdminContext, type Handler } from "../server";
import { asString, parsePage, parseSort, requireUuid, sanitizeText } from "./helpers";

const NOTIF_SORTABLE = ["created_at", "title", "status", "audience"];

type NotificationInput = {
  title: string;
  message: string;
  audience: string;
  channel: string;
  targetUserIds: string[] | null;
};

/** Validates + normalizes broadcast composer input (shared by create/edit). */
function validateNotificationInput(body: Record<string, unknown>): NotificationInput {
  const title = sanitizeText(body.title, 140);
  const message = sanitizeText(body.body, 2000);
  if (!title || !message) {
    throw new ApiError(400, "Notification title and body are required.", "bad_request");
  }

  const audience = ["all", "users", "admins", "selected"].includes(String(body.audience))
    ? String(body.audience)
    : "all";
  const channel = ["inapp", "push", "both"].includes(String(body.channel))
    ? String(body.channel)
    : "both";

  let targetUserIds: string[] | null = null;
  if (audience === "selected" && Array.isArray(body.target_user_ids)) {
    targetUserIds = body.target_user_ids
      .map((id) => requireUuid({ id: String(id) }))
      .filter(Boolean);
    if (targetUserIds.length === 0) {
      throw new ApiError(400, "At least one recipient is required for 'selected' audience.", "bad_request");
    }
  }

  return { title, message, audience, channel, targetUserIds };
}

export const listNotifications: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "NOTIFICATION_MANAGE");
  const { from, to, page, pageSize } = parsePage(params);
  const sort = parseSort(params, NOTIF_SORTABLE, "created_at", false);

  let query = ctx.client.from("admin_notifications").select("*", { count: "exact" });
  if (params.status) query = query.eq("status", params.status as string);
  query = query.order(sort.column, { ascending: sort.ascending }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new ApiError(502, "Could not load notifications.", "db_error");

  return {
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
};

export const createNotification: Handler = async (ctx, req) => {
  requirePermission(ctx, "NOTIFICATION_MANAGE");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = validateNotificationInput(body);

  const { data, error } = await ctx.client
    .from("admin_notifications")
    .insert({
      title: input.title,
      body: input.message,
      audience: input.audience,
      channel: input.channel,
      target_user_ids: input.targetUserIds,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not create the notification.", "db_error");

  await writeAudit(ctx, {
    action: "notification.create",
    resource_type: "notification",
    resource_id: data.id as string,
    metadata: {
      title: input.title,
      audience: input.audience,
      channel: input.channel,
      target_count: input.targetUserIds?.length ?? null,
    },
  });

  return data;
};

export const updateNotification: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "NOTIFICATION_MANAGE");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = validateNotificationInput(body);

  // Only drafts are editable; once a broadcast has entered the delivery
  // pipeline its content is frozen so the audit trail stays meaningful.
  const { data: existing, error: fetchError } = await ctx.client
    .from("admin_notifications")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the notification.", "db_error");
  if (!existing) throw new ApiError(404, "Notification not found.", "not_found");
  if (existing.status !== "draft") {
    throw new ApiError(409, "Only draft notifications can be edited.", "bad_state");
  }

  const { data, error } = await ctx.client
    .from("admin_notifications")
    .update({
      title: input.title,
      body: input.message,
      audience: input.audience,
      channel: input.channel,
      target_user_ids: input.targetUserIds,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not update the notification.", "db_error");

  await writeAudit(ctx, {
    action: "notification.update",
    resource_type: "notification",
    resource_id: id,
    metadata: {
      title: input.title,
      audience: input.audience,
      channel: input.channel,
      target_count: input.targetUserIds?.length ?? null,
    },
  });

  return data;
};

/**
 * Resolves the in-app audience size for a broadcast, matching the
 * "notifications: read sent" RLS policy exactly:
 *   - 'all' / 'users' → every account (one profiles row per user);
 *   - 'admins'       → admin accounts only (regular users cannot read that
 *     audience — only the is_admin() select policy exposes it);
 *   - 'selected'     → the explicit target list.
 * Push subscriptions are deliberately NOT consulted: this figure describes
 * who the broadcast was addressed to in-app, never devices or delivery.
 */
async function resolveInAppRecipientCount(
  ctx: AdminContext,
  audience: string,
  targetUserIds: unknown
): Promise<number> {
  if (audience === "selected") {
    return Array.isArray(targetUserIds) ? targetUserIds.length : 0;
  }

  let query = ctx.client.from("profiles").select("id", { count: "exact", head: true });
  if (audience === "admins") query = query.eq("role", "admin");
  // 'all' and 'users' address every account identically under RLS.

  const { count, error } = await query;
  if (error || count === null) {
    throw new ApiError(502, "Could not resolve the notification audience.", "db_error");
  }
  return count;
}

export const sendNotification: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "NOTIFICATION_MANAGE");
  const id = requireUuid(params);

  const { data: existing, error: fetchError } = await ctx.client
    .from("admin_notifications")
    .select("id,title,status,channel,audience,target_user_ids")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the notification.", "db_error");
  if (!existing) throw new ApiError(404, "Notification not found.", "not_found");
  if (!["draft", "failed", "cancelled"].includes(existing.status as string)) {
    throw new ApiError(409, "Only draft, failed or cancelled notifications can be sent.", "bad_state");
  }

  // Push delivery has no server-side dispatcher in this deployment. Reject
  // BEFORE flipping status so nothing is ever marked delivered that wasn't.
  if (existing.channel === "push") {
    throw new ApiError(
      409,
      "Push-only broadcasts cannot be delivered yet — switch the channel to 'In-app only' or 'In-app + push'.",
      "push_not_configured"
    );
  }

  // Resolve the audience BEFORE mutating so a failed resolution can never
  // leave half-sent state behind. The count is additive forensic metadata;
  // everything else about the send flow is untouched. The admin_notifications
  // table has no metadata column, so the awaited notification.send audit row
  // (jsonb metadata) is where this value is durably persisted.
  const recipientCount = await resolveInAppRecipientCount(
    ctx,
    existing.audience as string,
    existing.target_user_ids
  );

  const { data: updated, error } = await ctx.client
    .from("admin_notifications")
    .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
    .eq("id", id)
    .select("id,status,sent_at")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not send the notification.", "db_error");

  await writeAudit(ctx, {
    action: "notification.send",
    resource_type: "notification",
    resource_id: id,
    metadata: {
      title: existing.title,
      channel: existing.channel,
      audience: existing.audience,
      // Number of in-app accounts this broadcast was addressed to at send
      // time (see resolveInAppRecipientCount). It does NOT represent push
      // deliveries or read receipts of any kind.
      recipient_count: recipientCount,
      // The in-app leg is genuinely delivered (users read broadcasts from
      // their notification inbox). The push leg is not dispatched anywhere;
      // say so explicitly instead of implying a delivery that never happened.
      dispatch: "in_app_delivered",
      ...(existing.channel !== "inapp" ? { push_dispatch: "not_configured" } : {}),
    },
  });

  return updated;
};

export const cancelNotification: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "NOTIFICATION_MANAGE");
  const id = requireUuid(params);

  const { data: existing, error: fetchError } = await ctx.client
    .from("admin_notifications")
    .select("id,title,status")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the notification.", "db_error");
  if (!existing) throw new ApiError(404, "Notification not found.", "not_found");
  if (existing.status === "sent") {
    throw new ApiError(409, "A sent notification cannot be cancelled.", "bad_state");
  }

  const { data: updated, error } = await ctx.client
    .from("admin_notifications")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("id,status")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not cancel the notification.", "db_error");

  await writeAudit(ctx, {
    action: "notification.cancel",
    resource_type: "notification",
    resource_id: id,
    metadata: { title: existing.title },
  });

  return updated;
};

/** Terminal statuses whose rows an administrator may permanently remove.
 *  Drafts stay editable content; 'sending'/'failed' are pipeline states and
 *  must never be destroyed mid-flight. */
const DELETABLE_STATUSES = ["sent", "cancelled"];

export const deleteNotification: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "NOTIFICATION_MANAGE");
  const id = requireUuid(params);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Same explicit destructive-confirmation convention as transaction/category
  // deletion: the caller must echo confirm:"DELETE" — a stray click or a
  // replayed request without the marker is rejected before any data access.
  if (body.confirm !== "DELETE") {
    throw new ApiError(400, "Confirmation required: set confirm to 'DELETE'.", "confirmation_required");
  }

  // Load first so the audit trail can preserve what is being destroyed.
  const { data: existing, error: fetchError } = await ctx.client
    .from("admin_notifications")
    .select("id,title,status,audience,channel,target_user_ids")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the notification.", "db_error");
  if (!existing) throw new ApiError(404, "Notification not found.", "not_found");

  if (!DELETABLE_STATUSES.includes(existing.status as string)) {
    throw new ApiError(
      409,
      "Only sent or cancelled notifications can be deleted.",
      "bad_state"
    );
  }

  // Deletion flows through the admin's own RLS-scoped client ("notifications:
  // admin delete" policy) — no service role anywhere. Read markers for this
  // broadcast disappear with it via their ON DELETE CASCADE.
  const { error } = await ctx.client.from("admin_notifications").delete().eq("id", id);
  if (error) throw new ApiError(502, "Could not delete the notification.", "db_error");

  // Awaited + throws on failure (writeAudit contract): the console surfaces
  // audit_failed rather than leaving an unaudited destructive action behind.
  await writeAudit(ctx, {
    action: "notification.delete",
    resource_type: "notification",
    resource_id: id,
    metadata: {
      title: existing.title,
      previous_status: existing.status,
      audience: existing.audience,
      channel: existing.channel,
      target_count: Array.isArray(existing.target_user_ids)
        ? existing.target_user_ids.length
        : null,
    },
  });

  return { id, deleted: true };
};
