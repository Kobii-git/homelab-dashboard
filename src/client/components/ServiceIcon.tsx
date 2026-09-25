import type { DashboardResource } from "../../shared/types";
import { IconFrame } from "./SiteIcon";

/** Failed URLs stay quiet across polling renders and repeated service entries. */
const failedSources = new Set<string>();

export function iconSlug(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ServiceIcon({ resource, size = 40 }: {
  resource: Pick<DashboardResource, "name" | "icon" | "url" | "color"> & { id?: string };
  size?: number;
}) {
  const source = resource.id ? `/api/resources/${encodeURIComponent(resource.id)}/icon` : undefined;
  return <IconFrame name={resource.name} size={size} src={source && !failedSources.has(source) ? source : undefined}
    onError={() => { if (source) failedSources.add(source); }} />;
}
