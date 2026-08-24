import { test, expect, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";

/**
 * Admin Console E2E coverage — three execution tiers.
 *
 * Tier 1 (always runs): unauthenticated users must never reach the console.
 * Tier 2 (needs E2E_TEST_* creds, role:"user"): proves the negative RBAC
 *   boundary through the REAL auth chain — a signed-in non-admin is shown the
 *   forbidden screen. The account's role is never modified.
 * Tier 3 (needs optional E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD): full admin
 *   matrix. Before ANY tier-3 assertion runs, the supplied account is probed
 *   through Supabase GoTrue + GET /api/admin/whoami; it must genuinely hold
 *   role:"admin" on the target deployment. If the vars are absent, invalid,
 *   or the account is not actually an admin, the suite skips with an exact
 *   reason. No admin account is ever fabricated and no live RBAC row is
 *   touched by these tests.
 *
 * Mutating admin flows additionally require explicit opt-in:
 *   E2E_ALLOW_DESTRUCTIVE=1  plus  E2E_TARGET_USER_ID=<disposable account uuid>
 * They run against accounts/deployments the operator owns and may send real
 * emails / flip shared settings (always restored within the same test).
 */

const hasUserCreds = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const hasAdminCreds = Boolean(adminEmail && adminPassword);
const allowDestructive = process.env.E2E_ALLOW_DESTRUCTIVE === "1";
const targetUserId = process.env.E2E_TARGET_USER_ID;

const WIDTHS = [320, 360, 375, 390, 414, 430];

function onlyOnDesktopProject(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "chromium-desktop", "sweep runs once");
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

function adminSignIn(page: Page) {
  return signIn(page, adminEmail!, adminPassword!);
}

/* ---------------------------------------------------------------------- */
/* Tier 1 — unauthenticated boundary (always runs, zero credentials)       */
/* ---------------------------------------------------------------------- */

test.describe("admin boundary: unauthenticated", () => {
  for (const route of ["/admin", "/admin/users", "/admin/settings"]) {
    test(`unauthenticated visit to ${route} is redirected to login`, async ({ page }) => {
      // On a cold dev server the client-side replace() waits for Next to
      // lazily compile /login's RSC payload, which can take >20s under
      // parallel workers. Generous budgets; assertions unchanged.
      test.setTimeout(120_000);
      await page.goto(route);
      await expect(page.getByText("Verifying administrator")).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/login/, { timeout: 90_000 });
    });
  }
});

/* ---------------------------------------------------------------------- */
/* Tier 2 — authenticated NON-admin (real user account, never promoted)    */
/* ---------------------------------------------------------------------- */

