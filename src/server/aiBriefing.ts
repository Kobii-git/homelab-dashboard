import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type {
  AiBriefingActionDto,
  AiBriefingDto,
  AiBriefingItemDto,
  AiRuntimeDto,
  ApiWidgetDto,
  DailyBriefingDto,
  HostMonitorDto,
  IntegrationSourceDto
} from "../shared/types.js";
import type { AiEnvConfig } from "./env.js";
import { type SchedulerUpdate } from "./healthChecks.js";
import { toHostMonitorDto } from "./metrics.js";
import { toIntegrationSourceDto } from "./opnsense.js";
import { toApiWidgetDto } from "./apiWidgets.js";
import { buildDailyBriefing, resourceStatus } from "./dailyBriefing.js";
import { boundedJsonRequest } from "./httpJson.js";

export const AI_BRIEFING_CACHE_KEY = "ai_briefing_cache";
export const AI_SCHEDULER_INTERVAL_MS = 60_000;

const AI_REQUEST_TIMEOUT_MS = 20_000;
const AI_MAX_RESPONSE_BYTES = 3_000_000;
const MAX_AI_ITEMS = 6;
const MAX_AI_ACTIONS = 5;

const severitySchema = z.enum(["ok", "notice", "warning", "critical"]);
const confidenceSchema = z.enum(["low", "medium", "high"]);
const statusSchema = z.enum(["disabled", "unconfigured", "ready", "fresh", "cached", "error"]);
const shortText = (fallback: string, max = 240) =>
  z.string().trim().transform((value) => value ? value.slice(0, max) : fallback);

const aiModelOutputSchema = z.object({
  severity: severitySchema.catch("notice"),
  headline: shortText("AI briefing generated", 180),
  summary: shortText("The AI briefing did not include a summary.", 1400),
  items: z.array(z.object({
    title: shortText("Observation", 160),
    body: shortText("No detail provided.", 600),
    severity: severitySchema.catch("notice"),
    evidenceIds: z.array(z.string().trim().min(1).max(160)).max(12).catch([])
  })).max(MAX_AI_ITEMS).catch([]),
  nextActions: z.array(z.object({
    label: shortText("Review dashboard", 160),
    resourceId: z.string().trim().min(1).max(160).optional().nullable(),
    checkId: z.string().trim().min(1).max(160).optional().nullable(),
    integrationId: z.string().trim().min(1).max(160).optional().nullable(),
    widgetId: z.string().trim().min(1).max(160).optional().nullable()
  })).max(MAX_AI_ACTIONS).catch([]),
  confidence: confidenceSchema.catch("low")
});

const cachedAiBriefingSchema = z.object({
  status: statusSchema,
  severity: severitySchema,
  generatedAt: z.string().nullable(),
  headline: z.string(),
  summary: z.string(),
  items: z.array(z.object({
    title: z.string(),
    body: z.string(),
    severity: severitySchema,
    evidenceIds: z.array(z.string())
  })),
  nextActions: z.array(z.object({
    label: z.string(),
    resourceId: z.string().optional().nullable(),
    checkId: z.string().optional().nullable(),
    integrationId: z.string().optional().nullable(),
    widgetId: z.string().optional().nullable()
  })),
  confidence: confidenceSchema,
  model: z.string().nullable(),
  stale: z.boolean(),
  error: z.string().nullable()
});

type AiEvidenceResource = {
  id: string;
  evidenceId: string;
  name: string;
  kind: string;
  status: "online" | "offline" | "unknown";
  favorite: boolean;
  monitoringMode: string;
  manualStatus: string | null;
  address: string | null;
  checks: Array<{
    id: string;
    evidenceId: string;
    type: string;
    target: string | null;
    enabled: boolean;
    primary: boolean;
    status: string;
    latencyMs: number | null;
    checkedAt: string | null;
    error: string | null;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    failureThreshold: number;
    successThreshold: number;
    lastTransitionAt: string | null;
  }>;
};

