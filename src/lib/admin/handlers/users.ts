import { ApiError, requirePermission, writeAudit, type AdminContext, type Handler, type RouteParams } from "../server";
import {
  asNumber,
  asString,
  parsePage,
  parseSort,
  requireUuid,
  sanitizeText,
} from "./helpers";
import { createAnonClient } from "@/lib/auth/supabaseServer";
import { requestPasswordReset } from "@/lib/auth/passwordReset";
import { adminPasswordResetRateLimiter } from "@/lib/rateLimit";

const USER_SORTABLE = ["created_at", "last_active_at", "email", "full_name", "role", "account_status"];

const ALLOWED_ROLES = ["user", "admin"];
const ALLOWED_STATUS = ["active", "disabled", "suspended"];

type AuthInfo = {
  user_id: string;
  email_confirmed_at: string | null;
  auth_created_at: string | null;
  last_sign_in_at: string | null;
};

async function enrichAuth(
  ctx: AdminContext,
  ids: string[]
): Promise<Map<string, AuthInfo>> {
  const map = new Map<string, AuthInfo>();
  if (ids.length === 0) return map;
  const { data, error } = await ctx.client.rpc("admin_auth_infos", { ids });
  if (!error && Array.isArray(data)) {
    for (const row of data as AuthInfo[]) map.set(row.user_id, row);
  }
  return map;
}

async function countActiveAdmins(ctx: AdminContext, excludeId?: string): Promise<number> {
  let query = ctx.client
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("account_status", "active");
  if (excludeId) query = query.neq("id", excludeId);
  const { count } = await query;
  return count ?? 0;
}

function mapProfile(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    email: row.email as string | null,
    full_name: row.full_name as string | null,
    role: row.role as string,
    account_status: row.account_status as string,
    monthly_budget: Number(row.monthly_budget ?? 0),
    created_at: row.created_at as string,
    last_login_at: (row.last_login_at as string | null) ?? null,
    last_active_at: (row.last_active_at as string | null) ?? null,
  };
}

/**
 * Unverified-only listing (`?verified=false`, G-07). Email verification
 * state lives in auth.users and reaches the API exclusively through the
 * admin_auth_infos rpc, so the candidate ids are resolved with the regular
 * filters first and then intersected with the real verification state
 * before paging. Users missing from the rpc response count as unverified,
 * matching how the console renders a null email_confirmed_at.
 */
async function listUnverifiedUsers(
  ctx: AdminContext,
  params: RouteParams,
  opts: { sort: { column: string; ascending: boolean }; from: number; to: number; page: number; pageSize: number }
) {
  const search = asString(params.search);
  let idQuery = ctx.client.from("profiles").select("id");
  if (params.role && ALLOWED_ROLES.includes(params.role as string)) {
    idQuery = idQuery.eq("role", params.role as string);
  }
  if (params.status && ALLOWED_STATUS.includes(params.status as string)) {
    idQuery = idQuery.eq("account_status", params.status as string);
  }
  if (search) {
    idQuery = idQuery.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
  }
  idQuery = idQuery.order(opts.sort.column, { ascending: opts.sort.ascending });
  const { data: allRows, error: idError } = await idQuery;
  if (idError) throw new ApiError(502, "Could not load users.", "db_error");

  const authMap = await enrichAuth(ctx, (allRows ?? []).map((r) => r.id as string));
  const unverifiedIds = (allRows ?? [])
    .map((r) => r.id as string)
    .filter((id) => authMap.get(id)?.email_confirmed_at == null);

  const total = unverifiedIds.length;
  const envelope = {
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    pages: Math.max(1, Math.ceil(total / opts.pageSize)),
  };
  const pageIds = unverifiedIds.slice(opts.from, opts.to + 1);
  if (pageIds.length === 0) return { items: [], ...envelope };

  // Re-query with the same ordering so the requested sort is honoured even
  // though the page slice was computed from the ordered id pass.
  const { data: rows, error } = await ctx.client
    .from("profiles")
    .select("*")
    .in("id", pageIds)
    .order(opts.sort.column, { ascending: opts.sort.ascending });
  if (error) throw new ApiError(502, "Could not load users.", "db_error");

  const items = (rows ?? []).map((row) => {
    const item = mapProfile(row);
    const auth = authMap.get(item.id);
    return {
      ...item,
      email_confirmed_at: auth?.email_confirmed_at ?? null,
      last_sign_in_at: auth?.last_sign_in_at ?? null,
    };
  });
  return { items, ...envelope };
}

