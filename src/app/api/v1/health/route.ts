import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/auth/supabaseServer";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * API v1 health alias (/api/v1/health) — readiness semantics identical to
 * /api/v1/health/ready. Verifies the Supabase backend is reachable and the
 * schema is queryable; any DB error returns 503 so orchestrators take the pod
 * out of rotation. /health (without /api) is intentionally left 404.
 */
export async function GET() {
  const started = Date.now();
  try {
    const client = createAnonClient();
    const { error } = await client.from("profiles").select("id").limit(1);
    if (error) {
      logger.warn("health", "readiness_db_error", { code: error.code, message: error.message });
      return NextResponse.json(
        { status: "not_ready", db: "unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { status: "ok", db: "ok", latency_ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("health", "readiness_error", logger.err(err));
    return NextResponse.json(
      { status: "not_ready", db: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}