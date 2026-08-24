/**
 * Shared error/JSON helpers for the public `/api/v1/auth/*` routes.
 * Mirrors the Admin API error envelope so clients see a consistent shape.
 */

import { logger } from "@/lib/logger";

export class AuthApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function runApi(fn: () => Promise<unknown>, status = 200): Promise<Response> {
  try {
    const value = await fn();
    // Already-serialized responses (e.g. a rate-limit json()) are returned
    // as-is; plain values are wrapped so route handlers never need to build
    // their own Response for success paths.
    if (value instanceof Response) return value;
    return json(value, status);
  } catch (err) {
    if (err instanceof AuthApiError) {
      return json({ error: err.message, code: err.code, status: err.status }, err.status);
    }
    // Never leak stack traces or internals to the client.
    logger.error("auth-api", "unhandled_error", logger.err(err));
    return json(
      { error: "An unexpected error occurred.", code: "internal", status: 500 },
      500
    );
  }
}
