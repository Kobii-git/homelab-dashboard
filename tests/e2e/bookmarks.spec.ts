import { enableHomeWidgets } from "./homepage-fixtures";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("bookmarks save without checks, survive reload, filter, and open in a keyboard menu", async ({ page }, testInfo) => {
  const bookmarkName = `Reading shelf ${testInfo.project.name}`;
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  const library = page.getByRole("region", { name: "Bookmarks" });
  const bookmarksButton = page.getByRole("button", { name: "Bookmarks", exact: true });
  await expect(bookmarksButton).toHaveAttribute("aria-expanded", "false");
  await expect(library).toHaveCount(0);
  await bookmarksButton.focus();
  await bookmarksButton.press("Enter");
  await expect(page.getByRole("menu", { name: "Home bookmarks" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
  await library.getByRole("button", { name: "Add bookmark" }).click();
  const form = page.getByRole("form", { name: "New bookmark" });
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await form.getByLabel("Name", { exact: true }).fill(bookmarkName);
  await form.getByLabel("Website address").fill("https://example.com/reading");
  await form.getByLabel("Collection").selectOption({ label: "Unfiled" });
  await form.getByRole("button", { name: "Save bookmark" }).click();
  const reauth = page.getByRole("dialog", { name: "Confirm it’s you" });
  await reauth.getByLabel(/administrator password/i).fill("e2e-admin-password");
  await reauth.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(library.getByRole("link", { name: new RegExp(bookmarkName) })).toHaveAttribute("href", "https://example.com/reading");
  await expect(library.getByRole("button", { name: "Add bookmark" })).toBeFocused();
  const response = await page.request.get("/api/resources");
  const saved = (await response.json()).find((item: { name: string }) => item.name === bookmarkName);
  expect(saved.monitoringMode).toBe("disabled");
  expect(saved.kind).toBe("website");
  const checks = await (await page.request.get("/api/health-checks")).json();
  expect(checks.filter((item: { resourceId: string }) => item.resourceId === saved.id)).toEqual([]);
  await page.reload();
  await bookmarksButton.click();
  await expect(page.getByRole("menuitem", { name: bookmarkName, exact: true })).toBeVisible();
  await expect(page.locator(".launchpad-services").getByText(bookmarkName, { exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
  await library.getByLabel("Collection", { exact: true }).selectOption({ label: "Unfiled" });
  await library.getByLabel("Filter bookmarks").fill("missing");
  await expect(library.getByRole("status")).toContainText("No matching bookmarks");
  await library.getByLabel("Filter bookmarks").fill("Reading");
  await expect(library.getByRole("link", { name: new RegExp(bookmarkName) })).toBeVisible();
  await library.getByRole("button", { name: `Unpin ${bookmarkName}` }).click();
  await expect(library.getByRole("button", { name: `Pin ${bookmarkName}` })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Dashboard", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Google" });
  await expect(page.getByRole("button", { name: "My bookmarks", exact: true })).toHaveCount(0);
  await search.fill(bookmarkName);
  await expect(page.getByRole("listbox", { name: "Saved bookmark suggestions" })).toHaveCount(0);
  await bookmarksButton.click();
  const menu = page.getByRole("menu", { name: "Home bookmarks" });
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(250);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(bookmarksButton).toBeFocused();
  await bookmarksButton.click();
  await search.click();
  await expect(menu).toHaveCount(0);
  await expect(search).toBeFocused();
  await bookmarksButton.click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await bookmarksButton.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
  await library.getByRole("button", { name: `Edit bookmark ${bookmarkName}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit bookmark" })).toBeVisible();

});

test("bookmark save errors preserve the draft and announce the failure", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.route("**/api/homepage/bookmarks", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 500, json: { error: "Could not save bookmark" } }) : route.continue());
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
  await page.getByRole("button", { name: "Add bookmark" }).click();
  const form = page.getByRole("form", { name: "New bookmark" });
  await form.getByLabel("Name", { exact: true }).fill("Keep this draft");
  await form.getByLabel("Website address").fill("https://example.com");
  await form.getByRole("button", { name: "Save bookmark" }).click();
  await expect(form.getByRole("alert")).toContainText("Could not save bookmark");
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Keep this draft");
});

for (const unavailable of [false, true]) {
  test(`weather ${unavailable ? "failure" : "card"} remains visible on an empty home`, async ({ page }) => {
    await enableHomeWidgets(page, ["weather"]);
    await page.route("**/api/settings", (route) => route.fulfill({ json: {
      autoPingIntervalSeconds: 60,
      dashboardUtilities: { searchEngine: "duckduckgo", weather: { enabled: true, units: "metric", location: { name: "Example City" } }, releases: { enabled: false, repositories: [] } },
      dashboardHome: { agendaEnabled: false, tasksEnabled: false, mailEnabled: false, mediaEnabled: false, storageEnabled: false }
    } }));
    await page.route("**/api/dashboard", async (route) => {
      const data = await (await route.fetch()).json();
      await route.fulfill({ json: { ...data, groups: [], ungroupedResources: [] } });
    });
    await page.route("**/api/utilities/summary", (route) => route.fulfill(unavailable
      ? { status: 503, json: { error: "Weather provider unavailable" } }
      : { json: { weather: { state: "ready", data: { units: "metric", temperature: 22, apparentTemperature: 21, weatherCode: 0, isDay: true, condition: "Clear", location: { name: "Example City" } }, stale: false } } }));
    await page.goto("/");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("e2e-admin-password");
    await page.getByRole("button", { name: "Unlock" }).click();
    const today = page.getByRole("region", { name: "Weather", exact: true });
    await expect(today.getByText(unavailable ? /Weather unavailable/ : "22°C").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Bookmarks", exact: true })).toBeVisible();
    if (!unavailable) {
      const grid = await page.getByRole("region", { name: "Weather", exact: true }).boundingBox();
      const card = await page.locator(".compact-weather-card").boundingBox();
      expect(grid && card && card.width <= grid.width).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Home bookmarks" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Switch to light mode|Light mode/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("heading", { name: "Favorites", exact: true })).toHaveCSS("color", "rgb(37, 58, 54)");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });
}
