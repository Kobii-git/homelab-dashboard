import type { DashboardGroupDto, DashboardResource } from "../lib/api";
import type { DashboardDto, HealthCheckDto } from "../lib/api";

export type AppView = "dashboard" | "services" | "settings";

export type AppData = {
  dashboard: DashboardDto;
  resources: DashboardResource[];
  groups: DashboardGroupDto[];
  checks: HealthCheckDto[];
};

export const emptyAppData: AppData = {
  dashboard: { groups: [], ungroupedResources: [], layout: {} },
  resources: [],
  groups: [],
  checks: []
};
