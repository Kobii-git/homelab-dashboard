import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search Google" }),
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
    page.getByRole("status").filter({ hasText: /^Saved to your notes$/ }),
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
  await expect(page.getByLabel("Workspace notes")).toHaveValue("");
  await expect(page.locator(".hp-note").filter({ hasText: `Second device draft ${testInfo.project.name}` })).toBeVisible();
  await expect(page.locator(".hp-note").filter({ hasText: `First device ${testInfo.project.name}` })).toBeVisible();
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
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Customize home", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Customize homepage" });
  await panel.getByLabel("Accent", { exact: true }).selectOption("violet");
  await expect(page.locator(".homepage-preferences")).toHaveClass(/hp-accent-violet/);
  await panel.getByRole("button", { name: "Cancel preview" }).click();
  await expect(page.locator(".homepage-preferences")).toHaveClass(/hp-accent-blue/);
  await page
    .getByRole("button", { name: "Customize home", exact: true })
    .click();
  await panel.getByLabel("Background", { exact: true }).selectOption("ocean");
  await panel.getByRole("button", { name: "Save layout" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Dashboard", exact: true }).click();
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
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Data & backups", exact: true }).click();
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
  await expect(library).toHaveCount(0);
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Home bookmarks" }).locator(".hp-menu-link")).toHaveCount(60);
  await expect(page.locator(".bookmark-rail-items > a")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "More bookmarks", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
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

test("nested folders are managed in Settings and expand with the keyboard on Home", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
  await login(page);
  await page.request.post("/api/auth/reauth", { data: { password: "e2e-admin-password" } });
  await expect(page.getByLabel("Filter bookmarks")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export HTML" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
  await page.getByRole("button", { name: "Manage collections" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage collections" });
  const root = `Ideas ${testInfo.project.name}`;
  for (const [name, parent] of [[root, ""], ["Web", root], ["Design", `${root} / Web`]]) {
    await dialog.getByLabel("Collection name").fill(name);
    await dialog.getByLabel("Parent collection").selectOption({ label: parent || "Top level" });
    await dialog.getByRole("button", { name: "Add collection", exact: true }).click();
    await expect(dialog.getByLabel("Collection name")).toHaveValue("");
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add bookmark", exact: true }).click();
  const form = page.getByRole("form", { name: "New bookmark" });
  await form.getByLabel("Name", { exact: true }).fill("Design reference");
  await form.getByLabel("Website address").fill("https://example.com/design");
  await form.getByRole("combobox", { name: "Collection", exact: true }).selectOption({ label: `${root} / Web / Design` });
  await form.getByRole("button", { name: "Save bookmark" }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Dashboard", exact: true }).click();
  const library = page.getByRole("region", { name: "Bookmarks", exact: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByRole("button", { name: "Bookmarks", exact: true })).toBeVisible();
  await expect(library).toHaveCount(0);
  const rail = page.getByRole("complementary", { name: "Bookmarks bar" });
  expect((await rail.boundingBox())!.width).toBeLessThanOrEqual(84);
  const shortcut = rail.getByRole("button", { name: root, exact: true });
  await expect(shortcut).toBeVisible();
  await shortcut.focus();
  await shortcut.press("ArrowRight");
  const directMenu = page.getByRole("menu", { name: root, exact: true });
  await expect(directMenu).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Web", exact: true })).toBeFocused();
  await expect.poll(async () => (await directMenu.boundingBox())!.x).toBeGreaterThanOrEqual(80);
  await page.screenshot({ path: testInfo.outputPath("bookmark-rail-wide.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(shortcut).toBeFocused();
  await rail.getByRole("button", { name: "Collapse bookmarks bar", exact: true }).click();
  await expect(rail).toHaveCSS("width", "56px");
  await shortcut.click();
  await expect(directMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await rail.getByRole("button", { name: "Hide bookmarks bar", exact: true }).click();
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "Show bookmarks bar", exact: true }).click();
  await expect(rail).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("home-wide.png"), fullPage: true });
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Design reference", exact: true })).toHaveCount(0);
  for (const name of [root, "Web", "Design"]) {
    const folder = page.getByRole("menuitem", { name, exact: true });
    await folder.focus();
    await folder.press("ArrowRight");
    await expect(page.getByRole("menu", { name, exact: true })).toBeVisible();
    await expect.poll(async () => Math.abs((await page.getByRole("menu", { name, exact: true }).boundingBox())!.y - (await folder.boundingBox())!.y)).toBeLessThanOrEqual(8);
  }
  const reference = page.getByRole("menuitem", { name: "Design reference", exact: true });
  await expect(reference).toHaveAttribute("href", "https://example.com/design");
  await expect(reference).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("menu", { name: "Design", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Design", exact: true })).toBeFocused();
  await page.getByRole("menuitem", { name: "Design", exact: true }).hover();
  await expect(reference).toBeVisible();
  for (const menu of await page.getByRole("menu").all()) {
    const bounds = (await menu.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(250);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920);
  }
  const rootBounds = (await page.getByRole("menu", { name: "Home bookmarks" }).boundingBox())!;
  const childBounds = (await page.getByRole("menu", { name: root, exact: true }).boundingBox())!;
  expect(childBounds.x).toBeGreaterThanOrEqual(rootBounds.x + rootBounds.width - 4);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("folders-wide.png"), fullPage: true });
  await page.getByRole("searchbox", { name: "Search Google" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await rail.boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(shortcut).toBeHidden();
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  for (const name of [root, "Web", "Design"]) await page.getByRole("menuitem", { name, exact: true }).click();
  await expect(reference).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(1);
  const mobile = (await page.getByRole("menu").boundingBox())!;
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
  expect(mobile.y + mobile.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("folders-mobile.png"), fullPage: true });
  await page.getByRole("menuitem", { name: "Back", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Design", exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Bookmarks", exact: true })).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("home-mobile.png"), fullPage: true });

});

test("saved notes open, edit, and delete while scratchpad drafts stay separate", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
  await login(page);
  await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Work", exact: true }).click();
  const notes = page.getByRole("region", { name: "Notes", exact: true });
  const title = `Keep an idea ${testInfo.project.name}`;
  await notes.getByLabel("Workspace notes").fill(title);
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(notes.getByLabel("Workspace notes")).toHaveValue("");
  const card = notes.locator(".hp-note").filter({ hasText: title });
  await card.click();
  const editor = page.getByRole("dialog", { name: "Edit note" });
  await expect(editor.getByLabel("Note title")).toBeFocused();
  await editor.getByLabel("Note text").fill("The whole note is here.\nA second line.");
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await notes.getByLabel("Workspace notes").fill("A separate unsaved thought");
  await notes.locator(".hp-note").filter({ hasText: title }).click();
  await expect(editor.getByLabel("Note text")).toHaveValue("The whole note is here.\nA second line.");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notes.getByLabel("Workspace notes")).toHaveValue("A separate unsaved thought");
  await page.screenshot({ path: testInfo.outputPath("notes-dark.png"), fullPage: true });
  await page.getByRole("button", { name: /Switch to light mode|Light mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(notes).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(notes.getByRole("heading", { name: /^Notes/ })).toHaveCSS("color", "rgb(37, 58, 54)");
  await page.screenshot({ path: testInfo.outputPath("notes-light.png"), fullPage: true });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  await notes.locator(".hp-note").filter({ hasText: title }).click();
  page.once("dialog", d => d.accept());
  await editor.getByRole("button", { name: "Delete note" }).click();
  await expect(card).toHaveCount(0);
  await expect(notes.getByRole("button", { name: "New note" })).toBeFocused();
});

test("sidebar bookmarks follow the workspace and sections can mix dropdowns with dedicated content", async ({ page, browser, context }, testInfo) => {
  await login(page);
  const primary = page.getByRole("navigation", { name: "Primary" });
  const bookmarksButton = primary.getByRole("button", { name: "Bookmarks", exact: true });
  await expect(bookmarksButton).toBeVisible();
  const buttonBounds = await bookmarksButton.boundingBox();
  const homeBounds = await page.locator(".browser-home").boundingBox();
  expect(buttonBounds!.x).toBeLessThan(homeBounds!.x);
  await primary.getByRole("button", { name: "Services", exact: true }).click();
  await bookmarksButton.click();
  await expect(page.getByRole("menu", { name: "Home bookmarks" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Switch to Work bookmarks", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Work bookmarks" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Manage bookmarks", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Work bookmarks" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Workspace settings" }).getByRole("button", { name: "Work", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Appearance & widgets", exact: true }).click();
  await page.getByRole("button", { name: "Customize work", exact: true }).click();
  const preferences = page.getByRole("region", { name: "Customize homepage" });
  await preferences.getByLabel("Notes display", { exact: true }).selectOption("dropdown");
  await preferences.getByLabel("Focus timer display", { exact: true }).selectOption("dropdown");
  await expect(preferences.getByLabel("Prompt library display", { exact: true })).toHaveValue("section");
  await preferences.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(preferences).toHaveCount(0);
  await primary.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.reload();
  const notesToggle = page.locator(".hp-widget-dropdown > summary").filter({ hasText: /^Notes$/ });
  await expect(notesToggle).toBeVisible();
  await expect(page.getByLabel("Workspace notes")).toBeHidden();
  await expect(page.getByRole("button", { name: "Add prompt", exact: true })).toBeVisible();
  await notesToggle.focus();
  await notesToggle.press("Enter");
  await page.getByLabel("Workspace notes").fill("Keep the draft when folded");
  await notesToggle.press("Enter");
  await expect(page.getByLabel("Workspace notes")).toBeHidden();
  await notesToggle.press("Enter");
  await expect(page.getByLabel("Workspace notes")).toHaveValue("Keep the draft when folded");
  const secondContext = await browser.newContext({ storageState: await context.storageState() });
  try {
    const other = await secondContext.newPage();
    await other.goto("/");
    await expect(other.locator(".hp-widget-dropdown > summary").filter({ hasText: /^Notes$/ })).toBeVisible();
    await expect(other.getByLabel("Workspace notes")).toBeHidden();
  } finally {
    await secondContext.close();
  }
  await page.screenshot({ path: testInfo.outputPath("mixed-sections-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await bookmarksButton.click();
  await expect(page.getByRole("menu", { name: "Work bookmarks" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(bookmarksButton).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("mixed-sections-mobile.png"), fullPage: true });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
});
