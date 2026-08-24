import { ApiError, requirePermission, writeAudit, type Handler } from "../server";

export const getSystemStatus: Handler = async (ctx) => {
  requirePermission(ctx, "SYSTEM_SETTINGS");

  const [statusRes, settingsRes] = await Promise.all([
    ctx.client.rpc("app_status"),
    ctx.client.from("app_settings").select("key,value"),
  ]);

  const maintenance = !statusRes.error ? Boolean(statusRes.data?.[0]?.maintenance) : false;
  const appName = !statusRes.error
    ? ((statusRes.data?.[0]?.app_name as string) ?? "FinSight")
    : "FinSight";

  return {
    app: {
      name: appName,
      maintenance,
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0",
      runtime: "Node.js " + (process.version ?? "unknown"),
      node_env: process.env.NODE_ENV ?? "production",
      build_time: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
    },
    services: {
      database: !statusRes.error,
      settings: !settingsRes.error,
    },
    maintenance_mode: maintenance,
    generated_at: new Date().toISOString(),
  };
};

export const setMaintenanceMode: Handler = async (ctx, req) => {
  requirePermission(ctx, "SYSTEM_SETTINGS");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const enabled = body.enabled;
  if (typeof enabled !== "boolean") {
    throw new ApiError(400, "enabled must be a boolean.", "bad_request");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("app_settings")
    .select("value")
    .eq("key", "general")
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load settings.", "db_error");

  const merged = { ...((existing?.value as Record<string, unknown>) ?? {}), maintenance_mode: enabled };
  const { error } = await ctx.client
    .from("app_settings")
    .upsert({ key: "general", value: merged, updated_by: ctx.userId });
  if (error) throw new ApiError(502, "Could not update maintenance mode.", "db_error");

  await writeAudit(ctx, {
    action: "maintenance.toggle",
    resource_type: "system",
    metadata: { enabled },
  });

  return { maintenance: enabled };
};
