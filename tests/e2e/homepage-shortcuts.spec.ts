import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { HomepageSnapshot } from "../../src/shared/homepage";

test("homepage and sidebar shortcuts stay independent, with neutral styling and keyboard folder navigation", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("searchbox", { name: "Search Google" })).toBeVisible();
  expect((await page.request.post("/api/auth/reauth", { data: { password: "e2e-admin-password" } })).ok()).toBe(true);
  const getState = async () => (await (await page.request.get("/api/homepage")).json()) as HomepageSnapshot;
  let state = await getState();
  const original = structuredClone(state.data);
  const ids: string[] = [];
  const folderId = `shortcut-folder-${testInfo.project.name}`;
  const save = async (data: HomepageSnapshot["data"]) => {
    const latest = await getState();
    const response = await page.request.post("/api/homepage/state", { data: { revision: latest.revision, data } });
    expect(response.ok()).toBe(true);
    state = await response.json();
  };
  try {
    state.data.collections.push({ id: folderId, parentId: null, workspaceId: "home", name: "Daily reading", sortOrder: 0 });
    for (const widget of state.data.workspaces.home.layout.widgets) {
      widget.enabled = ["services", "notes", "prompts", "timer", "bookmarks"].includes(widget.id);
      widget.presentation = "section";
    }
    await save(state.data);
    for (const [name, url, collectionId] of [
      ["YouTube", "https://www.youtube.com/", null],
      ["Reference desk", "https://example.com/reference", null],
      ["A useful article", "https://example.com/article", folderId],
    ]) {
      const response = await page.request.post("/api/homepage/bookmarks", { data: { revision: state.revision, bookmark: { name, url, workspaceId: "home", collectionId } } });
      expect(response.ok()).toBe(true);
      state = await response.json();
      ids.push(state.bookmarks.find(b => b.name === name)!.id);
    }
    await page.reload();
    await page.getByRole("button", { name: "Choose bookmark folders", exact: true }).click();
    await page.getByRole("button", { name: "Customize home", exact: true }).click();
    const panel = page.getByRole("region", { name: "Customize homepage" });
    const center = panel.getByRole("group", { name: "Top bookmark folders", exact: true });
    const sidebar = panel.getByRole("group", { name: "Sidebar links", exact: true });
    await center.getByRole("button", { name: "Clear selection" }).click();
    await sidebar.getByRole("button", { name: "Clear selection" }).click();
    await expect(center.getByRole("checkbox", { name: /YouTube/ })).toHaveCount(0);
    await center.getByRole("checkbox", { name: /Daily reading/ }).first().check();
    await expect(sidebar.getByRole("checkbox", { name: /^Daily reading/ })).toHaveCount(0);
    await sidebar.getByRole("checkbox", { name: /Reference desk/ }).check();
    await sidebar.getByRole("checkbox", { name: /A useful article/ }).check();
    await expect(sidebar.getByRole("checkbox", { name: /YouTube/ })).not.toBeChecked();
    await expect(center.getByRole("checkbox", { name: /Reference desk/ })).toHaveCount(0);
    await panel.getByLabel("Accent", { exact: true }).selectOption("blue");
    await panel.getByLabel("Background", { exact: true }).selectOption("none");
    await expect(panel.getByLabel("Card color", { exact: true })).toHaveCount(0);
    await panel.getByLabel("Spacing", { exact: true }).selectOption("compact");
    await expect(panel.getByLabel("Shortcut style", { exact: true })).toHaveCount(0);
    const preview = await new AxeBuilder({ page }).analyze();
    expect(preview.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    await panel.getByRole("button", { name: "Save layout", exact: true }).click();
    await expect(panel).toHaveCount(0);
    const primary = page.getByRole("navigation", { name: "Primary" });
    await primary.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.reload();
    const shortcuts = page.getByRole("navigation", { name: "Bookmark folders" });
    const rail = page.getByRole("group", { name: "Bookmark shortcuts" });
    await expect(shortcuts.getByRole("link")).toHaveCount(0);
    await expect(shortcuts.getByRole("link", { name: "Reference desk", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: "Reference desk", exact: true })).toHaveAttribute("href", "https://example.com/reference");
    await expect(rail.getByRole("link", { name: "YouTube", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Daily reading", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: "A useful article", exact: true })).toHaveAttribute("href", "https://example.com/article");
    await expect(page.locator(".browser-home")).toHaveClass(/hp-accent-blue hp-bg-none hp-spacing-compact/);
    expect((await getState()).bookmarks.some(b => b.name === "YouTube")).toBe(true);
    const folder = shortcuts.getByRole("button", { name: "Daily reading", exact: true });
    await folder.focus();
    await folder.press("ArrowDown");
    const article = page.getByRole("menuitem", { name: "A useful article", exact: true });
    await expect(article).toBeFocused();
    await expect(article).toHaveAttribute("href", "https://example.com/article");
    const bounds = (await folder.boundingBox())!;
    const menuBounds = (await page.getByRole("menu", { name: "Daily reading", exact: true }).boundingBox())!;
    expect(menuBounds.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    await page.keyboard.press("Escape");
    await expect(folder).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
      await expect(page.getByRole("heading", { name: "Your day, one place." })).toHaveCSS("color", theme === "light" ? "rgb(37, 58, 54)" : "rgb(231, 237, 242)");
      await page.screenshot({ path: testInfo.outputPath(`shortcuts-${theme}.png`), fullPage: true });
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await folder.click();
    await expect(article).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("shortcuts-mobile.png"), fullPage: true });
    // Empty selections remain empty, rather than reverting to the automatic defaults.
    state = await getState();
    state.data.workspaces.home.layout.centerShortcuts = { bookmarkIds: [], collectionIds: [] };
    state.data.workspaces.home.layout.shortcutStyle = "tiles";
    await save(state.data);
    await page.reload();
    await expect(shortcuts.getByRole("link")).toHaveCount(0);
    await expect(shortcuts.getByRole("button", { name: "Add bookmark folders" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Reference desk", exact: true })).toBeHidden(); // Mobile uses the library menu.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(rail.getByRole("link", { name: "Reference desk", exact: true })).toBeVisible();
  } finally {
    for (const action of ["trash", "delete"]) {
      if (!ids.length) break;
      const latest = await getState();
      expect((await page.request.post("/api/homepage/bookmarks/bulk", { data: { revision: latest.revision, ids, action } })).ok()).toBe(true);
    }
    await save(original);
  }
});

test("sidebar overflow contains only remaining selected links and the library still contains folders", async ({ page }) => {
  await page.route("**/api/homepage", async route => {
    const snapshot = await (await route.fetch()).json() as HomepageSnapshot;
    snapshot.data.collections = [
      { id: "top", name: "Top folder", workspaceId: "home", parentId: null, sortOrder: 0 },
      { id: "nested", name: "Nested folder", workspaceId: "home", parentId: "top", sortOrder: 0 },
    ];
    snapshot.bookmarks = Array.from({ length: 29 }, (_, i) => ({ id: `pin-${i}`, name: `Pinned link ${String(i + 1).padStart(2, "0")}`, url: `https://example.com/${i}`, workspaceId: "home", collectionId: "nested", favorite: false, notes: "", readingState: "none", sortOrder: i, deletedAt: i === 28 ? "2026-09-25T00:00:00Z" : null, updatedAt: "2026-09-25T00:00:00Z" }));
    snapshot.data.workspaces.home.layout.sidebarShortcuts = { collectionIds: ["top"], bookmarkIds: snapshot.bookmarks.filter(b => b.id !== "pin-27").map(b => b.id).concat("missing") };
    snapshot.data.workspaces.home.layout.centerShortcuts = { collectionIds: ["top"], bookmarkIds: [] };
    snapshot.data.workspaces.home.layout.widgets.find(w => w.id === "bookmarks")!.enabled = true;
    snapshot.data.workspaces.work.layout.sidebarShortcuts = { collectionIds: [], bookmarkIds: [] };
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  const rail = page.getByRole("group", { name: "Bookmark shortcuts" });
  await expect(rail.getByRole("link")).toHaveCount(24);
  await expect(rail.getByRole("button", { name: "Top folder", exact: true })).toHaveCount(0);
  const more = rail.getByRole("button", { name: "More sidebar links", exact: true });
  await more.focus(); await more.press("ArrowDown");
  const overflow = page.getByRole("menu", { name: "More sidebar links", exact: true });
  await expect(overflow.getByRole("menuitem")).toHaveCount(3);
  await expect(overflow.getByRole("menuitem", { name: "Pinned link 25", exact: true })).toBeFocused();
  await expect(overflow.getByRole("menuitem", { name: "Pinned link 27", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(more).toBeFocused();
  await rail.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Top folder", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Work", exact: true }).click();
  await expect(rail.getByRole("link")).toHaveCount(0);
  await expect(more).toHaveCount(0);
});
