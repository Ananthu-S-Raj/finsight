import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — convenience alias of the liveness probe. The process is
 * up; no dependencies are checked (orchestrators use /api/v1/health/live and
 * /api/v1/health/ready for that). Deliberately exposes no configuration,
 * credentials, paths or version details.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
