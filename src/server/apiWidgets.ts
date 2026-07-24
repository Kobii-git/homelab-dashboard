import { Prisma, type ApiWidget, type ApiWidgetSample, type PrismaClient, type Resource } from "@prisma/client";
import type {
  ApiWidgetDto,
  ApiWidgetFieldDto,
  ApiWidgetFieldMappingDto,
  ApiWidgetSnapshotDto,
  ApiWidgetSuggestionDto,
  ApiWidgetTemplateDto,
  HealthStatus
} from "../shared/types.js";
import type { SchedulerUpdate } from "./healthChecks.js";
import { boundedJsonRequest } from "./httpJson.js";
import { assertApiWidgetSecretBinding } from "./apiWidgetBindings.js";

export const API_WIDGET_SAMPLE_RETENTION = 1440;

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 2_000_000;

type ApiWidgetWithSamples = ApiWidget & {
  samples?: ApiWidgetSample[];
};

type ApiWidgetOutcome = {
  status: "online" | "offline";
  error?: string;
  snapshot?: ApiWidgetSnapshotDto;
};

type ApiWidgetSuggestionResource = Pick<Resource, "id" | "name" | "url" | "description" | "icon" | "host">;
type ApiWidgetSuggestionExistingWidget = Pick<ApiWidget, "templateId" | "baseUrl">;

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  tlsVerify?: boolean;
  credentialed?: boolean;
};