export const listUsers: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "USER_VIEW");
  if (params.verified !== undefined && params.verified !== "false") {
    throw new ApiError(400, "Invalid verified value. Only 'false' is supported.", "bad_request");
  }
  if (params.verified === "false") {
    return listUnverifiedUsers(ctx, params, {
      sort: parseSort(params, USER_SORTABLE, "created_at", false),
      ...parsePage(params),
    });
  }

  const { from, to, page, pageSize } = parsePage(params);
  const sort = parseSort(params, USER_SORTABLE, "created_at", false);

  const search = asString(params.search);
  let query = ctx.client.from("profiles").select("*", { count: "exact" });

  if (params.role && ALLOWED_ROLES.includes(params.role as string)) {
    query = query.eq("role", params.role as string);
  }
  if (params.status && ALLOWED_STATUS.includes(params.status as string)) {
    query = query.eq("account_status", params.status as string);
  }
  if (search) {
    query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
  }
  query = query.order(sort.column, { ascending: sort.ascending }).range(from, to);

  const { data, count, error } = await query;
  if (error) throw new ApiError(502, "Could not load users.", "db_error");

  const items = (data ?? []).map((row) => mapProfile(row));

  const authMap = await enrichAuth(ctx, items.map((i) => i.id));
  const enriched = items.map((item) => {
    const auth = authMap.get(item.id);
    return {
      ...item,
      email_confirmed_at: auth?.email_confirmed_at ?? null,
      last_sign_in_at: auth?.last_sign_in_at ?? null,
    };
  });

  return {
    items: enriched,
    total: count ?? 0,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
};

export const getUser: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "USER_VIEW");
  const id = requireUuid(params);

  const { data, error } = await ctx.client.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw new ApiError(502, "Could not load the user.", "db_error");
  if (!data) throw new ApiError(404, "User not found.", "not_found");

  const authMap = await enrichAuth(ctx, [id]);
  const auth = authMap.get(id);

  const { count: transactionCount } = await ctx.client
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", id);

  const { count: pushCount } = await ctx.client
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", id);

  return {
    id,
    email: data.email ?? null,
    full_name: data.full_name ?? null,
    role: data.role,
    account_status: data.account_status,
    monthly_budget: Number(data.monthly_budget ?? 0),
    salary_balance: Number(data.salary_balance ?? 0),
    savings_balance: Number(data.savings_balance ?? 0),
    created_at: data.created_at,
    last_login_at: data.last_login_at ?? null,
    last_active_at: data.last_active_at ?? null,
    email_confirmed_at: auth?.email_confirmed_at ?? null,
    auth_created_at: auth?.auth_created_at ?? null,
    last_sign_in_at: auth?.last_sign_in_at ?? null,
    transaction_count: transactionCount ?? 0,
    push_count: pushCount ?? 0,
  };
};

