import type { Page } from "@playwright/test";
import type { HomepageSnapshot } from "../../src/shared/homepage";
export async function enableHomeWidgets(page: Page, ids: string[]) {
  await page.route("**/api/homepage", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = (await response.json()) as HomepageSnapshot;
    for (const w of data.data.workspaces.home.layout.widgets)
      if (ids.includes(w.id)) w.enabled = true;
    await route.fulfill({ json: data });
  });
}
