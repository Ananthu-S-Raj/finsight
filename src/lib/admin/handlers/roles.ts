import {
  ApiError,
  readJsonBody,
  requirePermission,
  writeAudit,
  type AdminContext,
  type Handler,
} from "../server";
import { isUuid, requireUuid, sanitizeText } from "./helpers";

export const listRoles: Handler = async (ctx) => {
  requirePermission(ctx, "ROLE_MANAGE");

  const [{ data: roles, error: rolesError }, { data: perms, error: permsError }] =
    await Promise.all([
      ctx.client.from("roles").select("id,name,description,is_system").order("name"),
      ctx.client.from("permissions").select("id,code,description").order("code"),
    ]);
  if (rolesError || permsError) throw new ApiError(502, "Could not load roles.", "db_error");

  const { data: links, error: linksError } = await ctx.client
    .from("role_permissions")
    .select("role_id,permission_id");
  if (linksError) throw new ApiError(502, "Could not load role permissions.", "db_error");

  const permissionIdByCode = new Map((perms ?? []).map((p) => [p.code as string, p.id as string]));
  const linksByRole = new Map<string, Set<string>>();
  for (const link of links ?? []) {
    const set = linksByRole.get(link.role_id as string) ?? new Set<string>();
    set.add(link.permission_id as string);
    linksByRole.set(link.role_id as string, set);
  }

  return (roles ?? []).map((role) => {
    const roleId = role.id as string;
    const granted = new Set(linksByRole.get(roleId));
    const codes = [...permissionIdByCode.entries()]
      .filter(([, permId]) => granted.has(permId))
      .map(([code]) => code);
    return {
      id: roleId,
      name: role.name,
      description: role.description,
      is_system: role.is_system,
      permissions: codes,
    };
  });
};

type RoleRow = { id: string; name: string; is_system: boolean };

/**
 * Loads a role and verifies it may have its permissions changed. System
 * roles (the seeded 'admin'/'user' roles) are protected SERVER-SIDE — the
 * UI merely mirrors this rule. A missing role and an out-of-range id are
 * both surfaced as 404 so callers cannot probe ids.
 */
async function loadManageableRole(ctx: AdminContext, rawId: string | undefined): Promise<RoleRow> {
  const roleId = requireUuid({ id: rawId });
  const { data: role, error } = await ctx.client
    .from("roles")
    .select("id,name,is_system")
    .eq("id", roleId)
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not load the role.", "db_error");
  if (!role) throw new ApiError(404, "Role not found.", "not_found");
  if (role.is_system) {
    throw new ApiError(403, "System roles cannot be modified.", "system_role");
  }
  return role as RoleRow;
}

/**
 * Resolves a permission reference to its row. Accepts either the permission
 * UUID or its exact code (e.g. "USER_VIEW"), so clients can address grants
 * without a second round-trip. Unknown references 404 without leaking DB
 * error details.
 */
async function resolvePermission(
  ctx: AdminContext,
  ref: string
): Promise<{ id: string; code: string }> {
  // Bound through a plain variable so the isUuid() type predicate doesn't
  // narrow `ref` itself (which would make the code branch unreachable).
  const asId = isUuid(ref) ? ref : null;
  let query = ctx.client.from("permissions").select("id,code").limit(1);
  query = asId ? query.eq("id", asId) : query.eq("code", ref.toUpperCase());
  const { data, error } = await query;
  if (error) throw new ApiError(502, "Could not load the permission.", "db_error");
  const perm = (data ?? [])[0] as { id: string; code: string } | undefined;
  if (!perm) throw new ApiError(404, "Permission not found.", "not_found");
  return perm;
}

/** Lists one role's permissions. Read access stays behind ROLE_MANAGE,
 *  mirroring listRoles. */
