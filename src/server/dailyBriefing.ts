import type { DailyBriefingDto, HostMonitorDto, IntegrationSourceDto } from "../shared/types.js";

type BriefingCheck = {
  id: string;
  target: string;
  enabled: boolean;
  primary: boolean;
  intervalSeconds: number;
  latestStatus: string;
  latestError: string | null;
  latestCheckedAt: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureThreshold: number;
  successThreshold: number;
  lastTransitionAt: Date | null;
};

export type BriefingResource = {
  id: string;
  name: string;
  monitoringMode: string;
  manualStatus: string | null;
  healthChecks: BriefingCheck[];
};

export function resourceStatus(resource: BriefingResource): "online" | "offline" | "unknown" {
  if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
    return resource.manualStatus === "online" || resource.manualStatus === "offline" ? resource.manualStatus : "unknown";
  }

  const status = resource.healthChecks.find((check) => check.enabled && check.primary)?.latestStatus;
  return status === "online" || status === "offline" ? status : "unknown";
}

export function buildDailyBriefing(
  resources: BriefingResource[],
  hostMonitors: HostMonitorDto[],
  integrations: IntegrationSourceDto[] = []
): DailyBriefingDto {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const statuses = resources.map((resource) => ({
    resource,
    status: resourceStatus(resource)
  }));

  const offlineServices = statuses
    .filter((item) => item.status === "offline")
    .map(({ resource }) => {
      const failed = resource.healthChecks.find(
        (check) => check.enabled && check.primary && check.latestStatus === "offline"
      );
      return {
        id: resource.id,
        name: resource.name,
        status: "offline" as const,
        error: failed?.latestError ?? null,
        lastCheckedAt: failed?.latestCheckedAt?.toISOString() ?? null
      };
    })
    .slice(0, 8);

  const recentChanges = resources
    .flatMap((resource) =>
      resource.healthChecks
        .filter((check) =>
          check.enabled &&
          check.primary &&
          (check.latestStatus === "online" || check.latestStatus === "offline") &&
          check.lastTransitionAt &&
          check.lastTransitionAt.getTime() >= dayAgo
        )
        .map((check) => ({
          resourceId: resource.id,
          name: resource.name,
          status: check.latestStatus as "online" | "offline",
          changedAt: (check.lastTransitionAt as Date).toISOString(),
          error: check.latestError
        }))
    )
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt))
    .slice(0, 8);

  const hostsUnderPressureAll = hostMonitors
    .flatMap((host) => {
      const metrics: DailyBriefingDto["hostsUnderPressure"] = [];
      for (const [metric, value] of [
        ["cpu", host.latestCpuPercent],
        ["memory", host.latestMemoryPercent],
        ["disk", host.latestDiskPercent]
      ] as const) {
        if (typeof value === "number" && value >= 80) {
          metrics.push({
            id: host.id,
            name: host.name,
            metric,
            value,
            level: value >= 90 ? "critical" : "warning"
          });
        }
      }
      return metrics;
    })
    .sort((left, right) => right.value - left.value);
  const hostsUnderPressure = hostsUnderPressureAll.slice(0, 8);

  const storageIssues: NonNullable<DailyBriefingDto["storageIssues"]> = integrations.flatMap((source) => {
    const snapshot = source.latestSnapshot?.provider === "truenas" ? source.latestSnapshot : null;
    if (!snapshot) return [];
    const capacity = snapshot.dataset ?? snapshot.pool;
    const usedPercent = capacity.sizeBytes > 0 ? Math.round((capacity.usedBytes / capacity.sizeBytes) * 1000) / 10 : 0;
    const unhealthy = !["ONLINE", "HEALTHY"].includes(snapshot.pool.health.toUpperCase());
    if (!unhealthy && usedPercent < 80) return [];
    return [{
      id: source.id,
      name: source.name,
      health: snapshot.pool.health,
      usedPercent,
      level: unhealthy || usedPercent >= 90 ? "critical" as const : "warning" as const
    }];
  });

  const staleChecksAll = resources
    .flatMap((resource) =>
      resource.monitoringMode === "auto"
        ? resource.healthChecks
          .filter((check) => {
            if (!check.enabled || !check.primary) return false;
            if (!check.latestCheckedAt) return true;
            const staleAfter = Math.max(check.intervalSeconds * 2 * 1000, 5 * 60 * 1000);
            return now - check.latestCheckedAt.getTime() > staleAfter;
          })
          .map((check) => ({
            resourceId: resource.id,
            resourceName: resource.name,
            checkId: check.id,
            target: check.target,
            lastCheckedAt: check.latestCheckedAt?.toISOString() ?? null
          }))
        : []
    );
  const staleChecks = staleChecksAll.slice(0, 8);

  const unmonitoredServicesAll = resources
    .filter((resource) =>
      resource.monitoringMode === "auto" &&
      resource.healthChecks.filter((check) => check.enabled && check.primary).length === 0
    )
    .map((resource) => ({ id: resource.id, name: resource.name }));
  const unmonitoredServices = unmonitoredServicesAll.slice(0, 8);

  const watchlistAll: DailyBriefingDto["watchlist"] = resources
    .flatMap((resource) =>
      resource.monitoringMode === "auto"
        ? resource.healthChecks
          .filter((check) => check.enabled && check.primary)
          .flatMap((check) => {
            const entries: DailyBriefingDto["watchlist"] = [];

            if (
              check.consecutiveFailures > 0 &&
              check.consecutiveFailures < check.failureThreshold &&
              check.latestStatus !== "offline"
            ) {
              entries.push({
                resourceId: resource.id,
                resourceName: resource.name,
                checkId: check.id,
                target: check.target,
                direction: "failing" as const,
                currentStatus: check.latestStatus as "online" | "offline" | "unknown",
                latestRawStatus: "offline" as const,
                consecutive: check.consecutiveFailures,
                threshold: check.failureThreshold,
                lastCheckedAt: check.latestCheckedAt?.toISOString() ?? null,
                error: check.latestError
              });
            }

            if (
              check.consecutiveSuccesses > 0 &&
              check.consecutiveSuccesses < check.successThreshold &&
              check.latestStatus === "offline"
            ) {
              entries.push({
                resourceId: resource.id,
                resourceName: resource.name,
                checkId: check.id,
                target: check.target,
                direction: "recovering" as const,
                currentStatus: check.latestStatus as "online" | "offline" | "unknown",
                latestRawStatus: "online" as const,
                consecutive: check.consecutiveSuccesses,
                threshold: check.successThreshold,
                lastCheckedAt: check.latestCheckedAt?.toISOString() ?? null,
                error: check.latestError
              });
            }

            return entries;
          })
        : []
    )
    .sort((left, right) => {
      const directionPriority = left.direction === right.direction ? 0 : left.direction === "failing" ? -1 : 1;
      if (directionPriority !== 0) return directionPriority;
      return (right.lastCheckedAt ?? "").localeCompare(left.lastCheckedAt ?? "");
    });
  const watchlist = watchlistAll.slice(0, 8);

  return {
    summary: {
      servicesTotal: resources.length,
      servicesOnline: statuses.filter((item) => item.status === "online").length,
      servicesOffline: statuses.filter((item) => item.status === "offline").length,
      servicesUnknown: statuses.filter((item) => item.status === "unknown").length,
      hostsTotal: hostMonitors.length,
      hostsOffline: hostMonitors.filter((host) => host.latestStatus === "offline").length,
      hostsUnderPressure: hostsUnderPressureAll.length,
      staleChecks: staleChecksAll.length,
      unmonitoredServices: unmonitoredServicesAll.length,
      pendingFailures: watchlistAll.filter((item) => item.direction === "failing").length,
      pendingRecoveries: watchlistAll.filter((item) => item.direction === "recovering").length,
      storageIssues: storageIssues.length
    },
    offlineServices,
    recentChanges,
    hostsUnderPressure,
    storageIssues,
    staleChecks,
    unmonitoredServices,
    watchlist
  };
}
