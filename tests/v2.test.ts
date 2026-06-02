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
    expect(widgets.json<Array<{ type: string }>>().some((widget) => widget.type === "incidents")).toBe(true);

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

  it("reveals vault secrets only after re-authentication and logs audit", async () => {
    const cookie = await loginCookie();
    const credential = await app.inject({
      method: "POST",
      url: "/api/credentials",
      headers: { cookie },
      payload: {
        label: "NAS root",
        username: "root",
        password: "vault-secret"
      }
    });
    expect(credential.statusCode).toBe(201);
    const credentialId = credential.json<{ id: string }>().id;

    const denied = await app.inject({
      method: "POST",
      url: "/api/vault/reveal",
      headers: { cookie },
      payload: { credentialId, password: "wrong" }
    });
    expect(denied.statusCode).toBe(403);

    const revealed = await app.inject({
      method: "POST",
      url: "/api/vault/reveal",
      headers: { cookie },
      payload: { credentialId, password: "test-pass" }
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json<{ password: string }>().password).toBe("vault-secret");

    const audit = await app.inject({
      method: "GET",
      url: "/api/vault/audit",
      headers: { cookie }
    });
    expect(audit.body).toContain("vault.reveal");
  });

  it("records session history when launching a connection", async () => {
    const cookie = await loginCookie();
    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Jumpbox", kind: "server", host: "192.168.1.10" }
    });
    const connection = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie },
      payload: {
        resourceId: resource.json<{ id: string }>().id,
        type: "ssh",
        host: "192.168.1.10",
        port: 22
      }
    });

    const launch = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: { connectionId: connection.json<{ id: string }>().id }
    });
    expect(launch.statusCode).toBe(200);
    expect(launch.json<{ sessionHistory: { id: string } }>().sessionHistory.id).toBeTruthy();

    const history = await app.inject({
      method: "GET",
      url: "/api/sessions/history",
      headers: { cookie }
    });
    expect(history.body).toContain("Jumpbox");
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
