import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { defaultLayout, type HomepageSnapshot } from "../../src/shared/homepage";
import { APP_VERSION } from "../../src/shared/version";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

async function visualFixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-25T10:00:00Z"));
  await page.route("**/api/resources/*/icon", route => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/homepage", async route => {
    const response = await route.fetch();
    const snapshot = await response.json() as HomepageSnapshot;
    const order = ["favorites", "weather", "prompts", "tasks", "services"];
    snapshot.data.workspaces.work.layout = defaultLayout(true);
    snapshot.data.collections = [
      { id: "daily", name: "Everyday", parentId: null, workspaceId: "home", sortOrder: 0 },
      { id: "reference", name: "Reference", parentId: "daily", workspaceId: "home", sortOrder: 0 },
      { id: "projects", name: "Projects", parentId: null, workspaceId: "home", sortOrder: 1 },
      { id: "work-tools", name: "Work tools", parentId: null, workspaceId: "work", sortOrder: 0 },
    ];
    const layout = snapshot.data.workspaces.home.layout;
    layout.background = "none";
    layout.accent = "green";
    layout.centerShortcuts = null;
    layout.widgets = layout.widgets.map(widget => ({ ...widget, enabled: order.includes(widget.id) || widget.id === "bookmarks", size: "normal", presentation: "section" }));
    layout.widgets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    snapshot.data.prompts = [{ id: "sample-prompt", title: "Plan the week", text: "Help me plan my week.", workspaceId: "home" }];
    snapshot.bookmarks = [
      { id: "sample-video", name: "YouTube", url: "https://www.youtube.com/", notes: "", favorite: true, workspaceId: "home", collectionId: null, readingState: "none", sortOrder: 0, deletedAt: null, updatedAt: "2026-09-25T10:00:00Z" },
      { id: "sample-reference", name: "Reference desk", url: "https://example.com/", notes: "", favorite: true, workspaceId: "home", collectionId: "reference", readingState: "none", sortOrder: 1, deletedAt: null, updatedAt: "2026-09-25T10:00:00Z" },
    ];
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/settings", async route => {
    const settings = await (await route.fetch()).json();
    settings.dashboardUtilities.weather = { enabled: true, units: "metric", location: { name: "Example City", label: "Example City", latitude: 0, longitude: 0, country: "Example", timezone: "UTC" } };
    settings.dashboardHome.tasksEnabled = true;
    await route.fulfill({ json: settings });
  });
  await page.route("**/api/utilities/summary", route => route.fulfill({ json: {
    weather: { state: "ready", data: { units: "metric", temperature: 16, apparentTemperature: 14, weatherCode: 2, isDay: true, condition: "Partly cloudy", location: { name: "Example City" },
      days: [{ date: "2026-09-25", weatherCode: 2, condition: "Partly cloudy", high: 19, low: 11, precipitationChance: 10 }, { date: "2026-09-26", weatherCode: 61, condition: "Rain", high: 17, low: 10, precipitationChance: 70 }, { date: "2026-09-27", weatherCode: 0, condition: "Clear", high: 21, low: 12, precipitationChance: null }],
    }, stale: false, error: null, fetchedAt: "2026-09-25T10:00:00Z" },
    releases: { state: "disabled", data: null, stale: false, error: null, fetchedAt: null },
  } }));
  await page.route("**/api/home/summary", route => route.fulfill({ json: {
    tasks: { state: "error", data: null, stale: false, error: "Todoist request timed out. Try again later.", fetchedAt: null },
    ...Object.fromEntries(["agenda", "mail", "media", "storage"].map(id => [id, { state: "disabled", data: null, stale: false, error: null, fetchedAt: null }])),
  } }));
}

