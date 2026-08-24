/**
 * Server-side maintenance-mode gate for the user API layer.
 *
 * Maintenance mode is toggled by admins through app_settings/general
 * (publicly surfaced via the `app_status` SECURITY DEFINER RPC). The UI gate
 * lives in AppShell; this module adds server-side enforcement so an
 * already-open browser tab cannot bypass it by calling /api/v1/* directly.
 *
 * Enforcement policy:
 *   - user mutations (POST/PATCH/DELETE) -> rejected while active;
 *   - user reads (GET)                   -> allowed;
 *   - auth/password flows, health, status and the whole admin API -> exempt.
 *
 * The flag is cached in-process for ~20s so mutations do not add a database
 * round-trip per request. NOTE: on Vercel/serverless this cache is per
 * function instance — best-effort by design (a few seconds of staleness is
 * acceptable; enforcement here is operational protection, not a security
 * boundary — RLS remains authoritative).
 */

import { createAnonClient } from "@/lib/auth/supabaseServer";
import { AuthApiError } from "@/lib/auth/errors";
import { logger } from "@/lib/logger";

const MAINTENANCE_TTL_MS = 20_000;

let cachedValue = false;
let cachedAt = 0;
let inflight: Promise<boolean> | null = null;

async function readMaintenanceFlag(): Promise<boolean> {
  try {
    const { data, error } = await createAnonClient().rpc("app_status");
    if (error) throw new Error(error.message);
    return Boolean(data?.[0]?.maintenance ?? false);
  } catch {
    // Fail open: if the lookup itself fails we allow the request. Requests
    // will fail naturally at data access when the database is unreachable.
    return false;
  }
}

/** Cached maintenance flag. Single-flight: concurrent requests share one read. */
export async function isUnderMaintenance(): Promise<boolean> {
  const now = Date.now();
  if (now - cachedAt < MAINTENANCE_TTL_MS) return cachedValue;
  if (!inflight) {
    inflight = readMaintenanceFlag()
      .then((value) => {
        cachedValue = value;
        cachedAt = Date.now();
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test hook: forget the cached flag so the next check re-reads the source. */
export function resetMaintenanceCacheForTests(): void {
  cachedValue = false;
  cachedAt = 0;
  inflight = null;
}

/**
 * Reject a mutating request while maintenance mode is active. Must be called
 * AFTER session validation and BEFORE any write. Throws AuthApiError(503,
 * "maintenance_mode") which runApi serializes into the standard error
 * envelope.
 */
export async function assertNotUnderMaintenance(info: {
  route: string;
  method: string;
  userId?: string | null;
}): Promise<void> {
  if (!(await isUnderMaintenance())) return;

  logger.warn("user-api", "maintenance_blocked", {
    route: info.route,
    method: info.method,
    ...(info.userId ? { userId: info.userId } : {}),
  });
  throw new AuthApiError(
    503,
    "FinSight is under maintenance. This action is temporarily unavailable.",
    "maintenance_mode"
  );
}
