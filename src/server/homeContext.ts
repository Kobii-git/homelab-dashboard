import { resolveEndpointUrl } from "./endpointUrl.js";
import crypto from "node:crypto";
import type { ApiWidget, Prisma, PrismaClient } from "@prisma/client";
import type {
  AgendaEventDto,
  AgendaSummaryDto,
  DashboardHomeConfigDto,
  DashboardHomeSummaryDto,
  HomeMediaItemDto,
  HomeMediaSummaryDto,
  HomeStorageSummaryDto,
  MailSummaryDto,
  TodoistTaskDto,
  TrueNasSnapshotDto,
  UtilityResultDto
} from "../shared/types.js";
import type { AppEnv } from "./env.js";
import { requestApiWidgetJson } from "./apiWidgets.js";
import { assertApiWidgetSecretBinding } from "./apiWidgetBindings.js";
import { fetchProxiedIcon } from "./iconProxy.js";
import { boundedJsonRequest, type JsonRequestOptions } from "./httpJson.js";
import { dashboardHomeConfigSchema } from "./validation.js";

const DASHBOARD_HOME_CONFIG_KEY = "dashboard_home_v1";
const GOOGLE_CACHE_MS = 5 * 60_000;
const TODOIST_CACHE_MS = 2 * 60_000;
const MEDIA_SERVER_CACHE_MS = 2 * 60_000;
const TMDB_CACHE_MS = 6 * 60 * 60_000;
const POSTER_CACHE_MS = 60 * 60_000;

export const DEFAULT_DASHBOARD_HOME_CONFIG: DashboardHomeConfigDto = {
  agendaEnabled: false,
  tasksEnabled: false,
  mailEnabled: false,
  mediaEnabled: false,
  storageEnabled: false,
  plexWidgetId: null,
  radarrWidgetId: null,
  mediaRegion: "ZA",
  mediaLanguage: "en-US",
  mediaLimit: 6
};

type JsonRequester = (url: URL | string, options: JsonRequestOptions) => Promise<unknown>;
type CacheEntry<T> = { value: T; fetchedAt: string; expiresAt: number };
type CachedValue<T> = { value: T; fetchedAt: string; stale: boolean; refreshError?: string };
type PosterTarget =
  | { kind: "tmdb"; url: string }
  | { kind: "widget"; widgetId: string; path: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeHttpsUrl(value: unknown, allowedHosts: readonly string[]): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && allowedHosts.includes(parsed.hostname.toLowerCase())
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer redacted")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic redacted")
    .replace(/[?&](?:token|api_key|apikey|key)=[^&\s]+/gi, "")
    .slice(0, 240);
}

function disabledResult<T>(): UtilityResultDto<T> {
  return { state: "disabled", data: null, fetchedAt: null, stale: false, error: null };
}

function cloneDefaultConfig(): DashboardHomeConfigDto {
  return { ...DEFAULT_DASHBOARD_HOME_CONFIG };
}

export async function getDashboardHomeConfig(prisma: Pick<PrismaClient, "systemConfig">): Promise<DashboardHomeConfigDto> {
  const entry = await prisma.systemConfig.findUnique({ where: { key: DASHBOARD_HOME_CONFIG_KEY } });
  if (!entry) return cloneDefaultConfig();
  try {
    const parsed = dashboardHomeConfigSchema.safeParse(JSON.parse(entry.value));
    return parsed.success ? parsed.data : cloneDefaultConfig();
  } catch {
    return cloneDefaultConfig();
  }
}

export async function setDashboardHomeConfig(
  prisma: Pick<PrismaClient, "systemConfig">,
  config: DashboardHomeConfigDto
): Promise<DashboardHomeConfigDto> {
  const normalized = dashboardHomeConfigSchema.parse(config);
  await prisma.systemConfig.upsert({
    where: { key: DASHBOARD_HOME_CONFIG_KEY },
    create: { key: DASHBOARD_HOME_CONFIG_KEY, value: JSON.stringify(normalized) },
    update: { value: JSON.stringify(normalized) }
  });
  return normalized;
}

