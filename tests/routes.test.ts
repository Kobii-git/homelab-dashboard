import { APP_VERSION } from "../src/shared/version";
import http from "node:http";
import tls from "node:tls";
import crypto from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { AI_BRIEFING_CACHE_KEY, buildAiBriefingEvidence, isAiBriefingDue } from "../src/server/aiBriefing";
import { getEnv, type AiEnvConfig } from "../src/server/env";
import { runHealthCheck } from "../src/server/healthChecks";
import { checkSslCertificate } from "../src/server/connectivity";
import { boundedJsonRequest } from "../src/server/httpJson";
import { collectOpnsenseSnapshot } from "../src/server/opnsense";
import {
  createAuthToken,
  createReauthToken,
  isRecentlyReauthenticated,
  REAUTH_COOKIE,
  SESSION_COOKIE
} from "../src/server/auth";
import {
  DashboardUtilitiesService,
  DEFAULT_DASHBOARD_UTILITIES_CONFIG
} from "../src/server/dashboardUtilities";
import type { DashboardUtilitiesConfigDto } from "../src/shared/types";
import {
  assertIntegrationTransport,
  configureOutboundPolicy,
  parseCidr,
  resolveOutboundTarget,
  withFixedProviderLimit
} from "../src/server/outboundPolicy";
import { isValidIconBody } from "../src/server/iconProxy";

