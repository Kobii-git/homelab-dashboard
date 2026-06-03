import type { DashboardGroupDto, DashboardResource } from "../../shared/types";
import type {
  AlertChannelDto,
  AlertDeliveryDto,
  AlertRuleDto,
  AuditEventDto,
  DashboardWidgetDto,
  FolderDto,
  IncidentDto,
  NoteDto,
  SearchResultDto,
  SessionHistoryDto,
  TagDto
} from "../../shared/types";

export type CredentialDto = {
  id: string;
  label: string;
  username: string | null;
  notes?: string | null;
  folderId?: string | null;
  lastUsedAt?: string | null;
  tags?: TagDto[];
};

export type ConnectionDto = {
  id: string;
  resourceId: string;
  type: "rdp" | "ssh";
  name: string | null;
  host: string;
  port: number;
  usernameHint: string | null;
  credentialId: string | null;
  notes?: string | null;
  favorite?: boolean;
  folderId?: string | null;
  lastLaunchedAt?: string | null;
  sortOrder: number;
  tags?: TagDto[];
  resource?: DashboardResource;
  credential?: CredentialDto | null;
};

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
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  failureThreshold?: number;
  successThreshold?: number;
  lastTransitionAt?: string | null;
  resource?: DashboardResource;
  results?: HealthResultDto[];
};

export type HealthResultDto = {
  id: string;
  checkId: string;
  status: "unknown" | "online" | "offline";
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
};

export type MaintenanceWindowDto = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  scope: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardDto = {
  groups: DashboardGroupDto[];
  ungroupedResources: DashboardResource[];
  layout: Record<string, unknown>;
};

export type SessionLaunchDto = {
  token: string;
  displayName: string;
  websocketPath: string;
  sessionHistory?: SessionHistoryDto;
};

export type {
  AlertChannelDto,
  AlertDeliveryDto,
  AlertRuleDto,
  AuditEventDto,
  DashboardWidgetDto,
  FolderDto,
  IncidentDto,
  NoteDto,
  SearchResultDto,
  SessionHistoryDto,
  TagDto
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
