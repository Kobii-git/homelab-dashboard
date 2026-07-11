import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

async function expectNoSeriousAxeViolations(page: Page) {
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
}

test("setup uses labeled, keyboard-focusable account controls", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/setup/status", (route) => route.fulfill({
    json: { firstRun: true, needsAccount: true, needsSetupCode: true }
  }));
  await page.goto("/");
  await expect(page.getByLabel("One-time setup code")).toBeVisible();
  const demo = page.getByRole("checkbox", { name: /Load demo data/ });
  await demo.focus();
  await page.keyboard.press("Space");
  await expect(demo).not.toBeChecked();
  await expectNoSeriousAxeViolations(page);
});

test("mobile navigation and service rows remain visible without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const name of ["Dashboard", "Services", "Admin"]) {
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name })).toBeVisible();
  }
  await page.getByRole("button", { name: "Services" }).click();
  await expect(page.getByRole("button", { name: "Delete OPNsense Gateway" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const row = page.locator(".service-data-row").first();
  const rowBox = await row.boundingBox();
  const deleteBox = await page.getByRole("button", { name: "Delete OPNsense Gateway" }).boundingBox();
  expect(rowBox && deleteBox && deleteBox.y + deleteBox.height <= rowBox.y + rowBox.height + 1).toBe(true);
});

test("cards and modal surfaces are keyboard operable and restore focus", async ({ page }) => {
  await login(page);
  const primaryCard = page.locator(".svc-primary").first();
  await expect(primaryCard).toHaveJSProperty("tagName", "BUTTON");
  await primaryCard.focus();
  await expect(primaryCard).toBeFocused();

  const search = page.getByRole("button", { name: /Search/ });
  await search.click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toHaveAttribute("aria-modal", "true");
  await expect(palette.getByPlaceholder("Search services and actions…")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();

  const details = page.getByRole("button", { name: "Show details for OPNsense Gateway" });
  await details.click();
  const drawer = page.getByRole("dialog", { name: "OPNsense Gateway details" });
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
});

test("authenticated views, palette, and drawer have no serious axe violations", async ({ page }) => {
  await page.goto("/");
  await expectNoSeriousAxeViolations(page);
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expectNoSeriousAxeViolations(page);
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await navigation.getByRole("button", { name: "Services", exact: true }).click();
  await expectNoSeriousAxeViolations(page);
  await navigation.getByRole("button", { name: "Admin", exact: true }).click();
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: /Search/ }).click();
  await expectNoSeriousAxeViolations(page);
  await page.keyboard.press("Escape");
  await navigation.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Show details for OPNsense Gateway" }).click();
  await expectNoSeriousAxeViolations(page);
});

test("a rejected authenticated refresh returns to login with an expiry message", async ({ page }) => {
  await login(page);
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(/session expired or was invalidated/i)).toBeVisible();
});

test("public status distinguishes unknown state and recovers from fetch errors", async ({ page }) => {
  await page.route("**/api/status", (route) => route.fulfill({
    json: {
      overallStatus: "unknown",
      summary: { resources: 1, online: 0, offline: 0, unknown: 1 },
      resources: [{ name: "Pending service", status: "unknown", uptimePercent: null, ticks: [] }],
      generatedAt: new Date().toISOString()
    }
  }));
  await page.goto("/status");
  await expect(page.getByText("System status is not yet known")).toBeVisible();

  await page.unroute("**/api/status");
  await page.route("**/api/status", (route) => route.abort());
  await page.reload();
  await expect(page.getByText("Status data is temporarily unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
