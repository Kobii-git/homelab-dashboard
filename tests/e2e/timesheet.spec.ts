import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { HomepageSnapshot } from "../../src/shared/homepage";
import { localWeekStart, weekdays } from "../../src/shared/timesheet";

const state = async (page: Page): Promise<HomepageSnapshot> => (await page.request.get("/api/homepage")).json();
async function login(page: Page) {
  // Identity fetching is covered separately; keep unrelated destination requests out of these flows.
  await page.route("**/api/resources/*/icon", route => route.fulfill({ status: 404, body: "No fixture icon" }));
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Work", exact: true }).click();
  await expect(page.getByRole("region", { name: "Timesheet notes" })).toBeVisible();
}
async function restore(page: Page, original: HomepageSnapshot) {
  const latest = await state(page);
  expect((await page.request.post("/api/homepage/state", { data: { revision: latest.revision, data: original.data } })).ok()).toBe(true);
}

test("Work timesheet autosaves five days, keeps history, copies a week, and fits both themes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await login(page);
  const original = await state(page);
  const sheet = page.getByRole("region", { name: "Timesheet notes" });
  try {
    for (const day of weekdays) await sheet.getByLabel(`${day} work notes`).fill(`${day}: reviewed sample tickets and documented the results.`);
    await expect(sheet.getByRole("status")).toHaveText("All changes saved");
    const saved = await state(page);
    expect(saved.data.workspaces.work.timesheetWeeks).toHaveLength(1);
    expect(saved.data.workspaces.home).toEqual(original.data.workspaces.home);
    expect(saved.data.workspaces.work.savedNotes).toEqual(original.data.workspaces.work.savedNotes);
    expect(saved.data.workspaces.work.layout).toEqual(original.data.workspaces.work.layout);
    const publicStatus = await page.request.get("/api/status");
    expect(publicStatus.ok()).toBe(true);
    expect(await publicStatus.text()).not.toContain("reviewed sample tickets");
    await page.reload();
    await expect(sheet.getByLabel("Monday work notes")).toHaveValue(/Monday: reviewed/);
    await sheet.getByRole("button", { name: "Previous timesheet week" }).click();
    await expect(sheet.getByLabel("Monday work notes")).toHaveValue("");
    await sheet.getByLabel("Friday work notes").fill("Last week's sample handover");
    await sheet.getByLabel("Friday work notes").press("Control+Enter");
    await expect(sheet.getByRole("status")).toHaveText("All changes saved");
    await sheet.getByRole("button", { name: "This week", exact: true }).click();
    await expect(sheet.getByLabel("Friday work notes")).toHaveValue(/Friday: reviewed/);
    await sheet.getByRole("button", { name: "Copy week", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Copy timesheet week" });
    await expect(dialog.getByLabel("Text to copy")).toHaveValue(/Monday[\s\S]*Tuesday[\s\S]*Wednesday[\s\S]*Thursday[\s\S]*Friday/);
    await page.keyboard.press("Escape");
    await expect(sheet.getByRole("button", { name: "Copy week", exact: true })).toBeFocused();
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["dark", "light"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
        await sheet.scrollIntoViewIfNeeded();
        expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        const result = await new AxeBuilder({ page }).include(".hp-timesheet").analyze();
        expect(result.violations, `${theme} ${width}`).toEqual([]);
        if ([390, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`timesheet-${theme}-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("html").evaluate(el => { el.style.zoom = "2"; });
    expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator("html").evaluate(el => { el.style.zoom = ""; });
    await page.getByRole("navigation", { name: "Dashboard view" }).getByRole("button", { name: "Home", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  } finally { await restore(page, original); }
});

test("timesheet preserves failed drafts across navigation and recovers concurrent edits without overwriting other days", async ({ page }) => {
  await login(page);
  const original = await state(page);
  const sheet = page.getByRole("region", { name: "Timesheet notes" });
  const nav = page.getByRole("navigation", { name: "Primary" });
  try {
    await page.route("**/api/homepage/state", route => route.abort());
    await sheet.getByLabel("Monday work notes").fill("My unsaved Monday");
    await expect(sheet.getByRole("alert")).toContainText("Could not save your week");
    await expect(sheet.getByRole("button", { name: "Previous timesheet week" })).toBeDisabled();
    await nav.getByRole("button", { name: "Services", exact: true }).click();
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(sheet.getByLabel("Monday work notes")).toHaveValue("My unsaved Monday");
    await expect(sheet.getByRole("alert")).toContainText("Could not save your week");
    // A second client changes Monday and Tuesday while this browser is offline.
    const remote = await state(page);
    const weekStart = localWeekStart(new Date());
    remote.data.workspaces.work.timesheetWeeks = [{ weekStart, days: ["Monday from another device", "Tuesday from another device", "", "", ""] }];
    expect((await page.request.post("/api/homepage/state", { data: { data: remote.data, revision: remote.revision } })).ok()).toBe(true);
    await page.unroute("**/api/homepage/state");
    await sheet.getByRole("button", { name: "Retry save" }).click();
    await expect(sheet.getByText("Monday from another device", { exact: false })).toBeVisible();
    await expect(sheet.getByLabel("Monday work notes")).toHaveValue("My unsaved Monday");
    await expect(sheet.getByLabel("Tuesday work notes")).toHaveValue("Tuesday from another device");
    await sheet.getByRole("button", { name: "Keep my edits" }).click();
    await expect(sheet.getByRole("status")).toHaveText("All changes saved");
    expect((await state(page)).data.workspaces.work.timesheetWeeks[0].days.slice(0, 2)).toEqual(["My unsaved Monday", "Tuesday from another device"]);
    await page.reload();
    await expect(sheet.getByLabel("Monday work notes")).toHaveValue("My unsaved Monday");
    // An unrelated configuration revision can be retried without discarding either side.
    await page.route("**/api/homepage/state", route => route.abort());
    await sheet.getByLabel("Wednesday work notes").fill("Wednesday draft");
    await expect(sheet.getByRole("alert")).toBeVisible();
    const newer = await state(page);
    newer.data.workspaces.work.notes = "Unrelated scratchpad edit";
    expect((await page.request.post("/api/homepage/state", { data: { data: newer.data, revision: newer.revision } })).ok()).toBe(true);
    await page.unroute("**/api/homepage/state");
    await sheet.getByRole("button", { name: "Retry save" }).click();
    await expect(sheet.getByRole("alert")).toContainText("Saved data changed");
    await sheet.getByRole("button", { name: "Retry save" }).click();
    await expect(sheet.getByRole("status")).toHaveText("All changes saved");
    expect((await state(page)).data.workspaces.work.notes).toBe("Unrelated scratchpad edit");
    expect((await state(page)).data.workspaces.work.timesheetWeeks[0].days[2]).toBe("Wednesday draft");
  } finally { await page.unroute("**/api/homepage/state"); await restore(page, original); }
});

test("typing during a save is retained and clearing an empty week removes only that week", async ({ page }) => {
  await login(page);
  const original = await state(page);
  const sheet = page.getByRole("region", { name: "Timesheet notes" });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.route("**/api/homepage/state", async route => { await gate; await route.continue(); }, { times: 1 });
    const started = page.waitForRequest("**/api/homepage/state");
    await sheet.getByLabel("Monday work notes").fill("First edit");
    await started;
    await sheet.getByLabel("Monday work notes").fill("First edit plus more detail");
    release();
    await expect(sheet.getByRole("status")).toHaveText("All changes saved");
    expect((await state(page)).data.workspaces.work.timesheetWeeks[0].days[0]).toBe("First edit plus more detail");
    await sheet.getByLabel("Monday work notes").fill("");
    await expect(sheet.getByRole("status")).toHaveText("All changes saved");
    expect((await state(page)).data.workspaces.work.timesheetWeeks).toEqual([]);
  } finally { release(); await page.unroute("**/api/homepage/state"); await restore(page, original); }
});