export const apiWidgetTemplates: ApiWidgetTemplateDto[] = [
  {
    id: "custom-json",
    name: "Custom JSON API",
    app: "Custom",
    description: "Read a JSON endpoint and display mapped fields.",
    docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    authType: "none",
    authHeaderName: null,
    authEnvVarHint: null,
    authValuePrefix: null,
    endpointPath: "/",
    fieldMappings: [{ label: "Status", path: "status", kind: "text" }]
  },
  {
    id: "home-assistant",
    name: "Home Assistant states",
    app: "Home Assistant",
    description: "Counts entities from the REST states endpoint.",
    docsUrl: "https://developers.home-assistant.io/docs/api/rest/",
    authType: "bearer",
    authHeaderName: "Authorization",
    authEnvVarHint: "HOME_ASSISTANT_TOKEN",
    authValuePrefix: null,
    endpointPath: "/api/states",
    fieldMappings: [{ label: "Entities", path: "", kind: "count" }]
  },
  {
    id: "proxmox",
    name: "Proxmox resources",
    app: "Proxmox VE",
    description: "Counts cluster resources from the Proxmox API.",
    docsUrl: "https://pve.proxmox.com/pve-docs/api-viewer/",
    authType: "header",
    authHeaderName: "Authorization",
    authEnvVarHint: "PROXMOX_API_TOKEN",
    authValuePrefix: "PVEAPIToken ",
    endpointPath: "/api2/json/cluster/resources",
    fieldMappings: [{ label: "Resources", path: "data", kind: "count" }]
  },
  {
    id: "portainer",
    name: "Portainer status",
    app: "Portainer",
    description: "Displays Portainer API status metadata.",
    docsUrl: "https://docs.portainer.io/api/docs",
    authType: "none",
    authHeaderName: null,
    authEnvVarHint: null,
    authValuePrefix: null,
    endpointPath: "/api/status",
    fieldMappings: [
      { label: "Version", path: "Version", kind: "text" },
      { label: "Edition", path: "Edition", kind: "text" }
    ]
  },
  {
    id: "adguard-home",
    name: "AdGuard Home stats",
    app: "AdGuard Home",
    description: "Displays DNS query and blocking counters.",
    docsUrl: "https://github.com/AdguardTeam/AdGuardHome/tree/master/openapi",
    authType: "basic",
    authHeaderName: "Authorization",
    authEnvVarHint: "ADGUARD_BASIC_AUTH",
    authValuePrefix: null,
    endpointPath: "/control/stats",
    fieldMappings: [
      { label: "Queries", path: "num_dns_queries", kind: "number" },
      { label: "Blocked", path: "num_blocked_filtering", kind: "number" },
      { label: "Avg", path: "avg_processing_time", kind: "duration" }
    ]
  },
  {
    id: "pihole-v6",
    name: "Pi-hole v6 summary",
    app: "Pi-hole",
    description: "Authenticates with Pi-hole v6 and reads the summary endpoint.",
    docsUrl: "https://docs.pi-hole.net/api/",
    authType: "pihole",
    authHeaderName: null,
    authEnvVarHint: "PIHOLE_PASSWORD",
    authValuePrefix: null,
    endpointPath: "/api/stats/summary",
    fieldMappings: [
      { label: "Queries", path: "queries.total", kind: "number" },
      { label: "Blocked", path: "queries.blocked", kind: "number" },
      { label: "Gravity", path: "gravity.domains_being_blocked", kind: "number" }
    ]
  },
  {
    id: "jellyfin",
    name: "Jellyfin system",
    app: "Jellyfin",
    description: "Displays Jellyfin system information using an API key.",
    docsUrl: "https://api.jellyfin.org/",
    authType: "header",
    authHeaderName: "X-Emby-Token",
    authEnvVarHint: "JELLYFIN_API_KEY",
    authValuePrefix: null,
    endpointPath: "/System/Info",
    fieldMappings: [
      { label: "Server", path: "ServerName", kind: "text" },
      { label: "Version", path: "Version", kind: "text" }
    ]
  },
  {
    id: "grafana",
    name: "Grafana health",
    app: "Grafana",
    description: "Reads Grafana HTTP API health.",
    docsUrl: "https://grafana.com/docs/grafana/latest/developers/http_api/",
    authType: "none",
    authHeaderName: null,
    authEnvVarHint: null,
    authValuePrefix: null,
    endpointPath: "/api/health",
    fieldMappings: [
      { label: "Database", path: "database", kind: "text" },
      { label: "Version", path: "version", kind: "text" }
    ]
  },
  {
    id: "prometheus",
    name: "Prometheus up query",
    app: "Prometheus",
    description: "Runs a simple HTTP API query and counts returned series.",
    docsUrl: "https://prometheus.io/docs/prometheus/latest/querying/api/",
    authType: "none",
    authHeaderName: null,
    authEnvVarHint: null,
    authValuePrefix: null,
    endpointPath: "/api/v1/query?query=up",
    fieldMappings: [
      { label: "Status", path: "status", kind: "text" },
      { label: "Series", path: "data.result", kind: "count" }
    ]
  },
  {
    id: "sonarr",
    name: "Sonarr status",
    app: "Sonarr",
    description: "Displays Sonarr system status.",
    docsUrl: "https://sonarr.tv/docs/api/",
    authType: "header",
    authHeaderName: "X-Api-Key",
    authEnvVarHint: "SONARR_API_KEY",
    authValuePrefix: null,
    endpointPath: "/api/v3/system/status",
    fieldMappings: [
      { label: "Version", path: "version", kind: "text" },
      { label: "Branch", path: "branch", kind: "text" }
    ]
  },
  {
    id: "radarr",
    name: "Radarr status",
    app: "Radarr",
    description: "Displays Radarr system status.",
    docsUrl: "https://radarr.video/docs/api/",
    authType: "header",
    authHeaderName: "X-Api-Key",
    authEnvVarHint: "RADARR_API_KEY",
    authValuePrefix: null,
    endpointPath: "/api/v3/system/status",
    fieldMappings: [
      { label: "Version", path: "version", kind: "text" },
      { label: "Branch", path: "branch", kind: "text" }
    ]
  }
];

const BUILT_IN_SECRET_NAMES = new Set(
  apiWidgetTemplates.flatMap((template) => template.authEnvVarHint ? [template.authEnvVarHint] : [])
);
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_HEADERS = new Set([
  "connection", "content-length", "cookie", "host", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"
]);