export const updateUser: Handler = async (ctx, req, params) => {
  const id = requireUuid(params);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const changes: Record<string, unknown> = {};
  const auditMeta: Record<string, unknown> = {};

  if ("role" in body) {
    requirePermission(ctx, "ROLE_MANAGE");
    const role = asString(body.role);
    if (!role) {
      throw new ApiError(400, "Role must be a non-empty string.", "bad_request");
    }
    // WS-B: validate against the live roles table instead of a hard-coded
    // allowlist. A lookup failure fails closed — an unreadable roles table
    // can never approve a role change.
    const { data: roleRow, error: roleError } = await ctx.client
      .from("roles")
      .select("name")
      .eq("name", role)
      .maybeSingle();
    if (roleError) throw new ApiError(502, "Could not validate the role.", "db_error");
    if (!roleRow) throw new ApiError(400, "That role does not exist.", "bad_request");
    changes.role = role;
    auditMeta.role = role;
  }
  if ("account_status" in body) {
    requirePermission(ctx, "USER_SUSPEND");
    const status = asString(body.account_status);
    if (!status || !ALLOWED_STATUS.includes(status)) {
      throw new ApiError(400, "Account status must be 'active', 'disabled' or 'suspended'.", "bad_request");
    }
    changes.account_status = status;
    auditMeta.account_status = status;
  }
  if ("full_name" in body) {
    requirePermission(ctx, "USER_EDIT");
    const name = sanitizeText(body.full_name, 80);
    changes.full_name = name;
  }
  if ("monthly_budget" in body) {
    requirePermission(ctx, "USER_EDIT");
    const budget = asNumber(body.monthly_budget);
    if (budget === undefined || budget < 0) {
      throw new ApiError(400, "Monthly budget must be a non-negative number.", "bad_request");
    }
    changes.monthly_budget = budget;
  }

  if (Object.keys(changes).length === 0) {
    throw new ApiError(400, "No supported fields provided.", "bad_request");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("profiles")
    .select("id,role,account_status,email,full_name")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load the user.", "db_error");
  if (!existing) throw new ApiError(404, "User not found.", "not_found");

  const currentRole = existing.role as string;
  const currentStatus = existing.account_status as string;
  const isAdminNow = currentRole === "admin";
  // Any move off the 'admin' role (not just to 'user') ceases active-admin
  // status now that validation accepts every seeded/live role name.
  const wouldCeaseActiveAdmin =
    isAdminNow &&
    currentStatus === "active" &&
    ((typeof changes.role === "string" && changes.role !== "admin") ||
      (changes.account_status ?? currentStatus) !== "active");

  if (wouldCeaseActiveAdmin) {
    const others = await countActiveAdmins(ctx, id);
    if (others < 1) {
      throw new ApiError(
        409,
        "At least one active administrator must remain.",
        "last_admin"
      );
    }
  }

  const { data: updated, error } = await ctx.client
    .from("profiles")
    .update(changes)
    .eq("id", id)
    .select("id,role,account_status,full_name,monthly_budget")
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not update the user.", "db_error");

  // Status-only updates get precise lifecycle actions (user.suspend /
  // user.disable / user.activate); anything mixed or profile-only stays
  // user.update. Every mutation still audits exactly once.
  const isStatusOnly =
    Object.keys(changes).length === 1 && typeof changes.account_status === "string";
  const lifecycleActions: Record<string, string> = {
    active: "user.activate",
    disabled: "user.disable",
    suspended: "user.suspend",
  };
  const action = isStatusOnly ? lifecycleActions[changes.account_status as string] : "user.update";

  await writeAudit(ctx, {
    action,
    resource_type: "user",
    resource_id: id,
    target_user_id: id,
    target_email: (existing.email as string) ?? null,
    metadata: auditMeta,
  });

  return { id, ...changes };
};

export const revokeUserSessions: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "USER_SUSPEND");
  const id = requireUuid(params);

  const { data: existing, error } = await ctx.client
    .from("profiles")
    .select("id,email")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not load the user.", "db_error");
  if (!existing) throw new ApiError(404, "User not found.", "not_found");

  // SECURITY DEFINER RPC — stamps the target user's password_changed_at so
  // every JWT issued before now fails the existing iat guard. The target id
  // travels explicitly; it is never derived from the caller's identity.
  const { data: stamped, error: rpcError } = await ctx.client.rpc("admin_revoke_sessions", {
    p_user_id: id,
  });
  if (rpcError || !stamped) {
    throw new ApiError(502, "Could not revoke the user's sessions.", "db_error");
  }

  await writeAudit(ctx, {
    action: "user.sessions_revoke",
    resource_type: "user",
    resource_id: id,
    target_user_id: id,
    target_email: (existing.email as string) ?? null,
    metadata: { mechanism: "password_changed_at" },
  });

  return { id, sessions_revoked: true };
};

export const requestUserPasswordReset: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "USER_EDIT");
  const id = requireUuid(params);

  const { data: existing, error } = await ctx.client
    .from("profiles")
    .select("id,email")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not load the user.", "db_error");
  if (!existing) throw new ApiError(404, "User not found.", "not_found");

  const email = String(existing.email ?? "").trim().toLowerCase();
  if (!email) {
    throw new ApiError(409, "This user has no email address to send a reset link to.", "no_email");
  }

  // Dedicated limiter instance — admin-initiated resets share no budget with
  // the public forgot-password endpoint in either direction.
  for (const key of [ctx.ip ?? "unknown-ip", `email:${email}`]) {
    if (!adminPasswordResetRateLimiter.check(key).ok) {
      throw new ApiError(429, "Too many password reset requests. Try again later.", "rate_limited");
    }
  }

  try {
    // Same reset engine as the public flow; failures inside are swallowed by
    // design there, and any surfaced rejection maps to a generic 502 without
    // leaking provider details.
    await requestPasswordReset(createAnonClient(), {
      email,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch {
    throw new ApiError(502, "Could not send the password reset email.", "reset_failed");
  }

  await writeAudit(ctx, {
    action: "user.password_reset.request",
    resource_type: "user",
    resource_id: id,
    target_user_id: id,
    target_email: email,
    metadata: {},
  });

  return { id, message: "A password reset link has been sent to the user's email address." };
};