export type AiBriefingEvidence = {
  capturedAt: string;
  privacy: {
    includeTargets: boolean;
    targetPolicy: string;
  };
  summary: DailyBriefingDto["summary"];
  dailyBriefing: {
    offlineServices: DailyBriefingDto["offlineServices"];
    recentChanges: DailyBriefingDto["recentChanges"];
    hostsUnderPressure: DailyBriefingDto["hostsUnderPressure"];
    staleChecks: Array<Omit<DailyBriefingDto["staleChecks"][number], "target"> & { target: string | null }>;
    unmonitoredServices: DailyBriefingDto["unmonitoredServices"];
    watchlist: Array<Omit<DailyBriefingDto["watchlist"][number], "target"> & { target: string | null; error: string | null }>;
  };
  resources: AiEvidenceResource[];
  hostMonitors: Array<{
    id: string;
    evidenceId: string;
    name: string;
    baseUrl: string | null;
    status: string;
    error: string | null;
    sampledAt: string | null;
    cpuPercent: number | null;
    memoryPercent: number | null;
    diskPercent: number | null;
    temperatureC: number | null;
    containersRunning: number | null;
    containersTotal: number | null;
  }>;
  integrations: Array<{
    id: string;
    evidenceId: string;
    provider: string;
    name: string;
    baseUrl: string | null;
    status: string;
    error: string | null;
    sampledAt: string | null;
    warnings: string[];
    system: {
      cpuPercent: number | null;
      memoryPercent: number | null;
      diskPercent: number | null;
      temperatureC: number | null;
    } | null;
    firmware: {
      version: string | null;
      latestVersion: string | null;
      updateAvailable: boolean | null;
      needsReboot: boolean | null;
    } | null;
    gateways: {
      total: number;
      online: number;
      offline: number;
      unknown: number;
    };
    interfaces: {
      total: number;
      online: number;
      offline: number;
      unknown: number;
      trafficBytesPerSec: number | null;
    };
  }>;
  apiWidgets: Array<{
    id: string;
    evidenceId: string;
    name: string;
    templateId: string;
    endpoint: string | null;
    status: string;
    error: string | null;
    sampledAt: string | null;
    summary: string | null;
    fields: Array<{ label: string; value: string; kind: string }>;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeAiText(value: string | null | undefined, includeTargets: boolean): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  let sanitized = trimmed
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer redacted")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic redacted")
    .replace(/sid=[^&\s]+/gi, "sid=redacted")
    .replace(/(api[_-]?key|api[_-]?secret|token|password)=([^&\s]+)/gi, "$1=redacted");

  if (!includeTargets) {
    sanitized = sanitized
      .replace(/https?:\/\/[^\s")]+/gi, "redacted-url")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "redacted-ip")
      .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){2,7}\b/gi, "redacted-ip");
  }

  return sanitized.slice(0, 700);
}

export function sanitizeAiBriefingError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return sanitizeAiText(error.message, false) ?? "AI briefing failed";
  }
  return "AI briefing failed";
}

