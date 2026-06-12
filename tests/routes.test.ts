import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";

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
