import { claimRevision, initializeHomepage, registerHomepageRoutes } from "./homepage.js";
import { registerHomepageBackupRoutes } from "./homepageBackup.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { Prisma, PrismaClient, type HealthCheck, type HostMonitor } from "@prisma/client";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions
} from "fastify";
import { z, ZodError } from "zod";
import {
  clearSetupCode,
  createAuthToken,
  createReauthToken,
  hashPassword,
  incrementSessionVersion,
  initializeSetupCode,
  isAuthenticated,
  isRecentlyReauthenticated,
  REAUTH_COOKIE,
  REAUTH_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  verifyAdminLogin,
  verifyAdminPassword,
  verifySetupCode
} from "./auth.js";
import { getEnv, type AppEnv } from "./env.js";
import { getBuildInfo } from "../shared/version.js";
import type { DashboardHomeConfigDto, DashboardHomeSummaryDto, HealthCheckType } from "../shared/types.js";
import {
  executeHealthCheck,
  runHealthCheck,
  startHealthScheduler,
  type SchedulerUpdate
} from "./healthChecks.js";
import { runHostMetricSample, startMetricsScheduler, toHostMonitorDto } from "./metrics.js";
import {
  apiWidgetTemplateById,
  apiWidgetTemplates,
  isApiWidgetSecretAllowed,
  runApiWidgetSample,
  startApiWidgetScheduler,
  suggestApiWidgets,
  toApiWidgetDto
} from "./apiWidgets.js";
import {
  isOpnsenseConfigured,
  opnsenseRuntimeConfig,
  runIntegrationSample,
  startIntegrationScheduler,
  syncConfiguredIntegrationSources,
  toIntegrationSourceDto
} from "./opnsense.js";
import {
  AI_SCHEDULER_INTERVAL_MS,
  aiRuntimeConfig,
  getAiBriefing,
  getCachedAiBriefing,
  getDashboardAiBriefing,
  runAiBriefing,
  startAiBriefingScheduler
} from "./aiBriefing.js";
import { buildDailyBriefing } from "./dailyBriefing.js";
import {
  DashboardUtilitiesService,
  DASHBOARD_UTILITIES_CONFIG_KEY,
  getDashboardUtilitiesConfig,
  parseDashboardUtilitiesConfig,
  setDashboardUtilitiesConfig
} from "./dashboardUtilities.js";
import {
  HomeContextService,
  DASHBOARD_HOME_CONFIG_KEY,
  getDashboardHomeConfig,
  parseDashboardHomeConfig,
  setDashboardHomeConfig
} from "./homeContext.js";
import {
  isTrueNasConfigured,
  runTrueNasSample,
  startTrueNasScheduler,
  syncConfiguredTrueNasSource,
  trueNasRuntimeConfig,
  trueNasSourceDto
} from "./truenas.js";
import {
  apiWidgetPatchSchema,
  apiWidgetSchema,
  dashboardGroupPatchSchema,
  dashboardGroupSchema,
  healthCheckPatchSchema,
  healthCheckSchema,
  healthCheckTestSchema,
  hostMonitorPatchSchema,
  hostMonitorSchema,
  idParamSchema,
  loginSchema,
  reorderSchema,
  resourcePatchSchema,
  resourceSchema,
  settingsSchema,
  validateHealthCheckTarget
} from "./validation.js";
import { seedDemo } from "./seed.js";
import { registerStatusRoutes } from "./routes/status.js";
import { RateLimiter } from "./rateLimit.js";
import {
  configureOutboundPolicy,
  assertIntegrationTransport,
  outboundPolicySummary,
  resolveOutboundTarget
} from "./outboundPolicy.js";
import {
  adoptExistingApiWidgetBindings,
  bindApiWidgetSecret,
  removeApiWidgetSecretBinding,
  widgetSecretOrigin
} from "./apiWidgetBindings.js";
import { fetchProxiedIcon, serverIconSlug } from "./iconProxy.js";

type CreateAppOptions = {
  env?: AppEnv;
  prisma?: PrismaClient;
  monitor?: boolean;
  logger?: FastifyServerOptions["logger"];
  setupCode?: string;
  dashboardUtilities?: DashboardUtilitiesService;
  homeContext?: HomeContextService;
};

type SchedulerRuntime = {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  lastTickAt: Date | null;
  lastCompletedAt: Date | null;
  lastError: string | null;
  lastDueCount: number | null;
  lastDurationMs: number | null;
  skippedTickAt: Date | null;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTO_PING_INTERVAL_KEY = "auto_ping_interval_seconds";
const AUTO_PING_INTERVAL_DEFAULT = 60;
const AUTO_PING_INTERVAL_MIN = 15;
const AUTO_PING_INTERVAL_MAX = 86400;
const resetHealthCheckState = {
  latestStatus: "unknown",
  latestLatencyMs: null,
  latestCheckedAt: null,
  latestError: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastTransitionAt: null
} as const;
const resetHostMonitorState = {
  latestStatus: "unknown",
  latestError: null,
  latestSampledAt: null,
  latestCpuPercent: null,
  latestMemoryPercent: null,
  latestMemoryUsedBytes: null,
  latestMemoryTotalBytes: null,
  latestDiskPercent: null,
  latestDiskUsedBytes: null,
  latestDiskTotalBytes: null,
  latestNetworkRxBytesPerSec: null,
  latestNetworkTxBytesPerSec: null,
  latestTemperatureC: null,
  latestContainersRunning: null,
  latestContainersTotal: null
} as const;
const resetApiWidgetState = {
  latestStatus: "unknown",
  latestError: null,
  latestSnapshot: null,
  latestSampledAt: null
} as const;

function createSchedulerRuntime(intervalMs: number): SchedulerRuntime {
  return {
    enabled: false,
    running: false,
    intervalMs,
    lastTickAt: null,
    lastCompletedAt: null,
    lastError: null,
    lastDueCount: null,
    lastDurationMs: null,
    skippedTickAt: null
  };
}

function applySchedulerUpdate(state: SchedulerRuntime, update: SchedulerUpdate): void {
  if (update.running !== undefined) state.running = update.running;
  if (update.lastTickAt !== undefined) state.lastTickAt = update.lastTickAt;
  if (update.lastCompletedAt !== undefined) state.lastCompletedAt = update.lastCompletedAt;
  if (update.lastError !== undefined) state.lastError = update.lastError;
  if (update.lastDueCount !== undefined) state.lastDueCount = update.lastDueCount;
  if (update.lastDurationMs !== undefined) state.lastDurationMs = update.lastDurationMs;
  if (update.skippedTickAt !== undefined) state.skippedTickAt = update.skippedTickAt;
}

function serializeSchedulerRuntime(state: SchedulerRuntime) {
  return {
    enabled: state.enabled,
    running: state.running,
    intervalMs: state.intervalMs,
    lastTickAt: state.lastTickAt?.toISOString() ?? null,
    lastCompletedAt: state.lastCompletedAt?.toISOString() ?? null,
    lastError: state.lastError,
    lastDueCount: state.lastDueCount,
    lastDurationMs: state.lastDurationMs,
    skippedTickAt: state.skippedTickAt?.toISOString() ?? null
  };
}

function safeDatabaseHint(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    if (url.password) {
      url.password = "redacted";
    }
    if (url.username) {
      url.username = "redacted";
    }
    return url.toString();
  } catch {
    return "configured";
  }
}

function enforceDatabasePermissions(databaseUrl: string): void {
  if (!databaseUrl.startsWith("file:")) return;
  const rawPath = decodeURIComponent(databaseUrl.slice("file:".length).split("?")[0]);
  const databasePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), "prisma", rawPath);
  const directory = path.dirname(databasePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  if (fs.existsSync(databasePath)) fs.chmodSync(databasePath, 0o600);
}

function resolveClientDist(): string | null {
  const candidates = [
    path.resolve(__dirname, "../client"),
    path.resolve(__dirname, "../../dist/client")
  ];

  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "index.html")) &&
    fs.existsSync(path.join(candidate, "assets"))
  ) ?? null;
}

function healthCheckHostname(type: string, target: string): string {
  if (type === "ping") return target.trim();
  const protocol = type === "tcp" ? "tcp" : "https";
  const parsed = new URL(target.includes("://") ? target : `${protocol}://${target}`);
  return parsed.hostname;
}

async function validateConfiguredOutboundTarget(hostname: string): Promise<void> {
  if (!outboundPolicySummary().enforced) return;
  await resolveOutboundTarget(hostname);
}

function isLocalContainerHealthRequest(request: FastifyRequest, pathname: string): boolean {
  if (pathname !== "/api/health") return false;
  const remoteAddress = request.raw.socket.remoteAddress?.toLowerCase();
  if (
    remoteAddress !== "127.0.0.1" &&
    remoteAddress !== "::1" &&
    remoteAddress !== "::ffff:127.0.0.1"
  ) {
    return false;
  }
  try {
    const hostname = new URL(`http://${request.headers.host ?? ""}`).hostname;
    return hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname === "localhost";
  } catch {
    return false;
  }
}

async function adminAccountExists(env: AppEnv, prisma: PrismaClient): Promise<boolean> {
  if (env.adminPassword) {
    return true;
  }
  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  return Boolean(account);
}

