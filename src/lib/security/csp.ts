/**
 * Content-Security-Policy builder (pure — no framework imports, so it is
 * unit-testable). See src/middleware.ts for where the header is applied.
 *
 * Script policy: strict-dynamic + per-request nonce. Next.js reads the nonce
 * straight out of the CSP header and applies it to its own inline scripts and
 * page bundles, so the two app-owned inline scripts in the root layout are
 * given the same nonce explicitly.
 *
 * style-src keeps 'unsafe-inline' because React `style={{...}}` attributes are
 * not covered by nonces (and the app uses them everywhere); this does NOT
 * weaken script security.
 */

export type CspOptions = {
  nonce: string;
  isDev?: boolean;
  /** Supabase project URL, e.g. https://abcd.supabase.co — used for connect-src. */
  supabaseUrl?: string;
};

export function buildCspHeader({ nonce, isDev = false, supabaseUrl }: CspOptions): string {
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `media-src 'self'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
  ];

  const connectSources = ["'self'"];
  if (supabaseUrl) {
    const host = new URL(supabaseUrl).host;
    connectSources.push(`https://${host}`, `wss://${host}`);
  }
  if (isDev) {
    connectSources.push("ws://localhost:*", "http://localhost:*", "ws://127.0.0.1:*", "http://127.0.0.1:*");
  }
  directives.push(`connect-src ${connectSources.join(" ")}`);

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

/** Generates a per-request nonce (Edge-safe, no Buffer). */
export function generateNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