const execFileAsync = promisify(execFile);
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
  appOrigin: null,
  trustedProxyCidrs: [],
  adminPassword: "test-pass",
  cookieSecret: "test-cookie-secret-with-more-than-32-chars",
  cookieSecure: false,
  sessionMaxAgeSeconds: 60 * 60 * 24 * 7,
  setupCode: null,
  publicStatusMode: "services" as const,
  allowInsecureIntegrations: true,
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
  google: {
    configured: false,
    clientId: null,
    clientSecret: null,
    refreshToken: null,
    calendarIds: ["primary"]
  },
  todoist: { configured: false, apiToken: null },
  tmdb: { configured: false, bearerToken: null },
  truenas: {
    enabled: false,
    configured: false,
    name: "TrueNAS",
    baseUrl: null,
    username: null,
    apiKey: null,
    poolName: null,
    datasetName: null,
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
  const sessionCookie = login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const reauth = await app.inject({
    method: "POST",
    url: "/api/auth/reauth",
    headers: { cookie: sessionCookie },
    payload: { password: "test-pass" }
  });
  expect(reauth.statusCode).toBe(204);
  cachedCookie = [
    sessionCookie,
    ...reauth.cookies.map((cookie) => `${cookie.name}=${cookie.value}`)
  ].filter(Boolean).join("; ");
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
  it("keeps home context authenticated and disabled by default", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/home/summary" });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await app.inject({
      method: "GET",
      url: "/api/home/summary",
      headers: { cookie: await loginCookie() }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      agenda: { state: "disabled", data: null },
      tasks: { state: "disabled", data: null },
      mail: { state: "disabled", data: null },
      media: { state: "disabled", data: null },
      storage: { state: "disabled", data: null }
    });
  });

  it("validates and persists non-secret daily cockpit settings", async () => {
    const cookie = await loginCookie();
    const dashboardHome = {
      agendaEnabled: false,
      tasksEnabled: false,
      mailEnabled: false,
      mediaEnabled: false,
      storageEnabled: true,
      plexWidgetId: null,
      radarrWidgetId: null,
      mediaRegion: "ZA",
      mediaLanguage: "en-US",
      mediaLimit: 6
    };
    const updated = await app.inject({ method: "PATCH", url: "/api/settings", headers: { cookie }, payload: { dashboardHome } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().dashboardHome).toEqual(dashboardHome);
    const invalid = await app.inject({ method: "PATCH", url: "/api/settings", headers: { cookie }, payload: { dashboardHome: { ...dashboardHome, mediaRegion: "south-africa" } } });
    expect(invalid.statusCode).toBe(400);
    await app.inject({ method: "PATCH", url: "/api/settings", headers: { cookie }, payload: { dashboardHome: { ...dashboardHome, storageEnabled: false } } });
  });

  it("rejects primitive settings bodies without changing persisted settings", async () => {
    const cookie = await loginCookie();
    const before = await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } });
    expect(before.statusCode).toBe(200);

    for (const value of [null, true, 60, "60"]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie, "content-type": "application/json" },
        payload: JSON.stringify(value)
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "Invalid request" });
      const after = await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual(before.json());
    }
  });

  it("rejects unknown poster references without exposing proxy parameters", async () => {
    expect((await app.inject({ method: "GET", url: "/api/home/posters/AAAAAAAAAAAAAAAAAAAAAAAA" })).statusCode).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: "/api/home/posters/AAAAAAAAAAAAAAAAAAAAAAAA",
      headers: { cookie: await loginCookie() }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Poster is unavailable" });
  });
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
    const weatherLocations = await app.inject({ method: "GET", url: "/api/utilities/weather-locations?q=Cape%20Town" });
    expect(weatherLocations.statusCode).toBe(401);
    const utilities = await app.inject({ method: "GET", url: "/api/utilities/summary" });
    expect(utilities.statusCode).toBe(401);
  });

  it("normalizes partial dashboard utility settings without exposing extra values publicly", async () => {
    const cookie = await loginCookie();
    const original = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie }
    });
    expect(original.statusCode).toBe(200);
    expect(original.json()).toMatchObject({
      dashboardUtilities: DEFAULT_DASHBOARD_UTILITIES_CONFIG
    });

    const intervalOnly = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { autoPingIntervalSeconds: 45 }
    });
    expect(intervalOnly.statusCode).toBe(200);
    expect(intervalOnly.json()).toMatchObject({
      autoPingIntervalSeconds: 45,
      dashboardUtilities: DEFAULT_DASHBOARD_UTILITIES_CONFIG
    });

    const invalidWeather = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: {
        dashboardUtilities: {
          ...DEFAULT_DASHBOARD_UTILITIES_CONFIG,
          weather: { enabled: true, units: "metric", location: null }
        }
      }
    });
    expect(invalidWeather.statusCode).toBe(400);

    const configured = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: {
        dashboardUtilities: {
          searchEngine: "brave",
          weather: {
            enabled: true,
            units: "metric",
            location: {
              label: "Cape Town, Western Cape, South Africa",
              name: "Cape Town",
              country: "South Africa",
              latitude: -33.9258,
              longitude: 18.4232,
              timezone: "Africa/Johannesburg",
              apiToken: "must-not-survive-normalization"
            }
          },
          releases: {
            enabled: true,
            repositories: ["GlanceApp/Glance", "glanceapp/glance", "gethomepage/homepage"],
            githubToken: "must-not-survive-normalization"
          }
        }
      }
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({
      dashboardUtilities: {
        searchEngine: "brave",
        weather: {
          enabled: true,
          location: { name: "Cape Town", country: "South Africa" }
        },
        releases: {
          enabled: true,
          repositories: ["glanceapp/glance", "gethomepage/homepage"]
        }
      }
    });
    expect(configured.body).not.toContain("must-not-survive-normalization");

    const status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toContain("dashboardUtilities");
    expect(status.body).not.toContain("glanceapp/glance");

    const tooManyRepositories = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: {
        dashboardUtilities: {
          ...DEFAULT_DASHBOARD_UTILITIES_CONFIG,
          releases: {
            enabled: true,
            repositories: Array.from({ length: 13 }, (_, index) => `owner/repository-${index}`)
          }
        }
      }
    });
    expect(tooManyRepositories.statusCode).toBe(400);

    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { dashboardUtilities: DEFAULT_DASHBOARD_UTILITIES_CONFIG }
    });
  });

  it("maps, caches, deduplicates, and isolates dashboard utility providers", async () => {
    let now = Date.parse("2026-07-24T08:00:00.000Z");
    let weatherUnavailable = false;
    const calls = new Map<string, number>();
    const request = async (rawUrl: URL | string) => {
      const url = new URL(String(rawUrl));
      const key = `${url.hostname}${url.pathname}`;
      calls.set(key, (calls.get(key) ?? 0) + 1);

      if (url.hostname === "geocoding-api.open-meteo.com") {
        return {
          results: Array.from({ length: 6 }, (_, index) => ({
            name: index === 0 ? "Cape Town" : `Cape Town ${index + 1}`,
            country: "South Africa",
            admin1: "Western Cape",
            latitude: -33.9258 + index,
            longitude: 18.4232 + index,
            timezone: "Africa/Johannesburg"
          }))
        };
      }

      if (url.hostname === "api.open-meteo.com") {
        if (weatherUnavailable) throw new Error("Weather forecast timed out");
        return {
          current: {
            temperature_2m: 16.4,
            apparent_temperature: 15.1,
            is_day: 1,
            weather_code: 2
          },
          daily: {
            time: ["2026-07-24", "2026-07-25", "2026-07-26"],
            weather_code: [2, 61, 0],
            temperature_2m_max: [19, 17, 21],
            temperature_2m_min: [11, 10, 12],
            precipitation_probability_max: [10, 70, 5]
          }
        };
      }

      const repository = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases\/latest$/)?.[1];
      if (repository === "missing/project") throw new Error("GitHub release missing (404)");
      const isNewest = repository === "newest/project";
      return {
        html_url: `https://github.com/${repository}/releases/tag/${isNewest ? "v3.0.0" : "v2.0.0"}`,
        tag_name: isNewest ? "v3.0.0" : "v2.0.0",
        name: isNewest ? "Newest release" : "Older release",
        published_at: isNewest ? "2026-07-23T12:00:00Z" : "2026-07-20T12:00:00Z"
      };
    };
    const utilityService = new DashboardUtilitiesService(request, () => now);
    const utilityApp = await createApp({
      prisma,
      env,
      monitor: false,
      logger: false,
      dashboardUtilities: utilityService
    });

    try {
      await utilityApp.ready();
      const login = await utilityApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "test-pass" }
      });
      const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
      const location = {
        label: "Cape Town, Western Cape, South Africa",
        name: "Cape Town",
        country: "South Africa",
        latitude: -33.9258,
        longitude: 18.4232,
        timezone: "Africa/Johannesburg"
      };
      const config: DashboardUtilitiesConfigDto = {
        searchEngine: "duckduckgo",
        weather: { enabled: true, units: "metric", location },
        releases: {
          enabled: true,
          repositories: ["older/project", "missing/project", "newest/project"]
        }
      };
      expect((await utilityApp.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie },
        payload: { dashboardUtilities: config }
      })).statusCode).toBe(200);

      const [firstLocations, secondLocations] = await Promise.all([
        utilityApp.inject({
          method: "GET",
          url: "/api/utilities/weather-locations?q=Cape%20Town",
          headers: { cookie }
        }),
        utilityApp.inject({
          method: "GET",
          url: "/api/utilities/weather-locations?q=Cape%20Town",
          headers: { cookie }
        })
      ]);
      expect(firstLocations.statusCode).toBe(200);
      expect(secondLocations.statusCode).toBe(200);
      expect(firstLocations.json()).toHaveLength(5);
      expect(firstLocations.json()[0]).toEqual(location);
      expect(calls.get("geocoding-api.open-meteo.com/v1/search")).toBe(1);
      expect((await utilityApp.inject({
        method: "GET",
        url: "/api/utilities/weather-locations?q=ab",
        headers: { cookie }
      })).statusCode).toBe(400);

      const [firstSummary, secondSummary] = await Promise.all([
        utilityApp.inject({ method: "GET", url: "/api/utilities/summary", headers: { cookie } }),
        utilityApp.inject({ method: "GET", url: "/api/utilities/summary", headers: { cookie } })
      ]);
      expect(firstSummary.statusCode).toBe(200);
      expect(secondSummary.statusCode).toBe(200);
      expect(firstSummary.json()).toMatchObject({
        weather: {
          state: "ready",
          stale: false,
          data: {
            condition: "Partly cloudy",
            temperature: 16.4,
            days: [
              { condition: "Partly cloudy", high: 19, low: 11 },
              { condition: "Rain", high: 17, low: 10 },
              { condition: "Clear", high: 21, low: 12 }
            ]
          }
        },
        releases: {
          state: "ready",
          stale: false,
          error: "1 tracked repository could not be refreshed.",
          data: [
            { repository: "newest/project", tag: "v3.0.0" },
            { repository: "older/project", tag: "v2.0.0" }
          ]
        }
      });
      expect(calls.get("api.open-meteo.com/v1/forecast")).toBe(1);
      expect(calls.get("api.github.com/repos/newest/project/releases/latest")).toBe(1);
      expect(calls.get("api.github.com/repos/older/project/releases/latest")).toBe(1);
      expect(calls.get("api.github.com/repos/missing/project/releases/latest")).toBe(1);
      await utilityApp.inject({ method: "GET", url: "/api/utilities/summary", headers: { cookie } });
      expect(calls.get("api.github.com/repos/missing/project/releases/latest")).toBe(1);

      now += 7 * 60 * 60_000;
      weatherUnavailable = true;
      const staleSummary = await utilityApp.inject({
        method: "GET",
        url: "/api/utilities/summary",
        headers: { cookie }
      });
      expect(staleSummary.statusCode).toBe(200);
      expect(staleSummary.json()).toMatchObject({
        weather: {
          state: "ready",
          stale: true,
          error: "Weather refresh failed; showing the last available forecast."
        },
        releases: {
          state: "ready",
          data: [
            { repository: "newest/project" },
            { repository: "older/project" }
          ]
        }
      });
    } finally {
      await utilityApp.close();
      await app.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie: await loginCookie() },
        payload: { dashboardUtilities: DEFAULT_DASHBOARD_UTILITIES_CONFIG }
      });
    }

    const failingService = new DashboardUtilitiesService(async () => {
      throw new Error("Weather provider response exceeded the timeout");
    });
    const failed = await failingService.getSummary({
      searchEngine: "duckduckgo",
      weather: {
        enabled: true,
        units: "metric",
        location: {
          label: "Test location",
          name: "Test location",
          country: "Test country",
          latitude: 0,
          longitude: 0,
          timezone: "UTC"
        }
      },
      releases: { enabled: false, repositories: [] }
    });
    expect(failed.weather).toMatchObject({
      state: "error",
      data: null,
      stale: false,
      error: "Weather provider response exceeded the timeout"
    });
    expect(failed.releases.state).toBe("disabled");
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
      const originalHash = (await prisma.adminAccount.findUniqueOrThrow({ where: { id: "admin" } })).passwordHash;
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await authApp.inject({ method: "POST", url: attempt % 2 ? "/api/auth/reauth" : "/api/auth/password",
          headers: { cookie: reloginCookie }, remoteAddress: `192.0.2.${attempt + 1}`,
          payload: attempt % 2 ? { password: "wrong" } : { currentPassword: "wrong", newPassword: "new-database-password" } });
        expect(response.statusCode).toBe(401);
      }
      for (const url of ["/api/auth/password", "/api/auth/reauth"]) {
        const response = await authApp.inject({ method: "POST", url, headers: { cookie: reloginCookie },
          payload: url.endsWith("password") ? { currentPassword: "legacy-password-123", newPassword: "new-database-password" } : { password: "legacy-password-123" } });
        expect(response.statusCode).toBe(429);
      }
      expect((await prisma.adminAccount.findUniqueOrThrow({ where: { id: "admin" } })).passwordHash).toBe(originalHash);
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000);
      const changed = await authApp.inject({
        method: "POST",
        url: "/api/auth/password",
        headers: { cookie: reloginCookie },
        payload: { currentPassword: "legacy-password-123", newPassword: "new-database-password" }
      });
      clock.mockRestore();
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
        primaryCheck: { type: "tcp", target: "192.168.1.1:443" },
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

  it("accepts admin-selected service targets outside the former network list", async () => {
    const cookie = await loginCookie();
    configureOutboundPolicy({ ...env, nodeEnv: "production" });
    const lookup = vi.spyOn(dns.promises, "lookup");
    try {
      lookup.mockResolvedValueOnce([{ address: "10.0.10.1", family: 4 }] as never);
      const created = await app.inject({
        method: "POST",
        url: "/api/resources",
        headers: { cookie },
        payload: { name: "Another LAN", kind: "app", url: "https://10.0.10.1/" }
      });
      expect(created.statusCode).toBe(201);

      lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
      const blocked = await app.inject({
        method: "POST",
        url: "/api/resources",
        headers: { cookie },
        payload: { name: "Blocked target", kind: "app", url: "http://169.254.169.254/" }
      });
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json<{ error: string }>().error).toContain("forbidden address");
    } finally {
      lookup.mockRestore();
      configureOutboundPolicy(env);
    }
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
        latestError: "DNS for storage.internal.example (fd00::1234) failed at http://192.168.50.10:8080 with Bearer super-secret-token",
        consecutiveFailures: 2,
        failureThreshold: 3,
        enabled: true
      }
    });

    const redactedEvidence = await buildAiBriefingEvidence(prisma, aiEnv);
    expect(JSON.stringify(redactedEvidence)).not.toContain("192.168.50.10");
    expect(JSON.stringify(redactedEvidence)).not.toContain("super-secret-token");
    expect(JSON.stringify(redactedEvidence)).not.toContain("storage.internal.example");
    expect(JSON.stringify(redactedEvidence)).not.toContain("fd00::1234");
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

      const unconfirmedSecret = await app.inject({
        method: "POST",
        url: "/api/api-widgets",
        headers: { cookie },
        payload: {
          name: "Unconfirmed secure API",
          templateId: "custom-json",
          baseUrl,
          endpointPath: "/secure",
          authType: "bearer",
          authEnvVar: "TEST_WIDGET_TOKEN",
          fieldMappings: [{ label: "Status", path: "status", kind: "text" }]
        }
      });
      expect(unconfirmedSecret.statusCode).toBe(400);
      expect(unconfirmedSecret.body).toContain("Confirm the credential destination origin exactly");

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
          confirmSecretOrigin: baseUrl,
          fieldMappings: [{ label: "Status", path: "status", kind: "text" }]
        }
      });
      expect(secure.statusCode).toBe(201);
      const secureId = secure.json<{ id: string }>().id;

      const secureRun = await app.inject({ method: "POST", url: `/api/api-widgets/${secureId}/run`, headers: { cookie } });
      expect(secureRun.json<{ status: string }>().status).toBe("online");

      const onlySession = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "test-pass" } });
      const sessionHeader = onlySession.cookies.map(c => `${c.name}=${c.value}`).join("; ");
      expect((await app.inject({ method: "PATCH", url: `/api/api-widgets/${secureId}`, headers: { cookie: sessionHeader }, payload: { endpointPath: "/other" } })).statusCode).toBe(403);
      for (const endpointPath of ["/\\attacker.example/secret", "/\n/attacker.example/secret", "//attacker.example/secret"]) {
        expect((await app.inject({ method: "PATCH", url: `/api/api-widgets/${secureId}`, headers: { cookie }, payload: { endpointPath } })).statusCode).toBe(400);
        await prisma.apiWidget.update({ where: { id: secureId }, data: { endpointPath } });
        const blockedRun = await app.inject({ method: "POST", url: `/api/api-widgets/${secureId}/run`, headers: { cookie } });
        expect(blockedRun.json()).toMatchObject({ status: "offline" });
        expect(blockedRun.body).toContain("Endpoint path is not permitted");
      }
      await prisma.apiWidget.update({ where: { id: secureId }, data: { endpointPath: "/secure" } });

      const tamperedOrigin = new URL(baseUrl);
      tamperedOrigin.port = String(Number(tamperedOrigin.port) + 1);
      await prisma.apiWidget.update({
        where: { id: secureId },
        data: { baseUrl: tamperedOrigin.origin }
      });
      const tamperedRun = await app.inject({
        method: "POST",
        url: `/api/api-widgets/${secureId}/run`,
        headers: { cookie }
      });
      expect(tamperedRun.statusCode).toBe(200);
      expect(tamperedRun.json<{ status: string; error: string }>()).toMatchObject({
        status: "offline"
      });
      expect(tamperedRun.body).toContain("not bound to this origin");
      await prisma.apiWidget.update({
        where: { id: secureId },
        data: { baseUrl }
      });

      const directWidget = await prisma.apiWidget.create({
        data: {
          name: "Direct database widget",
          templateId: "custom-json",
          baseUrl,
          endpointPath: "/secure",
          authType: "bearer",
          authEnvVar: "TEST_WIDGET_TOKEN",
          fieldMappings: [{ label: "Status", path: "status", kind: "text" }]
        }
      });
      const directRun = await app.inject({
        method: "POST",
        url: `/api/api-widgets/${directWidget.id}/run`,
        headers: { cookie }
      });
      expect(directRun.json<{ status: string; error: string }>()).toMatchObject({ status: "offline" });
      expect(directRun.body).toContain("not bound to this origin");
      await prisma.apiWidget.delete({ where: { id: directWidget.id } });

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
    expect(body.build.version).toBe(APP_VERSION);
    expect(body.auth.source).toBe("env");
    expect(body.database.ok).toBe(true);
    expect(body.database.counts.resources).toBeGreaterThanOrEqual(0);
    expect(body.schedulers.health.enabled).toBe(false);
    expect(runtime.body).not.toContain("test-pass");
    expect(runtime.body).not.toContain("test-cookie-secret");
  });

  it("uses health thresholds as stable status gates and surfaces pending checks", async () => {
    const cookie = await loginCookie();
    await withMockGlances({ offline: true }, async (baseUrl, update) => {

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
        target: `${baseUrl}/quicklook`,
        intervalSeconds: 15,
        timeoutMs: 250,
        failureThreshold: 3,
        successThreshold: 2
      }
    });
    const checkId = check.json<{ id: string }>().id;

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

    update({ offline: false });

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
  });

  it("syncs a managed TCP primary check and preserves its port when a service host changes", async () => {
    const cookie = await loginCookie();

    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Moving Host",
        kind: "server",
        host: "192.0.2.10",
        primaryCheck: { type: "tcp", target: "192.0.2.10:443" }
      }
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json<{ id: string }>().id;

    const defaultCheck = await prisma.healthCheck.findFirstOrThrow({
      where: { resourceId, type: "tcp", target: "192.0.2.10:443", primary: true }
    });

    const custom = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: {
        resourceId,
        type: "ping",
        target: "192.0.2.10",
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
      type: "tcp",
      target: "192.0.2.11:443",
      enabled: false,
      latestStatus: "unknown",
      latestLatencyMs: null,
      latestCheckedAt: null,
      latestError: null,
      consecutiveFailures: 0
    });
    expect(body.healthChecks.find((check) => check.id === customCheckId)).toMatchObject({
      type: "ping",
      target: "192.0.2.10"
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
        host: "192.0.2.20",
        primaryCheck: { type: "ping", target: "192.0.2.20" }
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
      payload: { name: "Deleted Default", kind: "server", url: "http://deleted-default.test" }
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
    const run = await app.inject({ method: "POST", url: `/api/resources/${resourceId}/run`, headers: { cookie } });
    expect(run.statusCode).toBe(200);
    expect(run.json<{ outcomes: unknown[] }>().outcomes).toHaveLength(2);
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

  it("requires an explicit primary protocol for host-only automatic services", async () => {
    const cookie = await loginCookie();
    const rejected = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Unconfirmed ICMP Host", kind: "server", host: "192.168.88.10" }
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toContain("requires a TCP port or an explicit ping");

    const created = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: {
        name: "Explicit TCP Host",
        kind: "server",
        host: "192.168.88.10",
        primaryCheck: { type: "tcp", target: "192.168.88.10:8443" }
      }
    });
    expect(created.statusCode).toBe(201);
    const primary = await prisma.healthCheck.findFirstOrThrow({
      where: { resourceId: created.json<{ id: string }>().id }
    });
    expect(primary).toMatchObject({
      type: "tcp",
      target: "192.168.88.10:8443",
      managed: true,
      primary: true
    });
  });

  it("uses only the enabled primary check for service availability", async () => {
    const cookie = await loginCookie();
    const resource = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie },
      payload: { name: "Primary Availability", kind: "app" }
    });
    const resourceId = resource.json<{ id: string }>().id;
    const primaryResponse = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: { resourceId, type: "tcp", target: "primary.test:443" }
    });
    const diagnosticResponse = await app.inject({
      method: "POST",
      url: "/api/health-checks",
      headers: { cookie },
      payload: { resourceId, type: "ping", target: "diagnostic.test" }
    });
    const primaryId = primaryResponse.json<{ id: string }>().id;
    const diagnosticId = diagnosticResponse.json<{ id: string }>().id;
    await prisma.healthCheck.update({
      where: { id: primaryId },
      data: { latestStatus: "online", latestCheckedAt: new Date(), latestLatencyMs: 12 }
    });
    await prisma.healthCheck.update({
      where: { id: diagnosticId },
      data: { latestStatus: "offline", latestCheckedAt: new Date(), latestError: "ICMP blocked" }
    });

    let status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.json<{ resources: Array<{ name: string; status: string }> }>().resources)
      .toContainEqual(expect.objectContaining({ name: "Primary Availability", status: "online" }));

    const promoted = await app.inject({
      method: "PATCH",
      url: `/api/health-checks/${diagnosticId}`,
      headers: { cookie },
      payload: { primary: true }
    });
    expect(promoted.statusCode).toBe(200);
    expect(await prisma.healthCheck.findUniqueOrThrow({ where: { id: primaryId } })).toMatchObject({ primary: false });
    expect(await prisma.healthCheck.findUniqueOrThrow({ where: { id: diagnosticId } })).toMatchObject({ primary: true });

    status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.json<{ resources: Array<{ name: string; status: string }> }>().resources)
      .toContainEqual(expect.objectContaining({ name: "Primary Availability", status: "offline" }));

    await app.inject({
      method: "PATCH",
      url: `/api/health-checks/${diagnosticId}`,
      headers: { cookie },
      payload: { enabled: false }
    });
    status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.json<{ resources: Array<{ name: string; status: string }> }>().resources)
      .toContainEqual(expect.objectContaining({ name: "Primary Availability", status: "unknown" }));
  });

  it("tests HTTP reachability without persisting history and preserves exact URL ports and paths", async () => {
    const cookie = await loginCookie();
    await withMockJsonApi((request, response) => {
      response.statusCode = request.url?.startsWith("/down") ? 503 : 403;
      response.end();
    }, async (baseUrl) => {
      const exactUrl = `${baseUrl}/auth?source=dashboard`;
      const created = await app.inject({
        method: "POST",
        url: "/api/resources",
        headers: { cookie },
        payload: { name: "Port and Path App", kind: "docker", url: exactUrl }
      });
      expect(created.statusCode).toBe(201);
      expect(await prisma.healthCheck.findFirstOrThrow({
        where: { resourceId: created.json<{ id: string }>().id }
      })).toMatchObject({ type: "http", target: exactUrl, primary: true, managed: true });

      const before = await prisma.healthResult.count();
      const reachable = await app.inject({
        method: "POST",
        url: "/api/health-checks/test",
        headers: { cookie },
        payload: { type: "http", target: exactUrl, timeoutMs: 1000 }
      });
      expect(reachable.statusCode).toBe(200);
      expect(reachable.json<{ status: string }>().status).toBe("online");

      const unavailable = await app.inject({
        method: "POST",
        url: "/api/health-checks/test",
        headers: { cookie },
        payload: { type: "http", target: `${baseUrl}/down`, timeoutMs: 1000 }
      });
      expect(unavailable.statusCode).toBe(200);
      expect(unavailable.json<{ status: string; reason: string }>())
        .toMatchObject({ status: "offline", reason: "http_5xx" });
      expect(await prisma.healthResult.count()).toBe(before);
    });
  });

  it("backfills one deterministic primary without rewriting checks or history", async () => {
    const resource = await prisma.resource.create({
      data: { name: "Primary Backfill", kind: "server", monitoringMode: "auto" }
    });
    const oldest = await prisma.healthCheck.create({
      data: {
        resourceId: resource.id,
        type: "tcp",
        target: "backfill.test:80",
        enabled: true,
        managed: false,
        primary: false
      }
    });
    const managed = await prisma.healthCheck.create({
      data: {
        resourceId: resource.id,
        type: "tcp",
        target: "backfill.test:443",
        enabled: true,
        managed: true,
        primary: false
      }
    });
    await prisma.healthResult.create({
      data: { checkId: oldest.id, status: "online", latencyMs: 9 }
    });
    await prisma.systemConfig.deleteMany({ where: { key: "primary_health_checks_v1" } });

    const restarted = await createApp({ prisma, env, monitor: false, logger: false });
    await restarted.ready();
    await restarted.close();

    expect(await prisma.healthCheck.findUniqueOrThrow({ where: { id: managed.id } }))
      .toMatchObject({ primary: true, target: "backfill.test:443" });
    expect(await prisma.healthCheck.findUniqueOrThrow({ where: { id: oldest.id } }))
      .toMatchObject({ primary: false, target: "backfill.test:80" });
    expect(await prisma.healthResult.count({ where: { checkId: oldest.id } })).toBe(1);
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

    await withMockGlances({}, async (baseUrl) => {
    const nextTarget = `${baseUrl}/quicklook`;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/health-checks/${check.id}`,
      headers: { cookie },
      payload: { target: nextTarget }
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
      target: nextTarget,
      latestStatus: "unknown",
      latestLatencyMs: null,
      latestCheckedAt: null,
      latestError: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastTransitionAt: null
    });

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
      target: nextTarget,
      latestStatus: "online"
    }));
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
        kind: "other"
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
        payload: { name, kind: "app", host: "192.168.77.1", monitoringMode: "disabled" }
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
      payload: { name: "History Box", kind: "server" }
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

  it("requires recent password confirmation and binds it to the active session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "test-pass" }
    });
    const sessionCookie = login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const blocked = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie: sessionCookie },
      payload: { name: "Reauth blocked resource", kind: "other", monitoringMode: "disabled" }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ code: string }>().code).toBe("REAUTH_REQUIRED");

    const reauth = await app.inject({
      method: "POST",
      url: "/api/auth/reauth",
      headers: { cookie: sessionCookie },
      payload: { password: "test-pass" }
    });
    expect(reauth.statusCode).toBe(204);
    const reauthCookie = reauth.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const approved = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie: `${sessionCookie}; ${reauthCookie}` },
      payload: { name: "Reauth approved resource", kind: "other", monitoringMode: "disabled" }
    });
    expect(approved.statusCode).toBe(201);

    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "test-pass" }
    });
    const secondSession = secondLogin.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    const mismatched = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: { cookie: `${secondSession}; ${reauthCookie}` },
      payload: { name: "Wrong session resource", kind: "other", monitoringMode: "disabled" }
    });
    expect(mismatched.statusCode).toBe(403);

    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const fakeRequest = {
      cookies: { [SESSION_COOKIE]: "test-session" }
    } as unknown as FastifyRequest;
    fakeRequest.cookies![REAUTH_COOKIE] = createReauthToken(fakeRequest, env, issuedAt);
    expect(isRecentlyReauthenticated(fakeRequest, env, new Date(issuedAt.getTime() + 301_000))).toBe(false);
  });

  it("disables public status by default and supports aggregate-only mode", async () => {
    const disabledApp = await createApp({
      prisma,
      env: { ...env, publicStatusMode: "disabled" },
      monitor: false,
      logger: false
    });
    expect((await disabledApp.inject({ method: "GET", url: "/api/status" })).statusCode).toBe(404);
    expect((await disabledApp.inject({ method: "GET", url: "/status" })).statusCode).toBe(404);
    expect((await disabledApp.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
    expect(Object.keys((await disabledApp.inject({ method: "GET", url: "/api/version" })).json())).toEqual(["version"]);
    await disabledApp.close();

    const aggregateApp = await createApp({
      prisma,
      env: { ...env, publicStatusMode: "aggregate" },
      monitor: false,
      logger: false
    });
    const aggregate = await aggregateApp.inject({ method: "GET", url: "/api/status" });
    expect(aggregate.statusCode).toBe(200);
    expect(aggregate.json<{ resources: unknown[]; summary: { resources: number } }>().resources).toEqual([]);
    expect(aggregate.json<{ summary: { resources: number } }>().summary.resources).toBeGreaterThan(0);
    expect(aggregate.body).not.toContain("gitSha");
    expect(aggregate.body).not.toContain("buildTime");
    expect(aggregate.body).not.toContain("truenas");
    expect(aggregate.body).not.toContain("agenda");
    expect(aggregate.body).not.toContain("mediaRegion");
    await aggregateApp.close();
    configureOutboundPolicy(env);
  });

  it("enforces the production origin and keeps public build metadata minimal", async () => {
    const productionApp = await createApp({
      prisma,
      env: {
        ...env,
        nodeEnv: "production",
        appOrigin: "https://dashboard.test",
        cookieSecure: true,
        trustedProxyCidrs: ["127.0.0.1/32"],
        allowInsecureIntegrations: false,
        publicStatusMode: "disabled"
      },
      monitor: false,
      logger: false
    });

    expect((await productionApp.inject({
      method: "GET",
      url: "/api/version",
      headers: { host: "wrong.test", "x-forwarded-proto": "https" }
    })).statusCode).toBe(421);
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/version",
      headers: { host: "dashboard.test" }
    })).statusCode).toBe(421);
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/version",
      remoteAddress: "10.0.0.25",
      headers: { host: "dashboard.test", "x-forwarded-proto": "https" }
    })).statusCode).toBe(421);
    const forwardedHeaders = {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "dashboard.test",
      "x-forwarded-for": "127.0.0.1"
    };
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/version",
      remoteAddress: "10.0.0.25",
      headers: { host: "dashboard.test", ...forwardedHeaders }
    })).statusCode).toBe(421);
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress: "10.0.0.25",
      headers: { host: "127.0.0.1:4173", ...forwardedHeaders }
    })).statusCode).toBe(421);
    const version = await productionApp.inject({
      method: "GET",
      url: "/api/version",
      remoteAddress: "127.0.0.1",
      headers: { host: "dashboard.test", ...forwardedHeaders }
    });
    expect(version.statusCode).toBe(200);
    expect(Object.keys(version.json())).toEqual(["version"]);
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4173" }
    })).statusCode).toBe(200);
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress: "10.0.0.25",
      headers: { host: "wrong.test" }
    })).statusCode).toBe(421);
    expect((await productionApp.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress: "10.0.0.25",
      headers: { host: "dashboard.test", "x-forwarded-proto": "https" }
    })).statusCode).toBe(421);
    expect((await productionApp.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { host: "dashboard.test", origin: "https://evil.test", "x-forwarded-proto": "https" },
      payload: { password: "test-pass" }
    })).statusCode).toBe(403);
    expect((await productionApp.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { host: "dashboard.test", origin: "https://dashboard.test", "x-forwarded-proto": "https" },
      payload: { password: "test-pass" }
    })).statusCode).toBe(200);

    await productionApp.close();
    configureOutboundPolicy(env);
  });

  it("keeps host and browser-origin checks in private HTTP mode", async () => {
    const directApp = await createApp({
      prisma,
      env: {
        ...env,
        nodeEnv: "production",
        appOrigin: "http://192.168.50.20:4173",
        cookieSecure: false,
        trustedProxyCidrs: [],
      },
      monitor: false,
      logger: false
    });
    try {
      const host = "192.168.50.20:4173";
      expect((await directApp.inject({ method: "GET", url: "/api/version", headers: { host } })).statusCode).toBe(200);
      expect((await directApp.inject({ method: "GET", url: "/api/version", headers: { host: "other.test" } })).statusCode).toBe(421);
      const response = await directApp.inject({ method: "GET", url: "/api/version", headers: { host, "x-forwarded-proto": "https" } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["strict-transport-security"]).toBeUndefined();
      expect((await directApp.inject({
        method: "POST", url: "/api/auth/login", headers: { host, origin: "http://other.test" }, payload: { password: "test-pass" }
      })).statusCode).toBe(403);
      const login = await directApp.inject({
        method: "POST", url: "/api/auth/login", headers: { host, origin: `http://${host}` }, payload: { password: "test-pass" }
      });
      expect(login.statusCode).toBe(200);
      expect(String(login.headers["set-cookie"])).not.toMatch(/;\s*Secure\b/i);
    } finally {
      await directApp.close();
      configureOutboundPolicy(env);
    }
  });

  it("blocks special addresses, DNS rebinding, and insecure credential transport", async () => {
    expect(() => parseCidr("10.0.0.0/99")).toThrow("Invalid CIDR");
    configureOutboundPolicy({
      ...env,
      nodeEnv: "production",
      allowInsecureIntegrations: false
    });
    const lookup = vi.spyOn(dns.promises, "lookup");
    try {
      lookup.mockResolvedValueOnce([{ address: "10.0.21.15", family: 4 }] as never);
      await expect(resolveOutboundTarget("allowed.test")).resolves.toMatchObject({ address: "10.0.21.15" });

      lookup.mockResolvedValueOnce([{ address: "10.0.22.15", family: 4 }] as never);
      await expect(resolveOutboundTarget("outside.test")).resolves.toMatchObject({ address: "10.0.22.15" });

      lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
      await expect(resolveOutboundTarget("metadata.test")).rejects.toThrow("forbidden address");

      lookup.mockResolvedValueOnce([
        { address: "10.0.21.20", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ] as never);
      await expect(resolveOutboundTarget("rebind.test")).rejects.toThrow("forbidden address");

      lookup.mockResolvedValueOnce([{ address: "::ffff:127.0.0.1", family: 6 }] as never);
      await expect(resolveOutboundTarget("mapped.test")).rejects.toThrow("forbidden address");

      lookup.mockImplementationOnce(() => new Promise(() => undefined));
      await expect(resolveOutboundTarget("slow-dns.test", { timeoutMs: 10 })).rejects.toThrow(
        "DNS resolution for slow-dns.test timed out"
      );

      expect(() => assertIntegrationTransport(new URL("http://10.0.21.15"), {
        credentialed: true,
        tlsVerify: true
      })).toThrow("must use HTTPS");
      expect(() => assertIntegrationTransport(new URL("https://10.0.21.15"), {
        credentialed: true,
        tlsVerify: false
      })).toThrow("cannot be disabled");
    } finally {
      lookup.mockRestore();
      configureOutboundPolicy(env);
    }
  });

  it("caps fixed-provider concurrency and validates proxied image bytes", async () => {
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 12 }, () =>
      withFixedProviderLimit(true, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      })
    ));
    expect(peak).toBe(4);

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16)
    ]);
    expect(isValidIconBody(png, "image/png")).toBe(true);
    expect(isValidIconBody(Buffer.from("<svg onload=alert(1)>"), "image/png")).toBe(false);
    expect(isValidIconBody(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]), "image/jpeg")).toBe(true);
    expect(isValidIconBody(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(false);
  });

  it("pins outbound HTTP resolution and enforces redirects, size limits, and wall-clock timeouts", async () => {
    let observedHost = "";
    const server = http.createServer((request, response) => {
      observedHost = request.headers.host ?? "";
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/redirect") {
        response.writeHead(302, { Location: "/ok" });
        response.end();
        return;
      }
      if (pathname === "/large") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ value: "x".repeat(512) }));
        return;
      }
      if (pathname === "/slow") {
        response.writeHead(200, { "Content-Type": "application/json" });
        const interval = setInterval(() => response.write(" "), 10);
        response.once("close", () => clearInterval(interval));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const lookup = vi.spyOn(dns.promises, "lookup");
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    configureOutboundPolicy(env);
    const request = (pathname: string, overrides: Partial<Parameters<typeof boundedJsonRequest>[1]> = {}) =>
      boundedJsonRequest(`http://pinned.test:${address.port}${pathname}`, {
        timeoutMs: 500,
        maxBytes: 1024,
        label: "Pinned test",
        ...overrides
      });
    try {
      await expect(boundedJsonRequest(`http://user:password@pinned.test:${address.port}/ok`, {
        timeoutMs: 500,
        maxBytes: 1024,
        label: "Credential forwarding test"
      })).rejects.toThrow("must not contain embedded credentials");
      await expect(request("/ok")).resolves.toEqual({ ok: true });
      expect(observedHost).toBe(`pinned.test:${address.port}`);
      await expect(request("/redirect")).rejects.toThrow("HTTP 302");
      await expect(request("/large", { maxBytes: 32 })).rejects.toThrow("exceeded 32 bytes");
      const startedAt = Date.now();
      await expect(request("/slow", { timeoutMs: 75 })).rejects.toThrow("timed out");
      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      lookup.mockRestore();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      configureOutboundPolicy(env);
    }
  });

  it("verifies SSL trust, hostname identity, expiry pressure, and a private CA bundle", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-dashboard-tls-"));
    const caKey = path.join(directory, "ca-key.pem");
    const caCert = path.join(directory, "ca.pem");
    const serverKey = path.join(directory, "server-key.pem");
    const serverCsr = path.join(directory, "server.csr");
    const serverCert = path.join(directory, "server.pem");
    const shortCert = path.join(directory, "server-short.pem");
    const extensions = path.join(directory, "server.ext");
    fs.writeFileSync(extensions, "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n", { mode: 0o600 });

    try {
      await execFileAsync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", caKey, "-out", caCert, "-subj", "/CN=Homelab Test CA", "-days", "3650"
      ]);
      await execFileAsync("openssl", [
        "req", "-newkey", "rsa:2048", "-nodes",
        "-keyout", serverKey, "-out", serverCsr, "-subj", "/CN=127.0.0.1"
      ]);
      await execFileAsync("openssl", [
        "x509", "-req", "-in", serverCsr, "-CA", caCert, "-CAkey", caKey,
        "-CAcreateserial", "-out", serverCert, "-days", "365", "-extfile", extensions
      ]);
      await execFileAsync("openssl", [
        "x509", "-req", "-in", serverCsr, "-CA", caCert, "-CAkey", caKey,
        "-CAcreateserial", "-out", shortCert, "-days", "1", "-extfile", extensions
      ]);

      const runServer = async (certificatePath: string, run: (port: number) => Promise<void>) => {
        const server = tls.createServer({
          key: fs.readFileSync(serverKey),
          cert: fs.readFileSync(certificatePath)
        }, (socket) => socket.end());
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
          await run((server.address() as AddressInfo).port);
        } finally {
          await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
      };
      const runWithPrivateCa = async (target: string, pinLocalhost = false) => {
        const script = [
          "import dns from 'node:dns';",
          pinLocalhost
            ? "dns.promises.lookup = async () => [{ address: '127.0.0.1', family: 4 }];"
            : "",
          "const { checkSslCertificate } = await import('./src/server/connectivity.ts');",
          `process.stdout.write(JSON.stringify(await checkSslCertificate(${JSON.stringify(target)}, 3000)));`
        ].join("\n");
        const result = await execFileAsync(process.execPath, [
          "--import", "tsx", "--input-type=module", "-e", script
        ], {
          cwd: process.cwd(),
          env: { ...process.env, NODE_EXTRA_CA_CERTS: caCert },
          timeout: 10_000
        });
        return JSON.parse(result.stdout) as { status: string; error?: string };
      };

      configureOutboundPolicy(env);
      await runServer(serverCert, async (port) => {
        const untrusted = await checkSslCertificate(`127.0.0.1:${port}`, 3000);
        expect(untrusted.status).toBe("offline");
        expect(untrusted.error).toMatch(/certificate|self-signed|issuer/i);

        await expect(runWithPrivateCa(`127.0.0.1:${port}`)).resolves.toMatchObject({ status: "online" });
        const mismatch = await runWithPrivateCa(`mismatch.test:${port}`, true);
        expect(mismatch.status).toBe("offline");
        expect(mismatch.error).toMatch(/hostname|altnames|IP address/i);
      });
      await runServer(shortCert, async (port) => {
        const expiring = await runWithPrivateCa(`127.0.0.1:${port}`);
        expect(expiring.status).toBe("offline");
        expect(expiring.error).toMatch(/expires in/i);
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      configureOutboundPolicy(env);
    }
  }, 30_000);

  it("normalizes and bounds the production security environment", () => {
    const keys = [
      "NODE_ENV",
      "APP_ORIGIN",
      "TRUST_PROXY_CIDRS",
      "DIRECT_HTTP_LAN",
      "DASHBOARD_BIND_IP",
      "COOKIE_SECRET",
      "ADMIN_PASSWORD",
      "SESSION_MAX_AGE_HOURS"
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.NODE_ENV = "production";
      process.env.APP_ORIGIN = "https://dashboard.test";
      process.env.TRUST_PROXY_CIDRS = "172.17.0.1/32";
      process.env.DIRECT_HTTP_LAN = "false";
      process.env.DASHBOARD_BIND_IP = "127.0.0.1";
      process.env.COOKIE_SECRET = "production-cookie-secret-with-more-than-32-characters";
      process.env.ADMIN_PASSWORD = "production-admin-password";
      process.env.SESSION_MAX_AGE_HOURS = "999";

      const production = getEnv();
      expect(production.appOrigin).toBe("https://dashboard.test");
      expect(production.sessionMaxAgeSeconds).toBe(30 * 24 * 60 * 60);
      expect(production.cookieSecure).toBe(true);

      delete process.env.TRUST_PROXY_CIDRS;
      expect(() => getEnv()).toThrow("TRUST_PROXY_CIDRS");
      process.env.TRUST_PROXY_CIDRS = "172.17.0.1/32";
      process.env.APP_ORIGIN = "https://dashboard.test/path";
      expect(() => getEnv()).toThrow("APP_ORIGIN");
      process.env.APP_ORIGIN = "https://dashboard.test";
      process.env.DASHBOARD_BIND_IP = "0.0.0.0";
      expect(() => getEnv()).toThrow("DASHBOARD_BIND_IP must be 127.0.0.1");
      process.env.DASHBOARD_BIND_IP = "127.0.0.1";
      process.env.APP_ORIGIN = "http://192.168.50.20:4173";
      expect(() => getEnv()).toThrow("APP_ORIGIN");
      process.env.DIRECT_HTTP_LAN = "true";
      process.env.DASHBOARD_BIND_IP = "192.168.50.20";
      expect(() => getEnv()).toThrow("TRUST_PROXY_CIDRS must be empty");
      process.env.TRUST_PROXY_CIDRS = "";
      const direct = getEnv();
      expect(direct.appOrigin).toBe("http://192.168.50.20:4173");
      expect(direct.cookieSecure).toBe(false);
      process.env.DASHBOARD_BIND_IP = "192.168.50.21";
      expect(() => getEnv()).toThrow("private DASHBOARD_BIND_IP");
      process.env.DASHBOARD_BIND_IP = "192.168.50.20";
      process.env.APP_ORIGIN = "http://203.0.113.10:4173";
      expect(() => getEnv()).toThrow("private DASHBOARD_BIND_IP");
      process.env.APP_ORIGIN = "https://192.168.50.20:4173";
      expect(() => getEnv()).toThrow("APP_ORIGIN");
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("emits redacted structured security records", async () => {
    let output = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      }
    });
    const loggedApp = await createApp({
      prisma,
      env,
      monitor: false,
      logger: { level: "info", stream }
    });
    const secretAttempt = "do-not-log-this-password";
    await loggedApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: secretAttempt }
    });
    const login = await loggedApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "test-pass" }
    });
    const session = login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    await loggedApp.inject({
      method: "POST",
      url: "/api/auth/reauth",
      headers: { cookie: session },
      payload: { password: secretAttempt }
    });
    await loggedApp.close();

    const events = output
      .trim()
      .split("\n")
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as { securityEvent?: Record<string, unknown> };
          return entry.securityEvent ? [entry.securityEvent] : [];
        } catch {
          return [];
        }
      });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "auth.login", result: "failure" }),
      expect.objectContaining({ event: "auth.login", result: "success" }),
      expect.objectContaining({ event: "auth.reauthenticate", result: "failure" })
    ]));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(secretAttempt);
    expect(serialized).not.toContain("test-pass");
    expect(serialized).not.toContain("url");
    expect(events.every((event) =>
      Object.keys(event).every((key) =>
        ["event", "result", "clientIp", "objectType", "objectId"].includes(key)
      )
    )).toBe(true);
  });
});
