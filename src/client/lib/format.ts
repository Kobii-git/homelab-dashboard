import type { DashboardResource, HealthTick } from "../../shared/types";

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

function activeHealthChecks(resource: DashboardResource) {
  if (resource.monitoringMode !== "auto") {
    return [];
  }

  return (resource.healthChecks ?? []).filter((check) => check.enabled);
}

export function statusFor(resource: DashboardResource): "unknown" | "online" | "offline" {
  if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
    return resource.manualStatus ?? "unknown";
  }

  const checks = activeHealthChecks(resource);

  if (checks.length === 0) {
    return "unknown";
  }

  if (checks.some((check) => check.latestStatus === "offline")) {
    return "offline";
  }

  return checks.some((check) => check.latestStatus === "online") ? "online" : "unknown";
}

export function dashboardResources(groups: Array<{ resources: DashboardResource[] }>, ungrouped: DashboardResource[]) {
  return [...groups.flatMap((group) => group.resources), ...ungrouped];
}

export function summarizeResourceStatus(resources: DashboardResource[]) {
  return resources.reduce(
    (summary, resource) => {
      summary[statusFor(resource)] += 1;
      summary.checks += activeHealthChecks(resource).length;
      if (resource.favorite) {
        summary.favorites += 1;
      }
      return summary;
    },
    { online: 0, offline: 0, unknown: 0, checks: 0, favorites: 0 }
  );
}

/** Recent results of the primary (first enabled, non-empty) check, oldest → newest. */
export function resourceTicks(resource: DashboardResource, limit = 30): HealthTick[] {
  if (resource.monitoringMode !== "auto") {
    return [];
  }

  const checks = activeHealthChecks(resource);
  const primary = checks.find((check) => (check.results?.length ?? 0) > 0);
  const results = primary?.results ?? [];

  return [...results]
    .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt))
    .slice(-limit);
}

/** Percentage of stored recent results that were online, across all checks. Null when unmonitored. */
export function uptimePercent(resource: DashboardResource): number | null {
  if (resource.monitoringMode !== "auto") {
    return null;
  }

  const results = activeHealthChecks(resource).flatMap((check) => check.results ?? []);
  const counted = results.filter((result) => result.status === "online" || result.status === "offline");

  if (counted.length === 0) {
    return null;
  }

  const online = counted.filter((result) => result.status === "online").length;
  return Math.round((online / counted.length) * 1000) / 10;
}

export function formatUptime(value: number | null): string {
  if (value == null) {
    return "—";
  }

  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(0, value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function formatByteRate(value: number | null | undefined): string {
  const formatted = formatBytes(value);
  return formatted === "—" ? formatted : `${formatted}/s`;
}

export function latestLatency(resource: DashboardResource): number | null {
  const latencies = activeHealthChecks(resource)
    .map((check) => check.latestLatencyMs)
    .filter((value): value is number => typeof value === "number");

  if (latencies.length === 0) {
    return null;
  }

  return Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
}

export function latestCheckedAt(resource: DashboardResource): string | null {
  return activeHealthChecks(resource)
    .map((check) => check.latestCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function latestErrors(resource: DashboardResource): string[] {
  return activeHealthChecks(resource)
    .filter((check) => check.latestStatus === "offline" && check.latestError)
    .map((check) => check.latestError as string);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) {
    return "never";
  }

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "unknown";
  }

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  if (seconds < 90) return "1m ago";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400 * 2) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function serviceAddress(resource: DashboardResource): string {
  if (resource.url) {
    try {
      return new URL(resource.url).host;
    } catch {
      return resource.url;
    }
  }

  return resource.host ?? resource.kind;
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
