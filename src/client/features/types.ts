import type {
  AlertChannelDto,
  AlertDeliveryDto,
  AlertRuleDto,
  AuditEventDto,
  ConnectionDto,
  CredentialDto,
  DashboardDto,
  DashboardWidgetDto,
  FolderDto,
  HealthCheckDto,
  IncidentDto,
  MaintenanceWindowDto,
  NoteDto,
  SessionHistoryDto,
  TagDto
} from "../lib/api";
import type { DashboardGroupDto, DashboardResource } from "../../shared/types";

export type AppView = "dashboard" | "access" | "inventory" | "monitoring" | "vault" | "alerts";

export type V2Data = {
  dashboard: DashboardDto;
  resources: DashboardResource[];
  groups: DashboardGroupDto[];
  credentials: CredentialDto[];
  connections: ConnectionDto[];
  checks: HealthCheckDto[];
  widgets: DashboardWidgetDto[];
  incidents: IncidentDto[];
  sessionHistory: SessionHistoryDto[];
  folders: FolderDto[];
  tags: TagDto[];
  audit: AuditEventDto[];
  alertChannels: AlertChannelDto[];
  alertRules: AlertRuleDto[];
  alertDeliveries: AlertDeliveryDto[];
  maintenanceWindows: MaintenanceWindowDto[];
  notes: NoteDto[];
};

export const emptyV2Data: V2Data = {
  dashboard: { groups: [], ungroupedResources: [], layout: {} },
  resources: [],
  groups: [],
  credentials: [],
  connections: [],
  checks: [],
  widgets: [],
  incidents: [],
  sessionHistory: [],
  folders: [],
  tags: [],
  audit: [],
  alertChannels: [],
  alertRules: [],
  alertDeliveries: [],
  maintenanceWindows: [],
  notes: []
};
