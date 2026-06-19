export const RESOURCE_KINDS = ["app", "website", "docker", "vm", "server", "other"] as const;
export const HEALTH_CHECK_TYPES = ["http", "tcp", "ping", "ssl"] as const;
export const HEALTH_STATUSES = ["unknown", "online", "offline"] as const;
export const MONITORING_MODES = ["auto", "manual", "disabled"] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type HealthCheckType = (typeof HEALTH_CHECK_TYPES)[number];
export type HealthStatus = (typeof HEALTH_STATUSES)[number];
export type MonitoringMode = (typeof MONITORING_MODES)[number];

export type HealthTick = {
  id: string;
  status: HealthStatus;
  latencyMs: number | null;
  checkedAt: string;
};

export type DashboardResource = {
  id: string;
  name: string;
  kind: ResourceKind;
  url: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  host: string | null;
  notes: string | null;
  favorite: boolean;
  monitoringMode: MonitoringMode;
  manualStatus: HealthStatus | null;
  sortOrder: number;
  groupId: string | null;
  healthChecks?: Array<{
    id: string;
    resourceId: string;
    type: HealthCheckType;
    target: string;
    intervalSeconds: number;
    timeoutMs: number;
    enabled: boolean;
    latestStatus: HealthStatus;
    latestLatencyMs: number | null;
    latestCheckedAt: string | null;
    latestError: string | null;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    failureThreshold: number;
    successThreshold: number;
    lastTransitionAt: string | null;
    results?: HealthTick[];
  }>;
};

export type DashboardGroupDto = {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  resources: DashboardResource[];
};

export type HostMetricSampleDto = {
  id: string;
  monitorId: string;
  status: HealthStatus;
  error: string | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  diskPercent: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  networkRxBytesPerSec: number | null;
  networkTxBytesPerSec: number | null;
  temperatureC: number | null;
  containersRunning: number | null;
  containersTotal: number | null;
  sampledAt: string;
};

export type HostMonitorDto = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  sortOrder: number;
  primaryMount: string;
  networkInterface: string | null;
  latestStatus: HealthStatus;
  latestError: string | null;
  latestSampledAt: string | null;
  latestCpuPercent: number | null;
  latestMemoryPercent: number | null;
  latestMemoryUsedBytes: number | null;
  latestMemoryTotalBytes: number | null;
  latestDiskPercent: number | null;
  latestDiskUsedBytes: number | null;
  latestDiskTotalBytes: number | null;
  latestNetworkRxBytesPerSec: number | null;
  latestNetworkTxBytesPerSec: number | null;
  latestTemperatureC: number | null;
  latestContainersRunning: number | null;
  latestContainersTotal: number | null;
  samples?: HostMetricSampleDto[];
};

export type DailyBriefingDto = {
  offlineServices: Array<{
    id: string;
    name: string;
    status: HealthStatus;
    error: string | null;
    lastCheckedAt: string | null;
  }>;
  recentChanges: Array<{
    resourceId: string;
    name: string;
    status: HealthStatus;
    changedAt: string;
    error: string | null;
  }>;
  hostsUnderPressure: Array<{
    id: string;
    name: string;
    metric: "cpu" | "memory" | "disk";
    value: number;
    level: "warning" | "critical";
  }>;
  staleChecks: Array<{
    resourceId: string;
    resourceName: string;
    checkId: string;
    target: string;
    lastCheckedAt: string | null;
  }>;
  unmonitoredServices: Array<{
    id: string;
    name: string;
  }>;
};
