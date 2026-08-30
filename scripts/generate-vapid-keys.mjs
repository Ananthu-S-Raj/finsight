#!/usr/bin/env node
/**
 * Generates a fresh VAPID application-server keypair for FinSight push.
 *
 * VAPID needs ONE matching keypair shared by:
 *   - the Next.js client build  → NEXT_PUBLIC_VAPID_PUBLIC_KEY  (public, safe)
 *   - the Supabase Edge Functions → VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY +
 *                                   VAPID_SUBJECT (private stays server-side)
 *
 * This script only PRINTS the values and the exact provisioning commands. It
 * never writes any key to disk — in particular it NEVER persists or commits
 * the private key. Run it on your own machine and paste the values into the
 * deployment dashboards (Render env vars + `supabase secrets set`).
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// VAPID public keys are the raw uncompressed P-256 point (0x04 || X || Y).
const pubJwk = publicKey.export({ format: "jwk" });
const publicRaw = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pubJwk.x, "base64url"),
  Buffer.from(pubJwk.y, "base64url"),
]);
const publicKeyValue = base64url(publicRaw);

// The private key is the JWK scalar `d`.
const privJwk = privateKey.export({ format: "jwk" });
const privateKeyValue = privJwk.d;

const subject = "mailto:you@example.com";

const line = "-".repeat(72);
console.log(line);
console.log("FinSight VAPID keypair (generate once, reuse forever)");
console.log(line);
console.log("VAPID_PUBLIC_KEY (public — paste into NEXT_PUBLIC_VAPID_PUBLIC_KEY on Render");
console.log("                 and into the Supabase secret VAPID_PUBLIC_KEY):");
console.log();
console.log(publicKeyValue);
console.log();
console.log("VAPID_PRIVATE_KEY (SERVER-ONLY secret. Never paste into any client env,");
console.log("never commit, never share. Store it in the Supabase Edge Function secrets):");
console.log();
console.log(privateKeyValue);
console.log();
console.log("VAPID_SUBJECT (contact address — use a real mailto:you@domain):");
console.log();
console.log(subject);
console.log();
console.log("Provision commands:");
console.log(line);
console.log("  # 1. Server secrets (Supabase Edge Functions):");
console.log("  supabase secrets set VAPID_PUBLIC_KEY=\"" + publicKeyValue + "\"");
console.log("  supabase secrets set VAPID_PRIVATE_KEY=\"" + privateKeyValue + "\"");
console.log('  supabase secrets set VAPID_SUBJECT="mailto:you@example.com"');
console.log();
console.log("  # 2. Client (Render env var): put the public key value into");
console.log("  #     NEXT_PUBLIC_VAPID_PUBLIC_KEY and redeploy.");
console.log();
console.log("  # 3. Push the new migration + deploy the sender functions:");
console.log("  supabase db push");
console.log("  supabase functions deploy test-notification daily-reminder bill-reminder process-recurring");
console.log();
console.log("Then verify in the app: Settings → Notifications → toggle ON →");
console.log("Send test notification.");