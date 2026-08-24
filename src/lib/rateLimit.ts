/**
 * In-memory sliding-window rate limiter used to protect public endpoints
 * (e.g. forgot-password) against abuse.
 *
 * NOTE: the store is per Node process. In a single-instance deployment this
 * is sufficient; with multiple instances, swap this for a shared store
 * (Redis / Postgres) — the key structure and semantics stay the same.
 */

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string, now?: number) => RateLimitResult;
  clear: () => void;
};

/**
 * Reads a positive integer from the environment with a fallback.
 * `varname` is the env key; all limiter budgets are configurable at deploy
 * time so operations can tune them without a code change.
 */
export function envInt(varname: string, fallback: number): number {
  const raw = process.env[varname];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function envDurationMs(varname: string, fallbackMs: number): number {
  const raw = process.env[varname];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

export function createRateLimiter(opts: { max?: number; windowMs?: number } = {}): RateLimiter {
  const max = opts.max ?? 5;
  const windowMs = opts.windowMs ?? 60 * 60 * 1000;
  const store = new Map<string, number[]>();

  return {
    check(key: string, now = Date.now()): RateLimitResult {
      // Prune expired timestamps.
      for (const [k, timestamps] of store) {
        const fresh = timestamps.filter((t) => now - t < windowMs);
        if (fresh.length === 0) store.delete(k);
        else store.set(k, fresh);
      }

      const timestamps = store.get(key) ?? [];
      if (timestamps.length >= max) {
        const oldest = timestamps[0];
        return {
          ok: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }

      timestamps.push(now);
      store.set(key, timestamps);
      return { ok: true, remaining: max - timestamps.length, retryAfterSeconds: 0 };
    },
    clear: () => store.clear(),
  };
}

/**
 * Named limiters. Every budget is overridable through environment variables
 * (documented in .env.local.example); the defaults below are safe generic
 * values. Note: login / registration / OTP happen directly against Supabase
 * Auth from the browser, so those are throttled by the hosted auth service,
 * not here — the variables below are for the endpoints FinSight owns.
 */

/** Forgot-password: 5 requests / hour per key (IP and email). */
export const passwordResetRateLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_FORGOT_MAX", 5),
  windowMs: envDurationMs("RATE_LIMIT_FORGOT_WINDOW_MS", 60 * 60 * 1000),
});

/** Reset-token consumption: 10 attempts / hour per IP. */
export const passwordResetConsumeLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_RESET_CONSUME_MAX", 10),
  windowMs: envDurationMs("RATE_LIMIT_RESET_CONSUME_WINDOW_MS", 60 * 60 * 1000),
});

/**
 * AI insights: per-user (12 / hour) and per-IP (30 / hour) budgets cap LLM
 * spend from a leaked token.
 */
export const aiUserLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_AI_USER_MAX", 12),
  windowMs: envDurationMs("RATE_LIMIT_AI_USER_WINDOW_MS", 60 * 60 * 1000),
});

export const aiIpLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_AI_IP_MAX", 30),
  windowMs: envDurationMs("RATE_LIMIT_AI_IP_WINDOW_MS", 60 * 60 * 1000),
});

/**
 * Admin authentication failures: per-IP and per-user. Prevents credential /
 * token brute-forcing against the admin API. A generous budget because a
 * misbehaving proxy or shared NAT can legitimately fan out requests.
 */
export const adminAuthIpLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_ADMIN_AUTH_IP_MAX", 30),
  windowMs: envDurationMs("RATE_LIMIT_ADMIN_AUTH_WINDOW_MS", 15 * 60 * 1000),
});

export const adminAuthUserLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_ADMIN_AUTH_USER_MAX", 15),
  windowMs: envDurationMs("RATE_LIMIT_ADMIN_AUTH_WINDOW_MS", 15 * 60 * 1000),
});

/**
 * Admin-initiated password resets: 10 / hour per key (admin IP and target
 * email). Deliberately a separate instance from the public
 * passwordResetRateLimiter so public forgot-password traffic and admin
 * resets can never exhaust each other's budgets.
 */
export const adminPasswordResetRateLimiter = createRateLimiter({
  max: envInt("RATE_LIMIT_ADMIN_RESET_MAX", 10),
  windowMs: envDurationMs("RATE_LIMIT_ADMIN_RESET_WINDOW_MS", 60 * 60 * 1000),
});
