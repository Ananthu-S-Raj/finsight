/**
 * Typed AI failures. `kind` drives behavior (fallback vs. retry), while
 * `userMessage` is the only text ever shown to users — raw provider errors or
 * bodies are never forwarded to the client.
 */
export type AIFailureKind =
  | "not_configured"
  | "bad_request"
  | "auth"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "empty";

export class AIError extends Error {
  readonly kind: AIFailureKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly userMessage: string;

  constructor(
    kind: AIFailureKind,
    message: string,
    opts: { status?: number | null; retryAfterMs?: number | null; userMessage?: string } = {},
  ) {
    super(message);
    this.name = "AIError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.userMessage = opts.userMessage ?? AI_ERROR_MESSAGES[kind];
  }
}

export const AI_ERROR_MESSAGES: Record<AIFailureKind, string> = {
  not_configured: "AI insights are not configured for this deployment.",
  bad_request: "The AI provider could not understand the request. Try again later.",
  auth: "The AI provider rejected the API credentials. Contact the administrator.",
  rate_limited: "The AI provider is busy. Please try again in a minute.",
  server_error: "The AI provider is having trouble. Please try again shortly.",
  timeout: "The AI provider took too long to respond. Please try again.",
  network: "The AI provider could not be reached. Check the network connection.",
  empty: "The AI provider returned no insights. Please try again.",
};

export const DEFAULT_AI_FALLBACK =
  "AI insights are currently unavailable. Your on-device analysis is still up to date.";
