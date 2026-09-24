import { enableHomeWidgets } from "./homepage-fixtures";
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

const emptyDashboard = {
  groups: [],
  ungroupedResources: [],
  hostMonitors: [],
  integrations: [],
  apiWidgets: [],
  aiBriefing: null,
  dailyBriefing: {
    summary: {
      servicesTotal: 0,
      servicesOnline: 0,
      servicesOffline: 0,
      servicesUnknown: 0,
      hostsTotal: 0,
      hostsOffline: 0,
      hostsUnderPressure: 0,
      staleChecks: 0,
      unmonitoredServices: 0,
      pendingFailures: 0,
      pendingRecoveries: 0
    },
    offlineServices: [],
    recentChanges: [],
    hostsUnderPressure: [],
    staleChecks: [],
    unmonitoredServices: [],
    watchlist: []
  },
  layout: {}
};

const disabledHomeSettings = {
  agendaEnabled: false,
  tasksEnabled: false,
  mailEnabled: false,
  mediaEnabled: false,
  storageEnabled: false,
  plexWidgetId: null,
  radarrWidgetId: null,
  mediaRegion: "ZA",
  mediaLanguage: "en-US",
  mediaLimit: 6
};

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
  for (const name of ["Dashboard", "Services", "Settings"]) {
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name })).toBeVisible();
  }
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Services", exact: true }).click();
  await expect(page.locator(".launcher-service").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete OPNsense Gateway" })).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector(".workspace-scroll")!.scrollWidth <= document.querySelector(".workspace-scroll")!.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Manage services" }).click();
  await expect(page.getByRole("button", { name: "Delete OPNsense Gateway" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const row = page.locator(".service-data-row").first();
  const rowBox = await row.boundingBox();
  const deleteBox = await page.getByRole("button", { name: "Delete OPNsense Gateway" }).boundingBox();
  expect(rowBox && deleteBox && deleteBox.y + deleteBox.height <= rowBox.y + rowBox.height + 1).toBe(true);
});

test("service setup makes TCP reachability and exact web endpoints primary", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name;
  await login(page);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Services", exact: true }).click();
  await page.getByRole("button", { name: "Manage services" }).click();

  await page.getByRole("button", { name: "Service", exact: true }).click();
  let serviceForm = page.getByRole("heading", { name: "New service" }).locator("..");
  await serviceForm.getByRole("textbox", { name: "Name", exact: true }).fill(`OPNsense TCP Reachability ${suffix}`);
  await serviceForm.getByRole("textbox", { name: "Host", exact: true }).fill("192.168.10.254");
  await serviceForm.locator('select[name="resourceCheckType"]').selectOption("tcp");
  await serviceForm.locator('input[type="number"]').fill("443");
  await serviceForm.getByRole("button", { name: "Save service" }).click();

  const reauth = page.getByRole("dialog", { name: "Confirm it’s you" });
  await reauth.getByLabel(/administrator password/i).fill("e2e-admin-password");
  await reauth.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(`OPNsense TCP Reachability ${suffix}`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Service", exact: true }).click();
  serviceForm = page.getByRole("heading", { name: "New service" }).locator("..");
  await serviceForm.getByRole("textbox", { name: "Name", exact: true }).fill(`Docker Port App ${suffix}`);
  await serviceForm.getByRole("textbox", { name: "URL", exact: true }).fill("http://127.0.0.1:8080/docker/health");
  await serviceForm.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText(`Docker Port App ${suffix}`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await expect(page.getByText(/TCP port · Primary · 192\.168\.10\.254:443/).first()).toBeVisible();
  await expect(page.getByText(/Web endpoint \(HTTP\/HTTPS\) · Primary · http:\/\/127\.0\.0\.1:8080\/docker\/health/).first()).toBeVisible();

  await page.getByRole("button", { name: /Needs review/ }).click();
  await expect(page.getByText(/blocked ICMP can produce a false outage/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Review check" }).first()).toBeVisible();
});

test("Launchpad is the device default, ranks local search, and remembers the selected preset", async ({ page }) => {
  await login(page);
  const viewSwitch = page.getByRole("navigation", { name: "Dashboard view" });
  const launchpad = viewSwitch.getByRole("button", { name: "Home", exact: true });
  const operations = viewSwitch.getByRole("button", { name: "Operations" });
  await expect(launchpad).toHaveClass(/active/);

  const search = page.getByRole("combobox", { name: "Search Google" });
  await expect(page.getByRole("link", { name: /^ChatGPT$/ })).toHaveAttribute("href", "https://chatgpt.com/");

  await page.evaluate(() => {
    (window as Window & { __openedUrl?: string }).open = ((url?: string | URL) => {
      (window as Window & { __openedUrl?: string }).__openedUrl = String(url);
      return null;
    }) as typeof window.open;
  });
  await search.fill("home lab & vpn");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as Window & { __openedUrl?: string }).__openedUrl)).toBe(
    "https://www.google.com/search?q=home%20lab%20%26%20vpn"
  );

  await operations.click();
  await expect(page.getByRole("group", { name: "Dashboard view" }).getByRole("button", { name: "Operations" })).toHaveClass(/active/);
  await page.reload();
  await expect(page.getByRole("group", { name: "Dashboard view" }).getByRole("button", { name: "Operations" })).toHaveClass(/active/);
});

test("an empty Launchpad shows focused onboarding and Operations stays signal-only", async ({ page }) => {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: emptyDashboard }));
  await login(page);

  await expect(page.getByRole("heading", { name: "Your day, one place." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bookmarks", exact: true })).toBeVisible();
  await expect(page.getByText("Lab Vitals")).toHaveCount(0);
  await expect(page.getByText("Daily Briefing")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Search Google" })).toBeVisible();

  await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Operations" }).click();
  await expect(page.getByRole("button", { name: /Connect operations data/ })).toBeVisible();
  await expect(page.getByText("No operational issues need attention")).toBeVisible();
  await expect(page.locator(".briefing-grid")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
});

test("Launchpad utilities render independently and move after services on mobile", async ({ page }) => {
  await enableHomeWidgets(page, ["weather", "releases"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/settings", (route) => route.fulfill({
    json: {
      autoPingIntervalSeconds: 60,
      dashboardUtilities: {
        searchEngine: "startpage",
        weather: {
          enabled: true,
          units: "metric",
          location: {
            label: "Cape Town, Western Cape, South Africa",
            name: "Cape Town",
            country: "South Africa",
            latitude: -33.9258,
            longitude: 18.4232,
            timezone: "Africa/Johannesburg"
          }
        },
        releases: {
          enabled: true,
          repositories: ["gethomepage/homepage"]
        }
      },
      dashboardHome: disabledHomeSettings
    }
  }));
  await page.route("**/api/utilities/summary", (route) => route.fulfill({
    json: {
      weather: {
        state: "ready",
        data: {
          location: {
            label: "Cape Town, Western Cape, South Africa",
            name: "Cape Town",
            country: "South Africa",
            latitude: -33.9258,
            longitude: 18.4232,
            timezone: "Africa/Johannesburg"
          },
          units: "metric",
          temperature: 16.4,
          apparentTemperature: 15.1,
          weatherCode: 2,
          condition: "Partly cloudy",
          isDay: true,
          days: [
            { date: "2026-07-24", weatherCode: 2, condition: "Partly cloudy", high: 19, low: 11, precipitationChance: 10 },
            { date: "2026-07-25", weatherCode: 61, condition: "Rain", high: 17, low: 10, precipitationChance: 70 },
            { date: "2026-07-26", weatherCode: 0, condition: "Clear", high: 21, low: 12, precipitationChance: 5 }
          ]
        },
        fetchedAt: "2026-07-24T08:00:00.000Z",
        stale: false,
        error: null
      },
      releases: {
        state: "ready",
        data: [{
          repository: "gethomepage/homepage",
          name: "Homepage 1.8",
          tag: "v1.8.0",
          publishedAt: "2026-07-23T12:00:00.000Z",
          url: "https://github.com/gethomepage/homepage/releases/tag/v1.8.0"
        }],
        fetchedAt: "2026-07-24T08:00:00.000Z",
        stale: false,
        error: null
      }
    }
  }));
  await login(page);

  await expect(page.getByText(/Cape Town/).first()).toBeVisible();
  const weather = page.locator(".compact-weather-card");
  await expect(weather.getByRole("link", { name: "Open-Meteo" })).toHaveAttribute("href", "https://open-meteo.com/");
  await expect(weather.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
  await weather.getByRole("link", { name: "Open-Meteo" }).focus();
  await page.keyboard.press("Tab");
  await expect(weather.getByRole("link", { name: "CC BY 4.0" })).toBeFocused();
  const release = page.getByRole("link", { name: /gethomepage\/homepage/ });
  await expect(release).toHaveAttribute("href", "https://github.com/gethomepage/homepage/releases/tag/v1.8.0");
  const servicesBox = await page.locator(".launchpad-services").boundingBox();
  const utilitiesBox = await page.locator(".launchpad-utilities").boundingBox();
  expect(servicesBox && utilitiesBox && utilitiesBox.y >= servicesBox.y + servicesBox.height).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectNoSeriousAxeViolations(page);
});

test("a utility provider failure does not hide successful utility data or services", async ({ page }) => {
  await enableHomeWidgets(page, ["weather", "releases"]);
  await page.route("**/api/settings", (route) => route.fulfill({
    json: {
      autoPingIntervalSeconds: 60,
      dashboardUtilities: {
        searchEngine: "google",
        weather: {
          enabled: true,
          units: "metric",
          location: {
            label: "Cape Town, South Africa",
            name: "Cape Town",
            country: "South Africa",
            latitude: -33.9258,
            longitude: 18.4232,
            timezone: "Africa/Johannesburg"
          }
        },
        releases: { enabled: true, repositories: ["gethomepage/homepage"] }
      },
      dashboardHome: disabledHomeSettings
    }
  }));
  await page.route("**/api/utilities/summary", (route) => route.fulfill({
    json: {
      weather: {
        state: "error",
        data: null,
        fetchedAt: null,
        stale: false,
        error: "Weather provider timed out"
      },
      releases: {
        state: "ready",
        data: [{
          repository: "gethomepage/homepage",
          name: "Homepage 1.8",
          tag: "v1.8.0",
          publishedAt: "2026-07-23T12:00:00.000Z",
          url: "https://github.com/gethomepage/homepage/releases/tag/v1.8.0"
        }],
        fetchedAt: "2026-07-24T08:00:00.000Z",
        stale: false,
        error: null
      }
    }
  }));
  await login(page);
  await expect(page.getByText("Weather unavailable")).toBeVisible();
  await expect(page.getByText("Software releases")).toBeVisible();
  await expect(page.locator(".svc-primary").first()).toBeVisible();
});

test("daily cockpit renders agenda, tasks, mail, media tabs, and storage responsively", async ({ page }) => {
  await enableHomeWidgets(page, ["agenda", "tasks", "mail", "media", "storage"]);
  await page.clock.setFixedTime(new Date("2026-08-30T06:00:00.000Z"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/settings", (route) => route.fulfill({
    json: {
      autoPingIntervalSeconds: 60,
      dashboardUtilities: {
        searchEngine: "duckduckgo",
        weather: { enabled: false, units: "metric", location: null },
        releases: { enabled: false, repositories: [] }
      },
      dashboardHome: {
        ...disabledHomeSettings,
        agendaEnabled: true,
        tasksEnabled: true,
        mailEnabled: true,
        mediaEnabled: true,
        storageEnabled: true
      }
    }
  }));
  await page.route("**/api/home/summary", (route) => route.fulfill({
    json: {
      agenda: { state: "ready", data: { timeZone: "Africa/Johannesburg", events: [{ id: "event", title: "Planning", start: "2026-08-30T09:00:00+02:00", end: "2026-08-30T09:30:00+02:00", allDay: false, calendarName: "Primary", color: null, url: "https://calendar.google.com" }] }, fetchedAt: "2026-08-30T06:00:00.000Z", stale: false, error: null },
      tasks: { state: "ready", data: [{ id: "task", content: "Review backups", dueAt: null, dueDate: "2026-08-30", overdue: false, priority: 3, projectName: "Homelab", url: "https://app.todoist.com/app/task/task" }], fetchedAt: "2026-08-30T06:00:00.000Z", stale: false, error: null },
      mail: { state: "ready", data: { inboxUnread: 4, inboxUrl: "https://mail.google.com/mail/u/0/#inbox", composeUrl: "https://mail.google.com/mail/u/0/#compose" }, fetchedAt: "2026-08-30T06:00:00.000Z", stale: false, error: null },
      media: { state: "ready", data: { recentlyAdded: [{ id: "recent", source: "plex", title: "New Movie", year: 2026, releaseDate: "2026-08-20", addedAt: "2026-08-30T05:00:00.000Z", posterUrl: "/tmdb-logo.svg", externalUrl: null }], upcoming: [{ id: "upcoming", source: "radarr", title: "Soon Movie", year: 2026, releaseDate: "2026-09-05", addedAt: null, posterUrl: null, externalUrl: null }], trending: [{ id: "trending", source: "tmdb", title: "Trending Movie", year: 2026, releaseDate: "2026-08-25", addedAt: null, posterUrl: null, externalUrl: "https://www.themoviedb.org/movie/1" }], attribution: { provider: "tmdb", notice: "This product uses the TMDB API but is not endorsed or certified by TMDB.", logoUrl: "/tmdb-logo.svg" } }, fetchedAt: "2026-08-30T06:00:00.000Z", stale: false, error: null },
      storage: { state: "ready", data: { sourceId: "nas", name: "TrueNAS", poolName: "tank", datasetName: "tank/media", status: "online", health: "ONLINE", sizeBytes: 10_000, usedBytes: 6_500, freeBytes: 3_500, usedPercent: 65, change24hBytes: 125, sampledAt: "2026-08-30T06:00:00.000Z" }, fetchedAt: "2026-08-30T06:00:00.000Z", stale: false, error: null }
    }
  }));
  await login(page);

  await expect(page.locator(".home-calendar-card")).toBeVisible();
  await expect(page.getByText("Planning", { exact: true })).toBeVisible();
  await expect(page.getByText("Review backups", { exact: true })).toBeVisible();
  await expect(page.locator(".home-mail-card strong")).toHaveText("4");
  await expect(page.getByRole("img", { name: "New Movie poster" })).toBeVisible();
  const trending = page.getByRole("tab", { name: "Trending" });
  await page.getByRole("tab", { name: "Recently added" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(trending).toHaveAttribute("aria-selected", "true");
  await expect(trending).toBeFocused();
  await expect(page.getByText("Trending Movie", { exact: true })).toBeVisible();
  await expect(page.getByText("65%", { exact: true })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByRole("tab", { name: "Recently added" })).toBeVisible();
});

test("cards and modal surfaces are keyboard operable and restore focus", async ({ page }) => {
  await login(page);
  const primaryCard = page.locator(".svc-primary").first();
  await expect(primaryCard).toHaveJSProperty("tagName", "BUTTON");
  await primaryCard.focus();
  await expect(primaryCard).toBeFocused();

  const search = page.getByTitle("Search (⌘K)");
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

test("sensitive administration prompts for reauthentication and retries once", async ({ page }, testInfo) => {
  await login(page);
  await page.request.post("/api/auth/reauth", { data: { password: "e2e-admin-password" } });
  const targetName = `Delete target ${testInfo.project.name}`;
  await page.request.post("/api/resources", { data: { name: targetName, kind: "vm", monitoringMode: "disabled" } });
  await page.context().clearCookies();
  await login(page);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Services", exact: true }).click();
  await page.getByRole("button", { name: "Manage services" }).click();
  const deleteButton = page.getByRole("button", { name: `Delete ${targetName}` });
  await expect(deleteButton).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await deleteButton.click();

  const reauth = page.getByRole("dialog", { name: "Confirm it’s you" });
  await expect(reauth).toBeVisible({ timeout: 10_000 });
  const password = reauth.getByLabel(/administrator password/i);
  await expect(password).toBeFocused();
  await password.fill("e2e-admin-password");
  await reauth.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(reauth).toHaveCount(0);
  await expect(deleteButton).toHaveCount(0);
});

test("Runtime Health surfaces security warnings and disabled public-status policy", async ({ page }) => {
  await login(page);
  const runtimeResponse = await page.request.get("/api/admin/runtime");
  expect(runtimeResponse.ok()).toBe(true);
  const runtime = await runtimeResponse.json();
  await page.route("**/api/admin/runtime", (route) => route.fulfill({
    json: {
      ...runtime,
      security: {
        ...runtime.security,
        publicStatusMode: "disabled",
        readinessWarnings: ["CRITICAL: Insecure integration transport override is enabled"]
      }
    }
  }));

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Integrations & system", exact: true }).click();
  await page.getByRole("button", { name: "Account & runtime", exact: true }).click();
  await expect(page.getByText("Security readiness")).toBeVisible();
  await expect(page.getByText("CRITICAL: Insecure integration transport override is enabled")).toBeVisible();
  await expect(page.getByText("Public status is disabled by deployment policy.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Public status page" })).toHaveCount(0);
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
  await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  await expectNoSeriousAxeViolations(page);
  await page.getByTitle("Search (⌘K)").click();
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
