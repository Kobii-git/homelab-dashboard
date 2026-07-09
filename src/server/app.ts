import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { PrismaClient, type HealthCheck, type HostMonitor } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { isAuthenticated, createAuthToken, SESSION_COOKIE, verifyAdminPassword, verifyAdminLogin, hashPassword } from "./auth.js";
import { getEnv, type AppEnv } from "./env.js";
import { getBuildInfo } from "../shared/version.js";
import { runHealthCheck, startHealthScheduler, type SchedulerUpdate } from "./healthChecks.js";
import { runHostMetricSample, startMetricsScheduler, toHostMonitorDto } from "./metrics.js";
import {
  apiWidgetTemplateById,
  apiWidgetTemplates,
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
  apiWidgetPatchSchema,
  apiWidgetSchema,
  dashboardGroupPatchSchema,
  dashboardGroupSchema,
  healthCheckPatchSchema,
  healthCheckSchema,
  hostMonitorPatchSchema,
  hostMonitorSchema,
  idParamSchema,
  loginSchema,
  reorderSchema,
  resourcePatchSchema,
  resourceSchema,
  settingsSchema
} from "./validation.js";
import { seedDemo } from "./seed.js";
import { registerStatusRoutes } from "./routes/status.js";
import { RateLimiter } from "./rateLimit.js";

