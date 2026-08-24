import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/auth/supabaseServer";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Readiness probe — verifies the Supabase backend is reachable and the schema
 * is queryable before the instance is allowed to receive traffic. Fails closed:
 * any DB error returns 503 so orchestrators take the pod out of rotation.
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
