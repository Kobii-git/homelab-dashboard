import { enableHomeWidgets } from "./homepage-fixtures";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { DashboardHomeSummaryDto, DashboardResource } from "../../src/shared/types";

const disabled = { state: "disabled", data: null, fetchedAt: null, stale: false, error: null } as const;
const ready = { state: "ready", fetchedAt: "2026-08-30T12:00:00.000Z", stale: false, error: null } as const;

function homeSummary(): DashboardHomeSummaryDto {
  return {
    agenda: {
      ...ready,
      data: {
        timeZone: "Africa/Johannesburg",
        events: [
          { id: "later", title: "Late meeting", start: "2026-08-31T01:00:00Z", end: "2026-08-31T02:00:00Z", allDay: false, calendarName: "Primary", color: null, url: "https://calendar.google.com" },
          { id: "holiday", title: "Long weekend", start: "2026-08-29", end: "2026-08-31", allDay: true, calendarName: "Primary", color: null, url: "https://calendar.google.com" },
          { id: "today", title: "All-day reminder", start: "2026-08-30", end: "2026-08-31", allDay: true, calendarName: "Primary", color: null, url: "https://calendar.google.com" },
          { id: "finished", title: "Finished event", start: "2026-08-29", end: "2026-08-30", allDay: true, calendarName: "Primary", color: null, url: null }
        ]
      }
    },
    tasks: disabled,
    mail: { ...ready, data: { inboxUnread: 4, inboxUrl: "https://mail.google.com/mail/u/0/#inbox", composeUrl: "https://mail.google.com/mail/u/0/#compose" } },
    media: disabled,
    storage: { ...ready, data: { sourceId: "nas", name: "Storage", poolName: "pool", datasetName: null, status: "online", health: "ONLINE", sizeBytes: 10000, usedBytes: 6500, freeBytes: 3500, usedPercent: 65, change24hBytes: null, sampledAt: ready.fetchedAt } }
  };
}

async function openLaunchpad(page: Page, summary = homeSummary()) {
  await enableHomeWidgets(page, ["agenda", "mail", "storage"]);
  await page.clock.setFixedTime(new Date("2026-08-30T12:00:00.000Z"));
  await page.route("**/api/settings", (route) => route.fulfill({ json: {
    autoPingIntervalSeconds: 60,
    dashboardUtilities: { searchEngine: "duckduckgo", weather: { enabled: false, units: "metric", location: null }, releases: { enabled: false, repositories: [] } },
    dashboardHome: { agendaEnabled: true, tasksEnabled: false, mailEnabled: true, mediaEnabled: false, storageEnabled: true, plexWidgetId: null, radarrWidgetId: null, mediaRegion: "ZA", mediaLanguage: "en-US", mediaLimit: 6 }
  } }));
  await page.route("**/api/home/summary", (route) => route.fulfill({ json: summary }));
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator(".home-calendar-card")).toBeVisible();
}

test.describe("Launchpad in the device time zone", () => {
  test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

  test("keeps all-day dates, ongoing events, and month markers consistent", async ({ page }) => {
    await openLaunchpad(page);
    const agenda = page.locator(".agenda-list");
    await expect(agenda.locator("strong")).toHaveText(["Long weekend", "All-day reminder", "Late meeting"]);
    await expect(agenda.getByText("Finished event")).toHaveCount(0);
    const allDay = agenda.getByRole("link", { name: /All-day reminder/ });
    await expect(allDay.locator("small")).toContainText(/30 Sun|Sun 30/);
    await expect(agenda.getByRole("link", { name: /Late meeting/ }).locator("time")).toHaveText(/^(06:00 PM|18:00)$/);
    await expect(page.locator('.compact-calendar time[datetime="2026-08-30"]')).toHaveAttribute("aria-label", /Sunday, (August 30|30 August) · 3 events/);
    await expect(page.locator('.compact-calendar time[datetime="2026-08-30"]')).toHaveAttribute("aria-current", "date");
    await expect(page.locator('.compact-calendar time[datetime="2026-08-31"] i')).toHaveCount(0);

    await allDay.focus();
    await expect(allDay).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(agenda.getByRole("link", { name: /Late meeting/ })).toBeFocused();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });

  test("shows cached mail and storage notices without hiding useful values", async ({ page }) => {
    const summary = homeSummary();
    summary.mail.stale = true;
    summary.mail.error = "Mail refresh failed.";
    summary.storage.stale = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await openLaunchpad(page, summary);
    await expect(page.locator(".home-mail-card strong")).toHaveText("4");
    await expect(page.locator(".home-mail-card").getByRole("status")).toContainText("Showing cached mail count.");
    await expect(page.locator(".home-mail-card").getByRole("status")).toContainText("Mail refresh failed.");
    await expect(page.locator(".home-storage-card").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "65");
    await expect(page.locator(".home-storage-card").getByRole("status")).toHaveText("Showing cached storage data.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("services stay free of summary totals and ungrouped headings", async ({ page }) => {
    let status: "unknown" | "online" = "unknown";
    await page.route("**/api/dashboard", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const resources: DashboardResource[] = [...data.ungroupedResources, ...data.groups.flatMap((group: { resources: DashboardResource[] }) => group.resources)];
      for (const resource of resources) {
        resource.monitoringMode = "manual";
        resource.manualStatus = status;
      }
      await route.fulfill({ json: data });
    });
    await openLaunchpad(page);
    await expect(page.getByLabel("Service health summary")).toHaveCount(0);
    await expect(page.getByText("Service options", { exact: true })).toHaveCount(0);
    await expect(page.locator(".launchpad-services").getByRole("heading", { name: "Ungrouped", exact: true })).toHaveCount(0);
    await expect(page.getByText("Everything looks reachable")).toHaveCount(0);
    status = "online";
    await page.reload();
    await expect(page.getByText("Everything looks reachable")).toHaveCount(0);
    await expect(page.locator(".launchpad-services .svc-card").first()).toBeVisible();
  });
});
