import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBackupImport, buildBackupPayload, previewBackupImport } from "../src/server/backup.js";
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

describe("backup import/export", () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exports encrypted credentials and round-trips replace import", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Backup Host", kind: "server", host: "10.0.0.5" }
    });
    const resourceId = resource.json<{ id: string }>().id;

    const credential = await app.inject({
      method: "POST",
      url: "/api/credentials",
      headers: { cookie },
      payload: {
        label: "Backup cred",
        username: "root",
        password: "backup-secret"
      }
    });
    const credentialId = credential.json<{ id: string }>().id;

    await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { cookie },
      payload: {
        resourceId,
        type: "ssh",
        host: "10.0.0.5",
        port: 22,
        credentialId
      }
    });

    const exported = await app.inject({ method: "GET", url: "/api/export", headers: { cookie } });
    expect(exported.statusCode).toBe(200);
    const payload = exported.json<{
      version: string;
      credentials: Array<{ encryptedBlob: string; label: string }>;
      resources: Array<{ name: string }>;
    }>();
    expect(payload.version).toBe("1.0.0");
    expect(payload.credentials.some((item) => item.label === "Backup cred" && item.encryptedBlob)).toBe(true);
    expect(payload.resources.some((item) => item.name === "Backup Host")).toBe(true);
    expect(exported.body).not.toContain("backup-secret");

    const preview = await app.inject({
      method: "POST",
      url: "/api/import/preview",
      headers: { cookie },
      payload: { payload }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ valid: boolean }>().valid).toBe(true);

    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      headers: { cookie },
      payload: {
        password: "test-pass",
        mode: "replace",
        confirmReplace: "REPLACE",
        payload
      }
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json<{ applied: boolean }>().applied).toBe(true);

    const reveal = await app.inject({
      method: "POST",
      url: "/api/vault/reveal",
      headers: { cookie },
      payload: { credentialId, password: "test-pass" }
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json<{ password: string }>().password).toBe("backup-secret");
  });

  it("rejects invalid backup payloads", () => {
    const preview = previewBackupImport({ version: "1.0.0", exportedAt: "now" });
    expect(preview.valid).toBe(false);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it("merge import skips existing ids on second run", async () => {
    const payload = await buildBackupPayload(prisma);
    expect(payload.resources.length).toBeGreaterThan(0);

    const first = await applyBackupImport(prisma, payload, "merge");
    expect(first.applied).toBe(true);

    const second = await applyBackupImport(prisma, payload, "merge");
    expect(second.applied).toBe(true);
    expect(second.skipped.resources).toBe(payload.resources.length);
    expect(second.created.resources).toBe(0);
  });
});
