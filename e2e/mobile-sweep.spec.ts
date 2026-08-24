import { test, expect, type Page, type TestInfo } from "@playwright/test";

const WIDTHS = [320, 360, 375, 390, 414, 430];
const hasE2ECreds = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

// Runs once (on the desktop project) — viewport widths are set explicitly here,
// so the mobile-iphone project would just duplicate the work.
function onlyOnDesktopProject(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "chromium-desktop", "sweep runs once");
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const vw = doc.clientWidth;
    const offenders: string[] = [];
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${el.className}`);
      }
    });
    return {
      docOverflow: doc.scrollWidth - doc.clientWidth,
      bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0,
      offenders: offenders.slice(0, 5),
    };
  });
  expect(metrics.docOverflow).toBeLessThanOrEqual(0);
  expect(metrics.bodyOverflow).toBeLessThanOrEqual(0);
  expect(metrics.offenders).toEqual([]);
}

test.describe("mobile width sweep — public pages", () => {
  for (const width of WIDTHS) {
    test(`/login has no horizontal overflow at ${width}px`, async ({ page }, testInfo) => {
      onlyOnDesktopProject(testInfo);
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/login");
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("mobile width sweep — authenticated pages (needs E2E_TEST_EMAIL / E2E_TEST_PASSWORD)", () => {
  test.skip(!hasE2ECreds, "E2E credentials not configured — skipping auth sweep");

  const routes = ["/bills", "/calendar", "/goals", "/notifications"] as const;

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_TEST_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole("button", { name: /Log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  }

  for (const route of routes) {
    test(`${route} has no horizontal overflow at any mobile width`, async ({ page }, testInfo) => {
      onlyOnDesktopProject(testInfo);
      test.setTimeout(120_000); // dev server compiles routes/APIs on demand (~1.5–4.5s per first call)
      await signIn(page);

      // Wait for structural readiness instead of a network-quiet window:
      // in dev mode Next compiles each route and API handler lazily, so
      // "networkidle" is inherently flaky, while the app has no intentional
      // long-lived/polling requests on these pages. The layout is final once
      // the h1 rendered and the initial data-loading skeletons are gone.
      await page.setViewportSize({ width: WIDTHS[0], height: 844 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
      await expect(page).toHaveURL(new RegExp(route.replace("/", "\\/")));

      // One load, then sweep widths by resizing: the responsive layout is
      // driven by viewport media queries, which re-evaluate live, so every
      // width still gets a genuine overflow check without re-paying the
      // dev-server compile/data cost per navigation.
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
        );
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});
