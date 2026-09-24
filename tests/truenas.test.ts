import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { AppEnv, TrueNasEnvConfig } from "../src/server/env.js";
import { configureOutboundPolicy, resetOutboundPolicyForTests } from "../src/server/outboundPolicy.js";
import { collectTrueNasSnapshot } from "../src/server/truenas.js";

const NO_RESPONSE = Symbol("no-response");

function policyEnv(): AppEnv {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    databaseUrl: "file:test.db",
    appOrigin: null,
    trustedProxyCidrs: [],
    adminPassword: "test-pass",
    cookieSecret: "test-cookie-secret-with-more-than-32-chars",
    cookieSecure: false,
    sessionMaxAgeSeconds: 3600,
    setupCode: null,
    publicStatusMode: "disabled",
    outboundAllowedCidrs: [],
    outboundAllowedHosts: [],
    allowInsecureIntegrations: true,
    apiWidgetSecretAllowlist: [],
    opnsense: { enabled: false, configured: false, name: "OPNsense", baseUrl: null, apiKey: null, apiSecret: null, tlsVerify: true, pollIntervalSeconds: 60 },
    google: { configured: false, clientId: null, clientSecret: null, refreshToken: null, calendarIds: ["primary"] },
    todoist: { configured: false, apiToken: null },
    tmdb: { configured: false, bearerToken: null },
    truenas: { enabled: false, configured: false, name: "TrueNAS", baseUrl: null, username: null, apiKey: null, poolName: null, datasetName: null, tlsVerify: true, pollIntervalSeconds: 60 },
    ai: { enabled: false, configured: false, providerName: "AI", baseUrl: "https://api.openai.com/v1", apiKey: null, model: null, tlsVerify: true, briefingIntervalSeconds: 21600, includeTargets: false }
  };
}

async function fakeTrueNas(
  handler: (method: string, params: unknown[]) => unknown | typeof NO_RESPONSE
): Promise<{ config: TrueNasEnvConfig; methods: string[]; close: () => Promise<void> }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-truenas-wss-"));
  const key = path.join(directory, "key.pem");
  const cert = path.join(directory, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", key, "-out", cert
  ], { stdio: "ignore" });
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
  const webSocketServer = new WebSocketServer({ server, path: "/api/current", maxPayload: 1024 * 1024 });
  const methods: string[] = [];
  webSocketServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as { id: number; method: string; params: unknown[] };
      methods.push(request.method);
      try {
        const result = handler(request.method, request.params);
        if (result !== NO_RESPONSE) {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
        }
      } catch (error) {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -1, message: error instanceof Error ? error.message : "failed" } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    config: {
      enabled: true,
      configured: true,
      name: "TrueNAS",
      baseUrl: `https://127.0.0.1:${port}`,
      username: "dashboard-reader",
      apiKey: "private-api-key",
      poolName: "tank",
      datasetName: "tank/media",
      tlsVerify: false,
      pollIntervalSeconds: 60
    },
    methods,
    close: async () => {
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

afterEach(() => resetOutboundPolicyForTests());

describe("TrueNAS WSS JSON-RPC", () => {
  it("authenticates, correlates calls, and normalizes pool and dataset capacity", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas((method, params) => {
      if (method === "auth.login_ex") {
        expect(params).toEqual([expect.objectContaining({ mechanism: "API_KEY_PLAIN", username: "dashboard-reader", api_key: "private-api-key" })]);
        return { response_type: "SUCCESS", user_info: null };
      }
      if (method === "pool.query") return { name: "tank", status: "ONLINE", size: 1000, allocated: 750, free: 250 };
      if (method === "pool.dataset.query") return { id: "tank/media", used: { parsed: 600 }, available: { parsed: 200 } };
      throw new Error("Unexpected method");
    });
    try {
      const outcome = await collectTrueNasSnapshot(fake.config);
      expect(outcome.status).toBe("online");
      expect(outcome.snapshot).toMatchObject({
        provider: "truenas",
        pool: { name: "tank", health: "ONLINE", sizeBytes: 1000, usedBytes: 750, freeBytes: 250 },
        dataset: { name: "tank/media", sizeBytes: 800, usedBytes: 600, freeBytes: 200 }
      });
      expect(fake.methods).toEqual(["auth.login_ex", "pool.query", "pool.dataset.query"]);
    } finally {
      await fake.close();
    }
  });

  it("isolates authentication failures and does not leak API-key values", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas((method) => method === "auth.login_ex" ? { response_type: "AUTH_ERR" } : null);
    try {
      const outcome = await collectTrueNasSnapshot(fake.config);
      expect(outcome.status).toBe("offline");
      expect(outcome.error).toBe("TrueNAS authentication failed");
      expect(outcome.error).not.toContain("private-api-key");
      expect(fake.methods).toEqual(["auth.login_ex"]);
    } finally {
      await fake.close();
    }
  });

  it("bounds unanswered calls and closes the connection cleanly", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas(() => NO_RESPONSE);
    const startedAt = Date.now();
    try {
      const outcome = await collectTrueNasSnapshot(fake.config);
      expect(outcome.status).toBe("offline");
      expect(outcome.error).toContain("auth.login_ex timed out");
      expect(outcome.error).not.toContain("private-api-key");
      expect(Date.now() - startedAt).toBeLessThan(6_500);
    } finally {
      await fake.close();
    }
  }, 8_000);

  it("rejects missing pools before requesting a dataset", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas((method) => method === "auth.login_ex" ? { response_type: "SUCCESS", user_info: null } : []);
    try {
      const outcome = await collectTrueNasSnapshot(fake.config);
      expect(outcome).toMatchObject({ status: "offline", error: "Configured TrueNAS pool was not found" });
      expect(fake.methods).toEqual(["auth.login_ex", "pool.query"]);
    } finally {
      await fake.close();
    }
  });

  it("rejects malformed capacity payloads", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas((method) => {
      if (method === "auth.login_ex") return { response_type: "SUCCESS", user_info: null };
      if (method === "pool.query") return { name: "tank", status: "ONLINE" };
      return null;
    });
    try {
      const outcome = await collectTrueNasSnapshot({ ...fake.config, datasetName: null });
      expect(outcome).toMatchObject({ status: "offline", error: "TrueNAS returned invalid pool capacity data" });
    } finally {
      await fake.close();
    }
  });

  it("rejects responses larger than the configured message bound", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas(() => "x".repeat(600 * 1024));
    try {
      const outcome = await collectTrueNasSnapshot(fake.config);
      expect(outcome.status).toBe("offline");
      expect(outcome.error).toMatch(/payload|message size|connection closed/i);
    } finally {
      await fake.close();
    }
  });

  it("rejects an untrusted TrueNAS certificate when TLS verification is enabled", async () => {
    configureOutboundPolicy(policyEnv());
    const fake = await fakeTrueNas(() => true);
    try {
      const outcome = await collectTrueNasSnapshot({ ...fake.config, tlsVerify: true });
      expect(outcome.status).toBe("offline");
      expect(outcome.error).toMatch(/certificate|self-signed/i);
      expect(fake.methods).toEqual([]);
    } finally {
      await fake.close();
    }
  });
});