test("balanced arrangement previews, cancels, and saves without changing workspace preferences", async ({ page }) => {
  await login(page);
  const original = await (await page.request.get("/api/homepage")).json() as HomepageSnapshot;
  const nav = page.getByRole("navigation", { name: "Primary" });
  const panel = page.getByRole("region", { name: "Customize homepage" });
  try {
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Customize home", exact: true }).click();
    await panel.getByRole("button", { name: "Balanced arrangement", exact: true }).click();
    await expect(panel.getByLabel("Favorites width", { exact: true })).toHaveCount(0);
    await expect(panel.getByLabel("Notes width", { exact: true })).toHaveValue("wide");
    await panel.getByRole("button", { name: "Cancel preview" }).click();
    expect((await (await page.request.get("/api/homepage")).json()).data).toEqual(original.data);
    await page.getByRole("button", { name: "Customize home", exact: true }).click();
    await panel.getByRole("button", { name: "Balanced arrangement", exact: true }).click();
    await panel.getByRole("button", { name: "Save layout", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    const saved = await (await page.request.get("/api/homepage")).json() as HomepageSnapshot;
    expect(saved.data.workspaces.work).toEqual(original.data.workspaces.work);
    for (const widget of saved.data.workspaces.home.layout.widgets) {
      expect(widget.enabled).toBe(original.data.workspaces.home.layout.widgets.find(item => item.id === widget.id)!.enabled);
    }
    for (const id of ["favorites", "weather", "bookmarks"]) {
      const index = original.data.workspaces.home.layout.widgets.findIndex(w => w.id === id);
      expect(saved.data.workspaces.home.layout.widgets[index]).toEqual(original.data.workspaces.home.layout.widgets[index]);
    }
    expect(saved.data.workspaces.home.layout.widgets.filter(w => !["favorites", "weather", "bookmarks"].includes(w.id))[0].id).toBe("services");
  } finally {
    const latest = await (await page.request.get("/api/homepage")).json();
    expect((await page.request.post("/api/homepage/state", { data: { revision: latest.revision, data: original.data } })).ok()).toBe(true);
  }
});

test("dashboard status, forecast icons, logo fallbacks, and container columns remain coherent", async ({ page }) => {
  await visualFixture(page);
  await login(page);
  const status = page.getByRole("region", { name: "Dashboard status" });
  await expect(status.locator(".health-error").filter({ hasText: "Todoist: unavailable" })).toBeVisible();
  await expect(page.locator(".hp-widget-prompts")).not.toContainText("Todoist");
  await status.getByText("View details", { exact: true }).click();
  await expect(status.getByText("Todoist request timed out. Try again later.", { exact: true })).toBeVisible();
  const inspect = status.getByRole("button", { name: "View service", exact: true }).first();
  await inspect.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspect).toBeFocused();
  await expect(page.locator(".hp-widget-tasks").getByText("Unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Weather:/ }).click();
  const forecast = page.locator(".hp-forecast");
  await expect(forecast.locator("svg")).toHaveCount(3);
  await expect(page.locator(".weather-current")).toContainText("Feels like 14°C");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  const favorites = page.getByRole("menu", { name: "Favorites", exact: true });
  await expect(favorites.getByRole("menuitem", { name: "ChatGPT", exact: true }).locator("img")).toHaveAttribute("src", "/logos/chatgpt.png");
  await expect(favorites.getByRole("menuitem", { name: "Reference desk", exact: true }).locator(".site-icon")).toHaveText("RD");
  await page.route("**/logos/youtube.png", route => route.fulfill({ status: 404, body: "" }));
  await page.reload();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(favorites.getByRole("menuitem", { name: "YouTube", exact: true }).locator(".site-icon")).toHaveText("YO");
  await page.keyboard.press("Escape");
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const available = await page.locator(".hp-grid").evaluate(el => el.clientWidth);
    const columns = await page.locator(".hp-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(available >= 1120 ? 3 : available >= 720 ? 2 : 1);
  }
  await page.unroute("**/api/home/summary");
  await page.route("**/api/home/summary", route => route.fulfill({ json: {
    tasks: { state: "ready", data: [], stale: false, error: null, fetchedAt: "2026-09-25T10:01:00Z" },
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(status.locator(".health-healthy").filter({ hasText: "Todoist: up to date" })).toBeVisible();
  await expect(page.locator(".home-tasks-card")).toContainText("You’re clear for today.");
  await page.unroute("**/api/utilities/summary");
  await page.route("**/api/utilities/summary", route => route.fulfill({ json: {
    weather: { state: "error", stale: true, error: "Weather refresh timed out", fetchedAt: "2026-09-25T10:00:00Z",
      data: { units: "imperial", temperature: 61, apparentTemperature: 58, weatherCode: 2, isDay: true, condition: "Partly cloudy", location: { name: "Example City" }, days: [] } },
    releases: { state: "disabled", data: null, stale: false, error: null, fetchedAt: null },
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(status.locator(".health-warning").filter({ hasText: "Weather: cached data" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Weather:/ })).toContainText("61°F");
  await page.getByRole("button", { name: /^Weather:/ }).click();
  await expect(page.locator(".weather-current")).toContainText("61°F");
  await expect(page.locator(".compact-weather-card")).toContainText("Cached forecast");
  await expect(page.locator(".hp-forecast")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open-Meteo", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Services", exact: true }).click();
  await page.getByLabel("Find a service").fill("no matching service");
  await expect(page.getByText("No matching services", { exact: true })).toBeVisible();
  await status.getByText("View details", { exact: true }).click();
  await status.getByRole("button", { name: "View service", exact: true }).first().click();
  await expect(page.getByLabel("Find a service")).toHaveValue("");
  await expect(page.locator(".launcher-service:focus")).toHaveCount(1);
});

test("redesigned pages fit across themes and viewport sizes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await visualFixture(page);
  await login(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const destination of ["Home", "Work", "Operations", "Services", "Notes", "Settings"]) {
        if (["Home", "Work", "Operations"].includes(destination)) {
          await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
          if (await page.getByRole("button", { name: "Launchpad", exact: true }).isVisible()) await page.getByRole("button", { name: "Launchpad", exact: true }).click();
          await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: destination, exact: true }).click();
        } else await nav.getByRole("button", { name: destination, exact: true }).click();
        if (destination === "Home") await expect(page.getByRole("button", { name: /^Weather:/ })).toBeVisible();
        if (destination === "Work" || destination === "Notes") await expect(page.getByLabel("Workspace notes")).toBeVisible();
        if (destination === "Operations") await expect(page.getByRole("heading", { name: "Lab Command Center" })).toBeVisible();
        if (destination === "Services") await expect(page.locator(".launcher-service").first()).toBeVisible();
        if (destination === "Settings") await expect(page.getByRole("button", { name: /^Customize (home|work)$/ })).toBeVisible();
        await page.locator(".workspace-scroll").evaluate(el => { el.scrollTop = 0; });
        expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth), `${theme} ${width} ${destination}`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${destination.toLowerCase()}-${theme}-${width}.png`) });
        if (width === 1440) {
          const axe = await new AxeBuilder({ page }).analyze();
          expect(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")), `${theme} ${destination}`).toEqual([]);
        }
      }
    }
  }
});

test("narrow pages and zoom keep content within the viewport", async ({ page }) => {
  await visualFixture(page);
  await login(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, width === 1280 ? "2" : "1");
    for (const destination of ["Home", "Work", "Operations", "Services", "Notes", "Settings"]) {
      if (["Home", "Work", "Operations"].includes(destination)) {
        await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
        if (await page.getByRole("button", { name: "Launchpad", exact: true }).isVisible()) await page.getByRole("button", { name: "Launchpad", exact: true }).click();
        await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: destination, exact: true }).click();
      } else await nav.getByRole("button", { name: destination, exact: true }).click();
      if (destination === "Home") await expect(page.getByRole("button", { name: /^Weather:/ })).toBeVisible();
      if (destination === "Work" || destination === "Notes") await expect(page.getByLabel("Workspace notes")).toBeVisible();
      if (destination === "Settings") await expect(page.getByRole("button", { name: /^Customize (home|work)$/ })).toBeVisible();
      const overflow = await page.locator(".workspace-scroll").evaluate(root => {
        const right = root.getBoundingClientRect().right;
        return Array.from(root.querySelectorAll("*")).filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > right + 1)
          .slice(0, 12).map(el => ({ tag: el.tagName, class: el.getAttribute("class"), right: el.getBoundingClientRect().right, limit: right }));
      });
      expect(overflow, `${width} ${destination}`).toEqual([]);
      expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth), `${width} ${destination}`).toBe(true);
    }
  }
});

test("supporting overlays retain focus, contrast, and bounded layouts in both themes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await visualFixture(page);
  await login(page);
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const surface of ["palette", "drawer", "prompt"]) {
        const trigger = surface === "palette" ? page.getByTitle("Search (⌘K)")
          : surface === "drawer" ? page.getByRole("button", { name: /^Show details for/ }).first()
          : page.getByRole("button", { name: "Add prompt", exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute("aria-modal", "true");
        await dialog.locator("input, button").first().click({ trial: true });
        await expect.poll(async () => {
          const bounds = await dialog.boundingBox();
          return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        }).toBe(true);
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${surface}-${theme}-${width}.png`) });
        if (width === 1440) {
          const result = await new AxeBuilder({ page }).analyze();
          expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
        }
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
    }
  }
});

test("login, setup, and public status use readable surfaces at all review sizes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/api/auth/me", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/status", route => route.fulfill({ json: {
    overallStatus: "unknown", summary: { resources: 1, online: 0, offline: 0, unknown: 1 },
    resources: [{ name: "A service with a deliberately long name to check wrapping", status: "unknown", uptimePercent: null, ticks: [] }],
    generatedAt: "2026-09-25T10:00:00Z",
  } }));
  for (const theme of ["dark", "light"] as const) {
    await page.goto("/");
    await page.evaluate(value => localStorage.setItem("homelab-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme });
    for (const surface of ["login", "setup", "status"]) {
      await page.unroute("**/api/setup/status");
      await page.route("**/api/setup/status", route => route.fulfill({ json: {
        firstRun: surface === "setup", needsAccount: surface === "setup", needsSetupCode: surface === "setup",
      } }));
      await page.goto(surface === "status" ? "/status" : "/");
      if (surface === "status") await expect(page.getByText("System status is not yet known")).toBeVisible();
      else await expect(page.getByLabel(surface === "setup" ? "One-time setup code" : "Username", { exact: true })).toBeVisible();
      for (const width of [320, 390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        const root = page.locator(surface === "status" ? "body" : ".login-shell");
        expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth), `${theme} ${surface} ${width}`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${surface}-${theme}-${width}.png`) });
        if (width === 1440) {
          const result = await new AxeBuilder({ page }).analyze();
          expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
        }
      }
    }
  }
});

test("folder dropdowns and workspace backgrounds fill large screens without restoring loose tiles", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await visualFixture(page);
  await login(page);
  const bar = page.getByRole("navigation", { name: "Bookmark folders" });
  await expect(bar.getByRole("link")).toHaveCount(0);
  const everyday = bar.getByRole("button", { name: "Everyday", exact: true });
  await everyday.focus();
  await everyday.press("ArrowDown");
  const reference = page.getByRole("menuitem", { name: "Reference", exact: true });
  await expect(reference).toBeFocused();
  await reference.press("ArrowRight");
  const link = page.getByRole("menuitem", { name: "Reference desk", exact: true });
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("href", "https://example.com/");
  await page.screenshot({ path: testInfo.outputPath("nested-folder-dropdown.png") });
  await page.keyboard.press("Escape");
  await expect(reference).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(everyday).toBeFocused();
  await bar.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "No bookmarks here yet" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Work", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Work tools", exact: true })).toBeVisible();
  await expect(everyday).toHaveCount(0);
  await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Home", exact: true }).click();

  const home = page.locator(".browser-home");
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    for (const width of [390, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1080 });
      for (const background of ["dawn", "ocean", "asset"] as const) {
        // Exercise the actual page background styles without writing user data.
        await home.evaluate((el, preset) => {
          el.classList.remove("hp-bg-none", "hp-bg-dawn", "hp-bg-ocean", "hp-bg-asset");
          el.classList.add(`hp-bg-${preset}`);
          (el as HTMLElement).style.backgroundImage = preset === "asset" ? 'linear-gradient(var(--hp-overlay),var(--hp-overlay)),url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")' : "";
        }, background);
        const bounds = (await home.boundingBox())!;
        const viewport = (await page.locator(".workspace-scroll").boundingBox())!;
        expect(Math.abs(bounds.x - viewport.x)).toBeLessThan(1);
        expect(Math.abs(bounds.width - viewport.width)).toBeLessThan(1);
        expect(bounds.height).toBeGreaterThanOrEqual(viewport.height);
        await expect(home).not.toHaveCSS("background-image", "none");
        await expect(page.locator(".hp-widget").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`canvas-${theme}-${width}-${background}.png`) });
      }
      if (width === 1920) {
        const result = await new AxeBuilder({ page }).analyze();
        expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
      }
    }
  }
});

test("loaded app version stays visible across navigation and distinguishes an updated server", async ({ page }) => {
  await login(page);
  const badge = page.locator(".app-build-bar .build-badge");
  for (const width of [320, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    for (const destination of ["Dashboard", "Services", "Notes", "Settings"]) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: destination, exact: true }).click();
      await expect(badge).toBeVisible();
      await expect(badge).toContainText(`v${APP_VERSION}`);
      await page.locator(".workspace-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(badge).toBeInViewport();
    }
  }
  await page.route("**/api/version", route => route.fulfill({ json: { version: "99.0.0" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(badge).toContainText(`v${APP_VERSION}`);
  await expect(badge).not.toContainText("99.0.0");
  await expect(page.getByRole("button", { name: "Reload for v99.0.0" })).toBeVisible();
  await page.unroute("**/api/version");
  await page.getByRole("button", { name: "Reload for v99.0.0" }).click();
  await expect(page.getByRole("button", { name: "Reload for v99.0.0" })).toHaveCount(0);
  await expect(badge).toContainText(`v${APP_VERSION}`);
});

test("fixed header options cancel, save, reload, and remain isolated between workspaces", async ({ page }) => {
  await login(page);
  const original = await (await page.request.get("/api/homepage")).json() as HomepageSnapshot;
  const state = structuredClone(original.data);
  state.workspaces.home.layout.clock = "hidden";
  for (const workspace of ["home", "work"] as const) for (const widget of state.workspaces[workspace].layout.widgets) {
    if (["weather", "favorites"].includes(widget.id)) { widget.enabled = workspace === "home"; widget.size = "wide"; widget.presentation = "dropdown"; }
  }
  const nav = page.getByRole("navigation", { name: "Primary" });
  const panel = page.getByRole("region", { name: "Customize homepage" });
  const weather = page.getByRole("button", { name: /^Weather:/ });
  const favorites = page.getByRole("button", { name: "Favorites", exact: true });
  async function customize(workspace: string) {
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: `Customize ${workspace}`, exact: true }).click();
  }
  try {
    expect((await page.request.post("/api/homepage/state", { data: { revision: original.revision, data: state } })).ok()).toBe(true);
    await page.reload();
    await expect(weather).toBeVisible();
    await expect(page.locator(".hp-header-glance time")).toHaveCount(0);
    await expect(page.locator(".hp-widget-weather, .hp-widget-favorites, .hp-favorites")).toHaveCount(0);
    await favorites.focus();
    await favorites.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "ChatGPT", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(favorites).toBeFocused();
    await favorites.click();
    await page.getByRole("searchbox", { name: "Search Google" }).click();
    await expect(page.getByRole("menu", { name: "Favorites" })).toHaveCount(0);
    await customize("home");
    for (const label of ["Weather beside clock", "Favorites dropdown"]) await panel.getByRole("checkbox", { name: label }).uncheck();
    for (const label of ["Weather width", "Favorites width", "Weather display", "Favorites display"]) await expect(panel.getByLabel(label, { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Cancel preview" }).click();
    expect((await (await page.request.get("/api/homepage")).json()).data).toEqual(state);
    await page.getByRole("button", { name: "Customize home", exact: true }).click();
    for (const label of ["Weather beside clock", "Favorites dropdown"]) await panel.getByRole("checkbox", { name: label }).uncheck();
    await panel.getByRole("button", { name: "Save layout", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.reload();
    await expect(weather).toHaveCount(0); await expect(favorites).toHaveCount(0);
    const saved = await (await page.request.get("/api/homepage")).json() as HomepageSnapshot;
    expect(saved.data.workspaces.work).toEqual(state.workspaces.work);
    expect(saved.data.workspaces.home.layout.widgets).toEqual(state.workspaces.home.layout.widgets.map(w => ["weather", "favorites"].includes(w.id) ? { ...w, enabled: false } : w));
    await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Work", exact: true }).click();
    await expect(weather).toHaveCount(0); await expect(favorites).toHaveCount(0);
    await customize("work");
    for (const label of ["Weather beside clock", "Favorites dropdown"]) await panel.getByRole("checkbox", { name: label }).check();
    await panel.getByRole("button", { name: "Save layout", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(weather).toBeVisible(); await expect(favorites).toBeVisible();
    await expect(page.locator(".hp-header-glance time")).toBeVisible();
    await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Home", exact: true }).click();
    await expect(weather).toHaveCount(0); await expect(favorites).toHaveCount(0);
  } finally {
    const latest = await (await page.request.get("/api/homepage")).json();
    expect((await page.request.post("/api/homepage/state", { data: { revision: latest.revision, data: original.data } })).ok()).toBe(true);
  }
});

test("weather and Favorites disclosures stay bounded and keyboard accessible on saved backgrounds", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await visualFixture(page);
  await page.route("**/api/dashboard", async route => {
    const dashboard = await (await route.fetch()).json();
    const resource = dashboard.groups.flatMap((g: { resources: unknown[] }) => g.resources)[0];
    resource.name = "Inspect sample host"; resource.favorite = true; resource.url = null;
    await route.fulfill({ json: dashboard });
  });
  await login(page);
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(".browser-home").evaluate(el => { el.classList.remove("hp-bg-none"); el.classList.add("hp-bg-ocean"); });
      for (const kind of ["weather", "favorites"]) {
        const trigger = page.getByRole("button", { name: kind === "weather" ? /^Weather:/ : "Favorites", exact: true });
        await trigger.focus(); await trigger.press("Enter");
        const popup = page.getByRole(kind === "weather" ? "dialog" : "menu", { name: kind === "weather" ? "Weather details" : "Favorites", exact: true });
        await expect(popup).toBeVisible();
        const box = (await popup.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(await popup.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        if (width === 1440) {
          const result = await new AxeBuilder({ page }).analyze();
          expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
        }
        await page.screenshot({ path: testInfo.outputPath(`${kind}-${theme}-${width}.png`) });
        await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
      }
    }
  }
  const favorites = page.getByRole("button", { name: "Favorites", exact: true });
  await favorites.click();
  await page.getByRole("menuitem", { name: "Inspect sample host", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(favorites).toBeFocused();
  const weather = page.getByRole("button", { name: /^Weather:/ });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator("html").evaluate(el => { el.style.zoom = "2"; });
  for (const trigger of [weather, favorites]) {
    await trigger.click();
    const popup = page.locator(".hp-weather-popup, .hp-bookmark-popup");
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(1281);
    await page.keyboard.press("Escape");
  }
  await page.locator("html").evaluate(el => { el.style.zoom = ""; });
  await weather.click();
  await page.getByRole("button", { name: "Location & units", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog", { name: "Weather details" })).toHaveCount(0);
  await weather.click();
  await page.getByRole("searchbox", { name: "Search Google" }).click();
  await expect(page.getByRole("dialog", { name: "Weather details" })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search Google" })).toBeFocused();
  await weather.click();
  await page.getByRole("button", { name: "Location & units", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Launchpad utilities", exact: true })).toBeVisible();
});

test("header weather stays available while loading and preserves cached readings after refresh failure", async ({ page }) => {
  await visualFixture(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/utilities/summary", async route => { await pending; await route.fallback(); });
  try {
    await login(page);
    const weather = page.getByRole("button", { name: /^Weather:/ });
    await expect(weather).toContainText("Loading");
    await weather.click();
    await expect(page.getByRole("dialog", { name: "Weather details" })).toContainText("Loading");
    release();
    await expect(weather).toContainText("16°C");
    await page.keyboard.press("Escape");
    await page.route("**/api/utilities/summary", route => route.abort());
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(weather).toContainText("Cached");
    await expect(weather).toContainText("16°C");
    await weather.click();
    await expect(page.getByRole("dialog", { name: "Weather details" })).toContainText("Cached forecast");
    await expect(page.locator(".hp-forecast svg")).toHaveCount(3);
  } finally { release(); }
});
