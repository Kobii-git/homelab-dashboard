import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(
    page.getByRole("combobox", { name: "Search Google" }),
  ).toBeVisible();
}

test("Work notes preserve drafts across devices and expose explicit conflict recovery", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await login(page);
  await page
    .getByRole("navigation", { name: "Dashboard view" })
    .getByRole("button", { name: "Work", exact: true })
    .click();
  await expect(page.getByLabel("Workspace notes")).toBeVisible();
  const secondContext = await browser.newContext({
    storageState: await context.storageState(),
  });
  const other = await secondContext.newPage();
  await other.goto("/");
  await other
    .getByRole("navigation", { name: "Dashboard view" })
    .getByRole("button", { name: "Work", exact: true })
    .click();
  await page.bringToFront();
  await page
    .getByLabel("Workspace notes")
    .fill(`First device ${testInfo.project.name}`);
  await expect(
    page.getByRole("button", { name: "Save notes", exact: true }),
  ).toBeEnabled();
  await other.bringToFront();
  await other
    .getByLabel("Workspace notes")
    .fill(`Second device draft ${testInfo.project.name}`);
  await page.bringToFront();
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await other.bringToFront();
  await other.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(
    other.getByText(/Configuration changed on another device/).first(),
  ).toBeVisible();
  await expect(other.getByLabel("Workspace notes")).toHaveValue(
    `Second device draft ${testInfo.project.name}`,
  );
  await other.getByRole("button", { name: "Reload saved data" }).click();
  await other
    .getByRole("button", { name: "Keep draft against latest version" })
    .click();
  await other.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Workspace notes")).toHaveValue(
    `Second device draft ${testInfo.project.name}`,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Room to focus." }),
  ).toBeVisible();
  await secondContext.close();
});

test("prompt library copies reviewed text and handles clipboard failure without AI requests", async ({
  page,
}, testInfo) => {
  await login(page);
  await page
    .getByRole("navigation", { name: "Dashboard view" })
    .getByRole("button", { name: "Work", exact: true })
    .click();
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit prompt" });
  await dialog
    .getByLabel("Title", { exact: true })
    .fill(`Review prompt ${testInfo.project.name}`);
  await dialog
    .getByLabel("Prompt text")
    .fill("Review only these selected notes.");
  await dialog.getByRole("button", { name: "Save prompt" }).click();
  const row = page
    .locator(".hp-prompt")
    .filter({ hasText: `Review prompt ${testInfo.project.name}` });
  await row.getByRole("button", { name: "Copy", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Copy selected items" });
  await expect(preview.getByLabel("Text to copy")).toHaveValue(
    "Review only these selected notes.",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("unavailable")) },
    });
  });
  await preview.getByRole("button", { name: "Copy text", exact: true }).click();
  await expect(preview.getByRole("status")).toContainText("copy it manually");
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Copy", exact: true }),
  ).toBeFocused();
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("layout previews cancel, save, and remain usable at narrow widths and zoom", async ({
  page,
}, testInfo) => {
  await login(page);
  await page
    .getByRole("button", { name: "Customize home", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Customize homepage" });
  await panel.getByLabel("Accent", { exact: true }).selectOption("violet");
  await expect(page.locator(".browser-home")).toHaveClass(/hp-accent-violet/);
  await panel.getByRole("button", { name: "Cancel preview" }).click();
  await expect(page.locator(".browser-home")).toHaveClass(/hp-accent-blue/);
  await page
    .getByRole("button", { name: "Customize home", exact: true })
    .click();
  await panel.getByLabel("Background", { exact: true }).selectOption("ocean");
  await panel.getByRole("button", { name: "Save layout" }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".browser-home")).toHaveClass(/hp-bg-ocean/);
  await page.screenshot({
    path: testInfo.outputPath("homepage-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("homepage-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => (document.documentElement.style.zoom = "1"));
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});

test("configuration export downloads a ZIP and restore requires a reviewed safety backup", async ({
  page,
}) => {
  await login(page);
  await page.request.post("/api/auth/reauth", {
    data: { password: "e2e-admin-password" },
  });
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Admin", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Data and backups" });
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Export configuration", exact: true })
    .click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  await panel
    .getByLabel("Preview configuration restore")
    .setInputFiles((await file.path())!);
  await expect(
    panel.getByRole("heading", { name: "Review replacement" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Replace configuration", exact: true }),
  ).toBeDisabled();
  await expect(panel).toContainText("Administrator credentials");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Review replacement" }),
  ).toHaveCount(0);
});

test("a 5,000-bookmark library keeps search and paged scrolling responsive", async ({
  page,
}, testInfo) => {
  await page.route("**/api/homepage", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const snapshot = await response.json();
    snapshot.bookmarks = Array.from({ length: 5000 }, (_, index) => ({
      id: `performance-${index}`,
      name: `Reference bookmark ${String(index).padStart(4, "0")}`,
      url: `https://example.com/reference/${index}?topic=work#section`,
      notes: `Notes for project ${index % 100}`,
      workspaceId: "home",
      collectionId: null,
      readingState: "none",
      favorite: index < 8,
      sortOrder: index,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }));
    await route.fulfill({ json: snapshot });
  });
  await login(page);
  const library = page.getByRole("region", { name: "Bookmarks", exact: true });
  await expect(library.locator(".hp-link-row")).toHaveCount(60);
  const start = await page.evaluate(() => performance.now());
  await library.getByLabel("Filter bookmarks").fill("Reference bookmark 4999");
  await expect(library.locator(".hp-link-row")).toHaveCount(1);
  await expect(
    library.getByRole("link", { name: /Reference bookmark 4999/ }),
  ).toBeVisible();
  const searchMs = (await page.evaluate(() => performance.now())) - start;
  await library.getByLabel("Filter bookmarks").fill("");
  const scrollStart = await page.evaluate(() => performance.now());
  await library.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    library.getByRole("link", { name: /Reference bookmark 0060/ }),
  ).toBeVisible();
  const pageMs = (await page.evaluate(() => performance.now())) - scrollStart;
  const measurements = JSON.stringify({
    count: 5000,
    browser: testInfo.project.name,
    searchMs,
    pageMs,
    renderedRows: 60,
  });
  await writeFile(
    testInfo.outputPath("bookmark-performance.json"),
    measurements,
  );
  await testInfo.attach("bookmark-performance.json", {
    body: measurements,
    contentType: "application/json",
  });
  expect(searchMs).toBeLessThan(2000);
  expect(pageMs).toBeLessThan(2000);
});
