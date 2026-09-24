import type { DashboardResource } from "../../shared/types";

/** Saved websites reuse the resource model without scheduling availability checks. */
export function isBookmark(resource: DashboardResource): boolean {
  return resource.purpose === "bookmark";
}

export function bookmarkHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "Website"; }
}
