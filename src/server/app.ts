import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { isAuthenticated, createAuthToken, SESSION_COOKIE, verifyAdminPassword, hashPassword } from "./auth.js";
import { getEnv, type AppEnv } from "./env.js";
import { wireGuacamoleTunnel, SessionStore } from "./guacamole.js";
import { runHealthCheck, startHealthScheduler } from "./healthChecks.js";
import {
  connectionPatchSchema,
  connectionSchema,
  credentialPatchSchema,
  credentialSchema,
  dashboardGroupPatchSchema,
  dashboardGroupSchema,
  healthCheckPatchSchema,
  healthCheckSchema,
  idParamSchema,
  layoutSchema,
  loginSchema,
  resourcePatchSchema,
  resourceSchema,
  sessionLaunchSchema
} from "./validation.js";
import { decryptCredential, encryptCredential, type PlainCredential } from "./vault.js";
import { seedDemo } from "./seed.js";
import { createAuditEvent } from "./audit.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerVaultRoutes } from "./routes/vault.js";
import { registerWidgetRoutes } from "./routes/widgets.js";
import { serializeSessionHistory } from "./serializers.js";

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

function sanitizeCredential(credential: {
  id: string;
  label: string;
  username: string | null;
  notes?: string | null;
  folderId?: string | null;
  lastUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: credential.id,
    label: credential.label,
    username: credential.username,
    notes: credential.notes ?? null,
    folderId: credential.folderId ?? null,
    lastUsedAt: credential.lastUsedAt ?? null,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt
  };
}

function sanitizeConnection(connection: any) {
  return {
    id: connection.id,
    resourceId: connection.resourceId,
    type: connection.type,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    usernameHint: connection.usernameHint,
    credentialId: connection.credentialId,
    notes: connection.notes,
    favorite: connection.favorite,
    folderId: connection.folderId,
    lastLaunchedAt: connection.lastLaunchedAt,
    sortOrder: connection.sortOrder,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    resource: connection.resource,
    credential: connection.credential ? sanitizeCredential(connection.credential) : null
  };
}

