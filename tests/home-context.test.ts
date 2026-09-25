import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/server/env.js";
import type { DashboardHomeConfigDto, TrueNasSnapshotDto } from "../src/shared/types.js";
import {
  DEFAULT_DASHBOARD_HOME_CONFIG,
  HomeContextService,
  storageSummaryFromSnapshots
} from "../src/server/homeContext.js";
import { isTrueNasConfigured, sanitizeTrueNasError, trueNasRuntimeConfig } from "../src/server/truenas.js";
import type { JsonRequestOptions } from "../src/server/httpJson.js";

const baseEnv: AppEnv = {
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
  allowInsecureIntegrations: false,
  apiWidgetSecretAllowlist: [],
  opnsense: { enabled: false, configured: false, name: "OPNsense", baseUrl: null, apiKey: null, apiSecret: null, tlsVerify: true, pollIntervalSeconds: 60 },
  google: { configured: true, clientId: "client", clientSecret: "secret", refreshToken: "refresh", calendarIds: ["primary"] },
  todoist: { configured: false, apiToken: null },
  tmdb: { configured: false, bearerToken: null },
  truenas: { enabled: false, configured: false, name: "TrueNAS", baseUrl: null, username: null, apiKey: null, poolName: null, datasetName: null, tlsVerify: true, pollIntervalSeconds: 60 },
  ai: { enabled: false, configured: false, providerName: "AI", baseUrl: "https://api.openai.com/v1", apiKey: null, model: null, tlsVerify: true, briefingIntervalSeconds: 21600, includeTargets: false }
};

function config(patch: Partial<DashboardHomeConfigDto>): DashboardHomeConfigDto {
  return { ...DEFAULT_DASHBOARD_HOME_CONFIG, ...patch };
}

