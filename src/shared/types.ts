export const RESOURCE_KINDS = ["app", "website", "docker", "vm", "server", "other"] as const;
export const HEALTH_CHECK_TYPES = ["http", "tcp", "ping", "ssl"] as const;
export const HEALTH_STATUSES = ["unknown", "online", "offline"] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type HealthCheckType = (typeof HEALTH_CHECK_TYPES)[number];
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

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
  }>;
};

export type DashboardGroupDto = {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  resources: DashboardResource[];
};
