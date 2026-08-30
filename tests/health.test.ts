// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET as healthGet } from "@/app/api/health/route";
import { config as middlewareConfig } from "@/middleware";

const ROUTE_SOURCE = readFileSync(
  join(import.meta.dirname, "..", "src", "app", "api", "health", "route.ts"),
  "utf8"
);

describe("GET /api/health — public UptimeRobot endpoint", () => {
  it("returns 200 with status ok for unauthenticated clients", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });

  it("is a genuine Next.js App Router route export — GET on the route module", () => {
    // The App Router serves this when the module exports GET. A stray default
    // page export (or a component) would render the FinSight UI instead of JSON.
    const mod = { GET: healthGet } as const;
    expect(typeof mod.GET).toBe("function");
    expect(ROUTE_SOURCE).toMatch(/export function GET\(\)/);
    expect(ROUTE_SOURCE).not.toMatch(/export default/);
  });

  it("does not render the application UI — no layout, splash, or React imports", () => {
    // This endpoint must never fall through to the app shell / StartupSplash.
    // The route file imports only next/server and emits NextResponse.json.
    expect(ROUTE_SOURCE).not.toMatch(/StartupSplash/);
    expect(ROUTE_SOURCE).not.toMatch(/from ["'@]\/(app|components)\//);
    expect(ROUTE_SOURCE).toMatch(/NextResponse\.json\(/);
    expect(ROUTE_SOURCE).toMatch(/\{\s*status:\s*"ok"/);
  });

  it("is not gated by middleware — /api/* routes never enter the auth/CSP matcher", () => {
    // The middleware matcher only targets HTML pages and explicitly skips API
    // routes, so this endpoint is reachable without any session, cookie, or
    // token — exactly what a monitoring service like UptimeRobot needs.
    const { source } = middlewareConfig.matcher[0];
    const pattern = new RegExp(`^${source}$`);
    const matches = (url: string) => pattern.test(url.replace(/^https?:\/\/[^/]+/, ""));
    expect(matches("/api/health")).toBe(false);
  });

  it("requires no database or env access and exposes only the status field", async () => {
    const res = await healthGet();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["status"]);
    expect(body.status).toBe("ok");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // No Supabase or database imports in the handler.
    expect(ROUTE_SOURCE).not.toMatch(/supabase|createClient|\.from\(/);
  });
});