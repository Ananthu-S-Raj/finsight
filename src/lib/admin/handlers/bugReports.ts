import { ApiError, readJsonBody, requirePermission, writeAudit, type Handler } from "../server";
import { asString, parsePage, requireUuid, sanitizeText } from "./helpers";
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_STATUSES,
  type BugReport,
  isBugReportStatus,
} from "../../bugReports";

type BugReportWithUser = BugReport & {
  user: { id: string; email: string | null; full_name: string | null } | null;
};

const CATEGORY_VALUES = BUG_REPORT_CATEGORIES as readonly string[];

export const listBugReports: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "BUG_REPORT_MANAGE");
  const { from, to, page, pageSize } = parsePage(params);

  let query = ctx.client.from("bug_reports").select("*", { count: "exact" });

  const status = asString(params.status);
  if (status) {
    if (!isBugReportStatus(status)) {
      throw new ApiError(
        400,
        `Invalid status. Expected one of: ${BUG_REPORT_STATUSES.join(", ")}.`,
        "bad_request"
      );
    }
    query = query.eq("status", status);
  }

  const category = asString(params.category);
  if (category) {
    if (!CATEGORY_VALUES.includes(category)) {
      throw new ApiError(
        400,
        `Invalid category. Expected one of: ${CATEGORY_VALUES.join(", ")}.`,
        "bad_request"
      );
    }
    query = query.eq("category", category);
  }

  const search = asString(params.search);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new ApiError(502, "Could not load bug reports.", "db_error");

  const reports = (data ?? []) as BugReport[];

  // Attach the reporter's identity for the triage table. Profiles is
  // admin-readable under RLS, so a batched lookup is safe and cheap.
  const userIds = Array.from(new Set(reports.map((r) => r.user_id)));
  const usersById = new Map<string, { id: string; email: string | null; full_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await ctx.client
      .from("profiles")
      .select("id,email,full_name")
      .in("id", userIds);
    if (!profileError) {
      for (const p of profiles ?? []) {
        usersById.set(p.id, { id: p.id, email: p.email ?? null, full_name: p.full_name ?? null });
      }
    }
  }

  const items: BugReportWithUser[] = reports.map((r) => ({
    ...r,
    user: usersById.get(r.user_id) ?? null,
  }));

  return {
    items,
    total: count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
};

export const updateBugReport: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "BUG_REPORT_MANAGE");
  const id = requireUuid(params);
  const body = await readJsonBody(req);

  const changes: Record<string, unknown> = {};
  if ("status" in body) {
    const status = asString(body.status);
    if (!status || !isBugReportStatus(status)) {
      throw new ApiError(
        400,
        `Invalid status. Expected one of: ${BUG_REPORT_STATUSES.join(", ")}.`,
        "bad_request"
      );
    }
    changes.status = status;
  }
  if ("admin_notes" in body) {
    const notes = sanitizeText(body.admin_notes, 4000);
    changes.admin_notes = notes === "" ? null : notes;
  }

  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "No supported fields provided.", "bad_request");
  }

  const auditChanges = { ...changes };

  // The Admin Console never writes other columns; bump the audit trail on
  // updates so the "last touched" timestamp stays honest.
  changes.updated_at = new Date().toISOString();

  const { data: updated, error } = await ctx.client
    .from("bug_reports")
    .update(changes)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not update the bug report.", "db_error");
  if (!updated) throw new ApiError(404, "Bug report not found.", "not_found");

  await writeAudit(ctx, {
    action: "bug_report.update",
    resource_type: "bug_report",
    resource_id: id,
    target_user_id: (updated.user_id as string) ?? null,
    metadata: auditChanges,
  });

  return updated;
};