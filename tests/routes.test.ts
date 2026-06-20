import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { runHealthCheck } from "../src/server/healthChecks";

const prisma = new PrismaClient();
const env = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  databaseUrl: "file:./data/test.db",
  adminPassword: "test-pass",
  cookieSecret: "test-cookie-secret-with-more-than-32-chars"
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

function mockGlancesFetch(options: { optionalFailure?: boolean; offline?: boolean } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (options.offline && url.includes("/quicklook")) {
      return new Response("offline", { status: 503 });
    }
    if (options.optionalFailure && (url.includes("/fs") || url.includes("/network") || url.includes("/containers"))) {
      return new Response("optional failure", { status: 500 });
    }

    const body = url.includes("/quicklook")
      ? { cpu: 42.4, mem: 55.2, temperature: 47.8 }
      : url.includes("/mem")
        ? { percent: 55.2, used: 5_520_000_000, total: 10_000_000_000 }
        : url.includes("/fs")
          ? [{ mnt_point: "/", percent: 70.1, used: 700_000_000_000, size: 1_000_000_000_000 }]
          : url.includes("/network")
            ? [{ interface_name: "eth0", bytes_recv_rate_per_sec: 1024, bytes_sent_rate_per_sec: 2048 }]
            : url.includes("/containers")
              ? { containers: [{ status: "running" }, { status: "exited" }] }
              : {};

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });
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
    expect(status.json<{ firstRun: boolean; needsAccount: boolean }>()).toEqual({
      firstRun: false,
      needsAccount: false
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
    mockGlancesFetch();

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Docker Host",
        baseUrl: "http://glances.local:61208/",
        primaryMount: "/",
        networkInterface: "eth0"
      }
    });
    expect(created.statusCode).toBe(201);
    const hostId = created.json<{ id: string; baseUrl: string }>().id;
    expect(created.json<{ baseUrl: string }>().baseUrl).toBe("http://glances.local:61208");

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

  it("keeps Glances host samples online when optional endpoints fail", async () => {
    const cookie = await loginCookie();
    mockGlancesFetch({ optionalFailure: true });

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Partial Host",
        baseUrl: "http://partial-glances.local:61208"
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

  it("marks Glances host samples offline when core metrics fail", async () => {
    const cookie = await loginCookie();
    mockGlancesFetch({ offline: true });

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Offline Host",
        baseUrl: "http://offline-glances.local:61208"
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

  it("clears stale Glances host metrics when a host goes offline", async () => {
    const cookie = await loginCookie();
    mockGlancesFetch();

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Flapping Host",
        baseUrl: "http://flapping-glances.local:61208"
      }
    });
    const hostId = created.json<{ id: string }>().id;

    await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });
    let monitor = await prisma.hostMonitor.findUniqueOrThrow({ where: { id: hostId } });
    expect(monitor.latestCpuPercent).toBe(42.4);
    expect(monitor.latestNetworkRxBytesPerSec).toBe(1024);

    vi.restoreAllMocks();
    mockGlancesFetch({ offline: true });
    await app.inject({ method: "POST", url: `/api/metrics/hosts/${hostId}/run`, headers: { cookie } });

    monitor = await prisma.hostMonitor.findUniqueOrThrow({ where: { id: hostId } });
    expect(monitor.latestStatus).toBe("offline");
    expect(monitor.latestCpuPercent).toBeNull();
    expect(monitor.latestMemoryPercent).toBeNull();
    expect(monitor.latestDiskPercent).toBeNull();
    expect(monitor.latestNetworkRxBytesPerSec).toBeNull();
    expect(monitor.latestNetworkTxBytesPerSec).toBeNull();
  });

  it("resets Glances host latest state and history when monitor identity changes", async () => {
    const cookie = await loginCookie();
    mockGlancesFetch();

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Moved Metrics Host",
        baseUrl: "http://old-glances.local:61208",
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
        baseUrl: "http://new-glances.local:61208/",
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
      baseUrl: "http://new-glances.local:61208",
      latestStatus: "unknown",
      latestSampledAt: null,
      latestCpuPercent: null,
      samples: []
    });
    expect(await prisma.hostMetricSample.count({ where: { monitorId: hostId } })).toBe(0);
  });

  it("prunes Glances host metric history to the retention limit", async () => {
    const cookie = await loginCookie();
    mockGlancesFetch();

    const created = await app.inject({
      method: "POST",
      url: "/api/metrics/hosts",
      headers: { cookie },
      payload: {
        name: "Retention Host",
        baseUrl: "http://retention-glances.local:61208"
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
      enabled: true,
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

  it("repairs an already stale auto-created health check target", async () => {
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
      target: "192.0.2.21",
      latestStatus: "unknown",
      latestCheckedAt: null,
      latestError: null,
      consecutiveFailures: 0
    });
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
      where: { resourceId, type: "http", target: "http://old-web.test" }
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
      resources: Array<{ id: string; uptimePercent: number | null; ticks: Array<{ status: string }> }>;
    }>();
    const statusEntry = statusBody.resources.find((item) => item.id === resourceId);
    expect(statusEntry).toBeDefined();
    expect(statusEntry!.uptimePercent).toBe(0);
    expect(statusEntry!.ticks.length).toBeGreaterThanOrEqual(2);
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
    const body = status.json<{ resources: Array<{ id: string; status: string; monitoringMode: string }> }>();
    expect(body.resources.find((item) => item.id === resourceId)).toMatchObject({
      status: "offline",
      monitoringMode: "manual"
    });
  });
});
