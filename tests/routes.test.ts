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

  it("creates dashboard inventory without leaking credential secrets", async () => {
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
    const resourceBody = resource.json<{ id: string }>();

    const credential = await app.inject({
      method: "POST",
      url: "/api/credentials",
      headers: { cookie },
      payload: {
        label: "Router admin",
        username: "admin",
        password: "super-secret"
      }
    });
    expect(credential.statusCode).toBe(201);
    expect(credential.body).not.toContain("super-secret");
    expect(credential.body).not.toContain("encryptedBlob");
    const credentialBody = credential.json<{ id: string }>();

    const connection = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie },
      payload: {
        resourceId: resourceBody.id,
        type: "ssh",
        host: "192.168.1.1",
        port: 22,
        credentialId: credentialBody.id
      }
    });
    expect(connection.statusCode).toBe(201);
    expect(connection.body).not.toContain("super-secret");

    const launch = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        connectionId: connection.json<{ id: string }>().id
      }
    });
    expect(launch.statusCode).toBe(200);
    expect(launch.body).not.toContain("super-secret");
    expect(launch.json<{ websocketPath: string }>().websocketPath).toContain("/api/tunnel?token=");
    expect(launch.json<{ websocketPath: string }>().websocketPath).toContain("&session=");
  });

  it("rejects setup after an admin account exists", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { seedDemo: false }
    });
    expect(response.statusCode).toBe(403);
  });

  it("merges credential secrets on partial patch", async () => {
    const cookie = await loginCookie();

    const created = await app.inject({
      method: "POST",
      url: "/api/credentials",
      headers: { cookie },
      payload: {
        label: "Patch merge test",
        username: "admin",
        password: "original-secret",
        domain: "LAB"
      }
    });
    expect(created.statusCode).toBe(201);
    const credentialId = created.json<{ id: string }>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/credentials/${credentialId}`,
      headers: { cookie },
      payload: { password: "updated-secret" }
    });
    expect(patched.statusCode).toBe(200);

    const reveal = await app.inject({
      method: "POST",
      url: "/api/vault/reveal",
      headers: { cookie },
      payload: { credentialId, password: "test-pass" }
    });
    expect(reveal.statusCode).toBe(200);
    const revealed = reveal.json<{ username: string; password: string; domain: string }>();
    expect(revealed.username).toBe("admin");
    expect(revealed.password).toBe("updated-secret");
    expect(revealed.domain).toBe("LAB");
  });

  it("updates encrypted username on username-only patch", async () => {
    const cookie = await loginCookie();

    const created = await app.inject({
      method: "POST",
      url: "/api/credentials",
      headers: { cookie },
      payload: {
        label: "Username patch test",
        username: "root",
        password: "secret"
      }
    });
    const credentialId = created.json<{ id: string }>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/credentials/${credentialId}`,
      headers: { cookie },
      payload: { username: "admin" }
    });
    expect(patched.statusCode).toBe(200);

    const reveal = await app.inject({
      method: "POST",
      url: "/api/vault/reveal",
      headers: { cookie },
      payload: { credentialId, password: "test-pass" }
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json<{ username: string; password: string }>().username).toBe("admin");
    expect(reveal.json<{ password: string }>().password).toBe("secret");
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
});
