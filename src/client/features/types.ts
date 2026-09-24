import type { DashboardGroupDto, DashboardResource } from "../lib/api";
import type { DashboardDto, HealthCheckDto } from "../lib/api";

export type AppView = "dashboard" | "services" | "notes" | "settings";

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
    integrations: [],
    apiWidgets: [],
    aiBriefing: null,
    dailyBriefing: {
      summary: {
        servicesTotal: 0,
        servicesOnline: 0,
        servicesOffline: 0,
        servicesUnknown: 0,
        hostsTotal: 0,
        hostsOffline: 0,
        hostsUnderPressure: 0,
        staleChecks: 0,
        unmonitoredServices: 0,
        pendingFailures: 0,
        pendingRecoveries: 0
      },
      offlineServices: [],
      recentChanges: [],
      hostsUnderPressure: [],
      staleChecks: [],
      unmonitoredServices: [],
      watchlist: []
    },
    layout: {}
  },
  resources: [],
  groups: [],
  checks: []
};
