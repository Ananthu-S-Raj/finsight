#!/usr/bin/env node
/**
 * Stamps a per-deploy version into the service worker's cache id so every
 * release ships DIFFERENT sw.js bytes.
 *
 * Why: PWA update detection compares the bytes of the installed service worker
 * script (public/sw.js). When that file is static (e.g. `const CACHE =
 * "finsight-v4"`), every deployment ships identical bytes, the browser never
 * installs a new worker, `controllerchange` never fires and the auto-update
 * flow in UpdatePrompt never runs — users stay on the old build indefinitely.
 *
 * This script rewrites `const CACHE = ...` to embed an id derived from the
 * current git commit (falling back to a build timestamp outside a git
 * checkout). Each deploy therefore reliably triggers the install → skipWaiting
 * → clients.claim → controllerchange → reload lifecycle.
 *
 * Idempotent: building the same commit twice produces identical bytes, so the
 * tree stays clean at a fixed HEAD.
 *
 * Wired into `npm run build` (runs BEFORE `next build`, so the stamped file is
 * what gets copied into the deploy output).
 *
 * Usage:
 *   node scripts/stamp-sw.mjs          # stamp public/sw.js for the current HEAD
 *   node scripts/stamp-sw.mjs --check  # verify public/sw.js matches the current
 *                                      # deploy id (exits 1 with a message if not)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const swPath = path.join(root, "public", "sw.js");
const CACHE_RE = /const CACHE = "[^"]*";/;
const check = process.argv.includes("--check");

function deployId() {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (hash) return hash;
  } catch {
    // not a git checkout — fall through to a timestamp id
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

const source = readFileSync(swPath, "utf8");
if (!CACHE_RE.test(source)) {
  throw new Error("stamp-sw: could not find `const CACHE = ...` in public/sw.js");
}

const id = deployId();
const next = source.replace(CACHE_RE, `const CACHE = "finsight-v4-${id}";`);

if (check) {
  const currentId = CACHE_RE.exec(source)?.[0] ?? "";
  const expectedId = `const CACHE = "finsight-v4-${id}";`;
  if (!currentId || currentId !== expectedId) {
    console.error(
      `[stamp-sw] FAIL: public/sw.js cache id is stale for this release.\n` +
        `  found:    ${currentId || "(none)"}\n` +
        `  expected: ${expectedId}\n` +
        `Run \`node scripts/stamp-sw.mjs\` (or \`npm run build\`, which stamps ` +
        `before next build) and commit the stamped file. A stale service-worker ` +
        `bytes means browsers never install the new worker and the auto-update ` +
        `flow breaks.`
    );
    process.exit(1);
  }
  console.log(`[stamp-sw] ok: finsight-v4-${id}`);
  process.exit(0);
}

if (next === source) {
  console.log(`[stamp-sw] already stamped: finsight-v4-${id}`);
} else {
  writeFileSync(swPath, next);
  console.log(`[stamp-sw] stamped service worker: finsight-v4-${id}`);
}