import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { defaultLayout, type HomepageSnapshot } from "../../src/shared/homepage";

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
    snapshot.data.collections = [];
    const layout = snapshot.data.workspaces.home.layout;
    layout.background = "none";
    layout.accent = "green";
    layout.widgets = layout.widgets.map(widget => ({ ...widget, enabled: order.includes(widget.id) || widget.id === "bookmarks", size: "normal", presentation: "section" }));
    layout.widgets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    snapshot.data.prompts = [{ id: "sample-prompt", title: "Plan the week", text: "Help me plan my week.", workspaceId: "home" }];
    snapshot.bookmarks = [
      { id: "sample-video", name: "YouTube", url: "https://www.youtube.com/", notes: "", favorite: true, workspaceId: "home", collectionId: null, readingState: "none", sortOrder: 0, deletedAt: null, updatedAt: "2026-09-25T10:00:00Z" },
      { id: "sample-reference", name: "Reference desk", url: "https://example.com/", notes: "", favorite: true, workspaceId: "home", collectionId: null, readingState: "none", sortOrder: 1, deletedAt: null, updatedAt: "2026-09-25T10:00:00Z" },
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
    await expect(panel.getByLabel("Favorites width", { exact: true })).toHaveValue("normal");
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
    expect(saved.data.workspaces.home.layout.widgets.slice(0, 3).map(widget => widget.id)).toEqual(["favorites", "weather", "services"]);
    expect(saved.data.workspaces.home.layout.widgets.find(widget => widget.id === "favorites")?.size).toBe("normal");
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
  const forecast = page.locator(".hp-forecast");
  await expect(forecast.locator("svg")).toHaveCount(3);
  await expect(page.locator(".weather-current")).toContainText("Feels like 14°C");
  const favorites = page.getByRole("region", { name: "Favorites", exact: true });
  await expect(favorites.getByRole("link", { name: "ChatGPT", exact: true }).locator("img")).toHaveAttribute("src", "/logos/chatgpt.png");
  await expect(favorites.getByRole("link", { name: "Reference desk", exact: true }).locator(".site-icon")).toHaveText("RD");
  await page.route("**/logos/youtube.png", route => route.fulfill({ status: 404, body: "" }));
  await page.reload();
  await expect(favorites.getByRole("link", { name: "YouTube", exact: true }).locator(".site-icon")).toHaveText("YO");
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const available = await page.locator(".browser-home").evaluate(el => el.clientWidth);
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
        if (destination === "Home") await expect(page.locator(".compact-weather-card")).toBeVisible();
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
      if (destination === "Home") await expect(page.locator(".compact-weather-card")).toBeVisible();
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