type CreateAppOptions = {
  env?: AppEnv;
  prisma?: PrismaClient;
  monitor?: boolean;
  logger?: boolean;
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

type AutoPingTarget = { type: "http" | "ping"; target: string };

type ResourceAddress = {
  url: string | null;
  host: string | null;
};

type ResourceWithHealthChecks = ResourceAddress & {
  id: string;
  monitoringMode?: string | null;
  healthChecks: Pick<
    HealthCheck,
    | "id"
    | "type"
    | "target"
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

function normalizedResourceTarget(resource: ResourceAddress): AutoPingTarget | null {
  const url = resource.url?.trim();
  if (url) {
    const hasScheme = /^https?:\/\//i.test(url);
    return { type: "http", target: hasScheme ? url : `http://${url}` };
  }

  const host = resource.host?.trim();
  if (host) {
    return { type: "ping", target: host };
  }

  return null;
}

function normalizedAutoPingTarget(resource: ResourceAddress & { monitoringMode?: string | null }): AutoPingTarget | null {
  if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
    return null;
  }

  return normalizedResourceTarget(resource);
}

function healthCheckMatchesTarget(check: Pick<HealthCheck, "type" | "target">, target: AutoPingTarget): boolean {
  return check.type === target.type && check.target === target.target;
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

async function syncDefaultHealthCheckTarget(
  prisma: PrismaClient,
  previousResource: ResourceAddress,
  resource: ResourceWithHealthChecks
): Promise<void> {
  const nextTarget = normalizedAutoPingTarget(resource);

  if (!nextTarget) {
    return;
  }

  const previousTarget = normalizedResourceTarget(previousResource);
  const matchingDefaultCheck = previousTarget
    ? resource.healthChecks.find((check) => healthCheckMatchesTarget(check, previousTarget))
    : undefined;
  const autoManagedCandidates = resource.healthChecks.filter(isAutoManagedCheckCandidate);
  const defaultCheck = matchingDefaultCheck ?? (
    autoManagedCandidates.length === 1 ? autoManagedCandidates[0] : undefined
  );

  if (!defaultCheck) {
    if (resource.healthChecks.length === 0) {
      const intervalSeconds = await getAutoPingIntervalSeconds(prisma);
      await prisma.healthCheck.create({
        data: {
          resourceId: resource.id,
          type: nextTarget.type,
          target: nextTarget.target,
          intervalSeconds,
          timeoutMs: 3000,
          failureThreshold: 1,
          successThreshold: 1,
          enabled: true
        }
      });
    }
    return;
  }

  const targetChanged = !healthCheckMatchesTarget(defaultCheck, nextTarget);
  const wasPaused = !defaultCheck.enabled;

  if (!targetChanged && !wasPaused) {
    return;
  }

  await prisma.healthCheck.update({
    where: { id: defaultCheck.id },
    data: {
      type: nextTarget.type,
      target: nextTarget.target,
      enabled: true,
      ...resetHealthCheckState
    }
  });
}

async function syncAutoHealthCheckTargets(prisma: PrismaClient): Promise<void> {
  const resources = await prisma.resource.findMany({
    where: { monitoringMode: "auto" },
    include: { healthChecks: true }
  });

  await Promise.all(resources.map((resource) => syncDefaultHealthCheckTarget(prisma, resource, resource)));
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

async function getAutoPingIntervalSeconds(prisma: PrismaClient): Promise<number> {
  const entry = await prisma.systemConfig.findUnique({ where: { key: AUTO_PING_INTERVAL_KEY } });
  const parsed = Number.parseInt(entry?.value ?? "", 10);
  return clampAutoPingInterval(Number.isNaN(parsed) ? null : parsed);
}

async function setAutoPingIntervalSeconds(prisma: PrismaClient, value: number): Promise<void> {
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
  const prisma = options.prisma ?? new PrismaClient();
  const loginLimiter = new RateLimiter(10, 60_000);
  const app = Fastify({ logger: options.logger ?? env.nodeEnv === "production" });
  const startedAt = new Date();
  const healthScheduler = createSchedulerRuntime(15_000);
  const metricsScheduler = createSchedulerRuntime(15_000);
  const integrationScheduler = createSchedulerRuntime(15_000);
  const apiWidgetScheduler = createSchedulerRuntime(15_000);
  const aiScheduler = createSchedulerRuntime(AI_SCHEDULER_INTERVAL_MS);

  await app.register(cookie, {
    secret: env.cookieSecret
  });

  await app.register(cors, {
    origin: env.nodeEnv === "production" ? false : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true
  });

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

  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.raw.url ?? "/", "http://localhost");

    if (!url.pathname.startsWith("/api")) {
      return;
    }

    const publicRoutes = new Set([
      "/api/auth/login",
      "/api/auth/me",
      "/api/health",
      "/api/version",
      "/api/setup/status",
      "/api/setup",
      "/api/status"
    ]);
    if (publicRoutes.has(url.pathname)) {
      return;
    }

    if (!isAuthenticated(request, env)) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/api/health", async () => {
    return {
      ok: true,
      ...getBuildInfo()
    };
  });

  app.get("/api/version", async () => getBuildInfo());

  app.get("/api/setup/status", async () => {
    const [resourceCount, layout, adminAccount] = await Promise.all([
      prisma.resource.count(),
      isSetupDismissed(prisma),
      env.adminPassword ? null : prisma.adminAccount.findUnique({ where: { id: "admin" } })
    ]);
    const hasAccount = Boolean(env.adminPassword) || Boolean(adminAccount);
    const firstRun = Boolean(resourceCount === 0 && !layout);
    return { firstRun, needsAccount: !hasAccount };
  });

  app.post("/api/setup", async (request, reply) => {
    const body = z
      .object({
        username: z.string().trim().min(1).optional(),
        password: z.string().min(1).optional(),
        seedDemo: z.boolean()
      })
      .parse(request.body);

    const hasAccount = await adminAccountExists(env, prisma);

    if (hasAccount && !isAuthenticated(request, env)) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!hasAccount && !body.password && !env.adminPassword) {
      return reply.code(400).send({ error: "Password is required for first-run setup" });
    }

    if (!hasAccount && body.password && !env.adminPassword) {
      const hash = hashPassword(body.password);
      await prisma.adminAccount.upsert({
        where: { id: "admin" },
        create: { id: "admin", username: body.username ?? "admin", passwordHash: hash },
        update: { username: body.username ?? "admin", passwordHash: hash }
      });
    }

    await setSetupDismissed(prisma);

    if (body.seedDemo) {
      await seedDemo(prisma);
    }

    return { ok: true };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const clientIp = request.ip || "unknown";
    if (!loginLimiter.allow(clientIp)) {
      return reply.code(429).send({ error: "Too many login attempts. Try again shortly." });
    }

    const body = loginSchema.parse(request.body);

    if (!(await verifyAdminLogin(body.username, body.password, env, prisma))) {
      reply.code(401).send({ error: "Invalid password" });
      return;
    }

    reply.setCookie(SESSION_COOKIE, createAuthToken(env), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.cookieSecure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    return { authenticated: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { authenticated: false };
  });

  app.get("/api/auth/me", async (request) => {
    const authenticated = isAuthenticated(request, env);
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
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8)
      })
      .parse(request.body);

    if (!isAuthenticated(request, env)) {
      reply.code(401).send({ error: "Authentication required" });
      return;
    }

    if (env.adminPassword) {
      reply.code(400).send({
        error: "Password is managed by ADMIN_PASSWORD env var on the server. Update docker-compose and restart."
      });
      return;
    }

    if (!(await verifyAdminPassword(body.currentPassword, env, prisma))) {
      reply.code(401).send({ error: "Current password is incorrect" });
      return;
    }

    await prisma.adminAccount.update({
      where: { id: "admin" },
      data: { passwordHash: hashPassword(body.newPassword) }
    });

    return { ok: true };
  });

  await registerStatusRoutes({ app, prisma, env });

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
    await syncConfiguredIntegrationSources(prisma, env.opnsense);
    const [groups, ungroupedResources, hostMonitorsRaw, integrationsRaw, apiWidgetsRaw, aiBriefing] = await Promise.all([
      prisma.dashboardGroup.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          resources: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: dashboardCheckInclude
          }
        }
      }),
      prisma.resource.findMany({
        where: { groupId: null },
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
    const integrations = integrationsRaw.map(toIntegrationSourceDto);
    const apiWidgets = apiWidgetsRaw.map(toApiWidgetDto);
    const resources = [...groups.flatMap((group) => group.resources), ...ungroupedResources];

    return {
      groups,
      ungroupedResources,
      hostMonitors,
      integrations,
      apiWidgets,
      aiBriefing,
      dailyBriefing: buildDailyBriefing(resources, hostMonitors),
      layout: {}
    };
  });

  app.get("/api/settings", async () => {
    const autoPingIntervalSeconds = await getAutoPingIntervalSeconds(prisma);
    return { autoPingIntervalSeconds };
  });

  app.patch("/api/settings", async (request) => {
    const body = settingsSchema.parse(request.body);
    await setAutoPingIntervalSeconds(prisma, body.autoPingIntervalSeconds);
    return { autoPingIntervalSeconds: body.autoPingIntervalSeconds };
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
        cookieSecure: env.cookieSecure
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
        opnsense: opnsenseRuntimeConfig(env.opnsense)
      },
      ai: aiRuntimeConfig(env.ai, cachedAiBriefing),
      schedulers: {
        health: serializeSchedulerRuntime(healthScheduler),
        metrics: serializeSchedulerRuntime(metricsScheduler),
        integrations: serializeSchedulerRuntime(integrationScheduler),
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
    const monitor = await prisma.hostMonitor.create({
      data: createHostMonitorData(body),
      include: hostMonitorInclude
    });
    reply.code(201);
    return toHostMonitorDto(monitor);
  });

  app.patch("/api/metrics/hosts/:id", async (request) => {
    const id = routeId(request);
    const body = hostMonitorPatchSchema.parse(request.body);
    const data = patchHostMonitorData(body);
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
    await syncConfiguredIntegrationSources(prisma, env.opnsense);
    const sources = await prisma.integrationSource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: integrationInclude
    });
    return sources.map(toIntegrationSourceDto);
  });

  app.get("/api/integrations/:id", async (request) => {
    const id = routeId(request);
    await syncConfiguredIntegrationSources(prisma, env.opnsense);
    const source = await prisma.integrationSource.findUniqueOrThrow({
      where: { id },
      include: {
        samples: {
          orderBy: { sampledAt: "desc" },
          take: 1440
        }
      }
    });
    return toIntegrationSourceDto(source);
  });

  app.post("/api/integrations/:id/run", async (request, reply) => {
    const id = routeId(request);
    await syncConfiguredIntegrationSources(prisma, env.opnsense);
    const source = await prisma.integrationSource.findUniqueOrThrow({ where: { id } });

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
    const widget = await prisma.apiWidget.create({
      data: createApiWidgetData(body),
      include: apiWidgetInclude
    });
    reply.code(201);
    return toApiWidgetDto(widget);
  });

  app.patch("/api/api-widgets/:id", async (request) => {
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
    return toApiWidgetDto(widget);
  });

  app.delete("/api/api-widgets/:id", async (request) => {
    const id = routeId(request);
    await prisma.apiWidget.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/api-widgets/:id/run", async (request) => {
    const id = routeId(request);
    const widget = await prisma.apiWidget.findUniqueOrThrow({ where: { id } });
    const outcome = await runApiWidgetSample(prisma, widget);
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

  app.post("/api/resources", async (request, reply) => {
    const body = resourceSchema.parse(request.body);
    const resource = await prisma.resource.create({ data: { ...body } });

    const defaultCheck = normalizedAutoPingTarget(resource);
    if (defaultCheck) {
      const intervalSeconds = await getAutoPingIntervalSeconds(prisma);
      await prisma.healthCheck.create({
        data: {
          resourceId: resource.id,
          type: defaultCheck.type,
          target: defaultCheck.target,
          intervalSeconds,
          timeoutMs: 3000,
          failureThreshold: 1,
          successThreshold: 1,
          enabled: true
        }
      });
    }

    reply.code(201);
    return resource;
  });

  app.patch("/api/resources/:id", async (request) => {
    const id = routeId(request);
    const body = resourcePatchSchema.parse(request.body);
    const data = { ...body };

    if (data.monitoringMode === "auto") {
      data.manualStatus = null;
    }

    const previousResource = await prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true } });
    const resource = await prisma.resource.update({ where: { id }, data, include: { healthChecks: true, group: true } });

    if (resource.monitoringMode === "disabled") {
      await prisma.healthCheck.updateMany({ where: { resourceId: id }, data: { enabled: false } });
      return prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true, group: true } });
    }

    if (body.monitoringMode === "auto") {
      await prisma.healthCheck.updateMany({ where: { resourceId: id }, data: { enabled: true } });
    }

    await syncDefaultHealthCheckTarget(prisma, previousResource, resource);

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

  app.post("/api/health-checks", async (request, reply) => {
    const body = healthCheckSchema.parse(request.body);
    const check = await prisma.healthCheck.create({ data: body, include: { resource: true } });
    reply.code(201);
    return check;
  });

  app.patch("/api/health-checks/:id", async (request) => {
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
        enabled: true
      }
    });
    const resetState = shouldResetHealthCheckAfterPatch(previousCheck, body);

    return prisma.healthCheck.update({
      where: { id },
      data: resetState ? { ...body, ...resetHealthCheckState } : body,
      include: { resource: true }
    });
  });

  app.delete("/api/health-checks/:id", async (request) => {
    const id = routeId(request);
    await prisma.healthCheck.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/health-checks/:id/run", async (request) => {
    const id = routeId(request);
    const check = await prisma.healthCheck.findUniqueOrThrow({ where: { id }, include: { resource: true } });

    if (check.resource.monitoringMode === "manual" || check.resource.monitoringMode === "disabled") {
      return {
        id,
        status: check.resource.manualStatus ?? "unknown",
        error: "Monitoring is not set to automatic for this service."
      };
    }

    const outcome = await runHealthCheck(prisma, check);
    return { id, ...outcome };
  });

  let stopScheduler: (() => void) | undefined;
  let stopMetricsScheduler: (() => void) | undefined;
  let stopIntegrationScheduler: (() => void) | undefined;
  let stopApiWidgetScheduler: (() => void) | undefined;
  let stopAiBriefingScheduler: (() => void) | undefined;
  const shouldMonitor = options.monitor ?? env.nodeEnv !== "test";

  if (shouldMonitor) {
    healthScheduler.enabled = true;
    metricsScheduler.enabled = true;
    integrationScheduler.enabled = isOpnsenseConfigured(env.opnsense);
    apiWidgetScheduler.enabled = true;
    aiScheduler.enabled = env.ai.configured;
    await syncAutoHealthCheckTargets(prisma);
    await syncConfiguredIntegrationSources(prisma, env.opnsense);
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
    stopApiWidgetScheduler = startApiWidgetScheduler(
      prisma,
      apiWidgetScheduler.intervalMs,
      (update) => applySchedulerUpdate(apiWidgetScheduler, update)
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
