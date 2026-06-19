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
  dashboard: {
    groups: [],
    ungroupedResources: [],
    hostMonitors: [],
    dailyBriefing: {
      offlineServices: [],
      recentChanges: [],
      hostsUnderPressure: [],
      staleChecks: [],
      unmonitoredServices: []
    },
    layout: {}
  },
  resources: [],
  groups: [],
  checks: []
};
