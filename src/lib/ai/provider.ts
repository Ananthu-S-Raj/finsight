import type { AIConfig, AIProviderName } from "./config";
import { AIError } from "./errors";

export interface AICompletion {
  text: string;
  provider: AIProviderName;
  model: string;
  latencyMs: number;
}

export interface AIPing {
  reachable: boolean;
  latencyMs: number | null;
  model: string;
  detail: string | null;
}

export interface AIProvider {
  readonly name: AIProviderName;
  readonly model: string;
  readonly timeoutMs: number;
  isConfigured(): boolean;
  complete(system: string, user: string): Promise<AICompletion>;
  ping(): Promise<AIPing>;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AIError("timeout", `Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new AIError("network", `Could not reach ${url}`, { status: null });
  } finally {
    clearTimeout(timer);
  }
}

function throwForStatus(status: number, provider: string): never {
  if (status === 401 || status === 403) {
    throw new AIError("auth", `${provider} rejected the API credentials`, { status });
  }
  if (status === 429) {
    throw new AIError("rate_limited", `${provider} rate limited the request`, { status });
  }
  if (status >= 500) {
    throw new AIError("server_error", `${provider} returned HTTP ${status}`, { status });
  }
  throw new AIError("bad_request", `${provider} returned HTTP ${status}`, { status });
}

export class OpenAIProvider implements AIProvider {
  readonly name: AIProviderName = "openai";

  constructor(private readonly config: AIConfig["openai"]) {}

  get model(): string {
    return this.config.model;
  }

  get timeoutMs(): number {
    return this.config.timeoutMs;
  }

  isConfigured(): boolean {
    return this.config.apiKey.length > 0;
  }

  async complete(system: string, user: string): Promise<AICompletion> {
    const startedAt = Date.now();
    const res = await fetchWithTimeout(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ] satisfies ChatMessage[],
          temperature: 0.3,
        }),
      },
      this.config.timeoutMs,
    );

    if (!res.ok) throwForStatus(res.status, "OpenAI");

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new AIError("server_error", "OpenAI returned a malformed response");
    }

    const text = extractOpenAIText(data);
    if (!text) throw new AIError("empty", "OpenAI returned no content");

    return { text, provider: "openai", model: this.config.model, latencyMs: Date.now() - startedAt };
  }

  async ping(): Promise<AIPing> {
    // No live probe for hosted APIs — avoids spending quota on a status check.
    return {
      reachable: this.isConfigured(),
      latencyMs: null,
      model: this.config.model,
      detail: this.isConfigured() ? "configured" : "no API key set",
    };
  }
}

export class OllamaProvider implements AIProvider {
  readonly name: AIProviderName = "ollama";

  constructor(private readonly config: AIConfig["ollama"]) {}

  get model(): string {
    return this.config.model;
  }

  get timeoutMs(): number {
    return this.config.timeoutMs;
  }

  isConfigured(): boolean {
    return this.config.enabled && this.config.baseUrl.length > 0;
  }

  async complete(system: string, user: string): Promise<AICompletion> {
    const startedAt = Date.now();
    const res = await fetchWithTimeout(
      `${this.config.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ] satisfies ChatMessage[],
          stream: false,
        }),
      },
      this.config.timeoutMs,
    );

    if (!res.ok) throwForStatus(res.status, "Ollama");

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new AIError("server_error", "Ollama returned a malformed response");
    }

    const text = extractOllamaText(data);
    if (!text) throw new AIError("empty", "Ollama returned no content");

    return { text, provider: "ollama", model: this.config.model, latencyMs: Date.now() - startedAt };
  }

  async ping(): Promise<AIPing> {
    const startedAt = Date.now();
    try {
      const res = await fetchWithTimeout(`${this.config.baseUrl}/api/tags`, {}, this.config.timeoutMs);
      return {
        reachable: res.ok,
        latencyMs: Date.now() - startedAt,
        model: this.config.model,
        detail: res.ok ? "reachable" : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        model: this.config.model,
        detail: err instanceof AIError ? "unreachable" : "unknown error",
      };
    }
  }
}

function extractOpenAIText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown>;
  const message = first?.message as Record<string, unknown> | undefined;
  const text = typeof message?.content === "string" ? message.content : null;
  return text && text.trim().length > 0 ? text.trim() : null;
}

function extractOllamaText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const message = record.message as Record<string, unknown> | undefined;
  const text = typeof message?.content === "string" ? message.content : null;
  return text && text.trim().length > 0 ? text.trim() : null;
}

/** Returns the provider for the current configuration, or null if none is configured. */
export function getProvider(config: AIConfig): AIProvider | null {
  const provider =
    config.provider === "ollama" ? new OllamaProvider(config.ollama) : new OpenAIProvider(config.openai);
  return provider.isConfigured() ? provider : null;
}