export function isApiWidgetSecretAllowed(name: string | null | undefined, allowlist: readonly string[]): boolean {
  return !name || BUILT_IN_SECRET_NAMES.has(name) || allowlist.includes(name);
}

function assertSafeWidgetConfiguration(widget: Pick<ApiWidget, "authEnvVar" | "authHeaderName">, allowlist: readonly string[]) {
  if (!isApiWidgetSecretAllowed(widget.authEnvVar, allowlist)) {
    throw new Error("API widget secret environment variable is not allowlisted");
  }
  if (widget.authHeaderName) {
    const lower = widget.authHeaderName.toLowerCase();
    if (!HTTP_TOKEN.test(widget.authHeaderName) || FORBIDDEN_HEADERS.has(lower) || lower.startsWith("proxy-")) {
      throw new Error("API widget header name is not permitted");
    }
  }
}

const suggestionTemplateAliases: Array<{ templateId: string; aliases: string[] }> = [
  { templateId: "home-assistant", aliases: ["home assistant", "homeassistant", "home-assistant", "hass"] },
  { templateId: "proxmox", aliases: ["proxmox", "proxmox ve", "pve"] },
  { templateId: "portainer", aliases: ["portainer"] },
  { templateId: "adguard-home", aliases: ["adguard", "adguard home", "adguardhome"] },
  { templateId: "pihole-v6", aliases: ["pi-hole", "pihole", "pi hole"] },
  { templateId: "jellyfin", aliases: ["jellyfin"] },
  { templateId: "grafana", aliases: ["grafana"] },
  { templateId: "prometheus", aliases: ["prometheus"] },
  { templateId: "sonarr", aliases: ["sonarr"] },
  { templateId: "radarr", aliases: ["radarr"] }
];

export function apiWidgetTemplateById(id: string | null | undefined): ApiWidgetTemplateDto {
  return apiWidgetTemplates.find((template) => template.id === id) ?? apiWidgetTemplates[0];
}

export function sanitizeApiWidgetError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer redacted")
      .replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic redacted")
      .replace(/sid=[^&\s]+/g, "sid=redacted");
  }
  return "API widget request failed";
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function normalizedSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function baseUrlFromResource(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    parsed.search = "";
    return normalizedBaseUrl(parsed.toString());
  } catch {
    return null;
  }
}

function resourceSearchText(resource: ApiWidgetSuggestionResource): string {
  const parts = [
    resource.name,
    resource.description,
    resource.icon,
    resource.host,
    resource.url
  ].filter((part): part is string => Boolean(part));

  if (resource.url) {
    try {
      const parsed = new URL(resource.url);
      parts.push(parsed.hostname, parsed.pathname);
    } catch {
      // Invalid or non-HTTP service URLs are ignored by suggestion creation.
    }
  }

  return normalizedSearchText(parts.join(" "));
}

function matchesAlias(haystack: string, alias: string): boolean {
  const needle = normalizedSearchText(alias);
  if (!needle) return false;
  const padded = ` ${haystack} `;
  return padded.includes(` ${needle} `);
}

function suggestionKey(templateId: string, baseUrl: string): string {
  return `${templateId}:${normalizedBaseUrl(baseUrl).toLowerCase()}`;
}