function monthRange(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function googleEvent(value: unknown, calendarName: string): AgendaEventDto | null {
  const event = asRecord(value);
  const start = asRecord(event.start);
  const end = asRecord(event.end);
  const dateTime = stringValue(start.dateTime);
  const date = stringValue(start.date);
  const startValue = dateTime ?? (date ? `${date}T00:00:00` : null);
  if (!startValue) return null;
  return {
    id: stringValue(event.id) ?? crypto.createHash("sha256").update(`${calendarName}:${startValue}:${event.summary}`).digest("hex").slice(0, 24),
    title: stringValue(event.summary) ?? "Busy",
    start: startValue,
    end: stringValue(end.dateTime) ?? (stringValue(end.date) ? `${stringValue(end.date)}T00:00:00` : null),
    allDay: !dateTime,
    calendarName,
    color: stringValue(event.colorId),
    url: safeHttpsUrl(event.htmlLink, ["calendar.google.com", "www.google.com"])
  };
}

function taskDueMillis(task: TodoistTaskDto): number {
  const value = task.dueAt ?? (task.dueDate ? `${task.dueDate}T23:59:59` : null);
  const parsed = value ? Date.parse(value) : Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizeTodoistTask(value: unknown, now: number, projectNames: Map<string, string>): TodoistTaskDto | null {
  const task = asRecord(value);
  const id = stringValue(task.id) ?? (typeof task.id === "number" ? String(task.id) : null);
  const content = stringValue(task.content);
  if (!id || !content) return null;
  const due = asRecord(task.due);
  const dueAt = stringValue(due.datetime);
  const dueDate = stringValue(due.date);
  const dueMillis = Date.parse(dueAt ?? (dueDate ? `${dueDate}T23:59:59` : ""));
  const project = asRecord(task.project);
  const projectId = stringValue(task.project_id) ?? (typeof task.project_id === "number" ? String(task.project_id) : null);
  return {
    id,
    content,
    dueAt,
    dueDate,
    overdue: Boolean(due.is_overdue) || (Number.isFinite(dueMillis) && dueMillis < now),
    priority: Math.max(1, Math.min(4, numberValue(task.priority) ?? 1)),
    projectName: stringValue(task.project_name) ?? stringValue(project.name) ?? (projectId ? projectNames.get(projectId) ?? null : null),
    url: safeHttpsUrl(task.url, ["app.todoist.com", "todoist.com"]) ?? `https://app.todoist.com/app/task/${encodeURIComponent(id)}`
  };
}

function mediaYear(value: unknown, date: string | null): number | null {
  const direct = numberValue(value);
  if (direct && direct > 1800 && direct < 3000) return Math.trunc(direct);
  const fromDate = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(fromDate) ? fromDate : null;
}

export function storageSummaryFromSnapshots(
  source: { id: string; name: string },
  latest: TrueNasSnapshotDto,
  history: TrueNasSnapshotDto[]
): HomeStorageSummaryDto {
  const capacity = latest.dataset ?? latest.pool;
  const oldest = history.at(-1)?.dataset ?? history.at(-1)?.pool ?? null;
  const usedPercent = capacity.sizeBytes > 0 ? Math.round((capacity.usedBytes / capacity.sizeBytes) * 1000) / 10 : 0;
  return {
    sourceId: source.id,
    name: source.name,
    poolName: latest.pool.name,
    datasetName: latest.dataset?.name ?? null,
    status: latest.status,
    health: latest.pool.health,
    sizeBytes: capacity.sizeBytes,
    usedBytes: capacity.usedBytes,
    freeBytes: capacity.freeBytes,
    usedPercent,
    change24hBytes: oldest ? capacity.usedBytes - oldest.usedBytes : null,
    sampledAt: latest.sampledAt
  };
}

export class HomeContextService {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<CacheEntry<unknown>>>();
  private readonly posters = new Map<string, { target: PosterTarget; expiresAt: number }>();
  private googleToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly request: JsonRequester = boundedJsonRequest,
    private readonly now: () => number = Date.now
  ) {}

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<CachedValue<T>> {
    const existing = this.cache.get(key) as CacheEntry<T> | undefined;
    if (existing && existing.expiresAt > this.now()) {
      return { value: existing.value, fetchedAt: existing.fetchedAt, stale: false };
    }
    let pending = this.inFlight.get(key) as Promise<CacheEntry<T>> | undefined;
    if (!pending) {
      pending = load().then((value) => {
        const entry = { value, fetchedAt: new Date(this.now()).toISOString(), expiresAt: this.now() + ttlMs };
        this.cache.set(key, entry as CacheEntry<unknown>);
        return entry;
      }).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending as Promise<CacheEntry<unknown>>);
    }
    try {
      const refreshed = await pending;
      return { value: refreshed.value, fetchedAt: refreshed.fetchedAt, stale: false };
    } catch (error) {
      if (existing) {
        return {
          value: existing.value,
          fetchedAt: existing.fetchedAt,
          stale: true,
          refreshError: errorMessage(error, "Refresh failed")
        };
      }
      throw error;
    }
  }

  private result<T>(value: CachedValue<T>, error: string | null = null): UtilityResultDto<T> {
    return {
      state: "ready",
      data: value.value,
      fetchedAt: value.fetchedAt,
      stale: value.stale,
      error: error ?? value.refreshError ?? null
    };
  }

  private async loadResult<T>(load: () => Promise<CachedValue<T>>, fallback: string): Promise<UtilityResultDto<T>> {
    try {
      return this.result(await load());
    } catch (error) {
      return { state: "error", data: null, fetchedAt: null, stale: false, error: errorMessage(error, fallback) };
    }
  }

  private async googleAccessToken(env: AppEnv["google"]): Promise<string> {
    if (!env.configured || !env.clientId || !env.clientSecret || !env.refreshToken) {
      throw new Error("Google credentials are not configured");
    }
    if (this.googleToken && this.googleToken.expiresAt > this.now()) return this.googleToken.value;
    const form = new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: env.refreshToken,
      grant_type: "refresh_token"
    });
    const response = asRecord(await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      form,
      timeoutMs: 5_000,
      maxBytes: 128 * 1024,
      fixedProvider: true,
      credentialed: true,
      label: "Google token refresh"
    }));
    const token = stringValue(response.access_token);
    if (!token) throw new Error("Google token refresh returned no access token");
    const lifetime = Math.max(60, numberValue(response.expires_in) ?? 3600);
    this.googleToken = { value: token, expiresAt: this.now() + Math.max(30, lifetime - 60) * 1000 };
    return token;
  }

  private async agenda(env: AppEnv): Promise<CachedValue<AgendaSummaryDto>> {
    return this.cached(`google:agenda:${env.google.calendarIds.join(",")}`, GOOGLE_CACHE_MS, async () => {
      const token = await this.googleAccessToken(env.google);
      const range = monthRange(new Date(this.now()));
      const calendars = await Promise.all(env.google.calendarIds.map(async (calendarId) => {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
        url.searchParams.set("timeMin", range.start);
        url.searchParams.set("timeMax", range.end);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "100");
        const response = asRecord(await this.request(url, {
          headers: { Authorization: `Bearer ${token}` },
          timeoutMs: 5_000,
          maxBytes: 1_000_000,
          fixedProvider: true,
          credentialed: true,
          label: "Google Calendar"
        }));
        return {
          timeZone: stringValue(response.timeZone),
          events: asArray(response.items).flatMap((event) => {
            const normalized = googleEvent(event, calendarId === "primary" ? "Primary" : calendarId);
            return normalized ? [normalized] : [];
          })
        };
      }));
      return {
        events: calendars.flatMap((calendar) => calendar.events).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
        timeZone: calendars.find((calendar) => calendar.timeZone)?.timeZone ?? null
      };
    });
  }

  private async mail(env: AppEnv): Promise<CachedValue<MailSummaryDto>> {
    return this.cached("google:mail:inbox", GOOGLE_CACHE_MS, async () => {
      const token = await this.googleAccessToken(env.google);
      const response = asRecord(await this.request("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX", {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 5_000,
        maxBytes: 128 * 1024,
        fixedProvider: true,
        credentialed: true,
        label: "Gmail label count"
      }));
      return {
        inboxUnread: Math.max(0, Math.trunc(numberValue(response.messagesUnread) ?? 0)),
        inboxUrl: "https://mail.google.com/mail/u/0/#inbox",
        composeUrl: "https://mail.google.com/mail/u/0/#compose"
      };
    });
  }

  private async tasks(env: AppEnv, limit: number): Promise<CachedValue<TodoistTaskDto[]>> {
    if (!env.todoist.configured || !env.todoist.apiToken) throw new Error("Todoist is not configured");
    return this.cached(`todoist:tasks:${limit}`, TODOIST_CACHE_MS, async () => {
      const results: unknown[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page += 1) {
        const url = new URL("https://api.todoist.com/api/v1/tasks/filter");
        url.searchParams.set("query", "today | overdue");
        url.searchParams.set("limit", "50");
        if (cursor) url.searchParams.set("cursor", cursor);
        const response = await this.request(url, {
          headers: { Authorization: `Bearer ${env.todoist.apiToken}` },
          timeoutMs: 5_000,
          maxBytes: 512 * 1024,
          fixedProvider: true,
          credentialed: true,
          label: "Todoist tasks"
        });
        const record = asRecord(response);
        results.push(...(Array.isArray(response) ? response : asArray(record.results)));
        cursor = stringValue(record.next_cursor);
        if (!cursor) break;
      }
      const projectNames = new Map<string, string>();
      if (results.some((item) => {
        const projectId = asRecord(item).project_id;
        return typeof projectId === "string" || typeof projectId === "number";
      })) {
        try {
          cursor = null;
          for (let page = 0; page < 3; page += 1) {
            const url = new URL("https://api.todoist.com/api/v1/projects");
            url.searchParams.set("limit", "200");
            if (cursor) url.searchParams.set("cursor", cursor);
            const response = await this.request(url, {
              headers: { Authorization: `Bearer ${env.todoist.apiToken}` },
              timeoutMs: 5_000,
              maxBytes: 512 * 1024,
              fixedProvider: true,
              credentialed: true,
              label: "Todoist projects"
            });
            const record = asRecord(response);
            for (const value of (Array.isArray(response) ? response : asArray(record.results))) {
              const project = asRecord(value);
              const id = stringValue(project.id) ?? (typeof project.id === "number" ? String(project.id) : null);
              const name = stringValue(project.name);
              if (id && name) projectNames.set(id, name);
            }
            cursor = stringValue(record.next_cursor);
            if (!cursor) break;
          }
        } catch {
          // Project names are optional context; task availability should not depend on this lookup.
        }
      }
      return results.flatMap((item) => {
        const task = normalizeTodoistTask(item, this.now(), projectNames);
        return task ? [task] : [];
      }).sort((left, right) => Number(right.overdue) - Number(left.overdue) || taskDueMillis(left) - taskDueMillis(right) || right.priority - left.priority)
        .slice(0, limit);
    });
  }

  private mintPoster(target: PosterTarget): string {
    for (const [ref, entry] of this.posters) {
      if (entry.expiresAt <= this.now()) this.posters.delete(ref);
      else if (JSON.stringify(entry.target) === JSON.stringify(target)) return `/api/home/posters/${ref}`;
    }
    const ref = crypto.randomBytes(18).toString("base64url");
    this.posters.set(ref, { target, expiresAt: this.now() + POSTER_CACHE_MS });
    if (this.posters.size > 240) this.posters.delete(this.posters.keys().next().value as string);
    return `/api/home/posters/${ref}`;
  }

  private async widget(prisma: PrismaClient, id: string | null, templateId: string): Promise<ApiWidget> {
    if (!id) throw new Error(`${templateId === "plex" ? "Plex" : "Radarr"} widget is not selected`);
    const widget = await prisma.apiWidget.findUnique({ where: { id } });
    if (!widget || !widget.enabled || widget.templateId !== templateId) {
      throw new Error(`Selected ${templateId === "plex" ? "Plex" : "Radarr"} widget is unavailable`);
    }
    const expected = templateId === "plex"
      ? { envVar: "PLEX_TOKEN", header: "X-Plex-Token" }
      : { envVar: "RADARR_API_KEY", header: "X-Api-Key" };
    if (widget.authType !== "header" || widget.authEnvVar !== expected.envVar || widget.authHeaderName !== expected.header) {
      throw new Error(`Selected ${templateId === "plex" ? "Plex" : "Radarr"} widget does not use the built-in credential binding`);
    }
    return widget;
  }

  private async plex(prisma: PrismaClient, env: AppEnv, config: DashboardHomeConfigDto): Promise<CachedValue<HomeMediaItemDto[]>> {
    return this.cached(`plex:${config.plexWidgetId}:${config.mediaLimit}`, MEDIA_SERVER_CACHE_MS, async () => {
      const widget = await this.widget(prisma, config.plexWidgetId, "plex");
      const raw = asRecord(await requestApiWidgetJson(prisma, widget, `/library/recentlyAdded?type=1&X-Plex-Container-Start=0&X-Plex-Container-Size=${config.mediaLimit}`, env.apiWidgetSecretAllowlist));
      return asArray(asRecord(raw.MediaContainer).Metadata).slice(0, config.mediaLimit).flatMap((value) => {
        const item = asRecord(value);
        const title = stringValue(item.title);
        const key = stringValue(item.ratingKey) ?? stringValue(item.key);
        if (!title || !key) return [];
        const added = numberValue(item.addedAt);
        const thumb = stringValue(item.thumb);
        return [{
          id: `plex:${key}`,
          source: "plex",
          title,
          year: mediaYear(item.year, null),
          releaseDate: stringValue(item.originallyAvailableAt),
          addedAt: added ? new Date(added * 1000).toISOString() : null,
          posterUrl: thumb ? this.mintPoster({ kind: "widget", widgetId: widget.id, path: thumb }) : null,
          externalUrl: null
        } satisfies HomeMediaItemDto];
      });
    });
  }

  private async radarr(prisma: PrismaClient, env: AppEnv, config: DashboardHomeConfigDto): Promise<CachedValue<HomeMediaItemDto[]>> {
    return this.cached(`radarr:${config.radarrWidgetId}:${config.mediaLimit}`, MEDIA_SERVER_CACHE_MS, async () => {
      const widget = await this.widget(prisma, config.radarrWidgetId, "radarr");
      const start = new Date(this.now()).toISOString().slice(0, 10);
      const end = new Date(this.now() + 120 * 86400_000).toISOString().slice(0, 10);
      const raw = await requestApiWidgetJson(prisma, widget, `/api/v3/calendar?start=${start}&end=${end}&unmonitored=false`, env.apiWidgetSecretAllowlist);
      return asArray(raw).flatMap((value) => {
        const item = asRecord(value);
        const title = stringValue(item.title);
        const releaseDate = stringValue(item.digitalRelease) ?? stringValue(item.physicalRelease) ?? stringValue(item.inCinemas);
        const id = numberValue(item.id) ?? numberValue(item.tmdbId);
        if (!title || id == null) return [];
        const image = asArray(item.images).map(asRecord).find((candidate) => stringValue(candidate.coverType)?.toLowerCase() === "poster");
        const remoteUrl = image ? stringValue(image.remoteUrl) : null;
        let posterUrl: string | null = null;
        if (remoteUrl) {
          try {
            const parsed = new URL(remoteUrl);
            if (parsed.protocol === "https:" && parsed.hostname === "image.tmdb.org") {
              posterUrl = this.mintPoster({ kind: "tmdb", url: parsed.toString() });
            }
          } catch { /* malformed provider image URLs are omitted */ }
        }
        return [{
          id: `radarr:${id}`,
          source: "radarr",
          title,
          year: mediaYear(item.year, releaseDate),
          releaseDate,
          addedAt: null,
          posterUrl,
          externalUrl: numberValue(item.tmdbId) ? `https://www.themoviedb.org/movie/${numberValue(item.tmdbId)}` : null
        } satisfies HomeMediaItemDto];
      }).sort((a, b) => Date.parse(a.releaseDate ?? "9999") - Date.parse(b.releaseDate ?? "9999")).slice(0, config.mediaLimit);
    });
  }

  private async tmdb(env: AppEnv, config: DashboardHomeConfigDto): Promise<CachedValue<{ upcoming: HomeMediaItemDto[]; trending: HomeMediaItemDto[] }>> {
    if (!env.tmdb.configured || !env.tmdb.bearerToken) throw new Error("TMDB is not configured");
    return this.cached(`tmdb:${config.mediaRegion}:${config.mediaLanguage}:${config.mediaLimit}`, TMDB_CACHE_MS, async () => {
      const requestList = async (path: string) => {
        const url = new URL(`https://api.themoviedb.org/3${path}`);
        url.searchParams.set("region", config.mediaRegion);
        url.searchParams.set("language", config.mediaLanguage);
        const response = asRecord(await this.request(url, {
          headers: { Authorization: `Bearer ${env.tmdb.bearerToken}` },
          timeoutMs: 5_000,
          maxBytes: 1_000_000,
          fixedProvider: true,
          credentialed: true,
          label: "TMDB media"
        }));
        return asArray(response.results).slice(0, config.mediaLimit).flatMap((value) => {
          const item = asRecord(value);
          const id = numberValue(item.id);
          const title = stringValue(item.title);
          if (id == null || !title) return [];
          const releaseDate = stringValue(item.release_date);
          const posterPath = stringValue(item.poster_path);
          return [{
            id: `tmdb:${id}`,
            source: "tmdb",
            title,
            year: mediaYear(null, releaseDate),
            releaseDate,
            addedAt: null,
            posterUrl: posterPath ? this.mintPoster({ kind: "tmdb", url: `https://image.tmdb.org/t/p/w342${posterPath}` }) : null,
            externalUrl: `https://www.themoviedb.org/movie/${id}`
          } satisfies HomeMediaItemDto];
        });
      };
      const [upcoming, trending] = await Promise.all([requestList("/movie/upcoming"), requestList("/trending/movie/day")]);
      return { upcoming, trending };
    });
  }

  private async media(prisma: PrismaClient, env: AppEnv, config: DashboardHomeConfigDto): Promise<UtilityResultDto<HomeMediaSummaryDto>> {
    const [plex, radarr, tmdb] = await Promise.allSettled([
      this.plex(prisma, env, config),
      this.radarr(prisma, env, config),
      this.tmdb(env, config)
    ]);
    const successes = [plex, radarr, tmdb].filter((result) => result.status === "fulfilled");
    if (successes.length === 0) {
      const errors = [plex, radarr, tmdb].map((result) => result.status === "rejected" ? errorMessage(result.reason, "Media unavailable") : null).filter(Boolean);
      return { state: "error", data: null, fetchedAt: null, stale: false, error: errors.join(" · ").slice(0, 240) };
    }
    const tmdbValue = tmdb.status === "fulfilled" ? tmdb.value : null;
    const error = [plex, radarr, tmdb].flatMap((result) => {
      if (result.status === "rejected") return [errorMessage(result.reason, "Media source unavailable")];
      return result.value.refreshError ? [result.value.refreshError] : [];
    }).join(" · ").slice(0, 240) || null;
    return {
      state: "ready",
      data: {
        recentlyAdded: plex.status === "fulfilled" ? plex.value.value : [],
        upcoming: radarr.status === "fulfilled" && radarr.value.value.length > 0 ? radarr.value.value : tmdbValue?.value.upcoming ?? [],
        trending: tmdbValue?.value.trending ?? [],
        attribution: env.tmdb.configured ? {
          provider: "tmdb",
          notice: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
          logoUrl: "/tmdb-logo.svg"
        } : null
      },
      fetchedAt: [plex, radarr, tmdb].flatMap((result) => result.status === "fulfilled" ? [result.value.fetchedAt] : []).sort().at(-1) ?? null,
      stale: [plex, radarr, tmdb].some((result) => result.status === "fulfilled" && result.value.stale),
      error
    };
  }

  private async storage(prisma: PrismaClient): Promise<UtilityResultDto<HomeStorageSummaryDto>> {
    try {
      const source = await prisma.integrationSource.findFirst({
        where: { provider: "truenas", enabled: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { samples: { orderBy: { sampledAt: "desc" }, take: 1440 } }
      });
      const latest = source?.latestSnapshot as Prisma.JsonValue | null | undefined;
      if (!source || !latest || typeof latest !== "object" || Array.isArray(latest) || (latest as { provider?: string }).provider !== "truenas") {
        throw new Error("TrueNAS has not produced a storage sample yet");
      }
      const history = source.samples.flatMap((sample) => {
        const snapshot = sample.snapshot;
        return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && (snapshot as { provider?: string }).provider === "truenas"
          ? [snapshot as unknown as TrueNasSnapshotDto]
          : [];
      });
      const summary = storageSummaryFromSnapshots(source, latest as unknown as TrueNasSnapshotDto, history);
      return { state: "ready", data: summary, fetchedAt: source.latestSampledAt?.toISOString() ?? null, stale: false, error: source.latestError };
    } catch (error) {
      return { state: "error", data: null, fetchedAt: null, stale: false, error: errorMessage(error, "Storage unavailable") };
    }
  }

  async getSummary(prisma: PrismaClient, env: AppEnv, config: DashboardHomeConfigDto): Promise<DashboardHomeSummaryDto> {
    const [agenda, tasks, mail, media, storage] = await Promise.all([
      config.agendaEnabled ? this.loadResult(() => this.agenda(env), "Calendar unavailable") : Promise.resolve(disabledResult<AgendaSummaryDto>()),
      config.tasksEnabled ? this.loadResult(() => this.tasks(env, 6), "Todoist unavailable") : Promise.resolve(disabledResult<TodoistTaskDto[]>()),
      config.mailEnabled ? this.loadResult(() => this.mail(env), "Gmail unavailable") : Promise.resolve(disabledResult<MailSummaryDto>()),
      config.mediaEnabled ? this.media(prisma, env, config) : Promise.resolve(disabledResult<HomeMediaSummaryDto>()),
      config.storageEnabled ? this.storage(prisma) : Promise.resolve(disabledResult<HomeStorageSummaryDto>())
    ]);
    return { agenda, tasks, mail, media, storage };
  }

  async getPoster(prisma: PrismaClient, env: AppEnv, ref: string): Promise<{ body: Buffer; contentType: string }> {
    if (!/^[A-Za-z0-9_-]{24}$/.test(ref)) throw new Error("Poster reference is invalid");
    const entry = this.posters.get(ref);
    if (!entry || entry.expiresAt <= this.now()) {
      this.posters.delete(ref);
      throw new Error("Poster reference is unavailable");
    }
    if (entry.target.kind === "tmdb") {
      return fetchProxiedIcon(new URL(entry.target.url), {
        fixedProvider: true,
        cacheKey: `poster:${ref}`,
        maxBytes: 2 * 1024 * 1024,
        cacheMs: POSTER_CACHE_MS
      });
    }
    const widget = await prisma.apiWidget.findUnique({ where: { id: entry.target.widgetId } });
    if (!widget || !widget.enabled || widget.templateId !== "plex" || widget.authType !== "header" || widget.authEnvVar !== "PLEX_TOKEN" || widget.authHeaderName !== "X-Plex-Token") throw new Error("Poster source is unavailable");
    await assertApiWidgetSecretBinding(prisma, widget);
    if (!entry.target.path.startsWith("/") || entry.target.path.startsWith("//")) throw new Error("Poster path is invalid");
    const plexToken = widget.authEnvVar ? process.env[widget.authEnvVar] : null;
    if (!plexToken) throw new Error("Plex poster credentials are unavailable");
    const url = resolveEndpointUrl(widget.baseUrl, entry.target.path);
    url.searchParams.delete("X-Plex-Token");
    url.searchParams.delete("token");
    return fetchProxiedIcon(url, {
      headers: { "X-Plex-Token": plexToken },
      tlsVerify: widget.tlsVerify,
      credentialed: true,
      cacheKey: `poster:${ref}`,
      maxBytes: 2 * 1024 * 1024,
      cacheMs: POSTER_CACHE_MS
    });
  }
}