async function setSetupDismissed(prisma: PrismaClient): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: "setup_dismissed" },
    update: { value: "true" },
    create: { key: "setup_dismissed", value: "true" }
  });
}

async function isSetupDismissed(prisma: PrismaClient): Promise<boolean> {
  const entry = await prisma.systemConfig.findUnique({ where: { key: "setup_dismissed" } });
  return entry?.value === "true";
}

function routeId(request: { params: unknown }): string {
  return idParamSchema.parse(request.params).id;
}

type HealthCheckTarget = {
  type: HealthCheckType;
  target: string;
};

type ResourceAddress = {
  url: string | null;
  host: string | null;
};

type PrimaryCheckInput = NonNullable<z.infer<typeof resourceSchema>["primaryCheck"]>;
type DatabaseClient = PrismaClient | Prisma.TransactionClient;

type ResourceWithHealthChecks = ResourceAddress & {
  id: string;
  monitoringMode?: string | null;
  healthChecks: Pick<
    HealthCheck,
    | "id"
    | "managed"
    | "primary"
    | "type"
    | "target"
    | "intervalSeconds"
    | "timeoutMs"
    | "enabled"
    | "latestStatus"
    | "latestLatencyMs"
    | "latestCheckedAt"
    | "latestError"
    | "consecutiveFailures"
    | "consecutiveSuccesses"
    | "failureThreshold"
    | "successThreshold"
    | "lastTransitionAt"
  >[];
};

function implicitPrimaryTarget(resource: ResourceAddress): HealthCheckTarget | null {
  const url = resource.url?.trim();
  if (url) {
    const hasScheme = /^https?:\/\//i.test(url);
    return { type: "http", target: hasScheme ? url : `http://${url}` };
  }
  return null;
}

function legacyManagedTarget(resource: ResourceAddress): HealthCheckTarget | null {
  const httpTarget = implicitPrimaryTarget(resource);
  if (httpTarget) return httpTarget;
  const host = resource.host?.trim();
  return host ? { type: "ping", target: host } : null;
}

function automaticImplicitTarget(
  resource: ResourceAddress & { monitoringMode?: string | null }
): HealthCheckTarget | null {
  if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
    return null;
  }
  return implicitPrimaryTarget(resource);
}

function healthCheckMatchesTarget(check: Pick<HealthCheck, "type" | "target">, target: HealthCheckTarget): boolean {
  return check.type === target.type && check.target === target.target;
}