describe("daily home context", () => {
  it("refreshes Google tokens with form data and normalizes timed and all-day events", async () => {
    const calls: Array<{ url: string; options: JsonRequestOptions }> = [];
    const service = new HomeContextService(async (url, options) => {
      calls.push({ url: url.toString(), options });
      if (url.toString().includes("oauth2.googleapis.com")) return { access_token: "access", expires_in: 3600 };
      return {
        timeZone: "Africa/Johannesburg",
        items: [
          { id: "one", summary: "Planning", start: { dateTime: "2026-08-30T09:00:00+02:00" }, end: { dateTime: "2026-08-30T09:30:00+02:00" }, htmlLink: "https://calendar.google.com/event?eid=one" },
          { id: "two", summary: "Holiday", start: { date: "2026-08-31" }, end: { date: "2026-09-01" } }
        ]
      };
    }, () => Date.UTC(2026, 7, 30, 6));

    const summary = await service.getSummary({} as PrismaClient, baseEnv, config({ agendaEnabled: true }));
    expect(summary.agenda.state).toBe("ready");
    expect(summary.agenda.data?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "one", allDay: false, title: "Planning" }),
      expect.objectContaining({ id: "two", allDay: true, title: "Holiday" })
    ]));
    expect(summary.agenda.data?.timeZone).toBe("Africa/Johannesburg");
    expect(calls[0].options.form?.get("grant_type")).toBe("refresh_token");
    expect(calls[1].options.headers?.Authorization).toBe("Bearer access");
  });

  it("returns stale cached agenda data when a refresh fails", async () => {
    let now = Date.UTC(2026, 7, 30, 6);
    let eventCalls = 0;
    const service = new HomeContextService(async (url) => {
      if (url.toString().includes("oauth2.googleapis.com")) return { access_token: "access", expires_in: 3600 };
      eventCalls += 1;
      if (eventCalls > 1) throw new Error("Bearer private-token failed");
      return { items: [{ id: "one", summary: "Planning", start: { date: "2026-08-30" }, end: { date: "2026-08-31" } }] };
    }, () => now);
    const homeConfig = config({ agendaEnabled: true });
    expect((await service.getSummary({} as PrismaClient, baseEnv, homeConfig)).agenda.stale).toBe(false);
    now += 6 * 60_000;
    const stale = (await service.getSummary({} as PrismaClient, baseEnv, homeConfig)).agenda;
    expect(stale.state).toBe("ready");
    expect(stale.stale).toBe(true);
    expect(stale.data?.events[0]?.title).toBe("Planning");
    expect(stale.error).toBe("Bearer redacted failed");
    expect(stale.error).not.toContain("private-token");
  });

  it("paginates Todoist safely and sorts overdue tasks before today", async () => {
    const env = { ...baseEnv, google: { ...baseEnv.google, configured: false }, todoist: { configured: true, apiToken: "todoist" } };
    const service = new HomeContextService(async (url) => {
      const parsed = new URL(url.toString());
      if (parsed.pathname.endsWith("/projects")) {
        return { results: [{ id: "personal", name: "Personal" }], next_cursor: null };
      }
      if (!parsed.searchParams.get("cursor")) {
        return { results: [{ id: "today", content: "Today", project_id: "personal", due: { date: "2026-08-30" }, priority: 1 }], next_cursor: "next" };
      }
      return { results: [{ id: "late", content: "Late", project_id: "personal", due: { date: "2026-08-28", is_overdue: true }, priority: 4 }], next_cursor: null };
    }, () => Date.UTC(2026, 7, 30, 6));
    const tasks = (await service.getSummary({} as PrismaClient, env, config({ tasksEnabled: true }))).tasks;
    expect(tasks.state).toBe("ready");
    expect(tasks.data?.map((task) => task.id)).toEqual(["late", "today"]);
    expect(tasks.data?.[0]?.projectName).toBe("Personal");
    expect(tasks.data?.[0]?.url).toContain("app.todoist.com");
  });

  it("isolates media source failures and still serves TMDB discovery", async () => {
    const env = { ...baseEnv, google: { ...baseEnv.google, configured: false }, tmdb: { configured: true, bearerToken: "tmdb" } };
    const prisma = { apiWidget: { findUnique: async () => null } } as unknown as PrismaClient;
    const service = new HomeContextService(async () => ({
      results: [{ id: 42, title: "The Answer", release_date: "2026-09-01", poster_path: "/poster.jpg" }]
    }), () => Date.UTC(2026, 7, 30, 6));
    const media = (await service.getSummary(prisma, env, config({ mediaEnabled: true }))).media;
    expect(media.state).toBe("ready");
    expect(media.data?.trending[0]).toMatchObject({ id: "tmdb:42", title: "The Answer", source: "tmdb" });
    expect(media.data?.upcoming[0]?.posterUrl).toMatch(/^\/api\/home\/posters\//);
    expect(media.error).toContain("Plex widget is not selected");
    expect(media.data?.attribution?.notice).toContain("not endorsed or certified by TMDB");
  });
});

describe("TrueNAS storage normalization", () => {
  const latest: TrueNasSnapshotDto = {
    provider: "truenas",
    status: "online",
    sampledAt: "2026-08-30T06:00:00.000Z",
    warnings: [],
    pool: { name: "tank", health: "ONLINE", statusDetail: null, sizeBytes: 1000, usedBytes: 850, freeBytes: 150 },
    dataset: { name: "tank/media", sizeBytes: 800, usedBytes: 640, freeBytes: 160 }
  };

  it("uses the media dataset for capacity and computes the 24-hour change", () => {
    const oldest: TrueNasSnapshotDto = {
      ...latest,
      sampledAt: "2026-08-29T06:00:00.000Z",
      dataset: { name: "tank/media", sizeBytes: 800, usedBytes: 600, freeBytes: 200 }
    };
    expect(storageSummaryFromSnapshots({ id: "source", name: "NAS" }, latest, [latest, oldest])).toMatchObject({
      datasetName: "tank/media",
      usedPercent: 80,
      change24hBytes: 40
    });
  });

  it("recognizes complete configuration and redacts API key wording from errors", () => {
    const configured = { ...baseEnv.truenas, enabled: true, configured: true, baseUrl: "https://nas.example", username: "reader", apiKey: "secret", poolName: "tank" };
    expect(isTrueNasConfigured(configured)).toBe(true);
    expect(sanitizeTrueNasError(new Error("api_key=secret failed"))).not.toContain("secret");
    expect(JSON.stringify(trueNasRuntimeConfig(configured))).not.toContain("secret");
    expect(JSON.stringify(trueNasRuntimeConfig(configured))).not.toContain("reader");
  });
});
