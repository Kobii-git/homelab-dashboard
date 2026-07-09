import type {
  DailyBriefingDto,
  DashboardGroupDto,
  DashboardResource,
  HealthTick,
  AiBriefingDto,
  AiRuntimeDto,
  ApiWidgetDto,
  ApiWidgetSuggestionDto,
  ApiWidgetTemplateDto,
  HostMetricSampleDto,
  HostMonitorDto,
  IntegrationSourceDto
} from "../../shared/types";

export type HealthCheckDto = {
  id: string;
  resourceId: string;
  type: "http" | "tcp" | "ping" | "ssl";
  target: string;
  intervalSeconds: number;
  timeoutMs: number;
  enabled: boolean;
  latestStatus: "unknown" | "online" | "offline";
  latestLatencyMs: number | null;
  latestCheckedAt: string | null;
  latestError: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureThreshold: number;
  successThreshold: number;
  lastTransitionAt: string | null;
  resource?: DashboardResource;
  results?: HealthTick[];
};

export type DashboardDto = {
  groups: DashboardGroupDto[];
  ungroupedResources: DashboardResource[];
  hostMonitors: HostMonitorDto[];
  integrations: IntegrationSourceDto[];
  apiWidgets: ApiWidgetDto[];
  aiBriefing?: AiBriefingDto | null;
  dailyBriefing: DailyBriefingDto;
  layout: Record<string, unknown>;
};

export type SystemSettingsDto = {
  autoPingIntervalSeconds: number;
};

export type RuntimeStatusDto = {
  build: {
    version: string;
    gitSha: string;
    buildTime: string | null;
  };
  process: {
    nodeEnv: string;
    nodeVersion: string;
    platform: string;
    arch: string;
    host: string;
    port: number;
    uptimeSeconds: number;
    startedAt: string;
  };
  auth: {
    source: "env" | "database";
    cookieSecure: boolean;
  };
  database: {
    ok: boolean;
    url: string;
    counts: {
      groups: number;
      resources: number;
      healthChecks: number;
      healthResults: number;
      hostMonitors: number;
      hostMetricSamples: number;
      integrationSources: number;
      integrationSamples: number;
      apiWidgets: number;
      apiWidgetSamples: number;
    };
  };
  integrations: {
    opnsense: {
      enabled: boolean;
      configured: boolean;
      name: string;
      baseUrl: string | null;
      tlsVerify: boolean;
      pollIntervalSeconds: number;
    };
  };
  ai: AiRuntimeDto;
  schedulers: {
    health: SchedulerRuntimeDto;
    metrics: SchedulerRuntimeDto;
    integrations: SchedulerRuntimeDto;
    apiWidgets: SchedulerRuntimeDto;
    ai: SchedulerRuntimeDto;
  };
};

export type SchedulerRuntimeDto = {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastDueCount: number | null;
  lastDurationMs: number | null;
  skippedTickAt: string | null;
};

export type {
  ApiWidgetDto,
  ApiWidgetSuggestionDto,
  ApiWidgetTemplateDto,
  AiBriefingDto,
  AiRuntimeDto,
  DashboardGroupDto,
  DashboardResource,
  DailyBriefingDto,
  HostMetricSampleDto,
  HostMonitorDto,
  IntegrationSourceDto
};


type ApiErrorBody = {
  error?: string;
  details?: Array<{ path?: string; message?: string }>;
};

export function getApiError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: ApiErrorBody = {};

  if (text) {
    try {
      data = JSON.parse(text) as ApiErrorBody;
    } catch {
      data = { error: text || "Request failed" };
    }
  }

  if (!response.ok) {
    const details = data.details?.length
      ? `: ${data.details.map((item) => (item.path ? `${item.path} — ${item.message}` : item.message)).join("; ")}`
      : "";
    throw new Error(`${data.error ?? "Request failed"}${details}`);
  }

  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      credentials: "include"
    })
  );
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
  );
}

export function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}
