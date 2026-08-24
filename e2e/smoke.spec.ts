import { test, expect, type Page } from "@playwright/test";

const hasE2ECreds = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("public smoke tests", () => {
  test("home page redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /Log in/i })).toBeVisible();
  });

  test("login page renders the full auth form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /Log in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Create an? account/i })).toBeVisible();
  });

  test("register page renders the signup form", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("button", { name: /Create account/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Log in/i })).toBeVisible();
  });

  test("forgot password page renders and links back", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /Forgot/i })).toBeVisible();
  });

  test("404s for unknown routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByText("404", { exact: false })).toBeVisible();
  });

  test("page stays within the viewport width on mobile", async ({ page }) => {
    await page.goto("/login");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("authenticated journeys (needs E2E_TEST_EMAIL / E2E_TEST_PASSWORD)", () => {
  test.skip(!hasE2ECreds, "E2E credentials not configured — skipping auth journey");

  test("signs in and reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_TEST_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole("button", { name: /Log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });

  test("signs out from the profile menu", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_TEST_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole("button", { name: /Log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/profile/);
  });
});