export function suggestApiWidgets(
  resources: ApiWidgetSuggestionResource[],
  existingWidgets: ApiWidgetSuggestionExistingWidget[]
): ApiWidgetSuggestionDto[] {
  const existing = new Set(existingWidgets.map((widget) => suggestionKey(widget.templateId, widget.baseUrl)));
  const suggestions: ApiWidgetSuggestionDto[] = [];

  for (const resource of resources) {
    const baseUrl = baseUrlFromResource(resource.url);
    if (!baseUrl) continue;

    const haystack = resourceSearchText(resource);
    for (const match of suggestionTemplateAliases) {
      const matchedAlias = match.aliases.find((alias) => matchesAlias(haystack, alias));
      if (!matchedAlias) continue;
      if (existing.has(suggestionKey(match.templateId, baseUrl))) continue;

      const template = apiWidgetTemplateById(match.templateId);
      suggestions.push({
        id: `${resource.id}:${template.id}`,
        resourceId: resource.id,
        resourceName: resource.name,
        templateId: template.id,
        templateName: template.name,
        app: template.app,
        baseUrl,
        endpointPath: template.endpointPath,
        authType: template.authType,
        authHeaderName: template.authHeaderName,
        authEnvVarHint: template.authEnvVarHint,
        authValuePrefix: template.authValuePrefix,
        fieldMappings: template.fieldMappings,
        reason: `Matched ${template.app} from "${matchedAlias}".`
      });
    }
  }

  return suggestions;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function valueAtPath(source: unknown, path: string): unknown {
  const trimmed = path.trim().replace(/^\$\.?/, "");
  if (!trimmed) return source;

  return trimmed
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current == null) return undefined;
      if (part === "length") {
        return Array.isArray(current) || typeof current === "string" ? current.length : undefined;
      }
      if (Array.isArray(current)) {
        const index = Number(part);
        return Number.isInteger(index) ? current[index] : undefined;
      }
      return asRecord(current)[part];
    }, source);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function displayValue(value: unknown, kind: ApiWidgetFieldDto["kind"]): { value: string; rawValue: string | number | boolean | null } {
  if (kind === "count") {
    const count = Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value).length
        : numberValue(value);
    return { value: count == null ? "-" : String(count), rawValue: count };
  }

  if (kind === "percent") {
    const number = numberValue(value);
    return { value: number == null ? "-" : `${Math.round(number * 10) / 10}%`, rawValue: number };
  }

  if (kind === "bytes") {
    const number = numberValue(value);
    return { value: number == null ? "-" : formatBytes(number), rawValue: number };
  }

  if (kind === "duration") {
    const number = numberValue(value);
    return { value: number == null ? "-" : `${Math.round(number * 1000)} ms`, rawValue: number };
  }

  if (kind === "number") {
    const number = numberValue(value);
    return { value: number == null ? "-" : String(Math.round(number * 100) / 100), rawValue: number };
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { value: String(value), rawValue: value };
  }
  if (value == null) {
    return { value: "-", rawValue: null };
  }
  return { value: JSON.stringify(value), rawValue: null };
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current >= 10 ? Math.round(current) : Math.round(current * 10) / 10} ${units[unit]}`;
}

function normalizeMappings(value: Prisma.JsonValue | unknown): ApiWidgetFieldMappingDto[] {
  if (!Array.isArray(value)) return apiWidgetTemplates[0].fieldMappings;
  return value.map((item) => {
    const record = asRecord(item);
    return {
      label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : "Value",
      path: typeof record.path === "string" ? record.path : "",
      suffix: typeof record.suffix === "string" ? record.suffix : null,
      kind: ["text", "number", "percent", "bytes", "duration", "count"].includes(`${record.kind}`)
        ? record.kind as ApiWidgetFieldMappingDto["kind"]
        : "text"
    };
  });
}

function buildUrl(baseUrl: string, endpointPath: string): URL {
  const normalizedEndpoint = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  return new URL(normalizedEndpoint, normalizedBaseUrl(baseUrl));
}

async function requestJson(baseUrl: string, endpointPath: string, options: RequestOptions = {}): Promise<unknown> {
  const url = buildUrl(baseUrl, endpointPath);
  return boundedJsonRequest(url, {
    method: options.method,
    body: options.body,
    headers: options.headers,
    tlsVerify: options.tlsVerify,
    credentialed: options.credentialed,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    label: "API widget"
  });
}

function authHeaders(widget: ApiWidget, allowlist: readonly string[]): Record<string, string> {
  assertSafeWidgetConfiguration(widget, allowlist);
  if (widget.authType === "none" || widget.authType === "pihole") return {};
  if (!widget.authEnvVar) throw new Error("API widget auth env var is not configured");
  const secret = process.env[widget.authEnvVar];
  if (!secret) throw new Error(`API widget auth env var ${widget.authEnvVar} is not set`);

  if (widget.authType === "bearer") {
    return { Authorization: `Bearer ${secret}` };
  }
  if (widget.authType === "basic") {
    return { Authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
  }
  const header = widget.authHeaderName || "Authorization";
  return { [header]: `${widget.authValuePrefix ?? ""}${secret}` };
}

async function requestWidgetData(widget: ApiWidget, allowlist: readonly string[]): Promise<unknown> {
  assertSafeWidgetConfiguration(widget, allowlist);
  if (widget.authType !== "pihole") {
    return requestJson(widget.baseUrl, widget.endpointPath, {
      headers: authHeaders(widget, allowlist),
      tlsVerify: widget.tlsVerify,
      credentialed: widget.authType !== "none"
    });
  }

  if (!widget.authEnvVar) throw new Error("Pi-hole password env var is not configured");
  const password = process.env[widget.authEnvVar];
  if (!password) throw new Error(`Pi-hole password env var ${widget.authEnvVar} is not set`);

  const auth = await requestJson(widget.baseUrl, "/api/auth", {
    method: "POST",
    body: { password },
    tlsVerify: widget.tlsVerify,
    credentialed: true
  });
  const sid = valueAtPath(auth, "session.sid");
  if (typeof sid !== "string" || !sid) {
    throw new Error("Pi-hole auth did not return a session id");
  }

  const endpoint = buildUrl(widget.baseUrl, widget.endpointPath);
  endpoint.searchParams.set("sid", sid);

  try {
    return await requestJson(endpoint.origin, `${endpoint.pathname}${endpoint.search}`, {
      tlsVerify: widget.tlsVerify,
      credentialed: true
    });
  } finally {
    try {
      await requestJson(widget.baseUrl, `/api/auth?sid=${encodeURIComponent(sid)}`, {
        method: "DELETE",
        tlsVerify: widget.tlsVerify,
        credentialed: true
      });
    } catch {
      // Logout is best-effort; the session will expire server-side.
    }
  }
}

function buildSnapshot(widget: ApiWidget, raw: unknown): ApiWidgetSnapshotDto {
  const mappings = normalizeMappings(widget.fieldMappings);
  const fields = mappings.map((mapping): ApiWidgetFieldDto => {
    const kind = mapping.kind ?? "text";
    const displayed = displayValue(valueAtPath(raw, mapping.path), kind);
    return {
      label: mapping.label,
      value: displayed.value,
      rawValue: displayed.rawValue,
      suffix: mapping.suffix ?? null,
      kind
    };
  });

  return {
    provider: "api-widget",
    templateId: widget.templateId,
    status: "online",
    sampledAt: new Date().toISOString(),
    title: widget.name,
    summary: fields.length > 0 ? `${fields[0].label}: ${fields[0].value}${fields[0].suffix ?? ""}` : null,
    fields
  };
}

export async function collectApiWidgetSnapshot(widget: ApiWidget, allowlist: readonly string[] = []): Promise<ApiWidgetOutcome> {
  try {
    const raw = await requestWidgetData(widget, allowlist);
    return {
      status: "online",
      snapshot: buildSnapshot(widget, raw)
    };
  } catch (error) {
    return {
      status: "offline",
      error: sanitizeApiWidgetError(error)
    };
  }
}

export async function runApiWidgetSample(
  prisma: PrismaClient,
  widget: ApiWidget,
  allowlist: readonly string[] = []
): Promise<ApiWidgetOutcome> {
  let outcome: ApiWidgetOutcome;
  try {
    await assertApiWidgetSecretBinding(prisma, widget);
    outcome = await collectApiWidgetSnapshot(widget, allowlist);
  } catch (error) {
    outcome = {
      status: "offline",
      error: sanitizeApiWidgetError(error)
    };
  }
  const snapshotJson = outcome.snapshot
    ? outcome.snapshot as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull;
  const sampledAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.apiWidgetSample.create({
      data: {
        widgetId: widget.id,
        status: outcome.status,
        error: outcome.error ?? null,
        snapshot: snapshotJson
      }
    });

    await tx.apiWidget.update({
      where: { id: widget.id },
      data: {
        latestStatus: outcome.status,
        latestError: outcome.error ?? null,
        latestSnapshot: snapshotJson,
        latestSampledAt: sampledAt
      }
    });

    const stale = await tx.apiWidgetSample.findMany({
      where: { widgetId: widget.id },
      orderBy: { sampledAt: "desc" },
      skip: API_WIDGET_SAMPLE_RETENTION,
      select: { id: true }
    });

    if (stale.length > 0) {
      await tx.apiWidgetSample.deleteMany({
        where: { id: { in: stale.map((sample) => sample.id) } }
      });
    }
  });

  return outcome;
}

function snapshotFromJson(value: Prisma.JsonValue | null): ApiWidgetSnapshotDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as ApiWidgetSnapshotDto;
}

export function toApiWidgetDto(widget: ApiWidgetWithSamples): ApiWidgetDto {
  return {
    id: widget.id,
    name: widget.name,
    templateId: widget.templateId,
    baseUrl: widget.baseUrl,
    endpointPath: widget.endpointPath,
    authType: widget.authType as ApiWidgetDto["authType"],
    authHeaderName: widget.authHeaderName,
    authEnvVar: widget.authEnvVar,
    authValuePrefix: widget.authValuePrefix,
    tlsVerify: widget.tlsVerify,
    fieldMappings: normalizeMappings(widget.fieldMappings),
    enabled: widget.enabled,
    pollIntervalSeconds: widget.pollIntervalSeconds,
    sortOrder: widget.sortOrder,
    latestStatus: widget.latestStatus as HealthStatus,
    latestError: widget.latestError,
    latestSnapshot: snapshotFromJson(widget.latestSnapshot),
    latestSampledAt: widget.latestSampledAt?.toISOString() ?? null,
    samples: widget.samples?.map((sample) => ({
      id: sample.id,
      widgetId: sample.widgetId,
      status: sample.status as HealthStatus,
      error: sample.error,
      snapshot: snapshotFromJson(sample.snapshot),
      sampledAt: sample.sampledAt.toISOString()
    }))
  };
}

export function startApiWidgetScheduler(
  prisma: PrismaClient,
  intervalMs = 15_000,
  observer?: (update: SchedulerUpdate) => void,
  allowlist: readonly string[] = []
): () => void {
  let running = false;

  const tick = async () => {
    if (running) {
      observer?.({ skippedTickAt: new Date() });
      return;
    }

    const startedAt = Date.now();
    running = true;
    observer?.({ running: true, lastTickAt: new Date(), lastError: null });

    try {
      const widgets = await prisma.apiWidget.findMany({ where: { enabled: true } });
      const now = Date.now();
      const due = widgets.filter((widget) =>
        !widget.latestSampledAt ||
        now - widget.latestSampledAt.getTime() >= widget.pollIntervalSeconds * 1000
      );

      observer?.({ lastDueCount: due.length });
      for (let index = 0; index < due.length; index += 8) {
        await Promise.allSettled(due.slice(index, index + 8).map((widget) => runApiWidgetSample(prisma, widget, allowlist)));
      }
      observer?.({
        running: false,
        lastCompletedAt: new Date(),
        lastDurationMs: Date.now() - startedAt,
        lastError: null
      });
    } catch (error) {
      observer?.({
        running: false,
        lastCompletedAt: new Date(),
        lastDurationMs: Date.now() - startedAt,
        lastError: sanitizeApiWidgetError(error)
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  return () => clearInterval(timer);
}
