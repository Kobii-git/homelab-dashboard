import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function loginCookie(): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: "test-pass" }
  });

  expect(login.statusCode).toBe(200);
  return login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

describe("api routes", () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication for protected routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/resources" });
    expect(response.statusCode).toBe(401);
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
