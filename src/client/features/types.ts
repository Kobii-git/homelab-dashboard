import type {
  AlertChannelDto,
  AlertDeliveryDto,
  AlertRuleDto,
  DashboardDto,
  DashboardWidgetDto,
  HealthCheckDto,
  IncidentDto,
  MaintenanceWindowDto,
  NoteDto,
  TagDto
} from "../lib/api";
import type { DashboardGroupDto, DashboardResource } from "../../shared/types";

export type AppView = "dashboard" | "inventory" | "monitoring" | "alerts" | "settings";

export type V2Data = {
  dashboard: DashboardDto;
  resources: DashboardResource[];
  groups: DashboardGroupDto[];
  checks: HealthCheckDto[];
  widgets: DashboardWidgetDto[];
  incidents: IncidentDto[];
  tags: TagDto[];
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
  checks: [],
  widgets: [],
  incidents: [],
  tags: [],
  alertChannels: [],
  alertRules: [],
  alertDeliveries: [],
  maintenanceWindows: [],
  notes: []
};
