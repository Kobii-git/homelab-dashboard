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

export type IntegrationProvider = "opnsense";

export type OpnsenseGatewayDto = {
  id: string;
  name: string;
  status: HealthStatus;
  address: string | null;
  interfaceName: string | null;
  delayMs: number | null;
  lossPercent: number | null;
  description: string | null;
};

export type OpnsenseInterfaceDto = {
  id: string;
  name: string;
  identifier: string | null;
  device: string | null;
  status: HealthStatus;
  ipv4: string | null;
  ipv6: string | null;
  mac: string | null;
  receivedBytesPerSec: number | null;
  sentBytesPerSec: number | null;
  bytesReceived: number | null;
  bytesSent: number | null;
};

export type OpnsenseImportSuggestionDto = {
  id: string;
  name: string;
  kind: ResourceKind;
  url: string | null;
  host: string | null;
  description: string;
  icon: string;
  color: string;
  source: "gateway" | "interface" | "firewall";
};

export type OpnsenseSnapshotDto = {
  provider: "opnsense";
  status: HealthStatus;
  sampledAt: string;
  warnings: string[];
  system: {
    hostname: string | null;
    version: string | null;
    uptime: string | null;
    cpuPercent: number | null;
    memoryPercent: number | null;
    diskPercent: number | null;
    swapPercent: number | null;
    temperatureC: number | null;
  };
  firmware: {
    product: string | null;
    version: string | null;
    runningVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean | null;
    needsReboot: boolean | null;
  };
  firewall: {
    stateCount: number | null;
    srcNodes: number | null;
    fragmentCount: number | null;
    logEntries: number | null;
  };
  gateways: OpnsenseGatewayDto[];
  interfaces: OpnsenseInterfaceDto[];
  importSuggestions: OpnsenseImportSuggestionDto[];
};

export type IntegrationSampleDto = {
  id: string;
  sourceId: string;
  status: HealthStatus;
  error: string | null;
  snapshot: OpnsenseSnapshotDto | null;
  sampledAt: string;
};

export type IntegrationSourceDto = {
  id: string;
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  enabled: boolean;
  status: HealthStatus;
  latestError: string | null;
  latestSnapshot: OpnsenseSnapshotDto | null;
  latestSampledAt: string | null;
  sortOrder: number;
  samples?: IntegrationSampleDto[];
};

export type ApiWidgetAuthType = "none" | "bearer" | "header" | "basic" | "pihole";

export type ApiWidgetFieldMappingDto = {
  label: string;
  path: string;
  suffix?: string | null;
  kind?: "text" | "number" | "percent" | "bytes" | "duration" | "count" | null;
};

export type ApiWidgetFieldDto = {
  label: string;
  value: string;
  rawValue: string | number | boolean | null;
  suffix: string | null;
  kind: NonNullable<ApiWidgetFieldMappingDto["kind"]>;
};

export type ApiWidgetSnapshotDto = {
  provider: "api-widget";
  templateId: string;
  status: HealthStatus;
  sampledAt: string;
  title: string;
  summary: string | null;
  fields: ApiWidgetFieldDto[];
};

export type ApiWidgetSampleDto = {
  id: string;
  widgetId: string;
  status: HealthStatus;
  error: string | null;
  snapshot: ApiWidgetSnapshotDto | null;
  sampledAt: string;
};

export type ApiWidgetDto = {
  id: string;
  name: string;
  templateId: string;
  baseUrl: string;
  endpointPath: string;
  authType: ApiWidgetAuthType;
  authHeaderName: string | null;
  authEnvVar: string | null;
  authValuePrefix: string | null;
  tlsVerify: boolean;
  fieldMappings: ApiWidgetFieldMappingDto[];
  enabled: boolean;
  pollIntervalSeconds: number;
  sortOrder: number;
  latestStatus: HealthStatus;
  latestError: string | null;
  latestSnapshot: ApiWidgetSnapshotDto | null;
  latestSampledAt: string | null;
  samples?: ApiWidgetSampleDto[];
};

export type ApiWidgetTemplateDto = {
  id: string;
  name: string;
  app: string;
  description: string;
  docsUrl: string;
  authType: ApiWidgetAuthType;
  authHeaderName: string | null;
  authEnvVarHint: string | null;
  authValuePrefix: string | null;
  endpointPath: string;
  fieldMappings: ApiWidgetFieldMappingDto[];
};

export type ApiWidgetSuggestionDto = {
  id: string;
  resourceId: string;
  resourceName: string;
  templateId: string;
  templateName: string;
  app: string;
  baseUrl: string;
  endpointPath: string;
  authType: ApiWidgetAuthType;
  authHeaderName: string | null;
  authEnvVarHint: string | null;
  authValuePrefix: string | null;
  fieldMappings: ApiWidgetFieldMappingDto[];
  reason: string;
};

export type AiBriefingSeverity = "ok" | "notice" | "warning" | "critical";
export type AiBriefingStatus = "disabled" | "unconfigured" | "ready" | "fresh" | "cached" | "error";
export type AiBriefingConfidence = "low" | "medium" | "high";

export type AiBriefingItemDto = {
  title: string;
  body: string;
  severity: AiBriefingSeverity;
  evidenceIds: string[];
};

export type AiBriefingActionDto = {
  label: string;
  resourceId?: string | null;
  checkId?: string | null;
  integrationId?: string | null;
  widgetId?: string | null;
};

export type AiBriefingDto = {
  status: AiBriefingStatus;
  severity: AiBriefingSeverity;
  generatedAt: string | null;
  headline: string;
  summary: string;
  items: AiBriefingItemDto[];
  nextActions: AiBriefingActionDto[];
  confidence: AiBriefingConfidence;
  model: string | null;
  stale: boolean;
  error: string | null;
};

export type AiRuntimeDto = {
  enabled: boolean;
  configured: boolean;
  providerName: string;
  baseUrl: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  tlsVerify: boolean;
  briefingIntervalSeconds: number;
  includeTargets: boolean;
  lastGeneratedAt: string | null;
  lastError: string | null;
};

export type DailyBriefingDto = {
  summary: {
    servicesTotal: number;
    servicesOnline: number;
    servicesOffline: number;
    servicesUnknown: number;
    hostsTotal: number;
    hostsOffline: number;
    hostsUnderPressure: number;
    staleChecks: number;
    unmonitoredServices: number;
    pendingFailures: number;
    pendingRecoveries: number;
  };
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
  watchlist: Array<{
    resourceId: string;
    resourceName: string;
    checkId: string;
    target: string;
    direction: "failing" | "recovering";
    currentStatus: HealthStatus;
    latestRawStatus: "online" | "offline";
    consecutive: number;
    threshold: number;
    lastCheckedAt: string | null;
    error: string | null;
  }>;
};
