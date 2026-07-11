import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { AI_BRIEFING_CACHE_KEY, buildAiBriefingEvidence, isAiBriefingDue } from "../src/server/aiBriefing";
import type { AiEnvConfig } from "../src/server/env";
import { runHealthCheck } from "../src/server/healthChecks";
import { collectOpnsenseSnapshot } from "../src/server/opnsense";
import { createAuthToken } from "../src/server/auth";

const prisma = new PrismaClient();
const disabledAiEnv: AiEnvConfig = {
  enabled: false,
  configured: false,
  providerName: "AI",
  baseUrl: "https://api.openai.com/v1",
  apiKey: null,
  model: null,
  tlsVerify: true,
  briefingIntervalSeconds: 21600,
  includeTargets: false
};
const env = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  databaseUrl: process.env.DATABASE_URL ?? "file:../data/test.db",
  adminPassword: "test-pass",
  cookieSecret: "test-cookie-secret-with-more-than-32-chars",
  cookieSecure: false,
  apiWidgetSecretAllowlist: ["CUSTOM_WIDGET_TOKEN", "TEST_WIDGET_TOKEN"],
  opnsense: {
    enabled: false,
    configured: false,
    name: "OPNsense",
    baseUrl: null,
    apiKey: null,
    apiSecret: null,
    tlsVerify: true,
    pollIntervalSeconds: 60
  },
  ai: disabledAiEnv
};

const app = await createApp({ prisma, env, monitor: false, logger: false });
let cachedCookie: string | null = null;

async function loginCookie(): Promise<string> {
  if (cachedCookie) {
    return cachedCookie;
  }

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: "test-pass" }
  });

  expect(login.statusCode).toBe(200);
  cachedCookie = login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  return cachedCookie;
}

type MockGlancesOptions = { optionalFailure?: boolean; offline?: boolean };

