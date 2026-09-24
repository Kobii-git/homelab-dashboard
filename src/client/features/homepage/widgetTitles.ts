import type { HomeLayout } from "../../../shared/homepage";

export const widgetTitles: Record<HomeLayout["widgets"][number]["id"], string> = {
  favorites: "Favorites",
  bookmarks: "Bookmarks in sidebar",
  weather: "Weather",
  notes: "Notes",
  prompts: "Prompt library",
  reading: "Reading list",
  timer: "Focus timer",
  agenda: "Calendar",
  tasks: "Todoist",
  mail: "Mail",
  media: "Media",
  storage: "Storage",
  services: "Services",
  releases: "Software releases",
};