export const getRolePermissions: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "ROLE_MANAGE");
  const roleId = requireUuid(params);

  const { data: role, error } = await ctx.client
    .from("roles")
    .select("id,name,description,is_system")
    .eq("id", roleId)
    .maybeSingle();
  if (error) throw new ApiError(502, "Could not load the role.", "db_error");
  if (!role) throw new ApiError(404, "Role not found.", "not_found");

  const { data: links, error: linksError } = await ctx.client
    .from("role_permissions")
    .select("permission_id")
    .eq("role_id", roleId);
  if (linksError) throw new ApiError(502, "Could not load role permissions.", "db_error");

  const permIds = (links ?? []).map((l) => l.permission_id as string);
  let permissions: Array<{ id: string; code: string; description: string }> = [];
  if (permIds.length > 0) {
    const { data: perms, error: permsError } = await ctx.client
      .from("permissions")
      .select("id,code,description")
      .in("id", permIds);
    if (permsError) throw new ApiError(502, "Could not load role permissions.", "db_error");
    permissions = ((perms ?? []) as Array<{ id: string; code: string; description: string }>).sort(
      (a, b) => a.code.localeCompare(b.code)
    );
  }

  return { role, permissions };
};

/** Grants one permission to one non-system role. */
export const grantRolePermission: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "ROLE_MANAGE");
  const role = await loadManageableRole(ctx, params.id);

  const body = await readJsonBody(req);
  const ref = sanitizeText(body.permission_id ?? body.permission ?? body.code, 100);
  if (!ref) throw new ApiError(400, "A permission id or code is required.", "bad_request");
  const permission = await resolvePermission(ctx, ref);

  // Privilege-elevation guard (G-08): an administrator may only delegate
  // authority they themselves hold. ctx.permissions is the actor's effective
  // set as resolved by loadPermissions() during authentication (fail-closed
  // to []), so no second RBAC lookup is introduced here. A denied attempt
  // mutates nothing and writes no audit row.
  if (!ctx.permissions.includes(permission.code)) {
    throw new ApiError(
      403,
      "You cannot grant a permission you do not hold yourself.",
      "permission_escalation"
    );
  }

  // Deterministic duplicate-grant rejection (the composite PK would also
  // stop it in the database; checking first yields a clean 409).
  const existing = await ctx.client
    .from("role_permissions")
    .select("role_id")
    .eq("role_id", role.id)
    .eq("permission_id", permission.id)
    .maybeSingle();
  if (existing.error) throw new ApiError(502, "Could not check the existing grant.", "db_error");
  if (existing.data) {
    throw new ApiError(409, "That permission is already granted to this role.", "already_granted");
  }

  const { error } = await ctx.client
    .from("role_permissions")
    .insert({ role_id: role.id, permission_id: permission.id });
  if (error) throw new ApiError(502, "Could not grant the permission.", "db_error");

  // Throw-on-failure semantics: an unaudited mutation must not succeed.
  await writeAudit(ctx, {
    action: "role.permission.grant",
    resource_type: "role",
    resource_id: role.id,
    metadata: {
      role_name: role.name,
      permission_code: permission.code,
      permission_id: permission.id,
    },
  });

  return {
    granted: true,
    role: { id: role.id, name: role.name },
    permission: { id: permission.id, code: permission.code },
  };
};

/** Revokes one permission from one non-system role. */
export const revokeRolePermission: Handler = async (ctx, _req, params) => {
  requirePermission(ctx, "ROLE_MANAGE");
  const role = await loadManageableRole(ctx, params.id);

  const ref = sanitizeText(params.permissionId, 100);
  if (!ref) throw new ApiError(400, "A permission id or code is required.", "bad_request");
  const permission = await resolvePermission(ctx, ref);

  // Missing-grant rejection: revoking something that isn't granted is a
  // client bug and must surface as 404 instead of a silent no-op.
  const existing = await ctx.client
    .from("role_permissions")
    .select("role_id")
    .eq("role_id", role.id)
    .eq("permission_id", permission.id)
    .maybeSingle();
  if (existing.error) throw new ApiError(502, "Could not check the existing grant.", "db_error");
  if (!existing.data) {
    throw new ApiError(404, "That permission is not granted to this role.", "not_granted");
  }

  const { error } = await ctx.client
    .from("role_permissions")
    .delete()
    .eq("role_id", role.id)
    .eq("permission_id", permission.id);
  if (error) throw new ApiError(502, "Could not revoke the permission.", "db_error");

  await writeAudit(ctx, {
    action: "role.permission.revoke",
    resource_type: "role",
    resource_id: role.id,
    metadata: {
      role_name: role.name,
      permission_code: permission.code,
      permission_id: permission.id,
    },
  });

  return {
    revoked: true,
    role: { id: role.id, name: role.name },
    permission: { id: permission.id, code: permission.code },
  };
};
