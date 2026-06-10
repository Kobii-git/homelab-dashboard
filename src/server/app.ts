import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { isAuthenticated, createAuthToken, SESSION_COOKIE, verifyAdminPassword, verifyAdminLogin, hashPassword } from "./auth.js";
import { getEnv, type AppEnv } from "./env.js";
import { getBuildInfo } from "../shared/version.js";
import { runHealthCheck, startHealthScheduler } from "./healthChecks.js";
import {
  dashboardGroupPatchSchema,
  dashboardGroupSchema,
  healthCheckPatchSchema,
  healthCheckSchema,
  idParamSchema,
  loginSchema,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTO_PING_INTERVAL_KEY = "auto_ping_interval_seconds";
const AUTO_PING_INTERVAL_DEFAULT = 60;
const AUTO_PING_INTERVAL_MIN = 15;
const AUTO_PING_INTERVAL_MAX = 86400;

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

function normalizedAutoPingTarget(resource: {
  url: string | null;
  host: string | null;
  monitoringMode?: string | null;
}): { type: "http" | "ping"; target: string } | null {
  if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
    return null;
  }

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

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const raw = options.env ?? getEnv();
  const env: AppEnv = {
    ...raw,
    cookieSecret: raw.cookieSecret ?? crypto.randomBytes(32).toString("hex")
  };
  const prisma = options.prisma ?? new PrismaClient();
  const loginLimiter = new RateLimiter(10, 60_000);
  const app = Fastify({ logger: options.logger ?? env.nodeEnv === "production" });

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

  app.get("/api/dashboard", async () => {
    const [groups, ungroupedResources] = await Promise.all([
      prisma.dashboardGroup.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          resources: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: {
              healthChecks: true
            }
          }
        }
      }),
      prisma.resource.findMany({
        where: { groupId: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          healthChecks: true
        }
      })
    ]);

    return {
      groups,
      ungroupedResources,
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

    const resource = await prisma.resource.update({ where: { id }, data, include: { healthChecks: true, group: true } });

    if (resource.monitoringMode === "disabled") {
      await prisma.healthCheck.updateMany({ where: { resourceId: id }, data: { enabled: false } });
      return prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true, group: true } });
    }

    if (body.monitoringMode === "auto") {
      await prisma.healthCheck.updateMany({ where: { resourceId: id }, data: { enabled: true } });
      return prisma.resource.findUniqueOrThrow({ where: { id }, include: { healthChecks: true, group: true } });
    }

    return resource;
  });

  app.delete("/api/resources/:id", async (request) => {
    const id = routeId(request);
    await prisma.resource.delete({ where: { id } });
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
    return prisma.healthCheck.update({ where: { id }, data: body, include: { resource: true } });
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
  const shouldMonitor = options.monitor ?? env.nodeEnv !== "test";

  if (shouldMonitor) {
    stopScheduler = startHealthScheduler(prisma);
  }

  app.addHook("onClose", async () => {
    stopScheduler?.();
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
