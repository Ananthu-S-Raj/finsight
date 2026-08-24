export type AIProviderName = "openai" | "ollama";

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface OllamaProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface AIConfig {
  enabled: boolean;
  provider: AIProviderName;
  openai: OpenAIProviderConfig;
  ollama: OllamaProviderConfig;
}

const DEFAULTS = {
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  timeoutMs: 15000,
} as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envStr(name: string, fallback: string): string {
  return (process.env[name] || fallback).trim();
}

/**
 * AI configuration, read exclusively from environment variables.
 * Values are never persisted, never logged, and never exposed to clients.
 */
export function loadAIConfig(): AIConfig {
  const providerRaw = envStr("AI_PROVIDER", "openai").toLowerCase();
  const provider: AIProviderName = providerRaw === "ollama" ? "ollama" : "openai";

  return {
    enabled: envStr("AI_ENABLED", "true").toLowerCase() !== "false",
    provider,
    openai: {
      apiKey: envStr("OPENAI_API_KEY", ""),
      model: envStr("OPENAI_MODEL", DEFAULTS.model),
      baseUrl: envStr("OPENAI_BASE_URL", DEFAULTS.baseUrl).replace(/\/+$/, ""),
      timeoutMs: envInt("OPENAI_TIMEOUT_MS", DEFAULTS.timeoutMs),
    },
    ollama: {
      enabled: envStr("OLLAMA_ENABLED", "false").toLowerCase() === "true",
      baseUrl: envStr("OLLAMA_BASE_URL", "http://localhost:11434").replace(/\/+$/, ""),
      model: envStr("OLLAMA_MODEL", "llama3.2"),
      timeoutMs: envInt("OLLAMA_TIMEOUT_MS", 30000),
    },
  };
}