test.describe("admin boundary: authenticated non-admin (needs E2E_TEST_*)", () => {
  test.skip(!hasUserCreds, "E2E_TEST_EMAIL/E2E_TEST_PASSWORD not configured");

  test("signed-in regular user sees Access restricted on admin routes", async ({ page }) => {
    test.setTimeout(120_000); // dev server compiles admin routes lazily
    await signIn(page, process.env.E2E_TEST_EMAIL!, process.env.E2E_TEST_PASSWORD!);
    for (const route of ["/admin", "/admin/users"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText(/administrators only/i)).toBeVisible();
      await expect(page.getByRole("link", { name: /Back to FinSight/i })).toBeVisible();
      // The console shell must not mount: no nav, no page header content.
      await expect(page.getByRole("link", { name: "Dashboard" }).first()).toHaveCount(0);
    }
  });

  test("announcements inbox renders for the regular user", async ({ page }) => {
    test.setTimeout(120_000); // cold dev-server compiles login + inbox lazily
    await signIn(page, process.env.E2E_TEST_EMAIL!, process.env.E2E_TEST_PASSWORD!);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    // The inbox signals its own loading state; wait for it to settle.
    await expect(page.getByText(/loading announcements/i)).toBeHidden({ timeout: 60_000 }).catch(() => {
      /* empty inbox may settle without ever showing the label */
    });
    // The inbox is reachable and functional whether or not broadcasts exist.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("admin forbidden screen holds every common mobile width", async ({ page }, testInfo) => {
    onlyOnDesktopProject(testInfo);
    test.setTimeout(120_000);
    await signIn(page, process.env.E2E_TEST_EMAIL!, process.env.E2E_TEST_PASSWORD!);
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible({
      timeout: 60_000,
    });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `forbidden screen overflows at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});

/* ---------------------------------------------------------------------- */
/* Tier 3 — real admin account (optional env, runtime role verification)   */
/* ---------------------------------------------------------------------- */

type SkipReason = string | null;

let adminProbeCache: Promise<SkipReason> | null = null;

function adminSkipReason(
  request: APIRequestContext,
  baseURL?: string
): Promise<SkipReason> {
  if (!hasAdminCreds) {
    return Promise.resolve(
      "E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD not configured — admin console E2E skipped; no fake admin is created and live RBAC data is left untouched"
    );
  }
  if (!adminProbeCache) {
    adminProbeCache = (async (): Promise<SkipReason> => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !anonKey) {
        return "NEXT_PUBLIC_SUPABASE_* env vars unavailable — cannot verify admin credentials through GoTrue";
      }
      try {
        const tokenRes = await request.post(
          `${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
          { headers: { apikey: anonKey }, data: { email: adminEmail, password: adminPassword } }
        );
        if (tokenRes.status() !== 200) {
          return `supplied E2E_ADMIN_* credentials rejected by GoTrue (HTTP ${tokenRes.status()})`;
        }
        const accessToken = (await tokenRes.json())?.access_token as string | undefined;
        if (!accessToken) return "GoTrue returned no access_token";
        const who = await request.get(`${baseURL ?? "http://localhost:3000"}/api/admin/whoami`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (who.status() === 403) {
          return "supplied E2E_ADMIN_* account does NOT have the admin role on this deployment";
        }
        if (who.status() !== 200) return `/api/admin/whoami probe failed (HTTP ${who.status()})`;
        const body = (await who.json()) as { role?: string };
        if (body.role !== "admin") {
          return "supplied E2E_ADMIN_* account does NOT have the admin role on this deployment";
        }
        return null;
      } catch (err) {
        return `admin credential probe errored: ${String(err).slice(0, 140)}`;
      }
    })();
  }
  return adminProbeCache;
}