function generatedAtDate(briefing: AiBriefingDto): Date | null {
  if (!briefing.generatedAt) return null;
  const date = new Date(briefing.generatedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isAiBriefingStale(briefing: AiBriefingDto, config: AiEnvConfig): boolean {
  const generatedAt = generatedAtDate(briefing);
  if (!generatedAt) return false;
  return Date.now() - generatedAt.getTime() >= config.briefingIntervalSeconds * 1000;
}

export function isAiBriefingDue(briefing: AiBriefingDto | null, config: AiEnvConfig): boolean {
  if (!config.configured) return false;
  if (!briefing || !briefing.generatedAt) return true;
  return isAiBriefingStale(briefing, config);
}

function withFreshness(briefing: AiBriefingDto, config: AiEnvConfig, status: AiBriefingDto["status"] = "cached"): AiBriefingDto {
  const nextStatus = briefing.status === "error" ? "error" : status;
  return {
    ...briefing,
    status: nextStatus,
    model: briefing.model ?? config.model,
    stale: isAiBriefingStale(briefing, config)
  };
}

function syntheticBriefing(
  config: AiEnvConfig,
  status: AiBriefingDto["status"],
  headline: string,
  summary: string,
  severity: AiBriefingDto["severity"],
  error: string | null = null
): AiBriefingDto {
  return {
    status,
    severity,
    generatedAt: null,
    headline,
    summary,
    items: [],
    nextActions: [],
    confidence: "low",
    model: config.model,
    stale: false,
    error
  };
}

function disabledBriefing(config: AiEnvConfig): AiBriefingDto {
  return syntheticBriefing(
    config,
    "disabled",
    "AI briefing is disabled",
    "Set AI_ENABLED=true and provide AI_MODEL to enable command briefings.",
    "notice"
  );
}

function unconfiguredBriefing(config: AiEnvConfig): AiBriefingDto {
  const missing = [
    config.baseUrl ? null : "AI_BASE_URL",
    config.model ? null : "AI_MODEL"
  ].filter((item): item is string => Boolean(item));
  return syntheticBriefing(
    config,
    "unconfigured",
    "AI briefing is missing configuration",
    `Set ${missing.join(" and ") || "the required AI environment variables"} before running command briefings.`,
    "warning",
    "AI briefing is not configured"
  );
}

function readyBriefing(config: AiEnvConfig): AiBriefingDto {
  return syntheticBriefing(
    config,
    "ready",
    "Command briefing is ready",
    "No AI briefing has been generated yet. Run a briefing to summarize current lab signals.",
    "notice"
  );
}

function errorBriefing(config: AiEnvConfig, error: unknown): AiBriefingDto {
  const message = sanitizeAiBriefingError(error);
  return {
    status: "error",
    severity: "warning",
    generatedAt: new Date().toISOString(),
    headline: "AI briefing could not be generated",
    summary: "The deterministic dashboard data is still available. Check the AI runtime settings and provider endpoint before trying again.",
    items: [],
    nextActions: [{ label: "Review AI settings" }],
    confidence: "low",
    model: config.model,
    stale: false,
    error: message
  };
}

async function saveCachedAiBriefing(prisma: PrismaClient, briefing: AiBriefingDto): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: AI_BRIEFING_CACHE_KEY },
    update: { value: JSON.stringify(briefing) },
    create: { key: AI_BRIEFING_CACHE_KEY, value: JSON.stringify(briefing) }
  });
}

export async function getCachedAiBriefing(prisma: PrismaClient, config: AiEnvConfig): Promise<AiBriefingDto | null> {
  const entry = await prisma.systemConfig.findUnique({ where: { key: AI_BRIEFING_CACHE_KEY } });
  if (!entry?.value) return null;

  try {
    const parsed = cachedAiBriefingSchema.parse(JSON.parse(entry.value));
    return withFreshness(parsed, config);
  } catch {
    return null;
  }
}

export async function getAiBriefing(prisma: PrismaClient, config: AiEnvConfig): Promise<AiBriefingDto> {
  const cached = await getCachedAiBriefing(prisma, config);
  if (cached) return cached;
  if (!config.enabled) return disabledBriefing(config);
  if (!config.configured) return unconfiguredBriefing(config);
  return readyBriefing(config);
}

export async function getDashboardAiBriefing(prisma: PrismaClient, config: AiEnvConfig): Promise<AiBriefingDto | null> {
  const cached = await getCachedAiBriefing(prisma, config);
  if (cached) return cached;
  return config.configured ? readyBriefing(config) : null;
}

export function aiRuntimeConfig(config: AiEnvConfig, briefing: AiBriefingDto | null): AiRuntimeDto {
  return {
    enabled: config.enabled,
    configured: config.configured,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    tlsVerify: config.tlsVerify,
    briefingIntervalSeconds: config.briefingIntervalSeconds,
    includeTargets: config.includeTargets,
    lastGeneratedAt: briefing?.generatedAt ?? null,
    lastError: briefing?.error ?? null
  };
}

