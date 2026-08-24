import { test, expect, type Request, type Response } from "@playwright/test";

test.describe("diag", () => {
  test.skip(!process.env.E2E_TEST_EMAIL, "no creds");
  test("observe network on /bills, /calendar, /goals", async ({ page }) => {
    test.setTimeout(180_000);
    const log: string[] = [];
    page.on("request", (r: Request) => {
      log.push(`[req ${new Date().toISOString().slice(11, 23)}] ${r.method()} ${r.url()}`);
    });
    page.on("response", (r: Response) => {
      log.push(`[res ${new Date().toISOString().slice(11, 23)}] ${r.status()} ${r.request().method()} ${r.url()}`);
    });
    page.on("requestfailed", (r: Request) => {
      log.push(`[fail ${new Date().toISOString().slice(11, 23)}] ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_TEST_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole("button", { name: /Log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    log.push("--- logged in, waiting 6s for dashboard background calls ---");
    await page.waitForTimeout(6000);

    for (const route of ["/bills", "/calendar", "/goals"]) {
      log.push(`=========== goto ${route} (networkidle, 15s cap) ===========`);
      try {
        await page.goto(route, { waitUntil: "networkidle", timeout: 15_000 });
        log.push(`>>> ${route}: networkidle REACHED`);
      } catch (e) {
        log.push(`>>> ${route}: TIMEOUT ${String(e).split("\n")[0]}`);
        await page.waitForTimeout(2000);
      }
      console.log("=====DIAG-BEGIN=====");
      for (const line of log) console.log(line);
      console.log("=====DIAG-END=====");
      log.length = 0;
    }
  });
});
