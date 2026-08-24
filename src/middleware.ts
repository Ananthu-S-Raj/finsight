import { NextResponse, type NextRequest } from "next/server";
import { buildCspHeader, generateNonce } from "@/lib/security/csp";

/**
 * Applies a strict, nonce-based Content-Security-Policy to every HTML page.
 *
 * A fresh nonce is generated per request and exposed via the `x-nonce` header
 * so the root layout can stamp the two app-owned inline scripts. Next.js
 * parses the nonce out of the CSP header itself and applies it to its own
 * inline scripts, styles and page bundles — no per-tag wiring needed.
 *
 * NOTE: nonce-based CSP requires dynamic rendering. The root layout already
 * reads `headers()` (for the nonce), which makes every route dynamic.
 */
export function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = generateNonce();

  const cspHeader = buildCspHeader({
    nonce,
    isDev,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", cspHeader);

  return response;
}

export const config = {
  matcher: [
    {
      // Skip API routes, Next internals and static assets; only HTML pages.
      source:
        "/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icons/|.*\\..*$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
