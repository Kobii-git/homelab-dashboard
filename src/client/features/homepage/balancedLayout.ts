import type { HomeLayout } from "../../../shared/homepage";

const order: HomeLayout["widgets"][number]["id"][] = [
  "favorites", "weather", "services", "prompts", "agenda", "tasks", "mail",
  "notes", "reading", "timer", "media", "storage", "releases", "bookmarks",
];

/** A preview transformation: visibility, presentation, and unrelated preferences survive. */
export function balancedLayout(layout: HomeLayout): HomeLayout {
  const fixed = new Set(["favorites", "weather", "bookmarks"]);
  const arranged = order.filter(id => !fixed.has(id)).map(id => ({
    ...layout.widgets.find(widget => widget.id === id)!,
    size: id === "notes" || id === "media" ? "wide" as const : "normal" as const,
  }));
  let index = 0;
  return { ...layout, widgets: layout.widgets.map(widget => fixed.has(widget.id) ? widget : arranged[index++]) };
}
