import { ApiError, requirePermission, type Handler } from "../server";
import { AUDIT_RESOURCE_TYPES } from "../auditResourceTypes";
import { asString, parseIsoDateParam, parseOptionalUuidParam, parsePage } from "./helpers";

export const listAuditLogs: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "AUDIT_LOG_VIEW");
  const { from, to, page, pageSize } = parsePage(params);

  let query = ctx.client.from("audit_logs").select("*", { count: "exact" });

  const action = asString(params.action);
  if (action) query = query.eq("action", action);
  const userId = asString(params.userId);
  if (userId) query = query.eq("target_user_id", userId);
  const actorId = parseOptionalUuidParam(params.actorId, "actorId");
  if (actorId) query = query.eq("actor_id", actorId);
  const dateFrom = parseIsoDateParam(params.dateFrom, "dateFrom", "start");
  if (dateFrom) query = query.gte("created_at", dateFrom);
  const dateTo = parseIsoDateParam(params.dateTo, "dateTo", "end");
  if (dateTo) query = query.lte("created_at", dateTo);

  const resourceType = asString(params.resourceType);
  if (resourceType) {
    if (!(AUDIT_RESOURCE_TYPES as readonly string[]).includes(resourceType)) {
      throw new ApiError(
        400,
        `Invalid resourceType. Expected one of: ${AUDIT_RESOURCE_TYPES.join(", ")}.`,
        "bad_request"
      );
    }
    query = query.eq("resource_type", resourceType);
  }
  const resourceId = parseOptionalUuidParam(params.resourceId, "resourceId");
  if (resourceId) query = query.eq("resource_id", resourceId);

  const search = asString(params.search);
  if (search) query = query.or(`actor_email.ilike.%${search}%,target_email.ilike.%${search}%`);

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new ApiError(502, "Could not load audit logs.", "db_error");

  return {
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
};