function sanitizeDailyBriefing(briefing: DailyBriefingDto, includeTargets: boolean): AiBriefingEvidence["dailyBriefing"] {
  return {
    offlineServices: briefing.offlineServices.map((item) => ({
      ...item,
      error: sanitizeAiText(item.error, includeTargets)
    })),
    recentChanges: briefing.recentChanges.map((item) => ({
      ...item,
      error: sanitizeAiText(item.error, includeTargets)
    })),
    hostsUnderPressure: briefing.hostsUnderPressure,
    staleChecks: briefing.staleChecks.map((item) => ({
      ...item,
      target: includeTargets ? sanitizeAiText(item.target, true) : null
    })),
    unmonitoredServices: briefing.unmonitoredServices,
    watchlist: briefing.watchlist.map((item) => ({
      ...item,
      target: includeTargets ? sanitizeAiText(item.target, true) : null,
      error: sanitizeAiText(item.error, includeTargets)
    }))
  };
}

function integrationEvidence(source: IntegrationSourceDto, includeTargets: boolean): AiBriefingEvidence["integrations"][number] {
  const snapshot = source.latestSnapshot?.provider === "opnsense" ? source.latestSnapshot : null;
  const gatewayStatuses = snapshot?.gateways ?? [];
  const interfaceStatuses = snapshot?.interfaces ?? [];
  const traffic = interfaceStatuses.reduce(
    (sum, item) => sum + (item.receivedBytesPerSec ?? 0) + (item.sentBytesPerSec ?? 0),
    0
  );

  return {
    id: source.id,
    evidenceId: `integration:${source.id}`,
    provider: source.provider,
    name: source.name,
    baseUrl: includeTargets ? source.baseUrl : null,
    status: source.status,
    error: sanitizeAiText(source.latestError, includeTargets),
    sampledAt: source.latestSampledAt,
    warnings: (snapshot?.warnings ?? []).map((warning) => sanitizeAiText(warning, includeTargets)).filter((warning): warning is string => Boolean(warning)),
    system: snapshot ? {
      cpuPercent: snapshot.system.cpuPercent,
      memoryPercent: snapshot.system.memoryPercent,
      diskPercent: snapshot.system.diskPercent,
      temperatureC: snapshot.system.temperatureC
    } : null,
    firmware: snapshot ? {
      version: snapshot.firmware.version,
      latestVersion: snapshot.firmware.latestVersion,
      updateAvailable: snapshot.firmware.updateAvailable,
      needsReboot: snapshot.firmware.needsReboot
    } : null,
    gateways: {
      total: gatewayStatuses.length,
      online: gatewayStatuses.filter((item) => item.status === "online").length,
      offline: gatewayStatuses.filter((item) => item.status === "offline").length,
      unknown: gatewayStatuses.filter((item) => item.status === "unknown").length
    },
    interfaces: {
      total: interfaceStatuses.length,
      online: interfaceStatuses.filter((item) => item.status === "online").length,
      offline: interfaceStatuses.filter((item) => item.status === "offline").length,
      unknown: interfaceStatuses.filter((item) => item.status === "unknown").length,
      trafficBytesPerSec: traffic > 0 ? traffic : null
    }
  };
}

function apiWidgetEvidence(widget: ApiWidgetDto, includeTargets: boolean): AiBriefingEvidence["apiWidgets"][number] {
  return {
    id: widget.id,
    evidenceId: `widget:${widget.id}`,
    name: widget.name,
    templateId: widget.templateId,
    endpoint: includeTargets ? `${widget.baseUrl}${widget.endpointPath}` : null,
    status: widget.latestStatus,
    error: sanitizeAiText(widget.latestError, includeTargets),
    sampledAt: widget.latestSampledAt,
    summary: sanitizeAiText(widget.latestSnapshot?.summary, includeTargets),
    fields: (widget.latestSnapshot?.fields ?? []).slice(0, 8).map((field) => ({
      label: sanitizeAiText(field.label, includeTargets) ?? "Field",
      value: sanitizeAiText(field.value, includeTargets) ?? "-",
      kind: field.kind
    }))
  };
}

