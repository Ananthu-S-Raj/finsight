import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Specs gate on process.env.E2E_TEST_EMAIL / E2E_TEST_PASSWORD, which live in
// .env.local (a Next.js convention the Playwright runner does not honor natively).
// Node >= 20.12 ships process.loadEnvFile; variables already present in the
// real environment still win, so explicit CI configuration is unaffected.
if (existsSync(".env.local")) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // A malformed env file must not break the test runner entirely;
    // credential-gated suites will simply report as skipped.
  }
}

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-iphone",
      use: { ...devices["iPhone 12"], browserName: "chromium" },
    },
  ],
});
