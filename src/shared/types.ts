export const RESOURCE_KINDS = ["app", "website", "docker", "vm", "server", "other"] as const;
export const CONNECTION_TYPES = ["rdp", "ssh"] as const;
export const HEALTH_CHECK_TYPES = ["http", "tcp", "ping", "ssl"] as const;
export const HEALTH_STATUSES = ["unknown", "online", "offline"] as const;
export const INCIDENT_STATUSES = ["open", "acknowledged", "resolved", "muted"] as const;
export const ALERT_CHANNEL_TYPES = ["webhook", "email"] as const;
export const ALERT_EVENTS = ["incident.opened", "incident.resolved", "incident.acknowledged"] as const;
export const WIDGET_TYPES = [
  "favorites",
  "serviceStatus",
  "incidents",
  "failingChecks",
  "recentSessions",
  "vaultHealth",
  "notes"
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ConnectionType = (typeof CONNECTION_TYPES)[number];
export type HealthCheckType = (typeof HEALTH_CHECK_TYPES)[number];
export type HealthStatus = (typeof HEALTH_STATUSES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type AlertChannelType = (typeof ALERT_CHANNEL_TYPES)[number];
export type AlertEvent = (typeof ALERT_EVENTS)[number];
export type WidgetType = (typeof WIDGET_TYPES)[number];

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
  tags?: TagDto[];
  connections?: Array<{ id: string; type: ConnectionType }>;
  healthChecks?: Array<{
    id: string;
    type: HealthCheckType;
    target: string;
    latestStatus: HealthStatus;
    latestLatencyMs: number | null;
    latestCheckedAt: string | null;
    latestError: string | null;
  }>;
};

export type TagSummary = {
  id: string;
  name: string;
  color: string | null;
  type: string;
};

export type DashboardGroupDto = {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  resources: DashboardResource[];
};

export type FolderDto = {
  id: string;
  name: string;
  type: "connection" | "credential" | "mixed";
  parentId: string | null;
  sortOrder: number;
};

export type TagDto = {
  id: string;
  name: string;
  color: string | null;
  type: string;
};

export type DashboardWidgetDto = {
  id: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
  sortOrder: number;
  enabled: boolean;
};

export type SessionHistoryDto = {
  id: string;
  connectionId: string | null;
  credentialId: string | null;
  resourceName: string;
  connectionName: string | null;
  protocol: ConnectionType;
  host: string;
  port: number;
  status: string;
  error: string | null;
  hasCredential: boolean;
  startedAt: string;
  endedAt: string | null;
};

export type IncidentDto = {
  id: string;
  checkId: string | null;
  resourceId: string | null;
  status: IncidentStatus;
  severity: string;
  title: string;
  summary: string | null;
  failureCount: number;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  mutedUntil: string | null;
  resource?: DashboardResource | null;
};

export type AlertChannelDto = {
  id: string;
  name: string;
  type: AlertChannelType;
  enabled: boolean;
  configSummary: Record<string, unknown>;
};

export type AlertRuleDto = {
  id: string;
  name: string;
  channelId: string;
  event: AlertEvent;
  enabled: boolean;
  cooldownSeconds: number;
  lastTriggeredAt: string | null;
};

export type AlertDeliveryDto = {
  id: string;
  channelId: string;
  ruleId: string | null;
  incidentId: string | null;
  event: AlertEvent;
  status: string;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type AuditEventDto = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type NoteDto = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  resourceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SearchResultDto = {
  id: string;
  type: "resource" | "connection" | "check" | "incident" | "credential" | "navigation" | "action";
  title: string;
  subtitle: string;
  action: string;
  payload?: Record<string, unknown>;
};