function tcpTargetForHost(previousTarget: string, host: string): string | null {
  try {
    const parsed = new URL(previousTarget.includes("://") ? previousTarget : `tcp://${previousTarget}`);
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${normalizedHost}:${port}`;
  } catch {
    return null;
  }
}

function synchronizedManagedTarget(
  check: Pick<HealthCheck, "type" | "target">,
  resource: ResourceAddress
): HealthCheckTarget | null {
  if (check.type === "http") return implicitPrimaryTarget(resource);
  if (check.type === "ping") {
    const host = resource.host?.trim();
    return host ? { type: "ping", target: host } : null;
  }
  if (check.type === "tcp") {
    const host = resource.host?.trim();
    const target = host ? tcpTargetForHost(check.target, host) : null;
    return target ? { type: "tcp", target } : null;
  }
  return null;
}

function shouldResetHealthCheckAfterPatch(
  previous: Pick<
    HealthCheck,
    "resourceId" | "type" | "target" | "timeoutMs" | "failureThreshold" | "successThreshold" | "enabled"
  >,
  patch: z.infer<typeof healthCheckPatchSchema>
): boolean {
  return (
    (patch.resourceId !== undefined && patch.resourceId !== previous.resourceId) ||
    (patch.type !== undefined && patch.type !== previous.type) ||
    (patch.target !== undefined && patch.target !== previous.target) ||
    (patch.timeoutMs !== undefined && patch.timeoutMs !== previous.timeoutMs) ||
    (patch.failureThreshold !== undefined && patch.failureThreshold !== previous.failureThreshold) ||
    (patch.successThreshold !== undefined && patch.successThreshold !== previous.successThreshold) ||
    (patch.enabled === true && !previous.enabled)
  );
}

function isAutoManagedCheckCandidate(
  check: Pick<HealthCheck, "type" | "timeoutMs" | "failureThreshold" | "successThreshold">
): boolean {
  return (
    (check.type === "http" || check.type === "ping") &&
    check.timeoutMs === 3000 &&
    check.failureThreshold === 1 &&
    check.successThreshold === 1
  );
}

async function backfillManagedHealthChecks(prisma: PrismaClient): Promise<void> {
  const migrationKey = "managed_health_checks_v1";
  if (await prisma.systemConfig.findUnique({ where: { key: migrationKey } })) return;
  const resources = await prisma.resource.findMany({
    where: { monitoringMode: "auto" },
    include: { healthChecks: true }
  });

  for (const resource of resources) {
    if (resource.healthChecks.some((check) => check.managed)) continue;
    const target = legacyManagedTarget(resource);
    if (!target) continue;
    const candidates = resource.healthChecks.filter(
      (check) => healthCheckMatchesTarget(check, target) && isAutoManagedCheckCandidate(check)
    );
    if (candidates.length === 1) {
      await prisma.healthCheck.update({ where: { id: candidates[0].id }, data: { managed: true } });
    }
  }

  await prisma.systemConfig.upsert({
    where: { key: migrationKey },
    create: { key: migrationKey, value: new Date().toISOString() },
    update: { value: new Date().toISOString() }
  });
}

async function backfillPrimaryHealthChecks(prisma: PrismaClient): Promise<void> {
  const migrationKey = "primary_health_checks_v1";
  if (await prisma.systemConfig.findUnique({ where: { key: migrationKey } })) return;
  const resources = await prisma.resource.findMany({
    include: {
      healthChecks: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });

  for (const resource of resources) {
    const enabled = resource.healthChecks.filter((check) => check.enabled);
    const selected = enabled.find((check) => check.managed) ?? enabled[0];
    await prisma.$transaction([
      prisma.healthCheck.updateMany({
        where: { resourceId: resource.id, primary: true },
        data: { primary: false }
      }),
      ...(selected
        ? [prisma.healthCheck.update({ where: { id: selected.id }, data: { primary: true } })]
        : [])
    ]);
  }

  await prisma.systemConfig.upsert({
    where: { key: migrationKey },
    create: { key: migrationKey, value: new Date().toISOString() },
    update: { value: new Date().toISOString() }
  });
}

function checkInputWithDefaults(
  input: PrimaryCheckInput | HealthCheckTarget,
  intervalSeconds: number,
  previous?: Pick<
    HealthCheck,
    "intervalSeconds" | "timeoutMs" | "failureThreshold" | "successThreshold"
  >
) {
  const configured = input as PrimaryCheckInput;
  return {
    type: input.type,
    target: input.target,
    intervalSeconds: configured.intervalSeconds ?? previous?.intervalSeconds ?? intervalSeconds,
    timeoutMs: configured.timeoutMs ?? previous?.timeoutMs ?? 3000,
    failureThreshold: configured.failureThreshold ?? previous?.failureThreshold ?? 1,
    successThreshold: configured.successThreshold ?? previous?.successThreshold ?? 1,
    enabled: true,
    managed: true,
    primary: true
  };
}

async function createManagedHealthCheck(
  database: DatabaseClient,
  resource: ResourceAddress & { id: string },
  input?: PrimaryCheckInput | HealthCheckTarget
): Promise<void> {
  const target = input ?? implicitPrimaryTarget(resource);
  if (!target) return;
  const intervalSeconds = await getAutoPingIntervalSeconds(database);
  await database.healthCheck.updateMany({
    where: { resourceId: resource.id, primary: true },
    data: { primary: false }
  });
  await database.healthCheck.create({
    data: {
      resourceId: resource.id,
      ...checkInputWithDefaults(target, intervalSeconds)
    }
  });
}

function clampAutoPingInterval(value: number | null): number {
  if (value === null) {
    return AUTO_PING_INTERVAL_DEFAULT;
  }

  if (!Number.isInteger(value)) {
    return AUTO_PING_INTERVAL_DEFAULT;
  }

  if (value < AUTO_PING_INTERVAL_MIN || value > AUTO_PING_INTERVAL_MAX) {
    return AUTO_PING_INTERVAL_DEFAULT;
  }

  return value;
}

async function getAutoPingIntervalSeconds(database: DatabaseClient): Promise<number> {
  const entry = await database.systemConfig.findUnique({ where: { key: AUTO_PING_INTERVAL_KEY } });
  const parsed = Number.parseInt(entry?.value ?? "", 10);
  return clampAutoPingInterval(Number.isNaN(parsed) ? null : parsed);
}

async function setAutoPingIntervalSeconds(prisma: DatabaseClient, value: number): Promise<void> {
  const interval = clampAutoPingInterval(Math.trunc(value));
  await prisma.systemConfig.upsert({
    where: { key: AUTO_PING_INTERVAL_KEY },
    update: { value: String(interval) },
    create: { key: AUTO_PING_INTERVAL_KEY, value: String(interval) }
  });
}

function createHostMonitorData(input: z.infer<typeof hostMonitorSchema>) {
  return {
    name: input.name,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    enabled: input.enabled,
    sortOrder: input.sortOrder,
    primaryMount: input.primaryMount || "/",
    networkInterface: input.networkInterface || null
  };
}

function patchHostMonitorData(input: z.infer<typeof hostMonitorPatchSchema>) {
  const data = { ...input };
  if (data.baseUrl) {
    data.baseUrl = data.baseUrl.trim().replace(/\/+$/, "");
  }
  if ("primaryMount" in data && !data.primaryMount) {
    data.primaryMount = "/";
  }
  if ("networkInterface" in data && data.networkInterface === "") {
    data.networkInterface = null;
  }
  return data;
}

function shouldResetHostMonitorAfterPatch(
  previous: Pick<HostMonitor, "baseUrl" | "primaryMount" | "networkInterface">,
  patch: ReturnType<typeof patchHostMonitorData>
): boolean {
  return (
    (patch.baseUrl !== undefined && patch.baseUrl !== previous.baseUrl) ||
    (patch.primaryMount !== undefined && patch.primaryMount !== previous.primaryMount) ||
    (patch.networkInterface !== undefined && patch.networkInterface !== previous.networkInterface)
  );
}

function createApiWidgetData(input: z.infer<typeof apiWidgetSchema>) {
  const template = apiWidgetTemplateById(input.templateId);
  return {
    name: input.name,
    templateId: input.templateId ?? template.id,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    endpointPath: input.endpointPath,
    authType: input.authType ?? template.authType,
    authHeaderName: input.authHeaderName ?? template.authHeaderName,
    authEnvVar: input.authEnvVar || null,
    authValuePrefix: input.authValuePrefix ?? template.authValuePrefix,
    tlsVerify: input.tlsVerify ?? true,
    fieldMappings: input.fieldMappings,
    enabled: input.enabled,
    pollIntervalSeconds: input.pollIntervalSeconds,
    sortOrder: input.sortOrder
  };
}

function patchApiWidgetData(input: z.infer<typeof apiWidgetPatchSchema>) {
  const data = { ...input };
  if (data.baseUrl) {
    data.baseUrl = data.baseUrl.trim().replace(/\/+$/, "");
  }
  if ("authEnvVar" in data && !data.authEnvVar) {
    data.authEnvVar = null;
  }
  if ("authHeaderName" in data && !data.authHeaderName) {
    data.authHeaderName = null;
  }
  if ("authValuePrefix" in data && !data.authValuePrefix) {
    data.authValuePrefix = null;
  }
  return data;
}

function shouldResetApiWidgetAfterPatch(
  previous: Pick<ApiWidgetResetCandidate, "templateId" | "baseUrl" | "endpointPath" | "authType" | "authHeaderName" | "authEnvVar" | "authValuePrefix" | "tlsVerify" | "fieldMappings">,
  patch: ReturnType<typeof patchApiWidgetData>
): boolean {
  return (
    (patch.templateId !== undefined && patch.templateId !== previous.templateId) ||
    (patch.baseUrl !== undefined && patch.baseUrl !== previous.baseUrl) ||
    (patch.endpointPath !== undefined && patch.endpointPath !== previous.endpointPath) ||
    (patch.authType !== undefined && patch.authType !== previous.authType) ||
    (patch.authHeaderName !== undefined && patch.authHeaderName !== previous.authHeaderName) ||
    (patch.authEnvVar !== undefined && patch.authEnvVar !== previous.authEnvVar) ||
    (patch.authValuePrefix !== undefined && patch.authValuePrefix !== previous.authValuePrefix) ||
    (patch.tlsVerify !== undefined && patch.tlsVerify !== previous.tlsVerify) ||
    patch.fieldMappings !== undefined
  );
}

type ApiWidgetResetCandidate = {
  templateId: string;
  baseUrl: string;
  endpointPath: string;
  authType: string;
  authHeaderName: string | null;
  authEnvVar: string | null;
  authValuePrefix: string | null;
  tlsVerify: boolean;
  fieldMappings: unknown;
};

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const raw = options.env ?? getEnv();
  const env: AppEnv = {
    ...raw,
    cookieSecret: raw.cookieSecret ?? crypto.randomBytes(32).toString("hex")
  };
  configureOutboundPolicy(env);
  if (env.opnsense.configured && env.opnsense.baseUrl) {
    assertIntegrationTransport(new URL(env.opnsense.baseUrl), {
      credentialed: true,
      tlsVerify: env.opnsense.tlsVerify
    });
  }
  if (env.truenas.configured && env.truenas.baseUrl) {
    assertIntegrationTransport(new URL(env.truenas.baseUrl), {
      credentialed: true,
      tlsVerify: env.truenas.tlsVerify
    });
  }
  if (env.ai.configured && env.ai.baseUrl) {
    assertIntegrationTransport(new URL(env.ai.baseUrl), {
      credentialed: Boolean(env.ai.apiKey),
      tlsVerify: env.ai.tlsVerify
    });
  }
  const prisma = options.prisma ?? new PrismaClient();
  const loginLimiter = new RateLimiter(10, 60_000);
  const reauthLimiter = new RateLimiter(5, 15 * 60_000);
  const setupLimiter = new RateLimiter(5, 15 * 60_000);
  const app = Fastify({
    logger: options.logger ?? env.nodeEnv === "production",
    trustProxy: env.trustedProxyCidrs.length > 0 ? env.trustedProxyCidrs : false
  });
  const dashboardUtilities = options.dashboardUtilities ?? new DashboardUtilitiesService();
  const homeContext = options.homeContext ?? new HomeContextService();
  const startedAt = new Date();
  const healthScheduler = createSchedulerRuntime(15_000);
  const metricsScheduler = createSchedulerRuntime(15_000);
  const integrationScheduler = createSchedulerRuntime(15_000);
  const trueNasScheduler = createSchedulerRuntime(15_000);
  const apiWidgetScheduler = createSchedulerRuntime(15_000);
  const aiScheduler = createSchedulerRuntime(AI_SCHEDULER_INTERVAL_MS);

  await app.register(cookie, {
    secret: env.cookieSecret
  });

  await app.register(cors, {
    origin: env.nodeEnv === "production" ? false : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true
  });

  await initializeHomepage(prisma);
  await backfillManagedHealthChecks(prisma);
  await backfillPrimaryHealthChecks(prisma);
  await adoptExistingApiWidgetBindings(prisma);
  await prisma.systemConfig.deleteMany({ where: { key: "vault_key" } });
  enforceDatabasePermissions(env.databaseUrl);
  const setupCode = await initializeSetupCode(prisma, env, options.setupCode ?? env.setupCode ?? undefined);
  if (setupCode) {
    const message = `Homelab Dashboard one-time setup code: ${setupCode}`;
    if (env.nodeEnv !== "production") {
      if (options.logger) app.log.warn(message);
      else if (env.nodeEnv !== "test") console.warn(message);
    }
  }

  function securityLog(
    request: FastifyRequest,
    event: string,
    result: "success" | "failure",
    object?: { type: string; id?: string }
  ): void {
    app.log.info({
      securityEvent: {
        event,
        result,
        clientIp: request.ip || "unknown",
        ...(object ? { objectType: object.type, objectId: object.id ?? null } : {})
      }
    }, "security event");
  }

  function requireRecentReauthentication(request: FastifyRequest, reply: FastifyReply): boolean {
    if (isRecentlyReauthenticated(request, env)) return true;
    reply.code(403).send({
      error: "Recent password confirmation is required",
      code: "REAUTH_REQUIRED"
    });
    return false;
  }

  function sensitiveMutationFor(request: FastifyRequest): { type: string; id?: string } | null {
    if (!["POST", "PATCH", "DELETE"].includes(request.method)) return null;
    const pathname = new URL(request.raw.url ?? "/", "http://localhost").pathname;
    const collections: Array<{ prefix: string; type: string }> = [
      { prefix: "/api/metrics/hosts", type: "host-monitor" },
      { prefix: "/api/api-widgets", type: "api-widget" },
      { prefix: "/api/resources", type: "resource" },
      { prefix: "/api/health-checks", type: "health-check" },
      { prefix: "/api/groups", type: "group" }
    ];
    for (const collection of collections) {
      if (pathname !== collection.prefix && !pathname.startsWith(`${collection.prefix}/`)) continue;
      const suffix = pathname.slice(collection.prefix.length + 1);
      if (request.method === "POST" && (suffix === "reorder" || suffix.endsWith("/run"))) return null;
      if (collection.type === "group" && request.method !== "DELETE") return null;
      const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : {};
      if (
        request.method === "PATCH" &&
        collection.type === "resource" &&
        !["url", "host", "icon", "monitoringMode", "primaryCheck"].some((key) => key in body)
      ) {
        return null;
      }
      if (
        request.method === "PATCH" &&
        collection.type === "host-monitor" &&
        !["baseUrl", "enabled"].some((key) => key in body)
      ) {
        return null;
      }
      if (
        request.method === "PATCH" &&
        collection.type === "api-widget" &&
        !["baseUrl", "endpointPath", "authType", "authHeaderName", "authEnvVar", "authValuePrefix", "tlsVerify", "enabled"].some((key) => key in body)
      ) {
        return null;
      }
      if (
        request.method === "PATCH" &&
        collection.type === "health-check" &&
        !["type", "target", "enabled"].some((key) => key in body)
      ) {
        return null;
      }
      return {
        type: collection.type,
        ...(suffix && !suffix.includes("/") ? { id: suffix } : {})
      };
    }
    return null;
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: "Invalid request",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
      return;
    }

    const httpError = error as { statusCode?: unknown; message?: unknown };
    const statusCode =
      typeof httpError.statusCode === "number" && httpError.statusCode >= 400 && httpError.statusCode < 500
        ? httpError.statusCode
        : 500;

    if (statusCode < 500) {
      reply.code(statusCode).send({ error: typeof httpError.message === "string" ? httpError.message : "Invalid request" });
      return;
    }

    app.log.error(error);
    reply.code(500).send({ error: "Internal server error" });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'"
    );
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Embedder-Policy", "require-corp");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    if (env.cookieSecure) reply.header("Strict-Transport-Security", "max-age=31536000");
    if (request.url.startsWith("/assets/")) {
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
    } else if (!request.url.match(/^\/api\/resources\/[^/]+\/icon(?:\?|$)/)) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.raw.url ?? "/", "http://localhost");

    if (
      env.nodeEnv === "production" &&
      env.appOrigin &&
      !isLocalContainerHealthRequest(request, url.pathname) &&
      (
        request.headers.host !== new URL(env.appOrigin).host ||
        request.protocol !== new URL(env.appOrigin).protocol.slice(0, -1)
      )
    ) {
      return reply.code(421).send({ error: "Request origin transport does not match APP_ORIGIN" });
    }

    if (!url.pathname.startsWith("/api")) {
      return;
    }

    if (env.publicStatusMode === "disabled" && url.pathname === "/api/status") {
      return reply.code(404).send({ error: "Not found" });
    }

    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const fetchSite = request.headers["sec-fetch-site"];
      if (fetchSite === "cross-site") {
        return reply.code(403).send({ error: "Cross-site request rejected" });
      }

      const origin = request.headers.origin;
      if (origin) {
        let parsedOrigin: URL;
        try {
          parsedOrigin = new URL(origin);
        } catch {
          return reply.code(403).send({ error: "Invalid request origin" });
        }
        const requestHost = request.headers.host;
        const developmentOrigin =
          env.nodeEnv !== "production" &&
          ["http://localhost:5173", "http://127.0.0.1:5173"].includes(parsedOrigin.origin);
        const expectedOrigin = env.appOrigin ?? `${env.cookieSecure ? "https" : "http"}://${requestHost}`;
        if (!requestHost || (!developmentOrigin && parsedOrigin.origin !== expectedOrigin)) {
          return reply.code(403).send({ error: "Request origin does not match this server" });
        }
      } else if (fetchSite === "same-site") {
        return reply.code(403).send({ error: "Browser mutations must be same-origin" });
      }
    }

    const publicRoutes = new Set<string>([
      "/api/auth/login",
      "/api/auth/me",
      "/api/health",
      "/api/version",
      "/api/setup/status",
      "/api/setup"
    ]);
    if (env.publicStatusMode !== "disabled") publicRoutes.add("/api/status");
    if (publicRoutes.has(url.pathname)) {
      return;
    }

    if (!(await isAuthenticated(request, env, prisma))) {
      return reply.code(401).send({ error: "Authentication required" });
    }

  });

  app.addHook("preHandler", async (request, reply) => {
    const sensitiveMutation = sensitiveMutationFor(request);
    if (sensitiveMutation && !requireRecentReauthentication(request, reply)) {
      securityLog(request, "admin.mutation", "failure", sensitiveMutation);
      return reply;
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const sensitiveMutation = sensitiveMutationFor(request);
    if (sensitiveMutation && reply.statusCode !== 403) {
      securityLog(
        request,
        "admin.mutation",
        reply.statusCode < 400 ? "success" : "failure",
        sensitiveMutation
      );
    }
  });

  app.get("/api/health", async () => {
    return { ok: true };
  });

  app.get("/api/version", async () => ({ version: getBuildInfo().version }));

  app.get("/api/setup/status", async () => {
    const [resourceCount, layout, adminAccount] = await Promise.all([
      prisma.resource.count(),
      isSetupDismissed(prisma),
      env.adminPassword ? null : prisma.adminAccount.findUnique({ where: { id: "admin" } })
    ]);
    const hasAccount = Boolean(env.adminPassword) || Boolean(adminAccount);
    const firstRun = Boolean(resourceCount === 0 && !layout);
    return { firstRun, needsAccount: !hasAccount, needsSetupCode: !hasAccount };
  });

  app.post("/api/setup", async (request, reply) => {
    const body = z
      .object({
        username: z.string().trim().min(1).optional(),
        password: z.string().min(12).max(256).optional(),
        setupCode: z.string().trim().min(1).max(64).optional(),
        seedDemo: z.boolean()
      })
      .parse(request.body);

    const hasAccount = await adminAccountExists(env, prisma);

    if (hasAccount && !(await isAuthenticated(request, env, prisma))) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (hasAccount && body.seedDemo && !requireRecentReauthentication(request, reply)) {
      securityLog(request, "admin.seed_demo", "failure", { type: "system" });
      return;
    }

    if (!hasAccount) {
      const clientIp = request.ip || "unknown";
      if (!setupLimiter.allow(clientIp)) {
        return reply.code(429).send({ error: "Too many setup attempts. Try again later." });
      }
      if (!body.setupCode || !(await verifySetupCode(body.setupCode, env, prisma))) {
        return reply.code(403).send({ error: "Invalid setup code" });
      }
    }

    if (!hasAccount && !body.password && !env.adminPassword) {
      return reply.code(400).send({ error: "Password is required for first-run setup" });
    }

    if (!hasAccount && body.password && !env.adminPassword) {
      const hash = await hashPassword(body.password);
      await prisma.adminAccount.upsert({
        where: { id: "admin" },
        create: { id: "admin", username: body.username ?? "admin", passwordHash: hash },
        update: { username: body.username ?? "admin", passwordHash: hash }
      });
    }

    await setSetupDismissed(prisma);
    await clearSetupCode(prisma);

    if (body.seedDemo) {
      await seedDemo(prisma);
      if (hasAccount) securityLog(request, "admin.seed_demo", "success", { type: "system" });
    }

    return { ok: true };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const clientIp = request.ip || "unknown";
    if (!loginLimiter.allow(clientIp)) {
      securityLog(request, "auth.login", "failure");
      return reply.code(429).send({ error: "Too many login attempts. Try again shortly." });
    }

    const body = loginSchema.parse(request.body);

    if (!(await verifyAdminLogin(body.username, body.password, env, prisma))) {
      securityLog(request, "auth.login", "failure");
      reply.code(401).send({ error: "Invalid password" });
      return;
    }

    loginLimiter.reset(clientIp);

    reply.setCookie(SESSION_COOKIE, await createAuthToken(env, prisma), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.cookieSecure,
      path: "/",
      maxAge: env.sessionMaxAgeSeconds
    });
    securityLog(request, "auth.login", "success");

    return { authenticated: true };
  });

  app.post("/api/auth/reauth", async (request, reply) => {
    if (!reauthLimiter.allow("admin")) {
      securityLog(request, "auth.reauthenticate", "failure");
      return reply.code(429).send({ error: "Too many password confirmation attempts. Try again later." });
    }
    const body = z.object({ password: z.string().min(1).max(256) }).parse(request.body);
    if (!(await verifyAdminPassword(body.password, env, prisma))) {
      securityLog(request, "auth.reauthenticate", "failure");
      return reply.code(401).send({ error: "Password is incorrect" });
    }
    reauthLimiter.reset("admin");
    reply.setCookie(REAUTH_COOKIE, createReauthToken(request, env), {
      httpOnly: true,
      sameSite: "strict",
      secure: env.cookieSecure,
      path: "/",
      maxAge: REAUTH_MAX_AGE_SECONDS
    });
    securityLog(request, "auth.reauthenticate", "success");
    return reply.code(204).send();
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await incrementSessionVersion(prisma);
    reply.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "lax", secure: env.cookieSecure });
    reply.clearCookie(REAUTH_COOKIE, { path: "/", sameSite: "strict", secure: env.cookieSecure });
    securityLog(request, "auth.logout", "success");
    return { authenticated: false };
  });

  app.get("/api/auth/me", async (request) => {
    const authenticated = await isAuthenticated(request, env, prisma);
    if (!authenticated) {
      return { authenticated: false };
    }
    const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
    return {
      authenticated: true,
      username: account?.username ?? "admin",
      authSource: env.adminPassword ? "env" : "database"
    };
  });

  app.post("/api/auth/password", async (request, reply) => {
    const body = z
      .object({
        currentPassword: z.string().min(1).max(256),
        newPassword: z.string().min(12).max(256)
      })
      .parse(request.body);

    if (!(await isAuthenticated(request, env, prisma))) {
      reply.code(401).send({ error: "Authentication required" });
      return;
    }

    if (env.adminPassword) {
      securityLog(request, "auth.password_change", "failure", { type: "admin-account", id: "admin" });
      reply.code(400).send({
        error: "Password is managed by ADMIN_PASSWORD env var on the server. Update docker-compose and restart."
      });
      return;
    }

    if (!reauthLimiter.allow("admin")) {
      securityLog(request, "auth.password_change", "failure", { type: "admin-account", id: "admin" });
      return reply.code(429).send({ error: "Too many password confirmation attempts. Try again later." });
    }

    if (!(await verifyAdminPassword(body.currentPassword, env, prisma))) {
      securityLog(request, "auth.password_change", "failure", { type: "admin-account", id: "admin" });
      reply.code(401).send({ error: "Current password is incorrect" });
      return;
    }

    reauthLimiter.reset("admin");
    await prisma.adminAccount.update({
      where: { id: "admin" },
      data: { passwordHash: await hashPassword(body.newPassword) }
    });

    await incrementSessionVersion(prisma);
    reply.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "lax", secure: env.cookieSecure });
    reply.clearCookie(REAUTH_COOKIE, { path: "/", sameSite: "strict", secure: env.cookieSecure });
    securityLog(request, "auth.password_change", "success", { type: "admin-account", id: "admin" });

    return { ok: true, authenticated: false };
  });

  await registerStatusRoutes({ app, prisma, env });
  await registerHomepageRoutes(app, prisma, requireRecentReauthentication);
  registerHomepageBackupRoutes(app, prisma, requireRecentReauthentication);

  const dashboardCheckInclude = {
    healthChecks: {
      include: {
        results: {
          orderBy: { checkedAt: "desc" },
          take: 60,
          select: { id: true, status: true, latencyMs: true, checkedAt: true }
        }
      }
    }
  } as const;

  const hostMonitorInclude = {
    samples: {
      orderBy: { sampledAt: "desc" },
      take: 60
    }
  } as const;

  const integrationInclude = {
    samples: {
      orderBy: { sampledAt: "desc" },
      take: 60
    }
  } as const;

  const apiWidgetInclude = {
    samples: {
      orderBy: { sampledAt: "desc" },
      take: 60
    }
  } as const;

  app.get("/api/dashboard", async () => {
    await Promise.all([
      syncConfiguredIntegrationSources(prisma, env.opnsense),
      syncConfiguredTrueNasSource(prisma, env.truenas)
    ]);
    const [groups, ungroupedResources, hostMonitorsRaw, integrationsRaw, apiWidgetsRaw, aiBriefing] = await Promise.all([
      prisma.dashboardGroup.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          resources: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: dashboardCheckInclude
          }
        }
      }),
      prisma.resource.findMany({
        where: { groupId: null, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: dashboardCheckInclude
      }),
      prisma.hostMonitor.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: hostMonitorInclude
      }),
      prisma.integrationSource.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: integrationInclude
      }),
      prisma.apiWidget.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: apiWidgetInclude
      }),
      getDashboardAiBriefing(prisma, env.ai)
    ]);
    const hostMonitors = hostMonitorsRaw.map(toHostMonitorDto);
    const integrations = integrationsRaw.map((source) => source.provider === "truenas" ? trueNasSourceDto(source) : toIntegrationSourceDto(source));
    const apiWidgets = apiWidgetsRaw.map(toApiWidgetDto);
    const resources = [...groups.flatMap((group) => group.resources), ...ungroupedResources];

    return {
      groups,
      ungroupedResources,
      hostMonitors,
      integrations,
      apiWidgets,
      aiBriefing,
      dailyBriefing: buildDailyBriefing(resources.filter(r => r.purpose !== "bookmark"), hostMonitors, integrations),
      layout: {}
    };
  });

  async function readSettings(tx: DatabaseClient) {
    const [autoPingIntervalSeconds, utilities, dashboardHome, state] = await Promise.all([
      getAutoPingIntervalSeconds(tx), getDashboardUtilitiesConfig(tx), getDashboardHomeConfig(tx),
      tx.homepageState.findUniqueOrThrow({ where: { id: "main" } })
    ]);
    return { autoPingIntervalSeconds, dashboardUtilities: utilities, dashboardHome, revision: state.revision };
  }
  app.get("/api/settings", async () => {
    // Batch the snapshot to avoid holding an interactive SQLite transaction
    // across JavaScript callbacks during concurrent background refreshes.
    const [interval, utilities, home, state] = await prisma.$transaction([
      prisma.systemConfig.findUnique({ where: { key: AUTO_PING_INTERVAL_KEY } }),
      prisma.systemConfig.findUnique({ where: { key: DASHBOARD_UTILITIES_CONFIG_KEY } }),
      prisma.systemConfig.findUnique({ where: { key: DASHBOARD_HOME_CONFIG_KEY } }),
      prisma.homepageState.findUniqueOrThrow({ where: { id: "main" } }),
    ]);
    const parsedInterval = Number.parseInt(interval?.value ?? "", 10);
    return {
      autoPingIntervalSeconds: clampAutoPingInterval(Number.isNaN(parsedInterval) ? null : parsedInterval),
      dashboardUtilities: parseDashboardUtilitiesConfig(utilities?.value),
      dashboardHome: parseDashboardHomeConfig(home?.value),
      revision: state.revision,
    };
  });
  app.patch("/api/settings", async request => {
    const body = settingsSchema.parse(request.body);
    const { revision } = z.object({ revision: z.number().int().min(0).optional() }).parse(request.body);
    return prisma.$transaction(async tx => {
      if (revision !== undefined) await claimRevision(tx, revision);
      if (body.autoPingIntervalSeconds !== undefined) await setAutoPingIntervalSeconds(tx, body.autoPingIntervalSeconds);
      if (body.dashboardUtilities !== undefined) await setDashboardUtilitiesConfig(tx, body.dashboardUtilities);
      if (body.dashboardHome !== undefined) await setDashboardHomeConfig(tx, body.dashboardHome);
      return readSettings(tx);
    });
  });

  app.get("/api/home/summary", async (): Promise<DashboardHomeSummaryDto> => {
    await syncConfiguredTrueNasSource(prisma, env.truenas);
    const config: DashboardHomeConfigDto = await getDashboardHomeConfig(prisma);
    return homeContext.getSummary(prisma, env, config);
  });

  app.get("/api/home/posters/:ref", async (request, reply) => {
    const params = z.object({ ref: z.string().regex(/^[A-Za-z0-9_-]{24}$/) }).parse(request.params);
    try {
      const poster = await homeContext.getPoster(prisma, env, params.ref);
      return reply
        .header("Cache-Control", "private, max-age=300")
        .header("X-Content-Type-Options", "nosniff")
        .type(poster.contentType)
        .send(poster.body);
    } catch {
      return reply.code(404).send({ error: "Poster is unavailable" });
    }
  });

  app.get("/api/utilities/weather-locations", async (request) => {
    const query = z.object({ q: z.string().trim().min(3).max(120) }).parse(request.query);
    return dashboardUtilities.searchWeatherLocations(query.q);
  });

  app.get("/api/utilities/summary", async () => {
    const config = await getDashboardUtilitiesConfig(prisma);
    return dashboardUtilities.getSummary(config);
  });

  app.get("/api/admin/runtime", async () => {
    const [
      resourceCount,
      healthCheckCount,
      healthResultCount,
      hostMonitorCount,
      hostMetricSampleCount,
      integrationSourceCount,
      integrationSampleCount,
      apiWidgetCount,
      apiWidgetSampleCount,
      groupCount
    ] = await Promise.all([
      prisma.resource.count(),
      prisma.healthCheck.count(),
      prisma.healthResult.count(),
      prisma.hostMonitor.count(),
      prisma.hostMetricSample.count(),
      prisma.integrationSource.count(),
      prisma.integrationSample.count(),
      prisma.apiWidget.count(),
      prisma.apiWidgetSample.count(),
      prisma.dashboardGroup.count()
    ]);
    const cachedAiBriefing = await getCachedAiBriefing(prisma, env.ai);
    const outbound = outboundPolicySummary();
    const readinessWarnings = [
      ...(!env.appOrigin && env.nodeEnv === "production" ? ["APP_ORIGIN is not configured"] : []),
      ...(env.nodeEnv === "production" && env.cookieSecure && env.trustedProxyCidrs.length === 0 ? ["TRUST_PROXY_CIDRS is not configured"] : []),
      ...(!env.cookieSecure ? [env.nodeEnv === "production"
        ? "Private HTTP mode sends login credentials and session cookies without TLS; use only on a trusted LAN/VPN"
        : "Session cookies are not restricted to HTTPS"] : []),
      ...(env.publicStatusMode !== "disabled" ? [`Public status is enabled in ${env.publicStatusMode} mode`] : []),
      ...(!outbound.configured ? ["Outbound monitoring allowlists are not configured"] : []),
      ...(outbound.allowInsecureIntegrations ? ["CRITICAL: Insecure integration transport override is enabled"] : [])
    ];

    return {
      build: getBuildInfo(),
      process: {
        nodeEnv: env.nodeEnv,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        host: env.host,
        port: env.port,
        uptimeSeconds: Math.floor(process.uptime()),
        startedAt: startedAt.toISOString()
      },
      auth: {
        source: env.adminPassword ? "env" : "database",
        cookieSecure: env.cookieSecure,
        sessionMaxAgeHours: Math.floor(env.sessionMaxAgeSeconds / 3600)
      },
      security: {
        appOrigin: env.appOrigin,
        publicStatusMode: env.publicStatusMode,
        trustedProxyConfigured: env.trustedProxyCidrs.length > 0,
        outboundPolicy: outbound,
        readinessWarnings
      },
      database: {
        ok: true,
        url: safeDatabaseHint(env.databaseUrl),
        counts: {
          groups: groupCount,
          resources: resourceCount,
          healthChecks: healthCheckCount,
          healthResults: healthResultCount,
          hostMonitors: hostMonitorCount,
          hostMetricSamples: hostMetricSampleCount,
          integrationSources: integrationSourceCount,
          integrationSamples: integrationSampleCount,
          apiWidgets: apiWidgetCount,
          apiWidgetSamples: apiWidgetSampleCount
        }
      },
      integrations: {
        opnsense: opnsenseRuntimeConfig(env.opnsense),
        truenas: trueNasRuntimeConfig(env.truenas),
        personalContext: {
          googleConfigured: env.google.configured,
          todoistConfigured: env.todoist.configured,
          tmdbConfigured: env.tmdb.configured
        }
      },
      ai: aiRuntimeConfig(env.ai, cachedAiBriefing),
      schedulers: {
        health: serializeSchedulerRuntime(healthScheduler),
        metrics: serializeSchedulerRuntime(metricsScheduler),
        integrations: serializeSchedulerRuntime(integrationScheduler),
        truenas: serializeSchedulerRuntime(trueNasScheduler),
        apiWidgets: serializeSchedulerRuntime(apiWidgetScheduler),
        ai: serializeSchedulerRuntime(aiScheduler)
      }
    };
  });

  app.get("/api/ai/briefing", async () => getAiBriefing(prisma, env.ai));

  app.post("/api/ai/briefing/run", async () => runAiBriefing(prisma, env.ai));

  app.get("/api/metrics/hosts", async () => {
    const monitors = await prisma.hostMonitor.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: hostMonitorInclude
    });
    return monitors.map(toHostMonitorDto);
  });

  app.get("/api/metrics/hosts/:id", async (request) => {
    const id = routeId(request);
    const monitor = await prisma.hostMonitor.findUniqueOrThrow({
      where: { id },
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 1440
        }
      }
    });
    return toHostMonitorDto(monitor);
  });

  app.post("/api/metrics/hosts", async (request, reply) => {
    const body = hostMonitorSchema.parse(request.body);
    try {
      await validateConfiguredOutboundTarget(new URL(body.baseUrl).hostname);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Host target is not allowed" });
    }
    const monitor = await prisma.hostMonitor.create({
      data: createHostMonitorData(body),
      include: hostMonitorInclude
    });
    reply.code(201);
    return toHostMonitorDto(monitor);
  });

  app.patch("/api/metrics/hosts/:id", async (request, reply) => {
    const id = routeId(request);
    const body = hostMonitorPatchSchema.parse(request.body);
    const data = patchHostMonitorData(body);
    if (data.baseUrl) {
      try {
        await validateConfiguredOutboundTarget(new URL(data.baseUrl).hostname);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Host target is not allowed" });
      }
    }
    const previousMonitor = await prisma.hostMonitor.findUniqueOrThrow({
      where: { id },
      select: {
        baseUrl: true,
        primaryMount: true,
        networkInterface: true
      }
    });
    const resetState = shouldResetHostMonitorAfterPatch(previousMonitor, data);
    const monitor = await prisma.$transaction(async (tx) => {
      const updated = await tx.hostMonitor.update({
        where: { id },
        data: resetState ? { ...data, ...resetHostMonitorState } : data,
        include: hostMonitorInclude
      });

      if (resetState) {
        await tx.hostMetricSample.deleteMany({ where: { monitorId: id } });
        updated.samples = [];
      }

      return updated;
    });
    return toHostMonitorDto(monitor);
  });

  app.delete("/api/metrics/hosts/:id", async (request) => {
    const id = routeId(request);
    await prisma.hostMonitor.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/metrics/hosts/:id/run", async (request) => {
    const id = routeId(request);
    const monitor = await prisma.hostMonitor.findUniqueOrThrow({ where: { id } });
    const outcome = await runHostMetricSample(prisma, monitor);
    return { id, ...outcome };
  });

  app.get("/api/integrations", async () => {
    await Promise.all([
      syncConfiguredIntegrationSources(prisma, env.opnsense),
      syncConfiguredTrueNasSource(prisma, env.truenas)
    ]);
    const sources = await prisma.integrationSource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: integrationInclude
    });
    return sources.map((source) => source.provider === "truenas" ? trueNasSourceDto(source) : toIntegrationSourceDto(source));
  });

  app.get("/api/integrations/:id", async (request) => {
    const id = routeId(request);
    await Promise.all([
      syncConfiguredIntegrationSources(prisma, env.opnsense),
      syncConfiguredTrueNasSource(prisma, env.truenas)
    ]);
    const source = await prisma.integrationSource.findUniqueOrThrow({
      where: { id },
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 1440
        }
      }
    });
    return source.provider === "truenas" ? trueNasSourceDto(source) : toIntegrationSourceDto(source);
  });

  app.post("/api/integrations/:id/run", async (request, reply) => {
    const id = routeId(request);
    await Promise.all([
      syncConfiguredIntegrationSources(prisma, env.opnsense),
      syncConfiguredTrueNasSource(prisma, env.truenas)
    ]);
    const source = await prisma.integrationSource.findUniqueOrThrow({ where: { id } });

    if (source.provider === "truenas") {
      if (!isTrueNasConfigured(env.truenas)) {
        reply.code(400);
        return { error: "TrueNAS integration is not configured" };
      }
      const outcome = await runTrueNasSample(prisma, source, env.truenas);
      const refreshed = await prisma.integrationSource.findUniqueOrThrow({ where: { id }, include: integrationInclude });
      return { id, ...outcome, source: trueNasSourceDto(refreshed) };
    }
    if (source.provider !== "opnsense" || !isOpnsenseConfigured(env.opnsense)) {
      reply.code(400);
      return { error: "OPNsense integration is not configured" };
    }

    const outcome = await runIntegrationSample(prisma, source, env.opnsense);
    const refreshed = await prisma.integrationSource.findUniqueOrThrow({
      where: { id },
      include: integrationInclude
    });
    return { id, ...outcome, source: toIntegrationSourceDto(refreshed) };
  });

  app.get("/api/api-widget-templates", async () => apiWidgetTemplates);

  app.get("/api/api-widget-suggestions", async () => {
    const [resources, widgets] = await Promise.all([
      prisma.resource.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          url: true,
          description: true,
          icon: true,
          host: true
        }
      }),
      prisma.apiWidget.findMany({
        select: {
          templateId: true,
          baseUrl: true
        }
      })
    ]);

    return suggestApiWidgets(resources, widgets);
  });

  app.get("/api/api-widgets", async () => {
    const widgets = await prisma.apiWidget.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: apiWidgetInclude
    });
    return widgets.map(toApiWidgetDto);
  });

  app.get("/api/api-widgets/:id", async (request) => {
    const id = routeId(request);
    const widget = await prisma.apiWidget.findUniqueOrThrow({
      where: { id },
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 1440
        }
      }
    });
    return toApiWidgetDto(widget);
  });

  app.post("/api/api-widgets", async (request, reply) => {
    const body = apiWidgetSchema.parse(request.body);
    if (!isApiWidgetSecretAllowed(body.authEnvVar, env.apiWidgetSecretAllowlist)) {
      return reply.code(400).send({ error: "API widget secret environment variable is not allowlisted" });
    }
    const data = createApiWidgetData(body);
    const expectedOrigin = widgetSecretOrigin(data);
    const confirmation = z.object({
      confirmSecretOrigin: z.string().url().optional()
    }).parse(request.body).confirmSecretOrigin;
    if (expectedOrigin && confirmation !== expectedOrigin) {
      return reply.code(400).send({
        error: `Confirm the credential destination origin exactly: ${expectedOrigin}`
      });
    }
    try {
      assertIntegrationTransport(new URL(data.baseUrl), {
        credentialed: data.authType !== "none",
        tlsVerify: data.tlsVerify
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Unsafe integration transport" });
    }
    try {
      await validateConfiguredOutboundTarget(new URL(data.baseUrl).hostname);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Widget target is not allowed" });
    }
    const widget = await prisma.apiWidget.create({
      data,
      include: apiWidgetInclude
    });
    await bindApiWidgetSecret(prisma, widget);
    reply.code(201);
    return toApiWidgetDto(widget);
  });

  app.patch("/api/api-widgets/:id", async (request, reply) => {
    const id = routeId(request);
    const body = apiWidgetPatchSchema.parse(request.body);
    const data = patchApiWidgetData(body);
    const previous = await prisma.apiWidget.findUniqueOrThrow({
      where: { id },
      select: {
        templateId: true,
        baseUrl: true,
        endpointPath: true,
        authType: true,
        authHeaderName: true,
        authEnvVar: true,
        authValuePrefix: true,
        tlsVerify: true,
        fieldMappings: true
      }
    });
    const nextSecretName = "authEnvVar" in data ? data.authEnvVar : previous.authEnvVar;
    if (!isApiWidgetSecretAllowed(nextSecretName, env.apiWidgetSecretAllowlist)) {
      return reply.code(400).send({ error: "API widget secret environment variable is not allowlisted" });
    }
    const nextSecurityConfig = { id, ...previous, ...data };
    const nextOrigin = widgetSecretOrigin(nextSecurityConfig);
    const bindingChanged =
      data.baseUrl !== undefined ||
      data.authEnvVar !== undefined ||
      data.authType !== undefined;
    if (nextOrigin && bindingChanged) {
      const confirmation = z.object({
        confirmSecretOrigin: z.string().url().optional()
      }).parse(request.body).confirmSecretOrigin;
      if (confirmation !== nextOrigin) {
        return reply.code(400).send({
          error: `Confirm the credential destination origin exactly: ${nextOrigin}`
        });
      }
    }
    try {
      assertIntegrationTransport(new URL(nextSecurityConfig.baseUrl), {
        credentialed: nextSecurityConfig.authType !== "none",
        tlsVerify: nextSecurityConfig.tlsVerify
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Unsafe integration transport" });
    }
    try {
      await validateConfiguredOutboundTarget(new URL(nextSecurityConfig.baseUrl).hostname);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Widget target is not allowed" });
    }
    const resetState = shouldResetApiWidgetAfterPatch(previous, data);
    const widget = await prisma.$transaction(async (tx) => {
      const updated = await tx.apiWidget.update({
        where: { id },
        data: resetState ? { ...data, ...resetApiWidgetState } : data,
        include: apiWidgetInclude
      });

      if (resetState) {
        await tx.apiWidgetSample.deleteMany({ where: { widgetId: id } });
        updated.samples = [];
      }

      return updated;
    });
    await bindApiWidgetSecret(prisma, widget);
    return toApiWidgetDto(widget);
  });

  app.delete("/api/api-widgets/:id", async (request) => {
    const id = routeId(request);
    await prisma.apiWidget.delete({ where: { id } });
    await removeApiWidgetSecretBinding(prisma, id);
    return { ok: true };
  });

  app.post("/api/api-widgets/:id/run", async (request) => {
    const id = routeId(request);
    const widget = await prisma.apiWidget.findUniqueOrThrow({ where: { id } });
    const outcome = await runApiWidgetSample(prisma, widget, env.apiWidgetSecretAllowlist);
    const refreshed = await prisma.apiWidget.findUniqueOrThrow({
      where: { id },
      include: apiWidgetInclude
    });
    return { id, ...outcome, widget: toApiWidgetDto(refreshed) };
  });

  app.get("/api/groups", async () =>
    prisma.dashboardGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })
  );

  app.post("/api/groups", async (request, reply) => {
    const body = dashboardGroupSchema.parse(request.body);
    const group = await prisma.dashboardGroup.create({ data: body });
    reply.code(201);
    return group;
  });

  app.patch("/api/groups/:id", async (request) => {
    const id = routeId(request);
    const body = dashboardGroupPatchSchema.parse(request.body);
    return prisma.dashboardGroup.update({ where: { id }, data: body });
  });

  app.delete("/api/groups/:id", async (request) => {
    const id = routeId(request);
    await prisma.dashboardGroup.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/resources", async () =>
    prisma.resource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        healthChecks: true,
        group: true
      }
    })
  );

  app.get("/api/resources/:id/icon", async (request, reply) => {
    const id = routeId(request);
    const resource = await prisma.resource.findUniqueOrThrow({
      where: { id },
      select: { name: true, icon: true, url: true }
    });
    const candidates: Array<{ url: URL; fixedProvider: boolean }> = [];
    const icon = resource.icon?.trim();
    if (icon && /^https?:\/\//i.test(icon)) {
      candidates.push({ url: new URL(icon), fixedProvider: false });
    } else if (icon) {
      const slug = serverIconSlug(icon);
      if (slug) {
        candidates.push({
          url: new URL(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/${encodeURIComponent(slug)}.webp`),
          fixedProvider: true
        });
      }
    }
    const nameSlug = serverIconSlug(resource.name);
    if (nameSlug) {
      candidates.push({
        url: new URL(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/${encodeURIComponent(nameSlug)}.webp`),
        fixedProvider: true
      });
    }
    if (resource.url) {
      candidates.push({ url: new URL("/favicon.ico", resource.url), fixedProvider: false });
    }

    for (const candidate of candidates) {
      try {
        const proxied = await fetchProxiedIcon(candidate.url, { fixedProvider: candidate.fixedProvider });
        return reply
          .header("Cache-Control", "private, max-age=86400")
          .header("Vary", "Cookie")
          .type(proxied.contentType)
          .send(proxied.body);
      } catch {
        // Try the next safe candidate and fall back to initials in the client.
      }
    }
    return reply.code(404).send({ error: "Icon is unavailable" });
  });

  app.post("/api/resources", async (request, reply) => {
    const body = resourceSchema.parse(request.body);
    const { primaryCheck, ...resourceData } = body;
    const monitoringMode = resourceData.monitoringMode ?? "auto";
    const implicitTarget = automaticImplicitTarget({
      url: body.url ?? null,
      host: body.host ?? null,
      monitoringMode
    });
    const proposedTarget = primaryCheck ?? implicitTarget;
    if (monitoringMode === "auto" && body.host && !body.url && !primaryCheck) {
      return reply.code(400).send({
        error: "Automatic monitoring for a host-only service requires a TCP port or an explicit ping check"
      });
    }
    if (monitoringMode !== "auto" && primaryCheck) {
      return reply.code(400).send({ error: "A primary check can only be configured for automatic monitoring" });
    }
    if (proposedTarget) {
      try {
        await validateConfiguredOutboundTarget(healthCheckHostname(proposedTarget.type, proposedTarget.target));
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Resource target is not allowed" });
      }
    }
    const resource = await prisma.$transaction(async (tx) => {
      const created = await tx.resource.create({ data: resourceData });
      if (proposedTarget) await createManagedHealthCheck(tx, created, proposedTarget);
      return created;
    });

    reply.code(201);
    return resource;
  });

  app.patch("/api/resources/:id", async (request, reply) => {
    const id = routeId(request);
    const body = resourcePatchSchema.parse(request.body);
    const { primaryCheck, ...data } = body;

    if (data.monitoringMode === "auto") {
      data.manualStatus = null;
    }

    const previousResource = await prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true } });
    if (previousResource.purpose === "bookmark") return reply.code(409).send({ error: "Use the bookmark editor for this saved link" });
    const nextResourceAddress = { ...previousResource, ...data };
    const nextAutomatic = nextResourceAddress.monitoringMode === "auto";
    const transitionedToAuto = data.monitoringMode === "auto" && previousResource.monitoringMode !== "auto";
    const addressChanged =
      (data.url !== undefined && data.url !== previousResource.url) ||
      (data.host !== undefined && data.host !== previousResource.host);
    const currentPrimary = previousResource.healthChecks.find((check) => check.primary);
    const managedPrimary = currentPrimary?.managed ? currentPrimary : null;
    const synchronizedTarget = addressChanged && managedPrimary
      ? synchronizedManagedTarget(managedPrimary, nextResourceAddress)
      : null;
    const implicitTarget = !currentPrimary && nextAutomatic && (transitionedToAuto || addressChanged)
      ? implicitPrimaryTarget(nextResourceAddress)
      : null;
    const proposedTarget = primaryCheck ?? synchronizedTarget ?? implicitTarget;

    if (!nextAutomatic && primaryCheck) {
      return reply.code(400).send({ error: "A primary check can only be configured for automatic monitoring" });
    }
    if (
      nextAutomatic &&
      nextResourceAddress.host &&
      !nextResourceAddress.url &&
      !currentPrimary &&
      !primaryCheck &&
      (transitionedToAuto || addressChanged)
    ) {
      return reply.code(400).send({
        error: "Automatic monitoring for a host-only service requires a TCP port or an explicit ping check"
      });
    }
    if (
      nextAutomatic &&
      addressChanged &&
      managedPrimary &&
      !primaryCheck &&
      !synchronizedTarget &&
      nextResourceAddress.host &&
      !nextResourceAddress.url
    ) {
      return reply.code(400).send({
        error: "Choose a TCP port or explicitly confirm ping before removing the service URL"
      });
    }
    if (proposedTarget) {
      try {
        await validateConfiguredOutboundTarget(healthCheckHostname(proposedTarget.type, proposedTarget.target));
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Resource target is not allowed" });
      }
    }

    await prisma.$transaction(async (tx) => {
      const resource = await tx.resource.update({ where: { id }, data });
      if (primaryCheck) {
        if (managedPrimary) {
          const intervalSeconds = await getAutoPingIntervalSeconds(tx);
          await tx.healthCheck.update({
            where: { id: managedPrimary.id },
            data: {
              ...checkInputWithDefaults(primaryCheck, intervalSeconds, managedPrimary),
              ...resetHealthCheckState
            }
          });
        } else {
          await createManagedHealthCheck(tx, resource, primaryCheck);
        }
      } else if (
        managedPrimary &&
        synchronizedTarget &&
        !healthCheckMatchesTarget(managedPrimary, synchronizedTarget)
      ) {
        await tx.healthCheck.update({
          where: { id: managedPrimary.id },
          data: {
            type: synchronizedTarget.type,
            target: synchronizedTarget.target,
            ...resetHealthCheckState
          }
        });
      } else if (!currentPrimary && implicitTarget) {
        await createManagedHealthCheck(tx, resource, implicitTarget);
      }
    });

    return prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true, group: true } });
  });

  app.delete("/api/resources/:id", async (request) => {
    const id = routeId(request);
    await prisma.resource.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/resources/reorder", async (request, reply) => {
    const body = reorderSchema.parse(request.body);

    try {
      await prisma.$transaction(
        body.ids.map((id, index) =>
          prisma.resource.update({ where: { id }, data: { sortOrder: index } })
        )
      );
    } catch {
      reply.code(400);
      return { error: "One or more resource ids are unknown" };
    }

    return { ok: true };
  });

  app.get("/api/health-checks", async () =>
    prisma.healthCheck.findMany({
      where: { resource: { purpose: "service" } },
      orderBy: [{ latestStatus: "asc" }, { target: "asc" }],
      include: {
        resource: true,
        results: {
          orderBy: { checkedAt: "desc" },
          take: 10
        }
      }
    })
  );

  app.post("/api/health-checks/test", async (request, reply) => {
    const body = healthCheckTestSchema.parse(request.body);
    try {
      await validateConfiguredOutboundTarget(healthCheckHostname(body.type, body.target));
    } catch (error) {
      return reply.code(400).send({
        status: "offline",
        error: error instanceof Error ? error.message : "Health-check target is not allowed",
        reason: "policy"
      });
    }
    return executeHealthCheck({
      type: body.type,
      target: body.target,
      timeoutMs: body.timeoutMs ?? 3000
    });
  });

  app.post("/api/health-checks", async (request, reply) => {
    const body = healthCheckSchema.parse(request.body);
    const resource = await prisma.resource.findUniqueOrThrow({ where: { id: body.resourceId } });
    if (resource.purpose === "bookmark") return reply.code(400).send({ error: "Bookmarks cannot have health checks" });
    try {
      await validateConfiguredOutboundTarget(healthCheckHostname(body.type, body.target));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Health-check target is not allowed" });
    }
    const check = await prisma.$transaction(async (tx) => {
      const currentPrimary = await tx.healthCheck.findFirst({
        where: { resourceId: body.resourceId, primary: true },
        select: { id: true }
      });
      const makePrimary = body.primary === true || !currentPrimary;
      if (makePrimary) {
        await tx.healthCheck.updateMany({
          where: { resourceId: body.resourceId, primary: true },
          data: { primary: false }
        });
      }
      return tx.healthCheck.create({
        data: { ...body, primary: makePrimary },
        include: { resource: true }
      });
    });
    reply.code(201);
    return check;
  });

  app.patch("/api/health-checks/:id", async (request, reply) => {
    const id = routeId(request);
    const body = healthCheckPatchSchema.parse(request.body);
    const previousCheck = await prisma.healthCheck.findUniqueOrThrow({
      where: { id },
      select: {
        resourceId: true,
        type: true,
        target: true,
        timeoutMs: true,
        failureThreshold: true,
        successThreshold: true,
        enabled: true,
        primary: true
      }
    });
    if (body.primary === false && previousCheck.primary) {
      return reply.code(400).send({
        error: "Promote another check before removing this service's primary check"
      });
    }
    const nextType = body.type ?? previousCheck.type;
    const nextTarget = body.target ?? previousCheck.target;
    const targetError = validateHealthCheckTarget(nextType, nextTarget);
    if (targetError) return reply.code(400).send({ error: targetError });
    if (body.type !== undefined || body.target !== undefined || body.enabled === true) {
      try {
        await validateConfiguredOutboundTarget(healthCheckHostname(nextType, nextTarget));
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Health-check target is not allowed" });
      }
    }
    const resetState = shouldResetHealthCheckAfterPatch(previousCheck, body);
    const nextResourceId = body.resourceId ?? previousCheck.resourceId;
    const willBePrimary = body.primary === true || previousCheck.primary;

    return prisma.$transaction(async (tx) => {
      if (willBePrimary) {
        await tx.healthCheck.updateMany({
          where: {
            resourceId: nextResourceId,
            primary: true,
            id: { not: id }
          },
          data: { primary: false }
        });
      }
      return tx.healthCheck.update({
        where: { id },
        data: resetState ? { ...body, ...resetHealthCheckState } : body,
        include: { resource: true }
      });
    });
  });

  app.delete("/api/health-checks/:id", async (request) => {
    const id = routeId(request);
    await prisma.healthCheck.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/health-checks/:id/run", async (request, reply) => {
    const id = routeId(request);
    const check = await prisma.healthCheck.findUniqueOrThrow({ where: { id }, include: { resource: true } });

    if (check.resource.monitoringMode === "manual" || check.resource.monitoringMode === "disabled") {
      return reply.code(409).send({ error: "Monitoring is not set to automatic for this service." });
    }

    if (!check.enabled) return reply.code(409).send({ error: "Health check is disabled" });

    const outcome = await runHealthCheck(prisma, check);
    return { id, ...outcome };
  });

  app.post("/api/resources/:id/run", async (request, reply) => {
    const id = routeId(request);
    const resource = await prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true } });
    if (resource.monitoringMode !== "auto") {
      return reply.code(409).send({ error: "Monitoring is not set to automatic for this service." });
    }
    const checks = resource.healthChecks.filter((check) => check.enabled);
    if (checks.length === 0) return reply.code(409).send({ error: "No enabled health checks are available" });
    const outcomes: Array<{ id: string; status: string; latencyMs?: number; error?: string }> = [];
    for (let index = 0; index < checks.length; index += 8) {
      outcomes.push(...await Promise.all(
        checks.slice(index, index + 8).map(async (check) => ({ id: check.id, ...(await runHealthCheck(prisma, check)) }))
      ));
    }
    return { id, outcomes };
  });

  let stopScheduler: (() => void) | undefined;
  let stopMetricsScheduler: (() => void) | undefined;
  let stopIntegrationScheduler: (() => void) | undefined;
  let stopTrueNasScheduler: (() => void) | undefined;
  let stopApiWidgetScheduler: (() => void) | undefined;
  let stopAiBriefingScheduler: (() => void) | undefined;
  const shouldMonitor = options.monitor ?? env.nodeEnv !== "test";

  if (shouldMonitor) {
    healthScheduler.enabled = true;
    metricsScheduler.enabled = true;
    integrationScheduler.enabled = isOpnsenseConfigured(env.opnsense);
    trueNasScheduler.enabled = isTrueNasConfigured(env.truenas);
    apiWidgetScheduler.enabled = true;
    aiScheduler.enabled = env.ai.configured;
    await Promise.all([
      syncConfiguredIntegrationSources(prisma, env.opnsense),
      syncConfiguredTrueNasSource(prisma, env.truenas)
    ]);
    stopScheduler = startHealthScheduler(prisma, healthScheduler.intervalMs, (update) => applySchedulerUpdate(healthScheduler, update));
    stopMetricsScheduler = startMetricsScheduler(
      prisma,
      metricsScheduler.intervalMs,
      undefined,
      (update) => applySchedulerUpdate(metricsScheduler, update)
    );
    if (integrationScheduler.enabled) {
      stopIntegrationScheduler = startIntegrationScheduler(
        prisma,
        env.opnsense,
        integrationScheduler.intervalMs,
        (update) => applySchedulerUpdate(integrationScheduler, update)
      );
    }
    if (trueNasScheduler.enabled) {
      stopTrueNasScheduler = startTrueNasScheduler(
        prisma,
        env.truenas,
        trueNasScheduler.intervalMs,
        (update) => applySchedulerUpdate(trueNasScheduler, update)
      );
    }
    stopApiWidgetScheduler = startApiWidgetScheduler(
      prisma,
      apiWidgetScheduler.intervalMs,
      (update) => applySchedulerUpdate(apiWidgetScheduler, update),
      env.apiWidgetSecretAllowlist
    );
    if (aiScheduler.enabled) {
      stopAiBriefingScheduler = startAiBriefingScheduler(
        prisma,
        env.ai,
        aiScheduler.intervalMs,
        (update) => applySchedulerUpdate(aiScheduler, update)
      );
    }
  }

  app.addHook("onClose", async () => {
    stopScheduler?.();
    stopMetricsScheduler?.();
    stopIntegrationScheduler?.();
    stopTrueNasScheduler?.();
    stopApiWidgetScheduler?.();
    stopAiBriefingScheduler?.();
    if (!options.prisma) {
      await prisma.$disconnect();
    }
  });

  const clientDist = resolveClientDist();

  if (clientDist) {
    await app.register(staticFiles, {
      root: clientDist,
      prefix: "/"
    });

    app.setNotFoundHandler((request, reply) => {
      const url = new URL(request.raw.url ?? "/", "http://localhost");

      if (url.pathname.startsWith("/api")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }

      reply.sendFile("index.html");
    });
  }

  return app;
}
