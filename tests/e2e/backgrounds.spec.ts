import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { builtInBackgrounds } from "../../src/shared/backgrounds";
import type { HomepageSnapshot } from "../../src/shared/homepage";

test("background picker previews, cancels, persists each wallpaper, and isolates workspaces", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("searchbox", { name: "Search Google" })).toBeVisible();
  const getState = async () => (await (await page.request.get("/api/homepage")).json()) as HomepageSnapshot;
  const original = await getState();
  const nav = page.getByRole("navigation", { name: "Primary" });
  const panel = page.getByRole("region", { name: "Customize homepage" });
  const preview = page.getByLabel("Background preview", { exact: true });
  const fullImageRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/backgrounds/") && !request.url().includes("-thumb")) fullImageRequests.push(new URL(request.url()).pathname);
  });
  try {
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Customize home", exact: true }).click();
    await expect(panel.getByRole("radio")).toHaveCount(4);
    for (const image of await panel.locator(".hp-background-option img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(384);
    }
    await panel.getByRole("radio", { name: "Tidal", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(panel.getByLabel("Background", { exact: true })).toHaveValue("wallpaper:tidal");
    await page.keyboard.press("ArrowRight");
    await expect(panel.getByRole("radio", { name: "Aurora", exact: true })).toBeChecked();
    await expect(preview).toHaveCSS("background-image", /aurora-v1\.jpg/);
    expect(new Set(fullImageRequests)).toEqual(new Set(["/backgrounds/tidal-v1.jpg", "/backgrounds/aurora-v1.jpg"]));
    expect((await getState()).data).toEqual(original.data);
    await panel.getByRole("button", { name: "Cancel preview" }).click();
    expect((await getState()).data).toEqual(original.data);
    for (const preset of builtInBackgrounds) {
      await page.getByRole("button", { name: "Customize home", exact: true }).click();
      await panel.getByLabel("Background", { exact: true }).selectOption(preset.id);
      await expect(panel.getByRole("radio", { name: preset.name, exact: true })).toBeChecked();
      await expect(preview).toHaveCSS("background-image", new RegExp(preset.src));
      for (const width of [390, 1920]) {
        await page.setViewportSize({ width, height: 1080 });
        for (const theme of ["dark", "light"]) {
          if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
          await page.locator(".workspace-scroll").evaluate(el => { el.scrollTop = 0; });
          expect(await page.locator(".workspace-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
          const result = await new AxeBuilder({ page }).analyze();
          expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")), `${preset.name} settings ${theme} ${width}`).toEqual([]);
          if (width === 1920) await page.screenshot({ path: testInfo.outputPath(`picker-${preset.id.slice(10)}-${theme}.png`) });
        }
      }
      await panel.getByRole("button", { name: "Save layout", exact: true }).click();
      await expect(panel).toHaveCount(0);
      await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
      await page.reload();
      const home = page.locator(".browser-home");
      await expect(home).toHaveCSS("background-image", new RegExp(preset.src));
      const saved = await getState();
      expect(saved.data.workspaces.home.layout.background).toBe(preset.id);
      expect(saved.data.workspaces.work).toEqual(original.data.workspaces.work);
      expect(saved.data.workspaces.home.layout.widgets).toEqual(original.data.workspaces.home.layout.widgets);
      const response = await page.request.get(preset.src);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/jpeg");
      await expect(home).toHaveCSS("animation-name", "none");
      await expect(home).toHaveCSS("filter", "none");
      for (const theme of ["dark", "light"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
        await page.setViewportSize({ width: 2560, height: 1080 });
        const result = await new AxeBuilder({ page }).analyze();
        expect(result.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")), `${preset.name} homepage ${theme}`).toEqual([]);
        const bounds = (await home.boundingBox())!;
        const canvas = (await page.locator(".workspace-scroll").boundingBox())!;
        expect(Math.abs(bounds.width - canvas.width)).toBeLessThan(1);
        await page.screenshot({ path: testInfo.outputPath(`homepage-${preset.id.slice(10)}-${theme}.png`) });
      }
      await nav.getByRole("button", { name: "Settings", exact: true }).click();
    }
    await page.getByRole("group", { name: "Workspace settings" }).getByRole("button", { name: "Work", exact: true }).click();
    await page.getByRole("button", { name: "Customize work", exact: true }).click();
    await panel.getByLabel("Background", { exact: true }).selectOption("wallpaper:blue-hour");
    await panel.getByRole("button", { name: "Save layout", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    expect((await getState()).data.workspaces.home.layout.background).toBe("wallpaper:graphite");
    expect((await getState()).data.workspaces.work.layout.background).toBe("wallpaper:blue-hour");
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.locator(".browser-home")).toHaveCSS("background-image", /blue-hour-v1\.jpg/);
  } finally {
    const latest = await getState();
    expect((await page.request.post("/api/homepage/state", { data: { revision: latest.revision, data: original.data } })).ok()).toBe(true);
  }
});
