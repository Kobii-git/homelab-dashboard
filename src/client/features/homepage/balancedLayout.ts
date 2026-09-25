import type { HomeLayout } from "../../../shared/homepage";

const order: HomeLayout["widgets"][number]["id"][] = [
  "favorites", "weather", "services", "prompts", "agenda", "tasks", "mail",
  "notes", "reading", "timer", "media", "storage", "releases", "bookmarks",
];

/** A preview transformation: visibility, presentation, and unrelated preferences survive. */
export function balancedLayout(layout: HomeLayout): HomeLayout {
  return { ...layout, widgets: order.map(id => ({
    ...layout.widgets.find(widget => widget.id === id)!,
    size: id === "notes" || id === "media" ? "wide" : "normal",
  })) };
}