function hostEvidence(host: HostMonitorDto, includeTargets: boolean): AiBriefingEvidence["hostMonitors"][number] {
  return {
    id: host.id,
    evidenceId: `host:${host.id}`,
    name: host.name,
    baseUrl: includeTargets ? host.baseUrl : null,
    status: host.latestStatus,
    error: sanitizeAiText(host.latestError, includeTargets),
    sampledAt: host.latestSampledAt,
    cpuPercent: host.latestCpuPercent,
    memoryPercent: host.latestMemoryPercent,
    diskPercent: host.latestDiskPercent,
    temperatureC: host.latestTemperatureC,
    containersRunning: host.latestContainersRunning,
    containersTotal: host.latestContainersTotal
  };
}

export async function buildAiBriefingEvidence(prisma: PrismaClient, config: AiEnvConfig): Promise<AiBriefingEvidence> {
  const [resources, hostMonitorsRaw, integrationsRaw, widgetsRaw] = await Promise.all([
    prisma.resource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        healthChecks: {
          orderBy: [{ type: "asc" }, { target: "asc" }]
        }
      }
    }),
    prisma.hostMonitor.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 12
        }
      }
    }),
    prisma.integrationSource.findMany({
      // Personal-context and TrueNAS storage evidence is deliberately excluded from AI input.
      where: { enabled: true, provider: "opnsense" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 1
        }
      }
    }),
    prisma.apiWidget.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 1
        }
      }
    })
  ]);

  const hostMonitors = hostMonitorsRaw.map(toHostMonitorDto);
  const integrations = integrationsRaw.map(toIntegrationSourceDto);
  const apiWidgets = widgetsRaw.map(toApiWidgetDto);
  const dailyBriefing = buildDailyBriefing(resources, hostMonitors);
  const includeTargets = config.includeTargets;

  return {
    capturedAt: new Date().toISOString(),
    privacy: {
      includeTargets,
      targetPolicy: includeTargets
        ? "Service URLs, hosts, and check targets may be included."
        : "Service URLs, hosts, IP addresses, and check targets are redacted."
    },
    summary: dailyBriefing.summary,
    dailyBriefing: sanitizeDailyBriefing(dailyBriefing, includeTargets),
    resources: resources.slice(0, 80).map((resource): AiEvidenceResource => ({
      id: resource.id,
      evidenceId: `resource:${resource.id}`,
      name: resource.name,
      kind: resource.kind,
      status: resourceStatus(resource),
      favorite: resource.favorite,
      monitoringMode: resource.monitoringMode,
      manualStatus: resource.manualStatus,
      address: includeTargets ? sanitizeAiText(resource.url ?? resource.host, true) : null,
      checks: resource.healthChecks
        .filter((check) => check.enabled && check.primary)
        .slice(0, 1)
        .map((check) => ({
        id: check.id,
        evidenceId: `check:${check.id}`,
        type: check.type,
        target: includeTargets ? sanitizeAiText(check.target, true) : null,
        enabled: check.enabled,
        primary: check.primary,
        status: check.latestStatus,
        latencyMs: check.latestLatencyMs,
        checkedAt: check.latestCheckedAt?.toISOString() ?? null,
        error: sanitizeAiText(check.latestError, includeTargets),
        consecutiveFailures: check.consecutiveFailures,
        consecutiveSuccesses: check.consecutiveSuccesses,
        failureThreshold: check.failureThreshold,
        successThreshold: check.successThreshold,
        lastTransitionAt: check.lastTransitionAt?.toISOString() ?? null
      }))
    })),
    hostMonitors: hostMonitors.map((host) => hostEvidence(host, includeTargets)),
    integrations: integrations.map((source) => integrationEvidence(source, includeTargets)),
    apiWidgets: apiWidgets.map((widget) => apiWidgetEvidence(widget, includeTargets))
  };
}