function routeId(request: { params: unknown }): string {
  return idParamSchema.parse(request.params).id;
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const raw = options.env ?? getEnv();
  const env: AppEnv = {
    ...raw,
    cookieSecret: raw.cookieSecret ?? crypto.randomBytes(32).toString("hex"),
    vaultKey: raw.vaultKey ?? crypto.randomBytes(32).toString("hex")
  };
  const prisma = options.prisma ?? new PrismaClient();
  const sessions = new SessionStore();
  const app = Fastify({ logger: options.logger ?? env.nodeEnv === "production" });

  await app.register(cookie, {
    secret: env.cookieSecret
  });

  await app.register(cors, {
    origin: env.nodeEnv === "production" ? false : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true
  });

  await app.register(websocket);

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

    const publicRoutes = new Set(["/api/auth/login", "/api/auth/me", "/api/health", "/api/setup/status", "/api/setup"]);
    if (publicRoutes.has(url.pathname)) {
      return;
    }

    if (!isAuthenticated(request, env)) {
      reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    vaultConfigured: Boolean(env.vaultKey && env.vaultKey.length >= 16),
    guacd: { host: env.guacdHost, port: env.guacdPort }
  }));

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

  app.post("/api/setup", async (request) => {
    const body = z
      .object({ password: z.string().min(1).optional(), seedDemo: z.boolean() })
      .parse(request.body);

    // Create admin account if password provided and no env var override
    if (body.password && !env.adminPassword) {
      const hash = await hashPassword(body.password);
      await prisma.adminAccount.upsert({
        where: { id: "admin" },
        create: { id: "admin", passwordHash: hash },
        update: { passwordHash: hash }
      });
    }

    if (body.seedDemo) {
      await seedDemo(prisma, env.vaultKey);
    }

    const layout = await prisma.dashboardLayout.findUnique({ where: { id: "main" } });
    const existing = parseLayout(layout?.layoutJson ?? "{}");
    await prisma.dashboardLayout.upsert({
      where: { id: "main" },
      create: { id: "main", layoutJson: JSON.stringify({ ...existing, setupDismissed: true }) },
      update: { layoutJson: JSON.stringify({ ...existing, setupDismissed: true }) }
    });
    return { ok: true };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    if (!(await verifyAdminPassword(body.password, env, prisma))) {
      reply.code(401).send({ error: "Invalid password" });
      return;
    }

    reply.setCookie(SESSION_COOKIE, createAuthToken(env), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    return { authenticated: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { authenticated: false };
  });

  app.get("/api/auth/me", async (request) => ({
    authenticated: isAuthenticated(request, env)
  }));

  const routeContext = { app, prisma, env };
  await registerSearchRoutes(routeContext);
  await registerWidgetRoutes(routeContext);
  await registerVaultRoutes(routeContext);
  await registerIncidentRoutes(routeContext);
  await registerAlertRoutes(routeContext);
  await registerSessionRoutes(routeContext);

  app.get("/api/dashboard", async () => {
    const [groups, ungroupedResources, layout] = await Promise.all([
      prisma.dashboardGroup.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          resources: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: {
              healthChecks: true,
              connections: { select: { id: true, type: true } }
            }
          }
        }
      }),
      prisma.resource.findMany({
        where: { groupId: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          healthChecks: true,
          connections: { select: { id: true, type: true } }
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
        healthChecks: true,
        connections: { select: { id: true, type: true } },
        group: true
      }
    })
  );

  app.post("/api/resources", async (request, reply) => {
    const body = resourceSchema.parse(request.body);
    const resource = await prisma.resource.create({ data: body });
    reply.code(201);
    return resource;
  });

  app.patch("/api/resources/:id", async (request) => {
    const id = routeId(request);
    const body = resourcePatchSchema.parse(request.body);
    return prisma.resource.update({ where: { id }, data: body });
  });

  app.delete("/api/resources/:id", async (request) => {
    const id = routeId(request);
    await prisma.resource.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/credentials", async () => {
    const credentials = await prisma.credential.findMany({
      orderBy: [{ label: "asc" }],
      select: {
        id: true,
        label: true,
        username: true,
        notes: true,
        folderId: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return credentials.map(sanitizeCredential);
  });

  app.post("/api/credentials", async (request, reply) => {
    const body = credentialSchema.parse(request.body);
    const encrypted = encryptCredential(
      {
        username: body.username ?? undefined,
        password: body.password ?? undefined,
        domain: body.domain ?? undefined,
        privateKey: body.privateKey ?? undefined,
        passphrase: body.passphrase ?? undefined
      },
      env.vaultKey
    );

    const credential = await prisma.credential.create({
      data: {
        label: body.label,
        username: body.username ?? null,
        notes: body.notes ?? null,
        folderId: body.folderId ?? null,
        ...encrypted
      },
      select: {
        id: true,
        label: true,
        username: true,
        notes: true,
        folderId: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    await createAuditEvent(prisma, {
      action: "credential.created",
      entityType: "credential",
      entityId: credential.id,
      summary: `Created credential ${credential.label}`
    });

    reply.code(201);
    return sanitizeCredential(credential);
  });

  app.patch("/api/credentials/:id", async (request) => {
    const id = routeId(request);
    const body = credentialPatchSchema.parse(request.body);
    const data: Record<string, unknown> = {};

    if (body.label !== undefined) {
      data.label = body.label;
    }

    if (body.username !== undefined) {
      data.username = body.username;
    }

    if (body.notes !== undefined) {
      data.notes = body.notes;
    }

    if (body.folderId !== undefined) {
      data.folderId = body.folderId;
    }

    const hasSecretUpdate =
      body.password !== undefined ||
      body.domain !== undefined ||
      body.privateKey !== undefined ||
      body.passphrase !== undefined;

    if (hasSecretUpdate) {
      Object.assign(
        data,
        encryptCredential(
          {
            username: body.username ?? undefined,
            password: body.password ?? undefined,
            domain: body.domain ?? undefined,
            privateKey: body.privateKey ?? undefined,
            passphrase: body.passphrase ?? undefined
          },
          env.vaultKey
        )
      );
    }

    const credential = await prisma.credential.update({
      where: { id },
      data,
      select: {
        id: true,
        label: true,
        username: true,
        notes: true,
        folderId: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    await createAuditEvent(prisma, {
      action: "credential.updated",
      entityType: "credential",
      entityId: credential.id,
      summary: `Updated credential ${credential.label}`
    });

    return sanitizeCredential(credential);
  });

  app.delete("/api/credentials/:id", async (request) => {
    const id = routeId(request);
    await prisma.credential.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/connections", async () => {
    const connections = await prisma.connection.findMany({
      orderBy: [{ sortOrder: "asc" }, { host: "asc" }],
      include: {
        resource: true,
        credential: {
          select: {
            id: true,
            label: true,
            username: true,
            notes: true,
            folderId: true,
            lastUsedAt: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });

    return connections.map(sanitizeConnection);
  });

  app.post("/api/connections", async (request, reply) => {
    const body = connectionSchema.parse(request.body);
    const connection = await prisma.connection.create({
      data: body,
      include: {
        resource: true,
        credential: {
          select: {
            id: true,
            label: true,
            username: true,
            notes: true,
            folderId: true,
            lastUsedAt: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });
    await createAuditEvent(prisma, {
      action: "connection.created",
      entityType: "connection",
      entityId: connection.id,
      summary: `Created ${connection.type.toUpperCase()} connection to ${connection.host}`
    });

    reply.code(201);
    return sanitizeConnection(connection);
  });

  app.patch("/api/connections/:id", async (request) => {
    const id = routeId(request);
    const body = connectionPatchSchema.parse(request.body);
    const connection = await prisma.connection.update({
      where: { id },
      data: body,
      include: {
        resource: true,
        credential: {
          select: {
            id: true,
            label: true,
            username: true,
            notes: true,
            folderId: true,
            lastUsedAt: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });
    await createAuditEvent(prisma, {
      action: "connection.updated",
      entityType: "connection",
      entityId: connection.id,
      summary: `Updated ${connection.type.toUpperCase()} connection to ${connection.host}`
    });

    return sanitizeConnection(connection);
  });

  app.delete("/api/connections/:id", async (request) => {
    const id = routeId(request);
    await prisma.connection.delete({ where: { id } });
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

  app.post("/api/sessions", async (request, reply) => {
    const body = sessionLaunchSchema.parse(request.body);
    const connection = await prisma.connection.findUnique({
      where: { id: body.connectionId },
      include: { resource: true, credential: true }
    });

    if (!connection) {
      reply.code(404).send({ error: "Connection not found" });
      return;
    }

    let credential: PlainCredential | undefined;

    if (connection.credential) {
      credential = decryptCredential(
        {
          encryptedBlob: connection.credential.encryptedBlob,
          iv: connection.credential.iv,
          authTag: connection.credential.authTag
        },
        env.vaultKey
      );
    }

    const displayName =
      connection.name ?? `${connection.resource.name} ${connection.type.toUpperCase()}`;
    const history = await prisma.sessionHistory.create({
      data: {
        connectionId: connection.id,
        credentialId: connection.credentialId ?? null,
        resourceName: connection.resource.name,
        connectionName: connection.name,
        protocol: connection.type,
        host: connection.host,
        port: connection.port,
        status: "launching",
        hasCredential: Boolean(connection.credential)
      }
    });
    await prisma.connection.update({
      where: { id: connection.id },
      data: { lastLaunchedAt: new Date() }
    });
    if (connection.credentialId) {
      await prisma.credential.update({
        where: { id: connection.credentialId },
        data: { lastUsedAt: new Date() }
      });
    }
    await createAuditEvent(prisma, {
      action: "session.launched",
      entityType: "session",
      entityId: history.id,
      summary: `Launched ${connection.type.toUpperCase()} session to ${connection.host}`,
      metadata: { connectionId: connection.id, resourceId: connection.resourceId }
    });
    const token = sessions.create({
      protocol: connection.type as "rdp" | "ssh",
      host: connection.host,
      port: connection.port,
      displayName,
      usernameHint: connection.usernameHint,
      credential
    });

    return {
      token,
      sessionHistory: serializeSessionHistory(history),
      displayName,
      websocketPath: `/api/tunnel?token=${encodeURIComponent(token)}`
    };
  });

  app.get("/api/tunnel", { websocket: true }, (socket, request) => {
    const url = new URL(request.raw.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      socket.close(1008, "Missing session token");
      return;
    }

    const session = sessions.get(token);

    if (!session) {
      socket.close(1008, "Invalid or expired session token");
      return;
    }

    wireGuacamoleTunnel(socket, session, { host: env.guacdHost, port: env.guacdPort });
  });

  let stopScheduler: (() => void) | undefined;
  const shouldMonitor = options.monitor ?? env.nodeEnv !== "test";

  if (shouldMonitor) {
    stopScheduler = startHealthScheduler(prisma);
  }

  const sweepTimer = setInterval(() => sessions.sweep(), 60 * 1000);

  app.addHook("onClose", async () => {
    stopScheduler?.();
    clearInterval(sweepTimer);
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
