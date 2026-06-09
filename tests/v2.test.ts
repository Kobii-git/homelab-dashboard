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
  cookieSecret: "test-cookie-secret-with-more-than-32-chars",
  vaultKey: "test-vault-key-for-homelab-dashboard",
  guacdHost: "127.0.0.1",
  guacdPort: 4822
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

describe("v2 pro console routes", () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("seeds dashboard widgets and searches command targets", async () => {
    const cookie = await loginCookie();
    const widgets = await app.inject({
      method: "GET",
      url: "/api/dashboard/widgets",
      headers: { cookie }
    });
    expect(widgets.statusCode).toBe(200);
    const widgetList = widgets.json<Array<{ id: string; type: string; w: number; sortOrder: number }>>();
    expect(widgetList.map((widget) => widget.type)).toEqual(
      expect.arrayContaining(["serviceStatus", "incidents", "favorites", "failingChecks", "notes"])
    );

    const serviceStatusWidget = widgetList.find((widget) => widget.type === "serviceStatus");
    expect(serviceStatusWidget).toBeTruthy();
    const resizedWidget = await app.inject({
      method: "PATCH",
      url: `/api/dashboard/widgets/${serviceStatusWidget?.id}`,
      headers: { cookie },
      payload: { w: 12, sortOrder: 99 }
    });
    expect(resizedWidget.statusCode).toBe(200);
    expect(resizedWidget.json<{ w: number; sortOrder: number }>()).toEqual(expect.objectContaining({ w: 12, sortOrder: 99 }));

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "NAS",
        kind: "server",
        host: "192.168.1.5",
        url: "https://nas.local"
      }
    });
    expect(resource.statusCode).toBe(201);

    const search = await app.inject({
      method: "GET",
      url: "/api/search?q=nas",
      headers: { cookie }
    });
    expect(search.statusCode).toBe(200);
    expect(search.json<Array<{ title: string; action: string }>>()).toContainEqual(
      expect.objectContaining({ title: "NAS", action: "openUrl" })
    );
  });



  it("creates incidents and alert deliveries from failing checks", async () => {
    const cookie = await loginCookie();
    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Offline endpoint", kind: "other", host: "127.0.0.1" }
    });

    const channel = await app.inject({
      method: "POST",
      url: "/api/alert-channels",
      headers: { cookie },
      payload: {
        name: "Webhook",
        type: "webhook",
        config: { url: "https://example.invalid/hook" }
      }
    });
    expect(channel.statusCode).toBe(201);

    const rule = await app.inject({
      method: "POST",
      url: "/api/alert-rules",
      headers: { cookie },
      payload: {
        name: "Open incidents",
        channelId: channel.json<{ id: string }>().id,
        event: "incident.opened",
        cooldownSeconds: 0
      }
    });
    expect(rule.statusCode).toBe(201);

    const check = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId: resource.json<{ id: string }>().id,
        type: "tcp",
        target: "127.0.0.1:1",
        timeoutMs: 250,
        intervalSeconds: 15,
        failureThreshold: 1
      }
    });

    const run = await app.inject({
      method: "POST",
      url: `/api/health-checks/${check.json<{ id: string }>().id}/run`,
      headers: { cookie }
    });
    expect(run.statusCode).toBe(200);

    const incidents = await app.inject({
      method: "GET",
      url: "/api/incidents",
      headers: { cookie }
    });
    expect(incidents.body).toContain("TCP check failed");

    const deliveries = await app.inject({
      method: "GET",
      url: "/api/alert-deliveries",
      headers: { cookie }
    });
    expect(deliveries.body).toContain("incident.opened");
  });
});
