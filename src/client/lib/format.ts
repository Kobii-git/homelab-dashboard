import type { DashboardResource } from "../../shared/types";

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function statusFor(resource: DashboardResource): "unknown" | "online" | "offline" {
  if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
    return resource.manualStatus ?? "unknown";
  }

  const checks = resource.healthChecks ?? [];

  if (checks.length === 0) {
    return "unknown";
  }

  return checks.some((check) => check.latestStatus === "offline") ? "offline" : "online";
}

export function dashboardResources(groups: Array<{ resources: DashboardResource[] }>, ungrouped: DashboardResource[]) {
  return [...groups.flatMap((group) => group.resources), ...ungrouped];
}

export function summarizeResourceStatus(resources: DashboardResource[]) {
  return resources.reduce(
    (summary, resource) => {
      summary[statusFor(resource)] += 1;
      summary.checks += resource.healthChecks?.length ?? 0;
      if (resource.favorite) {
        summary.favorites += 1;
      }
      return summary;
    },
    { online: 0, offline: 0, unknown: 0, checks: 0, favorites: 0 }
  );
}
