import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const nextInits: unknown[] = [];

vi.mock("next/server", async () => {
  const actual = await import("next/server");
  return {
    ...actual,
    NextRequest: actual.NextRequest,
    NextResponse: {
      ...actual.NextResponse,
      next: (init?: unknown) => {
        nextInits.push(init);
        return actual.NextResponse.next(init as { request?: unknown; headers?: unknown });
      },
    },
  };
});

import { NextRequest } from "next/server";
import { middleware, config as middlewareConfig } from "@/middleware";

const PREV = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
  nextInits.length = 0;
});

afterAll(() => {
  if (PREV) process.env.NODE_ENV = PREV;
});

function scriptSrc(csp: string): string {
  return csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
}

describe("middleware — CSP emission on HTML pages", () => {
  it("applies a strict, nonce-based script policy to page requests", () => {
    const res = middleware(new NextRequest("http://localhost/dashboard"));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    const ss = scriptSrc(csp);
    expect(ss).toMatch(/script-src 'self' 'nonce-[a-f0-9]+' 'strict-dynamic'/);
    expect(ss).not.toContain("'unsafe-inline'");
    expect(ss).not.toContain("'unsafe-eval'");
  });

  it("injects the same nonce into the request headers the layout reads", () => {
    const res = middleware(new NextRequest("http://localhost/login"));
    const init = nextInits[0] as { request: { headers: Headers } };
    const cspNonce = /nonce-([a-f0-9]+)/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    expect(init?.request?.headers.get("x-nonce")).toBe(cspNonce);
  });

  it("uses a fresh nonce per request", () => {
    const a = middleware(new NextRequest("http://localhost/dashboard"));
    const b = middleware(new NextRequest("http://localhost/dashboard"));
    const nonceA = /nonce-([a-f0-9]+)/.exec(a.headers.get("content-security-policy") ?? "")?.[1];
    const nonceB = /nonce-([a-f0-9]+)/.exec(b.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });

  it("adds upgrade-insecure-requests in production", () => {
    const res = middleware(new NextRequest("http://localhost/dashboard"));
    expect(res.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });
});

describe("middleware — matcher scope", () => {
  it("matches HTML pages but not API routes or static assets", () => {
    // Next compiles the matcher source into `new RegExp("^" + source + "$")`.
    const { source } = middlewareConfig.matcher[0];
    const pattern = new RegExp(`^${source}$`);
    const matches = (url: string) => pattern.test(url.replace(/^https?:\/\/[^/]+/, ""));

    expect(matches("/dashboard")).toBe(true);
    expect(matches("/login")).toBe(true);
    expect(matches("/admin/users/abc")).toBe(true);
    expect(matches("/api/v1/health/live")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/_next/image?url=x")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/manifest.json")).toBe(false);
    expect(matches("/sw.js")).toBe(false);
    expect(matches("/icons/192.png")).toBe(false);
  });

  it("skips prefetch requests (missing-conditions)", () => {
    const matcher = middlewareConfig.matcher[0] as {
      missing: { type: string; key?: string; value?: string }[];
    };
    expect(matcher.missing).toEqual(
      expect.arrayContaining([
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ])
    );
  });
});