function completionUrl(baseUrl: string): string {
  return new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function responseContent(raw: unknown): string {
  const response = asRecord(raw);
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = asRecord(part);
        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  }

  throw new Error("AI provider response did not include message content");
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1));
    }
    throw new Error("AI provider returned malformed JSON");
  }
}

async function requestAiBriefing(config: AiEnvConfig, evidence: AiBriefingEvidence): Promise<z.infer<typeof aiModelOutputSchema>> {
  if (!config.baseUrl || !config.model) {
    throw new Error("AI briefing is not configured");
  }

  const raw = await boundedJsonRequest(completionUrl(config.baseUrl), {
      method: "POST",
      headers: {
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: {
        model: config.model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: [
              "You summarize a private homelab command center.",
              "Use only the supplied evidence; do not invent causes, services, metrics, or external facts.",
              "Return strict JSON only with keys severity, headline, summary, items, nextActions, and confidence.",
              "Severity must be ok, notice, warning, or critical. Confidence must be low, medium, or high.",
              "Items must cite supplied evidenceIds when possible. Next actions must be read-only suggestions for inspecting dashboard evidence or rerunning existing checks.",
              "If evidence is thin, say so plainly."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              schema: {
                severity: "ok | notice | warning | critical",
                headline: "one concise sentence",
                summary: "2-4 grounded sentences",
                items: "up to 6 objects: title, body, severity, evidenceIds",
                nextActions: "up to 5 objects: label, optional resourceId/checkId/integrationId/widgetId",
                confidence: "low | medium | high"
              },
              evidence
            })
          }
        ]
      },
      tlsVerify: config.tlsVerify,
      credentialed: Boolean(config.apiKey),
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
      maxBytes: AI_MAX_RESPONSE_BYTES,
      label: "AI provider"
    });
  const parsedContent = parseJsonContent(responseContent(raw));
  return aiModelOutputSchema.parse(parsedContent);
}

export async function runAiBriefing(prisma: PrismaClient, config: AiEnvConfig): Promise<AiBriefingDto> {
  if (!config.enabled) {
    return disabledBriefing(config);
  }

  if (!config.configured) {
    return unconfiguredBriefing(config);
  }

  try {
    const evidence = await buildAiBriefingEvidence(prisma, config);
    const output = await requestAiBriefing(config, evidence);
    const briefing: AiBriefingDto = {
      status: "fresh",
      severity: output.severity,
      generatedAt: new Date().toISOString(),
      headline: output.headline,
      summary: output.summary,
      items: output.items as AiBriefingItemDto[],
      nextActions: output.nextActions as AiBriefingActionDto[],
      confidence: output.confidence,
      model: config.model,
      stale: false,
      error: null
    };
    await saveCachedAiBriefing(prisma, briefing);
    return briefing;
  } catch (error) {
    const briefing = errorBriefing(config, error);
    await saveCachedAiBriefing(prisma, briefing);
    return briefing;
  }
}

export function startAiBriefingScheduler(
  prisma: PrismaClient,
  config: AiEnvConfig,
  intervalMs = AI_SCHEDULER_INTERVAL_MS,
  observer?: (update: SchedulerUpdate) => void
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
      const cached = await getCachedAiBriefing(prisma, config);
      const due = isAiBriefingDue(cached, config);
      observer?.({ lastDueCount: due ? 1 : 0 });

      const result = due ? await runAiBriefing(prisma, config) : null;
      observer?.({
        running: false,
        lastCompletedAt: new Date(),
        lastDurationMs: Date.now() - startedAt,
        lastError: result?.status === "error" ? result.error : null
      });
    } catch (error) {
      observer?.({
        running: false,
        lastCompletedAt: new Date(),
        lastDurationMs: Date.now() - startedAt,
        lastError: sanitizeAiBriefingError(error)
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