async function withMockGlances<T>(
  initial: MockGlancesOptions,
  run: (baseUrl: string, update: (next: MockGlancesOptions) => void) => Promise<T>
): Promise<T> {
  const state = { ...initial };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (state.offline && pathname.includes("/quicklook")) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "offline" }));
      return;
    }
    if (state.optionalFailure && ["/fs", "/network", "/containers"].some((part) => pathname.includes(part))) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "optional failure" }));
      return;
    }
    const body = pathname.includes("/quicklook")
      ? { cpu: 42.4, mem: 55.2, temperature: 47.8 }
      : pathname.includes("/mem")
        ? { percent: 55.2, used: 5_520_000_000, total: 10_000_000_000 }
        : pathname.includes("/fs")
          ? [{ mnt_point: "/", percent: 70.1, used: 700_000_000_000, size: 1_000_000_000_000 }]
          : pathname.includes("/network")
            ? [{ interface_name: "eth0", bytes_recv_rate_per_sec: 1024, bytes_sent_rate_per_sec: 2048 }]
            : pathname.includes("/containers")
              ? { containers: [{ status: "running" }, { status: "exited" }] }
              : {};
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`, (next) => Object.assign(state, next));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

type MockOpnsenseOptions = {
  optionalFailure?: boolean;
  offline?: boolean;
  invalidJson?: boolean;
  authStatus?: number;
};

function opnsenseBody(pathname: string): unknown {
  if (pathname.includes("/system_information")) {
    return { hostname: "opnsense.lab", uptime: "2 days" };
  }
  if (pathname.includes("/system_resources")) {
    return {
      cpu: { percent: 12.5 },
      memory: { percent: 44.2 },
      swap: { percent: 1.1 }
    };
  }
  if (pathname.includes("/system_disk")) {
    return { disk: { percent: 58.4 } };
  }
  if (pathname.includes("/system_temperature")) {
    return { temperature: 41.2 };
  }
  if (pathname.includes("/interfaces_info")) {
    return {
      rows: [
        { identifier: "wan", name: "WAN", device: "igb0", status: "up", ipv4: "198.51.100.10" },
        { identifier: "lan", name: "LAN", device: "igb1", status: "up", ipv4: "192.168.1.1" }
      ]
    };
  }
  if (pathname.includes("/get_interface_statistics")) {
    return {
      rows: [
        { interface: "wan", bytes_recv_rate_per_sec: 1024, bytes_sent_rate_per_sec: 2048 },
        { interface: "lan", bytes_recv_rate_per_sec: 512, bytes_sent_rate_per_sec: 256 }
      ]
    };
  }
  if (pathname.includes("/search_gateway")) {
    return {
      rows: [
        { name: "WAN_DHCP", status: "online", gateway: "198.51.100.1", interface: "WAN", delay: "9.2 ms", loss: "0.0 %" }
      ]
    };
  }
  if (pathname.includes("/firmware/info")) {
    return { product: "OPNsense", product_version: "26.1", latestVersion: "26.1", updateAvailable: false };
  }
  if (pathname.includes("/firmware/running")) {
    return { version: "26.1" };
  }
  if (pathname.includes("/pf_statistics")) {
    return { stateCount: 321, srcNodes: 10, fragmentCount: 0 };
  }
  if (pathname.includes("/firewall/log")) {
    return { rows: [{ action: "pass" }, { action: "block" }] };
  }
  return {};
}

async function withMockOpnsense<T>(options: MockOpnsenseOptions, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const coreEndpoint = pathname.includes("/system_information") || pathname.includes("/system_resources");

    if (options.authStatus) {
      response.writeHead(options.authStatus, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "auth failed" }));
      return;
    }

    if (options.offline && coreEndpoint) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "offline" }));
      return;
    }

    if (options.invalidJson && coreEndpoint) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{not-json");
      return;
    }

    if (options.optionalFailure && !coreEndpoint) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "optional failure" }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(opnsenseBody(pathname)));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function opnsenseEnv(baseUrl: string) {
  return {
    enabled: true,
    configured: true,
    name: "Lab Firewall",
    baseUrl,
    apiKey: "opn-test-key",
    apiSecret: "opn-test-secret",
    tlsVerify: true,
    pollIntervalSeconds: 60
  };
}

function configuredAiEnv(overrides: Partial<AiEnvConfig> = {}) {
  return {
    ...disabledAiEnv,
    enabled: true,
    configured: true,
    providerName: "Mock AI",
    baseUrl: "http://mock-ai.local/v1",
    apiKey: "ai-secret-key",
    model: "mock-command-model",
    ...overrides
  };
}

async function withMockJsonApi<T>(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe("api routes", () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication for protected routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/resources" });
    expect(response.statusCode).toBe(401);
    const metrics = await app.inject({ method: "GET", url: "/api/metrics/hosts" });
    expect(metrics.statusCode).toBe(401);
    const hostDetail = await app.inject({ method: "GET", url: "/api/metrics/hosts/cm0unauthenticated000000000000" });
    expect(hostDetail.statusCode).toBe(401);
    const integrations = await app.inject({ method: "GET", url: "/api/integrations" });
    expect(integrations.statusCode).toBe(401);
    const apiWidgets = await app.inject({ method: "GET", url: "/api/api-widgets" });
    expect(apiWidgets.statusCode).toBe(401);
    const apiWidgetSuggestions = await app.inject({ method: "GET", url: "/api/api-widget-suggestions" });
    expect(apiWidgetSuggestions.statusCode).toBe(401);
    const aiBriefing = await app.inject({ method: "GET", url: "/api/ai/briefing" });
    expect(aiBriefing.statusCode).toBe(401);
    const runtime = await app.inject({ method: "GET", url: "/api/admin/runtime" });
    expect(runtime.statusCode).toBe(401);
  });

  it("protects first-run setup with a bounded one-time code and strong passwords", async () => {
    await prisma.adminAccount.deleteMany();
    const databaseEnv = { ...env, adminPassword: null };
    const rateApp = await createApp({ prisma, env: databaseEnv, monitor: false, logger: false, setupCode: "ABCDEFGH2345" });
    try {
      const status = await rateApp.inject({ method: "GET", url: "/api/setup/status" });
      expect(status.json()).toMatchObject({ needsAccount: true, needsSetupCode: true });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await rateApp.inject({
          method: "POST",
          url: "/api/setup",
          payload: { username: "admin", password: "long-enough-password", setupCode: "WRONGCODE234", seedDemo: false }
        })).statusCode).toBe(403);
      }
      expect((await rateApp.inject({
        method: "POST",
        url: "/api/setup",
        payload: { username: "admin", password: "long-enough-password", setupCode: "WRONGCODE234", seedDemo: false }
      })).statusCode).toBe(429);
    } finally {
      await rateApp.close();
    }

    const setupApp = await createApp({ prisma, env: databaseEnv, monitor: false, logger: false, setupCode: "BCDEFGHJ3456" });
    try {
      const weak = await setupApp.inject({
        method: "POST",
        url: "/api/setup",
        payload: { username: "admin", password: "short", setupCode: "BCDEFGHJ3456", seedDemo: false }
      });
      expect(weak.statusCode).toBe(400);

      const setup = await setupApp.inject({
        method: "POST",
        url: "/api/setup",
        payload: { username: "admin", password: "long-enough-password", setupCode: "BCDEFGHJ3456", seedDemo: false }
      });
      expect(setup.statusCode).toBe(200);
      const account = await prisma.adminAccount.findUniqueOrThrow({ where: { id: "admin" } });
      expect(account.passwordHash).toMatch(/^scrypt\$32768\$8\$3\$/);
      expect(await prisma.systemConfig.findUnique({ where: { key: "setup_bootstrap_hash" } })).toBeNull();
    } finally {
      await setupApp.close();
      await prisma.adminAccount.deleteMany();
    }
  });

  it("uses unique expiring sessions and actively invalidates copied cookies", async () => {
    await prisma.adminAccount.deleteMany();
    const databaseEnv = { ...env, adminPassword: null };
    const salt = "legacy-test-salt";
    const legacyHash = crypto.pbkdf2Sync("legacy-password-123", salt, 100_000, 64, "sha256").toString("hex");
    await prisma.adminAccount.create({
      data: { id: "admin", username: "admin", passwordHash: `${salt}:${legacyHash}` }
    });
    const authApp = await createApp({ prisma, env: databaseEnv, monitor: false, logger: false });
    try {
      const missingUsername = await authApp.inject({ method: "POST", url: "/api/auth/login", payload: { password: "legacy-password-123" } });
      expect(missingUsername.statusCode).toBe(401);
      const first = await authApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "legacy-password-123" }
      });
      const second = await authApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "legacy-password-123" }
      });
      const firstCookie = first.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
      const secondCookie = second.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
      expect(firstCookie).not.toBe(secondCookie);
      expect((await prisma.adminAccount.findUniqueOrThrow({ where: { id: "admin" } })).passwordHash).toMatch(/^scrypt\$/);

      const tampered = `${firstCookie}x`;
      expect((await authApp.inject({ method: "GET", url: "/api/resources", headers: { cookie: tampered } })).statusCode).toBe(401);
      const expiredToken = await createAuthToken(databaseEnv, prisma, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
      expect((await authApp.inject({
        method: "GET",
        url: "/api/resources",
        headers: { cookie: `homelab_session=${expiredToken}` }
      })).statusCode).toBe(401);

      expect((await authApp.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: firstCookie } })).statusCode).toBe(200);
      expect((await authApp.inject({ method: "GET", url: "/api/resources", headers: { cookie: firstCookie } })).statusCode).toBe(401);
      expect((await authApp.inject({ method: "GET", url: "/api/resources", headers: { cookie: secondCookie } })).statusCode).toBe(401);

      const relogin = await authApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "legacy-password-123" }
      });
      const reloginCookie = relogin.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
      const changed = await authApp.inject({
        method: "POST",
        url: "/api/auth/password",
        headers: { cookie: reloginCookie },
        payload: { currentPassword: "legacy-password-123", newPassword: "new-database-password" }
      });
      expect(changed.statusCode).toBe(200);
      expect((await authApp.inject({ method: "GET", url: "/api/resources", headers: { cookie: reloginCookie } })).statusCode).toBe(401);
    } finally {
      await authApp.close();
      await prisma.adminAccount.deleteMany();
      cachedCookie = null;
    }
  });

  it("rejects browser cross-origin mutations and applies security headers", async () => {
    const cookie = await loginCookie();
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { cookie, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      payload: { name: "Blocked" }
    });
    expect(crossOrigin.statusCode).toBe(403);

    const response = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["strict-transport-security"]).toBeUndefined();

    const secureApp = await createApp({ prisma, env: { ...env, cookieSecure: true }, monitor: false, logger: false });
    try {
      const health = await secureApp.inject({ method: "GET", url: "/api/health" });
      expect(health.headers["strict-transport-security"]).toContain("max-age=31536000");
    } finally {
      await secureApp.close();
    }
  });

  it("allows env-managed admins to dismiss first-run setup after login", async () => {
    const cookie = await loginCookie();

    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      headers: { cookie },
      payload: { seedDemo: false }
    });
    expect(setup.statusCode).toBe(200);

    const status = await app.inject({
      method: "GET",
      url: "/api/setup/status",
      headers: { cookie }
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ firstRun: boolean; needsAccount: boolean; needsSetupCode: boolean }>()).toEqual({
      firstRun: false,
      needsAccount: false,
      needsSetupCode: false
    });
  });

  it("returns no integration sources when OPNsense env is disabled", async () => {
    const cookie = await loginCookie();
    const integrations = await app.inject({
      method: "GET",
      url: "/api/integrations",
      headers: { cookie }
    });

    expect(integrations.statusCode).toBe(200);
    expect(integrations.json<unknown[]>()).toEqual([]);
  });

  it("collects and normalizes read-only OPNsense snapshots", async () => {
    await withMockOpnsense({}, async (baseUrl) => {
      const result = await collectOpnsenseSnapshot(opnsenseEnv(baseUrl));

      expect(result.status).toBe("online");
      expect(result.snapshot).toMatchObject({
        system: {
          hostname: "opnsense.lab",
          cpuPercent: 12.5,
          memoryPercent: 44.2,
          diskPercent: 58.4
        },
        firmware: {
          version: "26.1"
        },
        firewall: {
          stateCount: 321
        }
      });
      expect(result.snapshot!.gateways[0]).toMatchObject({ name: "WAN_DHCP", status: "online" });
      expect(result.snapshot!.interfaces).toHaveLength(2);
      expect(result.snapshot!.importSuggestions.length).toBeGreaterThan(0);
    });
  });

  it("keeps OPNsense snapshots online when optional endpoints fail", async () => {
    await withMockOpnsense({ optionalFailure: true }, async (baseUrl) => {
      const result = await collectOpnsenseSnapshot(opnsenseEnv(baseUrl));

      expect(result.status).toBe("online");
      expect(result.snapshot!.warnings.length).toBeGreaterThan(0);
      expect(result.snapshot!.system.cpuPercent).toBe(12.5);
    });
  });

  it("sanitizes OPNsense failures without leaking credentials", async () => {
    await withMockOpnsense({ authStatus: 403 }, async (baseUrl) => {
      const result = await collectOpnsenseSnapshot(opnsenseEnv(baseUrl));

      expect(result.status).toBe("offline");
      expect(result.error).toContain("HTTP 403");
      expect(result.error).not.toContain("opn-test-key");
      expect(result.error).not.toContain("opn-test-secret");
    });

    await withMockOpnsense({ invalidJson: true }, async (baseUrl) => {
      const result = await collectOpnsenseSnapshot(opnsenseEnv(baseUrl));

      expect(result.status).toBe("offline");
      expect(result.error).toContain("invalid JSON");
    });
  });

  it("creates dashboard groups and resources", async () => {
    const cookie = await loginCookie();

    const group = await app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { cookie },
      payload: { name: "Core" }
    });
    expect(group.statusCode).toBe(201);
    const groupBody = group.json<{ id: string }>();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Router",
        kind: "server",
        host: "192.168.1.1",
        groupId: groupBody.id,
        favorite: true
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceBody = resource.json<{ id: string; name: string }>();
    expect(resourceBody.name).toBe("Router");

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie }
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain("Router");
  });

  it("creates Glances host monitors and includes metrics in the dashboard", async () => {
    const cookie = await loginCookie();
    await withMockGlances({}, async (baseUrl) => {

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Docker Host",
        baseUrl: `${baseUrl}/`,
        primaryMount: "/",
        networkInterface: "eth0"
      }
    });
    expect(created.statusCode).toBe(201);
    const hostId = created.json<{ id: string; baseUrl: string }>().id;
    expect(created.json<{ baseUrl: string }>().baseUrl).toBe(baseUrl);

    const run = await app.inject({
      method: "POST",
      url: `/api/metrics/hosts/${hostId}/run`,
      headers: { cookie }
    });
    expect(run.statusCode).toBe(200);
    expect(run.json<{ status: string; cpuPercent: number }>().status).toBe("online");
    expect(run.json<{ cpuPercent: number }>().cpuPercent).toBe(42.4);
    expect(run.json<{ networkRxBytesPerSec: number; networkTxBytesPerSec: number }>()).toMatchObject({
      networkRxBytesPerSec: 1024,
      networkTxBytesPerSec: 2048
    });

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    expect(dashboard.statusCode).toBe(200);
    const body = dashboard.json<{
      hostMonitors: Array<{ id: string; latestStatus: string; latestMemoryPercent: number; samples: unknown[] }>;
      dailyBriefing: { offlineServices: unknown[]; hostsUnderPressure: unknown[] };
    }>();
    const monitor = body.hostMonitors.find((host) => host.id === hostId);
    expect(monitor).toMatchObject({
      latestStatus: "online",
      latestMemoryPercent: 55.2
    });
    expect(monitor!.samples.length).toBeGreaterThan(0);
    expect(body.dailyBriefing.offlineServices).toBeDefined();
    expect(body.dailyBriefing.hostsUnderPressure).toBeDefined();
    });
  });

  it("keeps Glances host samples online when optional endpoints fail", async () => {
    const cookie = await loginCookie();
    await withMockGlances({ optionalFailure: true }, async (baseUrl) => {

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Partial Host",
        baseUrl
      }
    });
    const hostId = created.json<{ id: string }>().id;
    const run = await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });

    expect(run.statusCode).toBe(200);
    expect(run.json<{ status: string }>().status).toBe("online");
    const monitor = await prisma.hostMonitor.findUniqueOrThrow({ where: { id: hostId } });
    expect(monitor.latestStatus).toBe("online");
    expect(monitor.latestDiskPercent).toBeNull();
    });
  });

  it("marks Glances host samples offline when core metrics fail", async () => {
    const cookie = await loginCookie();
    await withMockGlances({ offline: true }, async (baseUrl) => {

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Offline Host",
        baseUrl
      }
    });
    const hostId = created.json<{ id: string }>().id;
    const run = await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });

    expect(run.statusCode).toBe(200);
    expect(run.json<{ status: string }>().status).toBe("offline");
    const sample = await prisma.hostMetricSample.findFirstOrThrow({
      where: { monitorId: hostId },
      orderBy: { sampledAt: "desc" }
    });
    expect(sample.status).toBe("offline");
    expect(sample.error).toContain("HTTP 503");
    });
  });

  it("clears stale Glances host metrics when a host goes offline", async () => {
    const cookie = await loginCookie();
    await withMockGlances({}, async (baseUrl, update) => {

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Flapping Host",
        baseUrl
      }
    });
    const hostId = created.json<{ id: string }>().id;

    await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });
    let monitor = await prisma.hostMonitor.findUniqueOrThrow({ where: { id: hostId } });
    expect(monitor.latestCpuPercent).toBe(42.4);
    expect(monitor.latestNetworkRxBytesPerSec).toBe(1024);

    update({ offline: true });
    await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });

    monitor = await prisma.hostMonitor.findUniqueOrThrow({ where: { id: hostId } });
    expect(monitor.latestStatus).toBe("offline");
    expect(monitor.latestCpuPercent).toBeNull();
    expect(monitor.latestMemoryPercent).toBeNull();
    expect(monitor.latestDiskPercent).toBeNull();
    expect(monitor.latestNetworkRxBytesPerSec).toBeNull();
    expect(monitor.latestNetworkTxBytesPerSec).toBeNull();
    });
  });

  it("resets Glances host latest state and history when monitor identity changes", async () => {
    const cookie = await loginCookie();
    await withMockGlances({}, async (baseUrl) => {

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Moved Metrics Host",
        baseUrl,
        networkInterface: "eth0"
      }
    });
    const hostId = created.json<{ id: string }>().id;
    await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });
    expect(await prisma.hostMetricSample.count({ where: { monitorId: hostId } })).toBe(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/metrics/hosts/${hostId}`,
      headers: { cookie },
      payload: {
        baseUrl: `${baseUrl}/new/`,
        networkInterface: "en0"
      }
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json<{
      baseUrl: string;
      latestStatus: string;
      latestSampledAt: string | null;
      latestCpuPercent: number | null;
      samples: unknown[];
    }>()).toMatchObject({
      baseUrl: `${baseUrl}/new`,
      latestStatus: "unknown",
      latestSampledAt: null,
      latestCpuPercent: null,
      samples: []
    });
    expect(await prisma.hostMetricSample.count({ where: { monitorId: hostId } })).toBe(0);
    });
  });

  it("prunes Glances host metric history to the retention limit", async () => {
    const cookie = await loginCookie();
    await withMockGlances({}, async (baseUrl) => {

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Retention Host",
        baseUrl
      }
    });
    const hostId = created.json<{ id: string }>().id;

    await prisma.hostMetricSample.createMany({
      data: Array.from({ length: 1441 }, (_, index) => ({
        monitorId: hostId,
        status: "online",
        cpuPercent: index % 100,
        sampledAt: new Date(Date.now() - (1441 - index) * 1000)
      }))
    });

    await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });

    const count = await prisma.hostMetricSample.count({ where: { monitorId: hostId } });
    expect(count).toBe(1440);
    });
  });

  it("returns authenticated Glances host detail with 24h samples", async () => {
    const cookie = await loginCookie();

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Detail Host",
        baseUrl: "http://detail-glances.local:61208"
      }
    });
    const hostId = created.json<{ id: string }>().id;

    await prisma.hostMetricSample.createMany({
      data: Array.from({ length: 1445 }, (_, index) => ({
        monitorId: hostId,
        status: "online",
        cpuPercent: index % 100,
        memoryPercent: 50,
        sampledAt: new Date(Date.now() - index * 60_000)
      }))
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/metrics/hosts/${hostId}`,
      headers: { cookie }
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ id: string; samples: unknown[] }>()).toMatchObject({ id: hostId });
    expect(detail.json<{ samples: unknown[] }>().samples).toHaveLength(1440);
  });

  it("runs OPNsense integration routes, dashboard payload, runtime redaction, and retention", async () => {
    await withMockOpnsense({}, async (baseUrl) => {
      const integrationApp = await createApp({
        prisma,
        env: {
          ...env,
          cookieSecret: "test-cookie-secret-with-more-than-32-chars-opnsense",
          opnsense: opnsenseEnv(baseUrl)
        },
        monitor: false,
        logger: false
      });
      await integrationApp.ready();

      try {
        const login = await integrationApp.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { password: "test-pass" }
        });
        expect(login.statusCode).toBe(200);
        const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");

        const list = await integrationApp.inject({ method: "GET", url: "/api/integrations", headers: { cookie } });
        expect(list.statusCode).toBe(200);
        const sourceId = list.json<Array<{ id: string; name: string; status: string }>>()[0].id;

        const run = await integrationApp.inject({
          method: "POST",
          url: `/api/integrations/${sourceId}/run`,
          headers: { cookie }
        });
        expect(run.statusCode).toBe(200);
        expect(run.json<{ status: string; snapshot: { system: { hostname: string } } }>()).toMatchObject({
          status: "online",
          snapshot: { system: { hostname: "opnsense.lab" } }
        });

        const dashboard = await integrationApp.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
        expect(dashboard.statusCode).toBe(200);
        const dashboardBody = dashboard.json<{
          integrations: Array<{ id: string; latestSnapshot: { gateways: unknown[]; importSuggestions: unknown[] } }>;
        }>();
        expect(dashboardBody.integrations[0].id).toBe(sourceId);
        expect(dashboardBody.integrations[0].latestSnapshot.gateways).toHaveLength(1);
        expect(dashboardBody.integrations[0].latestSnapshot.importSuggestions.length).toBeGreaterThan(0);

        const runtime = await integrationApp.inject({ method: "GET", url: "/api/admin/runtime", headers: { cookie } });
        expect(runtime.statusCode).toBe(200);
        expect(runtime.body).not.toContain("opn-test-key");
        expect(runtime.body).not.toContain("opn-test-secret");
        expect(runtime.json<{
          integrations: { opnsense: { configured: boolean; baseUrl: string } };
          schedulers: { integrations: { enabled: boolean } };
          database: { counts: { integrationSources: number } };
        }>()).toMatchObject({
          integrations: { opnsense: { configured: true, baseUrl } },
          schedulers: { integrations: { enabled: false } }
        });

        await prisma.integrationSample.createMany({
          data: Array.from({ length: 1441 }, (_, index) => ({
            sourceId,
            status: "online",
            sampledAt: new Date(Date.now() - (1441 - index) * 1000)
          }))
        });

        await integrationApp.inject({
          method: "POST",
          url: `/api/integrations/${sourceId}/run`,
          headers: { cookie }
        });
        expect(await prisma.integrationSample.count({ where: { sourceId } })).toBe(1440);
      } finally {
        await integrationApp.close();
      }
    });
  });

  it("returns disabled and unconfigured AI briefing states", async () => {
    await prisma.systemConfig.deleteMany({ where: { key: AI_BRIEFING_CACHE_KEY } });
    const cookie = await loginCookie();

    const disabled = await app.inject({ method: "GET", url: "/api/ai/briefing", headers: { cookie } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<{ status: string; headline: string }>()).toMatchObject({
      status: "disabled",
      headline: "AI briefing is disabled"
    });

    const unconfiguredApp = await createApp({
      prisma,
      env: {
        ...env,
        cookieSecret: "test-cookie-secret-with-more-than-32-chars-ai-unconfigured",
        ai: {
          ...disabledAiEnv,
          enabled: true,
          configured: false,
          model: null
        }
      },
      monitor: false,
      logger: false
    });
    await unconfiguredApp.ready();

    try {
      const login = await unconfiguredApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "test-pass" }
      });
      const unconfiguredCookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
      const response = await unconfiguredApp.inject({ method: "POST", url: "/api/ai/briefing/run", headers: { cookie: unconfiguredCookie } });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ status: string; error: string }>()).toMatchObject({
        status: "unconfigured",
        error: "AI briefing is not configured"
      });
    } finally {
      await unconfiguredApp.close();
    }
  });

  it("generates AI command briefings with sanitized evidence and redacted runtime config", async () => {
    await prisma.systemConfig.deleteMany({ where: { key: AI_BRIEFING_CACHE_KEY } });
    const aiEnv = configuredAiEnv();
    const resource = await prisma.resource.create({
      data: {
        name: "AI Target Service",
        kind: "app",
        url: "http://192.168.50.10:8080/admin",
        monitoringMode: "auto"
      }
    });
    const check = await prisma.healthCheck.create({
      data: {
        resourceId: resource.id,
        type: "http",
        target: "http://192.168.50.10:8080/health",
        latestStatus: "offline",
        latestError: "Timeout contacting http://192.168.50.10:8080 with Bearer super-secret-token",
        consecutiveFailures: 2,
        failureThreshold: 3,
        enabled: true
      }
    });

    const redactedEvidence = await buildAiBriefingEvidence(prisma, aiEnv);
    expect(JSON.stringify(redactedEvidence)).not.toContain("192.168.50.10");
    expect(JSON.stringify(redactedEvidence)).not.toContain("super-secret-token");
    const targetEvidence = await buildAiBriefingEvidence(prisma, { ...aiEnv, includeTargets: true });
    expect(JSON.stringify(targetEvidence)).toContain("192.168.50.10");
    expect(JSON.stringify(targetEvidence)).not.toContain("super-secret-token");

    let capturedBody = "";
    await withMockJsonApi((request, response) => {
      expect(request.url).toBe("/v1/chat/completions");
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        capturedBody = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            severity: "warning",
            headline: "One service needs attention",
            summary: "AI Target Service is offline and close to its failure threshold. Review the existing health check before chasing broader causes.",
            items: [{
              title: "Offline service",
              body: "The current evidence shows a failed HTTP check.",
              severity: "warning",
              evidenceIds: [`resource:${resource.id}`, `check:${check.id}`]
            }],
            nextActions: [
              { label: "Inspect service", resourceId: resource.id },
              { label: "Run check", checkId: check.id }
            ],
            confidence: "high"
          }) } }]
        }));
      });
    }, async (baseUrl) => {
    const aiApp = await createApp({
      prisma,
      env: {
        ...env,
        cookieSecret: "test-cookie-secret-with-more-than-32-chars-ai-success",
        ai: { ...aiEnv, baseUrl: `${baseUrl}/v1` }
      },
      monitor: false,
      logger: false
    });
    await aiApp.ready();

    try {
      const login = await aiApp.inject({ method: "POST", url: "/api/auth/login", payload: { password: "test-pass" } });
      const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");

      const run = await aiApp.inject({ method: "POST", url: "/api/ai/briefing/run", headers: { cookie } });
      expect(run.statusCode).toBe(200);
      expect(run.json<{ status: string; severity: string; headline: string; nextActions: unknown[] }>()).toMatchObject({
        status: "fresh",
        severity: "warning",
        headline: "One service needs attention"
      });
      expect(run.json<{ nextActions: unknown[] }>().nextActions).toHaveLength(2);
      expect(capturedBody).not.toContain("192.168.50.10");
      expect(capturedBody).not.toContain("super-secret-token");
      expect(capturedBody).not.toContain("ai-secret-key");

      const dashboard = await aiApp.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json<{ aiBriefing: { status: string; headline: string } | null }>().aiBriefing).toMatchObject({
        status: "cached",
        headline: "One service needs attention"
      });

      const runtime = await aiApp.inject({ method: "GET", url: "/api/admin/runtime", headers: { cookie } });
      expect(runtime.statusCode).toBe(200);
      expect(runtime.body).not.toContain("ai-secret-key");
      expect(runtime.body).not.toContain("super-secret-token");
      expect(runtime.json<{
        ai: { configured: boolean; apiKeyConfigured: boolean; model: string | null };
        schedulers: { ai: { enabled: boolean } };
      }>()).toMatchObject({
        ai: { configured: true, apiKeyConfigured: true, model: "mock-command-model" },
        schedulers: { ai: { enabled: false } }
      });
    } finally {
      await aiApp.close();
    }
    });
  });

  it("records AI provider failures and malformed responses without breaking the dashboard", async () => {
    await prisma.systemConfig.deleteMany({ where: { key: AI_BRIEFING_CACHE_KEY } });
    const aiEnv = configuredAiEnv();
    let requestCount = 0;
    await withMockJsonApi((_request, response) => {
      requestCount += 1;
      if (requestCount === 1) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "{not-json" } }] }));
      } else {
        response.writeHead(429, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "rate limited" }));
      }
    }, async (baseUrl) => {
    const aiApp = await createApp({
      prisma,
      env: {
        ...env,
        cookieSecret: "test-cookie-secret-with-more-than-32-chars-ai-errors",
        ai: { ...aiEnv, baseUrl: `${baseUrl}/v1` }
      },
      monitor: false,
      logger: false
    });
    await aiApp.ready();

    try {
      const login = await aiApp.inject({ method: "POST", url: "/api/auth/login", payload: { password: "test-pass" } });
      const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");

      const malformed = await aiApp.inject({ method: "POST", url: "/api/ai/briefing/run", headers: { cookie } });
      expect(malformed.statusCode).toBe(200);
      expect(malformed.json<{ status: string; error: string }>()).toMatchObject({
        status: "error",
        error: "AI provider returned malformed JSON"
      });

      const limited = await aiApp.inject({ method: "POST", url: "/api/ai/briefing/run", headers: { cookie } });
      expect(limited.statusCode).toBe(200);
      expect(limited.json<{ status: string; error: string }>()).toMatchObject({
        status: "error",
        error: "AI provider returned HTTP 429"
      });

      const dashboard = await aiApp.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json<{ aiBriefing: { status: string; error: string } | null }>().aiBriefing).toMatchObject({
        status: "error",
        error: "AI provider returned HTTP 429"
      });
    } finally {
      await aiApp.close();
    }
    });
  });

  it("checks AI briefing scheduler due state from cache age", () => {
    const aiEnv = configuredAiEnv({ briefingIntervalSeconds: 3600 });
    const recent = {
      status: "cached" as const,
      severity: "ok" as const,
      generatedAt: new Date().toISOString(),
      headline: "Recent",
      summary: "Recent summary",
      items: [],
      nextActions: [],
      confidence: "medium" as const,
      model: "mock-command-model",
      stale: false,
      error: null
    };
    const old = {
      ...recent,
      generatedAt: new Date(Date.now() - 3601 * 1000).toISOString()
    };

    expect(isAiBriefingDue(null, aiEnv)).toBe(true);
    expect(isAiBriefingDue(recent, aiEnv)).toBe(false);
    expect(isAiBriefingDue(old, aiEnv)).toBe(true);
    expect(isAiBriefingDue(null, disabledAiEnv)).toBe(false);
  });

  it("creates, runs, and retains custom API widgets without leaking env secrets", async () => {
    const cookie = await loginCookie();

    await withMockJsonApi(async (request, response) => {
      const auth = request.headers.authorization;
      if (request.url?.startsWith("/secure") && auth !== "Bearer widget-secret-token") {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        status: "ok",
        count: 42,
        nested: { percent: 88.8 },
        items: [{ id: 1 }, { id: 2 }]
      }));
    }, async (baseUrl) => {
      const templates = await app.inject({ method: "GET", url: "/api/api-widget-templates", headers: { cookie } });
      expect(templates.statusCode).toBe(200);
      expect(templates.body).toContain("home-assistant");

      const grafanaResource = await app.inject({
        method: "POST",
        url: "/api/resources",
        headers: { cookie },
        payload: {
          name: "Grafana API Suggestions",
          kind: "app",
          url: baseUrl,
          description: "Grafana lab metrics",
          icon: "grafana"
        }
      });
      expect(grafanaResource.statusCode).toBe(201);

      const suggestions = await app.inject({ method: "GET", url: "/api/api-widget-suggestions", headers: { cookie } });
      expect(suggestions.statusCode).toBe(200);
      type Suggestion = {
        id: string;
        resourceId: string;
        resourceName: string;
        templateId: string;
        baseUrl: string;
        endpointPath: string;
        authType: string;
        authHeaderName: string | null;
        authEnvVarHint: string | null;
        authValuePrefix: string | null;
        fieldMappings: Array<{ label: string; path: string; kind?: string | null }>;
      };
      const grafanaSuggestion = suggestions.json<Suggestion[]>().find((item) => item.templateId === "grafana" && item.baseUrl === baseUrl);
      expect(grafanaSuggestion).toBeTruthy();
      if (!grafanaSuggestion) throw new Error("Grafana API widget suggestion was not created");
      expect(grafanaSuggestion).toMatchObject({
        resourceName: "Grafana API Suggestions",
        endpointPath: "/api/health",
        authType: "none"
      });
      expect(suggestions.body).not.toContain("widget-secret-token");

      const imported = await app.inject({
        method: "POST",
        url: "/api/api-widgets",
        headers: { cookie },
        payload: {
          name: `${grafanaSuggestion.resourceName} widget`,
          templateId: grafanaSuggestion.templateId,
          baseUrl: grafanaSuggestion.baseUrl,
          endpointPath: grafanaSuggestion.endpointPath,
          authType: grafanaSuggestion.authType,
          authHeaderName: grafanaSuggestion.authHeaderName,
          authEnvVar: grafanaSuggestion.authEnvVarHint,
          authValuePrefix: grafanaSuggestion.authValuePrefix,
          tlsVerify: true,
          pollIntervalSeconds: 300,
          fieldMappings: grafanaSuggestion.fieldMappings,
          enabled: true
        }
      });
      expect(imported.statusCode).toBe(201);

      const dedupedSuggestions = await app.inject({ method: "GET", url: "/api/api-widget-suggestions", headers: { cookie } });
      expect(dedupedSuggestions.json<Suggestion[]>().some((item) => item.id === grafanaSuggestion.id)).toBe(false);

      const created = await app.inject({
        method: "POST",
        url: "/api/api-widgets",
        headers: { cookie },
        payload: {
          name: "Mock API",
          templateId: "custom-json",
          baseUrl,
          endpointPath: "/stats",
          authType: "none",
          tlsVerify: true,
          pollIntervalSeconds: 60,
          fieldMappings: [
            { label: "Status", path: "status", kind: "text" },
            { label: "Count", path: "count", kind: "number" },
            { label: "Items", path: "items", kind: "count" },
            { label: "Load", path: "nested.percent", kind: "percent" }
          ]
        }
      });
      expect(created.statusCode).toBe(201);
      const widgetId = created.json<{ id: string }>().id;

      const run = await app.inject({ method: "POST", url: `/api/api-widgets/${widgetId}/run`, headers: { cookie } });
      expect(run.statusCode).toBe(200);
      expect(run.json<{ status: string; snapshot: { fields: Array<{ label: string; value: string }> } }>()).toMatchObject({
        status: "online",
        snapshot: {
          fields: [
            { label: "Status", value: "ok" },
            { label: "Count", value: "42" },
            { label: "Items", value: "2" },
            { label: "Load", value: "88.8%" }
          ]
        }
      });

      const dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json<{ apiWidgets: Array<{ id: string; latestSnapshot: unknown }> }>().apiWidgets.some((widget) => widget.id === widgetId)).toBe(true);

      const runtime = await app.inject({ method: "GET", url: "/api/admin/runtime", headers: { cookie } });
      expect(runtime.statusCode).toBe(200);
      expect(runtime.json<{ database: { counts: { apiWidgets: number; apiWidgetSamples: number } } }>().database.counts.apiWidgets).toBeGreaterThanOrEqual(1);

      await prisma.apiWidgetSample.createMany({
        data: Array.from({ length: 1441 }, (_, index) => ({
          widgetId,
          status: "online",
          sampledAt: new Date(Date.now() - (1441 - index) * 1000)
        }))
      });
      await app.inject({ method: "POST", url: `/api/api-widgets/${widgetId}/run`, headers: { cookie } });
      expect(await prisma.apiWidgetSample.count({ where: { widgetId } })).toBe(1440);

      process.env.TEST_WIDGET_TOKEN = "widget-secret-token";
      const protectedSecret = await app.inject({
        method: "POST",
        url: "/api/api-widgets",
        headers: { cookie },
        payload: {
          name: "Forbidden secret",
          templateId: "custom-json",
          baseUrl,
          endpointPath: "/secure",
          authType: "bearer",
          authEnvVar: "COOKIE_SECRET",
          fieldMappings: [{ label: "Status", path: "status", kind: "text" }]
        }
      });
      expect(protectedSecret.statusCode).toBe(400);

      const secure = await app.inject({
        method: "POST",
        url: "/api/api-widgets",
        headers: { cookie },
        payload: {
          name: "Secure API",
          templateId: "custom-json",
          baseUrl,
          endpointPath: "/secure",
          authType: "bearer",
          authEnvVar: "TEST_WIDGET_TOKEN",
          fieldMappings: [{ label: "Status", path: "status", kind: "text" }]
        }
      });
      expect(secure.statusCode).toBe(201);
      const secureId = secure.json<{ id: string }>().id;

      const secureRun = await app.inject({ method: "POST", url: `/api/api-widgets/${secureId}/run`, headers: { cookie } });
      expect(secureRun.json<{ status: string }>().status).toBe("online");

      const forbiddenPatch = await app.inject({
        method: "PATCH",
        url: `/api/api-widgets/${secureId}`,
        headers: { cookie },
        payload: { authEnvVar: "COOKIE_SECRET" }
      });
      expect(forbiddenPatch.statusCode).toBe(400);

      delete process.env.TEST_WIDGET_TOKEN;

      const failed = await app.inject({ method: "POST", url: `/api/api-widgets/${secureId}/run`, headers: { cookie } });
      expect(failed.statusCode).toBe(200);
      expect(failed.json<{ status: string; error: string }>().status).toBe("offline");
      expect(failed.body).not.toContain("widget-secret-token");
    });
  });

  it("exposes runtime diagnostics without secrets", async () => {
    const cookie = await loginCookie();

    const runtime = await app.inject({
      method: "GET",
      url: "/api/admin/runtime",
      headers: { cookie }
    });

    expect(runtime.statusCode).toBe(200);
    const body = runtime.json<{
      build: { version: string };
      auth: { source: string };
      database: { ok: boolean; counts: { resources: number } };
      schedulers: { health: { enabled: boolean }; metrics: { enabled: boolean } };
    }>();
    expect(body.build.version).toBe("0.8.0");
    expect(body.auth.source).toBe("env");
    expect(body.database.ok).toBe(true);
    expect(body.database.counts.resources).toBeGreaterThanOrEqual(0);
    expect(body.schedulers.health.enabled).toBe(false);
    expect(runtime.body).not.toContain("test-pass");
    expect(runtime.body).not.toContain("test-cookie-secret");
  });

  it("uses health thresholds as stable status gates and surfaces pending checks", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Threshold Web",
        kind: "app"
      }
    });
    const resourceId = resource.json<{ id: string }>().id;

    const check = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId,
        type: "http",
        target: "http://threshold-web.test",
        intervalSeconds: 15,
        timeoutMs: 250,
        failureThreshold: 3,
        successThreshold: 2
      }
    });
    const checkId = check.json<{ id: string }>().id;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));

    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });
    let current = await prisma.healthCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(current.latestStatus).toBe("unknown");
    expect(current.consecutiveFailures).toBe(1);

    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });
    current = await prisma.healthCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(current.latestStatus).toBe("unknown");
    expect(current.consecutiveFailures).toBe(2);

    let dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    let briefing = dashboard.json<{
      dailyBriefing: {
        summary: { pendingFailures: number; pendingRecoveries: number };
        watchlist: Array<{ checkId: string; direction: string; consecutive: number; threshold: number }>;
      };
    }>().dailyBriefing;
    expect(briefing.watchlist).toContainEqual(expect.objectContaining({
      checkId,
      direction: "failing",
      consecutive: 2,
      threshold: 3
    }));
    expect(briefing.summary.pendingFailures).toBeGreaterThanOrEqual(1);

    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });
    current = await prisma.healthCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(current.latestStatus).toBe("offline");
    expect(current.consecutiveFailures).toBe(3);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });
    current = await prisma.healthCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(current.latestStatus).toBe("offline");
    expect(current.consecutiveSuccesses).toBe(1);

    dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    briefing = dashboard.json<{
      dailyBriefing: {
        summary: { pendingFailures: number; pendingRecoveries: number };
        watchlist: Array<{ checkId: string; direction: string; consecutive: number; threshold: number }>;
      };
    }>().dailyBriefing;
    expect(briefing.watchlist).toContainEqual(expect.objectContaining({
      checkId,
      direction: "recovering",
      consecutive: 1,
      threshold: 2
    }));
    expect(briefing.summary.pendingRecoveries).toBeGreaterThanOrEqual(1);

    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });
    current = await prisma.healthCheck.findUniqueOrThrow({ where: { id: checkId } });
    expect(current.latestStatus).toBe("online");
    expect(current.consecutiveSuccesses).toBe(2);
    expect(await prisma.healthResult.count({ where: { checkId } })).toBe(5);
  });

  it("syncs the default health check when a service address changes", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Moving Host",
        kind: "server",
        host: "192.0.2.10"
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json<{ id: string }>().id;

    const defaultCheck = await prisma.healthCheck.findFirstOrThrow({
      where: { resourceId, type: "ping", target: "192.0.2.10" }
    });

    const custom = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId,
        type: "tcp",
        target: "192.0.2.10:443",
        timeoutMs: 250,
        intervalSeconds: 15
      }
    });
    expect(custom.statusCode).toBe(201);
    const customCheckId = custom.json<{ id: string }>().id;

    await prisma.healthCheck.update({
      where: { id: defaultCheck.id },
      data: {
        enabled: false,
        latestStatus: "offline",
        latestLatencyMs: 3000,
        latestCheckedAt: new Date(),
        latestError: "Timeout",
        consecutiveFailures: 4,
        lastTransitionAt: new Date()
      }
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/resources/${resourceId}`,
      headers: { cookie },
      payload: { host: "192.0.2.11" }
    });
    expect(patched.statusCode).toBe(200);

    const body = patched.json<{
      healthChecks: Array<{
        id: string;
        type: string;
        target: string;
        enabled: boolean;
        latestStatus: string;
        latestLatencyMs: number | null;
        latestCheckedAt: string | null;
        latestError: string | null;
        consecutiveFailures: number;
      }>;
    }>();

    expect(body.healthChecks.find((check) => check.id === defaultCheck.id)).toMatchObject({
      type: "ping",
      target: "192.0.2.11",
      enabled: false,
      latestStatus: "unknown",
      latestLatencyMs: null,
      latestCheckedAt: null,
      latestError: null,
      consecutiveFailures: 0
    });
    expect(body.healthChecks.find((check) => check.id === customCheckId)).toMatchObject({
      type: "tcp",
      target: "192.0.2.10:443"
    });
  });

  it("does not repair a managed check during an unrelated resource edit", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Previously Moved Host",
        kind: "server",
        host: "192.0.2.20"
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json<{ id: string }>().id;

    const defaultCheck = await prisma.healthCheck.findFirstOrThrow({
      where: { resourceId, type: "ping", target: "192.0.2.20" }
    });

    await prisma.resource.update({
      where: { id: resourceId },
      data: { host: "192.0.2.21" }
    });
    await prisma.healthCheck.update({
      where: { id: defaultCheck.id },
      data: {
        latestStatus: "offline",
        latestLatencyMs: 3000,
        latestCheckedAt: new Date(),
        latestError: "Timeout",
        consecutiveFailures: 4,
        lastTransitionAt: new Date()
      }
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/resources/${resourceId}`,
      headers: { cookie },
      payload: { favorite: true }
    });
    expect(patched.statusCode).toBe(200);

    const body = patched.json<{
      healthChecks: Array<{
        id: string;
        target: string;
        latestStatus: string;
        latestCheckedAt: string | null;
        latestError: string | null;
        consecutiveFailures: number;
      }>;
    }>();

    expect(body.healthChecks.find((check) => check.id === defaultCheck.id)).toMatchObject({
      target: "192.0.2.20",
      latestStatus: "offline",
      latestError: "Timeout",
      consecutiveFailures: 4
    });
  });

  it("preserves deleted defaults across edits and app restart, but creates one on an explicit auto transition", async () => {
    const cookie = await loginCookie();
    const created = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Deleted Default", kind: "server", host: "192.0.2.31" }
    });
    const resourceId = created.json<{ id: string }>().id;
    const managed = await prisma.healthCheck.findFirstOrThrow({ where: { resourceId, managed: true } });
    await app.inject({ method: "DELETE", url: `/api/health-checks/${managed.id}`, headers: { cookie } });
    await app.inject({ method: "PATCH", url: `/api/resources/${resourceId}`, headers: { cookie }, payload: { favorite: true } });
    expect(await prisma.healthCheck.count({ where: { resourceId } })).toBe(0);

    const restarted = await createApp({ prisma, env, monitor: false, logger: false });
    await restarted.ready();
    await restarted.close();
    expect(await prisma.healthCheck.count({ where: { resourceId } })).toBe(0);

    await app.inject({ method: "PATCH", url: `/api/resources/${resourceId}`, headers: { cookie }, payload: { monitoringMode: "manual" } });
    await app.inject({ method: "PATCH", url: `/api/resources/${resourceId}`, headers: { cookie }, payload: { monitoringMode: "auto" } });
    expect(await prisma.healthCheck.findFirst({ where: { resourceId, managed: true } })).toBeTruthy();
  });

  it("runs every enabled check for a resource and rejects disabled checks", async () => {
    const cookie = await loginCookie();
    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Multi Check", kind: "app" }
    });
    const resourceId = resource.json<{ id: string }>().id;
    const first = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: { resourceId, type: "http", target: "http://first-check.test", enabled: true }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: { resourceId, type: "http", target: "http://second-check.test", enabled: true }
    });
    const disabled = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: { resourceId, type: "http", target: "http://disabled-check.test", enabled: false }
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const run = await app.inject({ method: "POST", url: `/api/resources/${resourceId}/run`, headers: { cookie } });
    expect(run.statusCode).toBe(200);
    expect(run.json<{ outcomes: unknown[] }>().outcomes).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(await prisma.healthResult.count({
      where: { checkId: { in: [first.json<{ id: string }>().id, second.json<{ id: string }>().id] } }
    })).toBe(2);

    const disabledRun = await app.inject({
      method: "POST",
      url: `/api/health-checks/${disabled.json<{ id: string }>().id}/run`,
      headers: { cookie }
    });
    expect(disabledRun.statusCode).toBe(409);
  });

  it("clears stale offline state when a health check target is edited", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Retargeted Web",
        kind: "app",
        url: "http://old-web.test"
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json<{ id: string }>().id;

    const check = await prisma.healthCheck.findFirstOrThrow({
      where: { resourceId, type: "http", target: "http://old-web.test/" }
    });

    await prisma.healthCheck.update({
      where: { id: check.id },
      data: {
        latestStatus: "offline",
        latestLatencyMs: 3000,
        latestCheckedAt: new Date(),
        latestError: "fetch failed",
        consecutiveFailures: 5,
        consecutiveSuccesses: 0,
        lastTransitionAt: new Date()
      }
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/health-checks/${check.id}`,
      headers: { cookie },
      payload: { target: "http://new-web.test" }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{
      target: string;
      latestStatus: string;
      latestLatencyMs: number | null;
      latestCheckedAt: string | null;
      latestError: string | null;
      consecutiveFailures: number;
      consecutiveSuccesses: number;
      lastTransitionAt: string | null;
    }>()).toMatchObject({
      target: "http://new-web.test",
      latestStatus: "unknown",
      latestLatencyMs: null,
      latestCheckedAt: null,
      latestError: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastTransitionAt: null
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const run = await app.inject({
      method: "POST",
      url: `/api/health-checks/${check.id}/run`,
      headers: { cookie }
    });
    expect(run.statusCode).toBe(200);
    expect(run.json<{ status: string }>().status).toBe("online");

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    const entry = dashboard.json<{
      ungroupedResources: Array<{
        id: string;
        healthChecks: Array<{ latestStatus: string; target: string }>;
      }>;
    }>().ungroupedResources.find((item) => item.id === resourceId);
    expect(entry?.healthChecks).toContainEqual(expect.objectContaining({
      target: "http://new-web.test",
      latestStatus: "online"
    }));
  });

  it("runs a TCP health check and stores the latest result", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Missing TCP",
        kind: "other",
        host: "127.0.0.1"
      }
    });

    const check = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId: resource.json<{ id: string }>().id,
        type: "tcp",
        target: "127.0.0.1:1",
        timeoutMs: 250,
        intervalSeconds: 15
      }
    });
    expect(check.statusCode).toBe(201);

    const run = await app.inject({
      method: "POST",
      url: `/api/health-checks/${check.json<{ id: string }>().id}/run`,
      headers: { cookie }
    });

    expect(run.statusCode).toBe(200);
    expect(run.json<{ status: string }>().status).toBe("offline");
  });

  it("ignores stale health check outcomes after the target changes", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Race Check Host",
        kind: "other"
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json<{ id: string }>().id;

    const check = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId,
        type: "tcp",
        target: "127.0.0.1:1",
        timeoutMs: 250,
        intervalSeconds: 15
      }
    });
    expect(check.statusCode).toBe(201);
    const checkId = check.json<{ id: string }>().id;
    const staleCheck = await prisma.healthCheck.findUniqueOrThrow({ where: { id: checkId } });

    await prisma.healthCheck.update({
      where: { id: checkId },
      data: { target: "127.0.0.1:2", latestStatus: "unknown" }
    });

    await runHealthCheck(prisma, staleCheck);

    const currentCheck = await prisma.healthCheck.findUniqueOrThrow({
      where: { id: checkId },
      include: { results: true }
    });
    expect(currentCheck.latestStatus).toBe("unknown");
    expect(currentCheck.results).toHaveLength(0);
  });

  it("reorders resources and persists sort order", async () => {
    const cookie = await loginCookie();

    const created: string[] = [];
    for (const name of ["Reorder A", "Reorder B", "Reorder C"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/resources",
        headers: { cookie },
        payload: { name, kind: "app", host: "192.168.77.1" }
      });
      expect(response.statusCode).toBe(201);
      created.push(response.json<{ id: string }>().id);
    }

    const reversed = [...created].reverse();
    const reorder = await app.inject({
      method: "POST",
      url: "/api/resources/reorder",
      headers: { cookie },
      payload: { ids: reversed }
    });
    expect(reorder.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/resources", headers: { cookie } });
    const ordered = list
      .json<Array<{ id: string; sortOrder: number }>>()
      .filter((item) => created.includes(item.id))
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((item) => item.id);
    expect(ordered).toEqual(reversed);

    const bogus = await app.inject({
      method: "POST",
      url: "/api/resources/reorder",
      headers: { cookie },
      payload: { ids: ["cjld2cjxh0000qzrmn831i7rn"] }
    });
    expect(bogus.statusCode).toBe(400);
  });

  it("returns recent results in the dashboard payload and uptime on the status page", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "History Box", kind: "server", host: "127.0.0.1" }
    });
    const resourceId = resource.json<{ id: string }>().id;

    const check = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId,
        type: "tcp",
        target: "127.0.0.1:1",
        timeoutMs: 250,
        intervalSeconds: 15
      }
    });
    const checkId = check.json<{ id: string }>().id;

    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/health-checks/${checkId}/run`, headers: { cookie } });

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    expect(dashboard.statusCode).toBe(200);
    const payload = dashboard.json<{
      ungroupedResources: Array<{
        id: string;
        healthChecks: Array<{ results: Array<{ status: string; checkedAt: string }> }>;
      }>;
    }>();
    const historyBox = payload.ungroupedResources.find((item) => item.id === resourceId);
    expect(historyBox).toBeDefined();
    const results = historyBox!.healthChecks.flatMap((item) => item.results);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((result) => result.status === "offline")).toBe(true);

    const status = await app.inject({ method: "GET", url: "/api/status" });
    const statusBody = status.json<{
      resources: Array<{ name: string; uptimePercent: number | null; ticks: string[] }>;
    }>();
    const statusEntry = statusBody.resources.find((item) => item.name === "History Box");
    expect(statusEntry).toBeDefined();
    expect(statusEntry!.uptimePercent).toBe(0);
    expect(statusEntry!.ticks.length).toBeGreaterThanOrEqual(2);
    expect(status.body).not.toContain(resourceId);
    expect(status.body).not.toContain("127.0.0.1");
    expect(Object.keys(statusEntry!)).toEqual(["name", "status", "uptimePercent", "ticks"]);
  });

  it("supports device-level monitoring disable and manual status override", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Manual NAS",
        kind: "server",
        host: "192.168.50.10",
        monitoringMode: "disabled",
        manualStatus: "online"
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json<{ id: string }>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/resources/${resourceId}`,
      headers: { cookie },
      payload: {
        monitoringMode: "manual",
        manualStatus: "offline"
      }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ monitoringMode: string; manualStatus: string }>().monitoringMode).toBe("manual");
    expect(patched.json<{ monitoringMode: string; manualStatus: string }>().manualStatus).toBe("offline");

    const status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.statusCode).toBe(200);
    const body = status.json<{ overallStatus: string; resources: Array<{ name: string; status: string }> }>();
    expect(body.resources.find((item) => item.name === "Manual NAS")).toEqual({
      name: "Manual NAS",
      status: "offline",
      uptimePercent: null,
      ticks: []
    });
    expect(body.overallStatus).toBe("degraded");
  });
});
