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
  layoutSchema,
  loginSchema,
  resourcePatchSchema,
  resourceSchema
} from "./validation.js";
import { seedDemo } from "./seed.js";
import { createAuditEvent } from "./audit.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerWidgetRoutes } from "./routes/widgets.js";
import { RateLimiter } from "./rateLimit.js";

type CreateAppOptions = {
  env?: AppEnv;
  prisma?: PrismaClient;
  monitor?: boolean;
  logger?: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../client");

function parseLayout(layoutJson: string): Record<string, unknown> {
  try {
    return JSON.parse(layoutJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function adminAccountExists(env: AppEnv, prisma: PrismaClient): Promise<boolean> {
  if (env.adminPassword) {
    return true;
  }
  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  return Boolean(account);
}



function routeId(request: { params: unknown }): string {
  return idParamSchema.parse(request.params).id;
}

function splitTagIds<T extends { tagIds?: string[] }>(body: T) {
  const { tagIds, ...rest } = body;
  return { rest, tagIds };
}

function tagConnect(tagIds?: string[]) {
  return tagIds?.length ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {};
}

function tagSet(tagIds?: string[] | undefined) {
  return tagIds !== undefined ? { tags: { set: tagIds.map((id) => ({ id })) } } : {};
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const raw = options.env ?? getEnv();
  const env: AppEnv = {
    ...raw,
    cookieSecret: raw.cookieSecret ?? crypto.randomBytes(32).toString("hex"),
    vaultKey: raw.vaultKey ?? crypto.randomBytes(32).toString("hex")
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
      ...getBuildInfo(),
      alertSecretEncryptionConfigured: Boolean(env.vaultKey && env.vaultKey.length >= 16)
    };
  });

  app.get("/api/version", async () => getBuildInfo());

  app.post("/api/alert-deliveries/:id/retry", async (request) => {
    const id = routeId(request);
    await prisma.alertDelivery.update({
      where: { id },
      data: { status: "queued", error: null }
    });
    return { ok: true };
  });

  app.get("/api/setup/status", async () => {
    const [resourceCount, layout, adminAccount] = await Promise.all([
      prisma.resource.count(),
      prisma.dashboardLayout.findUnique({ where: { id: "main" } }),
      env.adminPassword ? null : prisma.adminAccount.findUnique({ where: { id: "admin" } })
    ]);
    const layoutData = parseLayout(layout?.layoutJson ?? "{}");
    const hasAccount = Boolean(env.adminPassword) || Boolean(adminAccount);
    const emptyDashboard = resourceCount === 0 && !layoutData.setupDismissed;
    return { firstRun: !hasAccount || emptyDashboard, needsAccount: !hasAccount };
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

    // Create admin account
    if (!hasAccount && body.password && !env.adminPassword) {
      const hash = hashPassword(body.password);
      await prisma.adminAccount.upsert({
        where: { id: "admin" },
        create: { id: "admin", username: body.username ?? "admin", passwordHash: hash },
        update: { username: body.username ?? "admin", passwordHash: hash }
      });
    }

    // Mark setup dismissed immediately so the client can proceed
    const layout = await prisma.dashboardLayout.findUnique({ where: { id: "main" } });
    const existing = parseLayout(layout?.layoutJson ?? "{}");
    await prisma.dashboardLayout.upsert({
      where: { id: "main" },
      create: { id: "main", layoutJson: JSON.stringify({ ...existing, setupDismissed: true }) },
      update: { layoutJson: JSON.stringify({ ...existing, setupDismissed: true }) }
    });

    // Seed demo data in the background — don't block the response
    if (body.seedDemo) {
      seedDemo(prisma, env.vaultKey).catch((err) => {
        app.log.error({ err }, "Demo seed failed");
      });
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

  const routeContext = { app, prisma, env };
  await registerSearchRoutes(routeContext);
  await registerWidgetRoutes(routeContext);
  await registerTagRoutes(routeContext);
  await registerIncidentRoutes(routeContext);
  await registerAlertRoutes(routeContext);
  await registerExportRoutes(routeContext);
  await registerStatusRoutes(routeContext);

  app.get("/api/dashboard", async () => {
    const [groups, ungroupedResources, layout] = await Promise.all([
      prisma.dashboardGroup.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          resources: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: {
              tags: true,
              healthChecks: true
            }
          }
        }
      }),
      prisma.resource.findMany({
        where: { groupId: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          tags: true,
          healthChecks: true
        }
      }),
      prisma.dashboardLayout.upsert({
        where: { id: "main" },
        update: {},
        create: { id: "main", layoutJson: "{}" }
      })
    ]);

    return {
      groups,
      ungroupedResources,
      layout: parseLayout(layout.layoutJson)
    };
  });

  app.put("/api/dashboard/layout", async (request) => {
    const body = layoutSchema.parse(request.body);
    const layout = await prisma.dashboardLayout.upsert({
      where: { id: "main" },
      create: { id: "main", layoutJson: JSON.stringify(body.layout) },
      update: { layoutJson: JSON.stringify(body.layout) }
    });

    return { layout: parseLayout(layout.layoutJson) };
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
        tags: true,
        healthChecks: true,
        group: true
      }
    })
  );

  app.post("/api/resources", async (request, reply) => {
    const body = resourceSchema.parse(request.body);
    const { rest, tagIds } = splitTagIds(body);
    const resource = await prisma.resource.create({ data: { ...rest, ...tagConnect(tagIds) } });
    reply.code(201);
    return resource;
  });

  app.patch("/api/resources/:id", async (request) => {
    const id = routeId(request);
    const body = resourcePatchSchema.parse(request.body);
    const { rest, tagIds } = splitTagIds(body);
    return prisma.resource.update({
      where: { id },
      data: { ...rest, ...tagSet(tagIds) },
      include: { tags: true, healthChecks: true, group: true }
    });
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
    const check = await prisma.healthCheck.findUniqueOrThrow({ where: { id } });
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

  if (fs.existsSync(clientDist)) {
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