test.describe("admin console (needs E2E_ADMIN_* with genuine admin role)", () => {
  // Every test re-checks the cached probe result so the suite stays honest
  // about WHY it is skipping when it does.
  async function requireAdmin(request: APIRequestContext, baseURL?: string) {
    const reason = await adminSkipReason(request, baseURL);
    test.skip(reason !== null, reason ?? "");
  }

  test("admin reaches the dashboard and sees permission-filtered navigation", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
    // Core navigation present for a full-permission admin.
    for (const section of ["Users", "Transactions", "Categories", "Audit Log"]) {
      await expect(page.getByRole("link", { name: section })).toBeVisible();
    }
  });

  test("users list renders with USER_VIEW", async ({ page, request }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /users/i }).first()).toBeVisible();
    // The table/list region rendered rows or an explicit empty state.
    const rowCount = await page.locator("table tbody tr, [data-empty-state]").count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("users list: column sorting and unverified-only filter reach the API", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    // Sorting by name issues an API call carrying sort + order.
    const sorted = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return (
        u.pathname.includes("/api/admin/users") &&
        u.searchParams.get("sort") === "full_name" &&
        u.searchParams.get("order") === "asc"
      );
    });
    await page.getByRole("button", { name: "Sort by name" }).click();
    expect((await sorted).status()).toBe(200);

    // The unverified-only toggle composes with the active sort.
    const filtered = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return (
        u.pathname.includes("/api/admin/users") &&
        u.searchParams.get("verified") === "false" &&
        u.searchParams.get("sort") === "full_name"
      );
    });
    await page.getByRole("checkbox", { name: "Unverified only" }).check();
    expect((await filtered).status()).toBe(200);

    // Unchecking removes the param while keeping the sort.
    const cleared = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return (
        u.pathname.includes("/api/admin/users") &&
        !u.searchParams.get("verified") &&
        u.searchParams.get("sort") === "full_name"
      );
    });
    await page.getByRole("checkbox", { name: "Unverified only" }).uncheck();
    expect((await cleared).status()).toBe(200);
  });

  test("CSV exports download from users, audit and transactions lists", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);

    for (const [route, prefix] of [
      ["/admin/users", /^admin-users-\d{4}-\d{2}-\d{2}\.csv$/],
      ["/admin/audit", /^admin-audit-\d{4}-\d{2}-\d{2}\.csv$/],
      ["/admin/transactions", /^admin-transactions-\d{4}-\d{2}-\d{2}\.csv$/],
    ] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
      const exportButton = page.getByRole("button", { name: /export csv/i });
      await expect(exportButton).toBeVisible();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30_000 }),
        exportButton.click(),
      ]);
      expect(download.suggestedFilename()).toMatch(prefix);
    }
  });

  test("audit log: action filtering reaches the API and reset clears it", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    const actionSelect = page.getByLabel("Action filter");
    await expect(actionSelect).toBeVisible();

    const filtered = page.waitForResponse(
      (r) => r.url().includes("/api/admin/audit-logs") && r.url().includes("action=maintenance.toggle")
    );
    await actionSelect.selectOption({ label: "Maintenance toggle" });
    const res = await filtered;
    expect(res.status()).toBe(200);

    const resetButton = page.getByRole("button", { name: "Reset filters" });
    await expect(resetButton).toBeEnabled();
    const cleared = page.waitForResponse((r) => {
      const u = r.url();
      return u.includes("/api/admin/audit-logs") && !u.includes("action=");
    });
    await resetButton.click();
    expect((await cleared).status()).toBe(200);
    await expect(resetButton).toBeDisabled();
  });

  test("audit log: date range and actor filters reach the API", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    const dated = page.waitForResponse((r) => r.url().includes("dateFrom=2026-01-01"));
    await page.getByLabel("From date").fill("2026-01-01");
    expect((await dated).status()).toBe(200);

    const acted = page.waitForResponse((r) => r.url().includes("actorId=00000000"));
    await page.getByLabel("Filter by actor user ID").fill("00000000-0000-4000-8000-00000000000x");
    // Malformed UUID must be rejected server-side: surface the error state…
    await acted.catch(() => null); // request may or may not fire depending on trim
    await expect(page.getByText(/invalid actorId|could not load/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("audit log: resource filters reach the API and compose", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    const resourceSelect = page.getByLabel("Resource type filter");
    await expect(resourceSelect).toBeVisible();
    const typed = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/audit-logs") &&
        r.url().includes("resourceType=transaction")
    );
    await resourceSelect.selectOption("transaction");
    expect((await typed).status()).toBe(200);

    const composed = page.waitForResponse(
      (r) =>
        r.url().includes("resourceType=transaction") &&
        r.url().includes("resourceId=00000000-0000-4000-8000-000000000010")
    );
    await page
      .getByLabel("Filter by resource ID")
      .fill("00000000-0000-4000-8000-000000000010");
    expect((await composed).status()).toBe(200);
  });

  test("audit catalogue exposes the notification.delete action filter", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    const actionSelect = page.getByLabel("Action filter");
    await expect(actionSelect).toBeVisible();
    const optionLabels = (await actionSelect.locator("option").allTextContents()).join("\n");
    expect(optionLabels).toContain("Notification delete");
  });

  test("roles matrix renders", async ({ page, request }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/roles", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /role/i }).first()).toBeVisible();
  });

  test("categories render", async ({ page, request }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/categories", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /categor/i }).first()).toBeVisible();
  });

  test("settings: dirty-state detection enables Save and reverting disables it (never saved)", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    const saveButtons = page.getByRole("button", { name: /Save group/i });
    const firstGroup = page.locator("section, .card").filter({ has: saveButtons.first() });
    const appName = page.getByLabel("App name");
    await expect(appName).toBeVisible();
    const original = await appName.inputValue();
    const firstSave = saveButtons.first();
    await expect(firstSave).toBeDisabled();

    await appName.fill(`${original} [e2e-draft]`);
    await expect(firstSave).toBeEnabled(); // F-13 regression: change detected
    await appName.fill(original);
    await expect(firstSave).toBeDisabled(); // reverted — still never clicked
    void firstGroup;
  });

  test("push subscriptions page renders without claiming delivery", async ({
    page,
    request,
  }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    await adminSignIn(page);
    await page.goto("/admin/push", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("mobile sweep: admin pages hold every common width", async ({ page, request }, testInfo) => {
    await requireAdmin(request);
    onlyOnDesktopProject(testInfo);
    test.setTimeout(180_000);
    await adminSignIn(page);

    for (const route of ["/admin/dashboard", "/admin/users", "/admin/audit"]) {
      await page.setViewportSize({ width: WIDTHS[0], height: 844 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${route} overflows at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Destructive admin flows — double opt-in (admin creds + ALLOW flag +       */
/* disposable E2E_TARGET_USER_ID). Always restore state within the test.     */
/* ------------------------------------------------------------------------ */

test.describe("admin mutations (requires E2E_ALLOW_DESTRUCTIVE=1)", () => {
  test.skip(
    !(allowDestructive && hasAdminCreds),
    "destructive admin E2E requires explicit E2E_ALLOW_DESTRUCTIVE=1 plus valid E2E_ADMIN_* credentials"
  );

  test("suspend → activate cycles the target account and restores it", async ({
    page,
    request,
  }) => {
    test.skip(!targetUserId, "E2E_TARGET_USER_ID not configured — no disposable target to mutate");
    const reason = await adminSkipReason(request);
    test.skip(reason !== null, reason!);

    await adminSignIn(page);
    await page.goto(`/admin/users/${targetUserId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });

    // Suspend (armed two-step confirmation).
    await page.getByRole("button", { name: /^suspend/i }).click();
    await page.getByRole("button", { name: /^suspend/i }).click();
    await expect(page.getByText(/suspended/i).first()).toBeVisible({ timeout: 20_000 });

    // Restore.
    await page.getByRole("button", { name: /^activate/i }).click();
    await page.getByRole("button", { name: /^activate/i }).click();
    await expect(page.getByText(/^active/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("revoke sessions reports success for the target", async ({ page, request }) => {
    test.skip(!targetUserId, "E2E_TARGET_USER_ID not configured");
    const reason = await adminSkipReason(request);
    test.skip(reason !== null, reason!);

    await adminSignIn(page);
    await page.goto(`/admin/users/${targetUserId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
    await page.getByRole("button", { name: /revoke sessions/i }).click();
    await page.getByRole("button", { name: /revoke sessions/i }).click();
    await expect(page.locator("[role=alert], .toast")).toContainText(/revoked|success/i, {
      timeout: 20_000,
    });
  });

  test("broadcast deletion: draft has no Delete, sent does, delete removes it", async ({
    page,
    request,
  }) => {
    const reason = await adminSkipReason(request);
    test.skip(reason !== null, reason!);

    await adminSignIn(page);

    // Provision a disposable broadcast through the admin API (draft first).
    const adminToken = await page.evaluate(() => {
      const raw = Object.keys(localStorage)
        .filter((k) => k.includes("-auth-token"))
        .map((k) => localStorage.getItem(k))
        .find(Boolean);
      return raw ? (JSON.parse(raw!)?.access_token as string) : null;
    });
    expect(adminToken).toBeTruthy();
    const title = `E2E deletion probe ${Date.now()}`;
    const created = await request.post("/api/admin/notifications", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { title, body: "Disposable broadcast for the deletion lifecycle test.", audience: "users" },
    });
    expect(created.status()).toBe(200);
    const notifId = ((await created.json()) as { id?: string }).id;
    expect(notifId).toBeTruthy();

    try {
      // Draft rows offer no destructive action.
      await page.goto("/admin/notifications", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 60_000 });
      const draftRow = page.locator("div.px-5").filter({ hasText: title });
      await expect(draftRow).toBeVisible({ timeout: 20_000 });
      await expect(draftRow.getByRole("button", { name: /^delete/i })).toHaveCount(0);

      // Send it — the row enters a terminal state and Delete appears.
      const sent = await request.post(`/api/admin/notifications/${notifId}/send`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(sent.status()).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      const sentRow = page.locator("div.px-5").filter({ hasText: title });
      await expect(sentRow.getByRole("button", { name: /^delete/i })).toBeVisible({
        timeout: 20_000,
      });

      // Arm-then-fire confirmation, then the row disappears.
      await sentRow.getByRole("button", { name: /^delete/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const confirm = dialog.getByRole("button", { name: /delete notification/i });
      await confirm.click();
      await confirm.click();
      await expect(page.locator("div.px-5").filter({ hasText: title })).toHaveCount(0, {
        timeout: 20_000,
      });

      // Server-side truth: the notification is gone.
      const listed = await request.get("/api/admin/notifications?pageSize=50", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listed.status()).toBe(200);
      const remaining = ((await listed.json()) as { items?: { id: string }[] }).items ?? [];
      expect(remaining.some((n) => n.id === notifId)).toBe(false);
    } catch (err) {
      // Best-effort cleanup so a failed run never leaves the probe behind.
      await request.post(`/api/admin/notifications/${notifId}/cancel`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => null);
      await request.delete(`/api/admin/notifications/${notifId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { confirm: "DELETE" },
      }).catch(() => null);
      throw err;
    }
  });

  test("maintenance toggle blocks user mutations, keeps reads/auth, then restores OFF", async ({
    page,
    request,
  }) => {
    test.skip(
      !hasUserCreds || !process.env.NEXT_PUBLIC_SUPABASE_URL,
      "needs E2E_TEST_* (victim reads/mutations) and NEXT_PUBLIC_SUPABASE_URL"
    );
    const reason = await adminSkipReason(request);
    test.skip(reason !== null, reason!);

    // Flip maintenance ON via the dedicated system endpoint (SYSTEM_SETTINGS).
    await adminSignIn(page);
    const adminToken = await page.evaluate(() => {
      const raw = Object.keys(localStorage)
        .filter((k) => k.includes("-auth-token"))
        .map((k) => localStorage.getItem(k))
        .find(Boolean);
      return raw ? (JSON.parse(raw!)?.access_token as string) : null;
    });
    expect(adminToken).toBeTruthy();
    const enable = await request.post("/api/admin/system/maintenance", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { enabled: true },
    });
    expect(enable.status()).toBe(200);

    try {
      // Public status flips within its polling/cache window.
      const status = await request.get("/api/app/status");
      expect(status.status()).toBe(200);
      expect((await status.json()).maintenance).toBe(true);

      // A signed-in regular user: mutation blocked with the exact envelope,
      // reads and auth flows remain available.
      const victim = await request.post(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
        {
          headers: {
            apikey:
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
              process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          },
          data: { email: process.env.E2E_TEST_EMAIL, password: process.env.E2E_TEST_PASSWORD },
        }
      );
      expect(victim.status()).toBe(200);
      const bearer = `Bearer ${(await victim.json()).access_token}`;

      const blocked = await request.post("/api/v1/recurring", {
        headers: { Authorization: bearer, "Content-Type": "application/json" },
        data: {},
      });
      expect(blocked.status()).toBe(503);
      expect((await blocked.json()).code).toBe("maintenance_mode");

      const read = await request.get("/api/v1/transactions", { headers: { Authorization: bearer } });
      expect(read.status()).toBe(200);

      const forgot = await request.post("/api/v1/auth/forgot-password", {
        headers: { Authorization: bearer, "Content-Type": "application/json" },
        data: { email: process.env.E2E_TEST_EMAIL },
      });
      expect([200, 429]).toContain(forgot.status()); // 429 acceptable if limiter tripped

      // Admin API remains fully available during maintenance.
      const adminDuring = await request.get("/api/admin/overview", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(adminDuring.status()).toBe(200);
    } finally {
      await request.post("/api/admin/system/maintenance", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { enabled: false },
      });
    }
    const restored = await request.get("/api/app/status");
    expect((await restored.json()).maintenance).toBe(false);
  });
});
