import { ApiError, requirePermission, type Handler } from "../server";
import { loadAIConfig } from "@/lib/ai/config";
import { getProvider } from "@/lib/ai/provider";

/**
 * AI service status for the Admin Console.
 *
 * Configuration is split across two sources:
 *   - `app_settings.ai` (DB) — the legacy admin toggles / feature flags.
 *   - Environment variables — the source of truth for credentials, provider,
 *     and model (never stored in the DB, never exposed here).
 *
 * API keys are never returned. `configured` only reports whether a key exists.
 */
export const getAiStatus: Handler = async (ctx) => {
  requirePermission(ctx, "AI_SETTINGS");

  const { data, error } = await ctx.client.from("app_settings").select("value").eq("key", "ai").maybeSingle();
  if (error) throw new ApiError(502, "Could not load AI settings.", "db_error");

  const dbConfig = (data?.value as Record<string, unknown>) ?? {};
  const envConfig = loadAIConfig();
  const provider = getProvider(envConfig);

  let health: { reachable: boolean; latency_ms: number | null; model: string | null; detail: string | null };
  if (provider) {
    const ping = await provider.ping();
    health = {
      reachable: ping.reachable,
      latency_ms: ping.latencyMs,
      model: ping.model,
      detail: ping.detail,
    };
  } else {
    health = { reachable: false, latency_ms: null, model: null, detail: "AI not configured" };
  }

  return {
    config: {
      enabled: envConfig.enabled,
      admin_toggle: Boolean(dbConfig.ai_enabled),
      provider: envConfig.provider,
      model: provider?.model ?? null,
      configured: Boolean(provider),
      features: dbConfig.features ?? {},
      last_health_check: dbConfig.last_health_check ?? null,
    },
    health,
  };
};
