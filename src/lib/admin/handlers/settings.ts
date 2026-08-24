import { ApiError, requirePermission, writeAudit, type Handler } from "../server";
import { asBoolean, asNumber, asString, sanitizeText } from "./helpers";

const GROUPS = ["general", "finance", "notifications", "ai", "pwa"] as const;
type Group = (typeof GROUPS)[number];

/** Whitelisted, non-secret fields per group. Secrets never live here. */
const FIELD_TYPES: Record<Group, Record<string, "string" | "boolean" | "number" | "features">> = {
  general: {
    app_name: "string",
    app_description: "string",
    maintenance_mode: "boolean",
  },
  finance: {
    default_currency: "string",
    default_categories: "string",
  },
  notifications: {
    daily_reminder_enabled: "boolean",
    budget_alert_threshold: "number",
    card_reminder_enabled: "boolean",
  },
  ai: {
    ai_enabled: "boolean",
    provider: "string",
    features: "features",
  },
  pwa: {
    install_prompt_enabled: "boolean",
    notification_prompt_enabled: "boolean",
  },
};

function validateGroupValue(group: Group, key: string, value: unknown): unknown {
  const type = FIELD_TYPES[group][key];
  if (!type) throw new ApiError(400, `Unknown setting '${key}' in '${group}'.`, "bad_request");

  if (type === "features") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError(400, `'${key}' must be an object of booleans.`, "bad_request");
    }
    const out: Record<string, boolean> = {};
    for (const [featureKey, featureValue] of Object.entries(value)) {
      const bool = asBoolean(featureValue);
      if (bool === undefined) throw new ApiError(400, `'${key}.${featureKey}' must be a boolean.`, "bad_request");
      out[featureKey] = bool;
    }
    return out;
  }

  if (type === "boolean") {
    const bool = asBoolean(value);
    if (bool === undefined) throw new ApiError(400, `'${key}' must be a boolean.`, "bad_request");
    return bool;
  }
  if (type === "number") {
    const num = asNumber(value);
    if (num === undefined) throw new ApiError(400, `'${key}' must be a number.`, "bad_request");
    return num;
  }
  const str = sanitizeText(value, 500);
  if (key === "app_name" && str.length > 60) throw new ApiError(400, "app_name is too long.", "bad_request");
  return str;
}

export const getSettings: Handler = async (ctx) => {
  requirePermission(ctx, "SYSTEM_SETTINGS");
  const { data, error } = await ctx.client.from("app_settings").select("key,value");
  if (error) throw new ApiError(502, "Could not load settings.", "db_error");

  const grouped: Record<string, Record<string, unknown>> = {};
  for (const row of data ?? []) {
    grouped[row.key as string] = (row.value as Record<string, unknown>) ?? {};
  }
  return grouped;
};

export const updateSettings: Handler = async (ctx, req, params) => {
  requirePermission(ctx, "SYSTEM_SETTINGS");
  const group = params.group as Group;
  if (!GROUPS.includes(group)) {
    throw new ApiError(400, `Unknown settings group '${String(group)}'.`, "bad_request");
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowed = FIELD_TYPES[group];
  const patch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!(key in allowed)) {
      throw new ApiError(400, `Unknown setting '${key}' in '${group}'.`, "bad_request");
    }
    patch[key] = validateGroupValue(group, key, value);
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "No settings provided.", "bad_request");
  }

  const { data: existing, error: fetchError } = await ctx.client
    .from("app_settings")
    .select("value")
    .eq("key", group)
    .maybeSingle();
  if (fetchError) throw new ApiError(502, "Could not load settings.", "db_error");

  const merged = { ...((existing?.value as Record<string, unknown>) ?? {}), ...patch };
  const { data, error } = await ctx.client
    .from("app_settings")
    .upsert({ key: group, value: merged, updated_by: ctx.userId })
    .select("key,value")
    .single();
  if (error) throw new ApiError(502, "Could not save settings.", "db_error");

  // A maintenance_mode flip is operationally significant regardless of which
  // surface performed it (dedicated toggle endpoint or the general settings
  // form), so it is ALWAYS audited as maintenance.toggle/system — never as a
  // generic settings.update row. Remaining keys in the same patch still get
  // the ordinary settings.update entry.
  let maintenanceChanged: boolean | null = null;
  const otherKeys: string[] = [];
  if (group === "general" && typeof patch.maintenance_mode === "boolean") {
    const previous = Boolean((existing?.value as Record<string, unknown> | undefined)?.maintenance_mode);
    if (previous !== patch.maintenance_mode) {
      maintenanceChanged = patch.maintenance_mode;
    }
    for (const key of Object.keys(patch)) {
      if (key !== "maintenance_mode") otherKeys.push(key);
    }
  }

  if (maintenanceChanged !== null) {
    await writeAudit(ctx, {
      action: "maintenance.toggle",
      resource_type: "system",
      metadata: { enabled: maintenanceChanged },
    });
  }

  const auditedKeys = maintenanceChanged !== null ? otherKeys : Object.keys(patch);
  if (auditedKeys.length > 0) {
    await writeAudit(ctx, {
      action: "settings.update",
      resource_type: "app_settings",
      resource_id: group,
      metadata: { group, keys: auditedKeys },
    });
  }

  return data;
};
