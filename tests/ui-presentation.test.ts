import { describe, expect, it } from "vitest";
import { defaultLayout } from "../src/shared/homepage";
import type { DashboardResource } from "../src/shared/types";
import { balancedLayout } from "../src/client/features/homepage/balancedLayout";
import { serviceHealth, utilityPresentation } from "../src/client/lib/healthPresentation";

describe("balanced arrangement compatibility", () => {
  it("only changes widget order and width, without modifying its input", () => {
    const original = defaultLayout(true);
    original.accent = "violet";
    original.background = "ocean";
    original.spacing = "compact";
    original.centerShortcuts = { bookmarkIds: ["chosen"], collectionIds: [] };
    original.widgets[0].presentation = "dropdown";
    const before = structuredClone(original);
    const result = balancedLayout(original);
    expect(original).toEqual(before);
    expect({ ...result, widgets: [] }).toEqual({ ...before, widgets: [] });
    for (const widget of result.widgets) {
      const previous = before.widgets.find(item => item.id === widget.id)!;
      expect(widget.enabled).toBe(previous.enabled);
      expect(widget.presentation).toBe(previous.presentation);
    }
    expect(result.widgets.map(widget => widget.id)).toEqual(["favorites", "weather", "services", "prompts", "agenda", "tasks", "mail", "notes", "reading", "timer", "media", "storage", "releases", "bookmarks"]);
    expect(result.widgets.filter(widget => widget.size === "wide").map(widget => widget.id)).toEqual(["notes", "media"]);
  });
});

describe("health presentation", () => {
  const ready = { state: "ready", data: [], fetchedAt: null, stale: false, error: null } as const;
  it("distinguishes loading, disabled, unavailable, cached, and healthy states", () => {
    expect(utilityPresentation(null).tone).toBe("loading");
    expect(utilityPresentation({ ...ready, state: "disabled", data: null }).tone).toBe("neutral");
    expect(utilityPresentation({ ...ready, state: "error", data: null, error: "Timeout" }).tone).toBe("error");
    expect(utilityPresentation(ready, "Fetch failed").tone).toBe("warning");
    expect(utilityPresentation({ ...ready, stale: true }).tone).toBe("warning");
    expect(utilityPresentation(ready).tone).toBe("healthy");
  });
  it("does not report empty or unknown services as healthy or count bookmarks", () => {
    const resource = (id: string, status: "online" | "offline" | "unknown", purpose: "service" | "bookmark" = "service") => ({ id, name: id, monitoringMode: "manual", manualStatus: status, purpose }) as DashboardResource;
    expect(serviceHealth([], () => {}).tone).toBe("neutral");
    expect(serviceHealth([resource("pending", "unknown")], () => {}).tone).toBe("neutral");
    const mixed = serviceHealth([resource("ready", "online"), resource("down", "offline"), resource("pending", "unknown"), resource("link", "offline", "bookmark")], () => {});
    expect(mixed.label).toBe("Services: 1 online · 1 offline · 1 unknown");
    expect(mixed.tone).toBe("error");
    expect(mixed.details?.map(detail => detail.tone)).toEqual(["error", "neutral"]);
  });
});
