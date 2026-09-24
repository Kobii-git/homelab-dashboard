import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("notes are reachable from the rail, searchable, scrollable, and saved across reloads", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  const current = await (await page.request.get("/api/homepage")).json();
  const original = structuredClone(current.data);
  current.data.workspaces.home.savedNotes = Array.from({ length: 14 }, (_, index) => ({
    id: `review-note-${index}`, title: `Planning ${index}`, text: `Details for planning item ${index}`,
  }));
  expect((await page.request.post("/api/homepage/state", { data: { revision: current.revision, data: current.data } })).ok()).toBe(true);
  try {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("group", { name: "Notes workspace" }).getByRole("button", { name: "Home", exact: true }).click();
    const list = page.getByRole("region", { name: "Saved notes" });
    await expect(list.getByRole("button")).toHaveCount(14);
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await list.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.getByLabel("Find a note").fill("planning item 12");
    await expect(list.getByRole("button")).toHaveCount(1);
    await list.getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "Edit note" }).getByRole("textbox", { name: "Note text", exact: true })).toHaveValue("Details for planning item 12");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByLabel("Find a note").fill("nothing matches this");
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    const text = `Quick thought ${testInfo.project.name}\nA note saved with the keyboard.`;
    await page.getByLabel("Workspace notes").fill(text);
    await page.getByLabel("Workspace notes").press("ControlOrMeta+Enter");
    await expect(page.getByRole("status").filter({ hasText: "Saved to your notes" })).toBeVisible();
    await expect(list.getByRole("button").first()).toContainText(`Quick thought ${testInfo.project.name}`);
    await expect(page.getByLabel("Workspace notes")).toHaveValue("");
    await page.reload();
    await nav.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(list.getByRole("button").first()).toContainText(`Quick thought ${testInfo.project.name}`);
    await page.getByRole("group", { name: "Notes workspace" }).getByRole("button", { name: "Work", exact: true }).click();
    await expect(list.getByRole("button").filter({ hasText: `Quick thought ${testInfo.project.name}` })).toHaveCount(0);
  } finally {
    const latest = await (await page.request.get("/api/homepage")).json();
    expect((await page.request.post("/api/homepage/state", { data: { revision: latest.revision, data: original } })).ok()).toBe(true);
  }
});

test("everyday pages and grouped settings stay accessible in both themes and on mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) {
      await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    }
    for (const name of ["Notes", "Services"]) {
      await nav.getByRole("button", { name, exact: true }).click();
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    }
    await page.getByLabel("Find a service").fill("no such service");
    await expect(page.getByRole("heading", { name: "No matching services" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Integrations & system", exact: true }).click();
    for (const [category, heading] of [["Daily tools", "Personal context"], ["Connections", "Host metrics"], ["Account & runtime", "Runtime Health"]]) {
      await page.getByRole("button", { name: category, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Dashboard", "Services", "Notes", "Settings"]) {
    await nav.getByRole("button", { name, exact: true }).click();
    expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const button = nav.getByRole("button", { name, exact: true });
    await expect(button).toBeInViewport();
  }
});
