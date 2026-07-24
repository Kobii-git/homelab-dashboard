import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type {
  DashboardUtilitiesConfigDto,
  DashboardUtilitiesSummaryDto,
  ReleaseItemDto,
  UtilityResultDto,
  WeatherLocationDto,
  WeatherSummaryDto
} from "../shared/types.js";
import { boundedJsonRequest, type JsonRequestOptions } from "./httpJson.js";
import { dashboardUtilitiesConfigSchema } from "./validation.js";

const DASHBOARD_UTILITIES_CONFIG_KEY = "dashboard_utilities_v1";
const WEATHER_CACHE_MS = 15 * 60_000;
const GEOCODING_CACHE_MS = 24 * 60 * 60_000;
const RELEASE_CACHE_MS = 6 * 60 * 60_000;

export const DEFAULT_DASHBOARD_UTILITIES_CONFIG: DashboardUtilitiesConfigDto = {
  searchEngine: "duckduckgo",
  weather: {
    enabled: false,
    units: "metric",
    location: null
  },
  releases: {
    enabled: false,
    repositories: []
  }
};

type JsonRequester = (url: URL | string, options: JsonRequestOptions) => Promise<unknown>;

type CacheEntry<T> = {
  value: T;
  fetchedAt: string;
  expiresAt: number;
};

type CachedValue<T> = {
  value: T;
  fetchedAt: string;
  stale: boolean;
};

const geocodingResponseSchema = z.object({
  results: z.array(z.object({
    name: z.string(),
    country: z.string().optional(),
    admin1: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string()
  })).optional()
});

const forecastResponseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number().optional(),
    is_day: z.number().optional(),
    weather_code: z.number()
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()).optional()
  })
});

const releaseResponseSchema = z.object({
  html_url: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  }, "GitHub returned an unexpected release URL"),
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  published_at: z.string().datetime({ offset: true })
});

function cloneDefaultConfig(): DashboardUtilitiesConfigDto {
  return {
    searchEngine: DEFAULT_DASHBOARD_UTILITIES_CONFIG.searchEngine,
    weather: { ...DEFAULT_DASHBOARD_UTILITIES_CONFIG.weather },
    releases: {
      ...DEFAULT_DASHBOARD_UTILITIES_CONFIG.releases,
      repositories: []
    }
  };
}

export async function getDashboardUtilitiesConfig(prisma: PrismaClient): Promise<DashboardUtilitiesConfigDto> {
  const entry = await prisma.systemConfig.findUnique({ where: { key: DASHBOARD_UTILITIES_CONFIG_KEY } });
  if (!entry) return cloneDefaultConfig();

  try {
    const parsed = dashboardUtilitiesConfigSchema.safeParse(JSON.parse(entry.value));
    return parsed.success ? parsed.data : cloneDefaultConfig();
  } catch {
    return cloneDefaultConfig();
  }
}

export async function setDashboardUtilitiesConfig(
  prisma: PrismaClient,
  config: DashboardUtilitiesConfigDto
): Promise<DashboardUtilitiesConfigDto> {
  const normalized = dashboardUtilitiesConfigSchema.parse(config);
  await prisma.systemConfig.upsert({
    where: { key: DASHBOARD_UTILITIES_CONFIG_KEY },
    create: { key: DASHBOARD_UTILITIES_CONFIG_KEY, value: JSON.stringify(normalized) },
    update: { value: JSON.stringify(normalized) }
  });
  return normalized;
}

function weatherCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Mixed conditions";
}

function disabledResult<T>(): UtilityResultDto<T> {
  return {
    state: "disabled",
    data: null,
    fetchedAt: null,
    stale: false,
    error: null
  };
}

export class DashboardUtilitiesService {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<CacheEntry<unknown>>>();
  private readonly failures = new Map<string, { message: string; expiresAt: number }>();

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
      pending = load()
        .then((value) => {
          const fetchedAt = new Date(this.now()).toISOString();
          const entry: CacheEntry<T> = {
            value,
            fetchedAt,
            expiresAt: this.now() + ttlMs
          };
          this.cache.set(key, entry as CacheEntry<unknown>);
          return entry;
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
      this.inFlight.set(key, pending as Promise<CacheEntry<unknown>>);
    }

    try {
      const refreshed = await pending;
      return { value: refreshed.value, fetchedAt: refreshed.fetchedAt, stale: false };
    } catch (error) {
      if (existing) {
        return { value: existing.value, fetchedAt: existing.fetchedAt, stale: true };
      }
      throw error;
    }
  }

  async searchWeatherLocations(query: string): Promise<WeatherLocationDto[]> {
    const normalized = query.trim();
    if (normalized.length < 3) return [];

    const cached = await this.cached(`geocode:${normalized.toLowerCase()}`, GEOCODING_CACHE_MS, async () => {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", normalized);
      url.searchParams.set("count", "5");
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");

      const response = geocodingResponseSchema.parse(await this.request(url, {
        timeoutMs: 4_000,
        maxBytes: 128 * 1024,
        fixedProvider: true,
        label: "Weather location search"
      }));

      return (response.results ?? []).slice(0, 5).map((location) => {
        const region = location.admin1 && location.admin1 !== location.name ? `, ${location.admin1}` : "";
        const country = location.country ?? "Unknown country";
        return {
          label: `${location.name}${region}, ${country}`,
          name: location.name,
          country,
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: location.timezone
        } satisfies WeatherLocationDto;
      });
    });

    return cached.value;
  }

  private async loadWeather(config: DashboardUtilitiesConfigDto): Promise<CachedValue<WeatherSummaryDto>> {
    const location = config.weather.location;
    if (!location) throw new Error("Weather location is not configured");
    const cacheKey = [
      "weather",
      location.latitude.toFixed(4),
      location.longitude.toFixed(4),
      config.weather.units
    ].join(":");

    return this.cached(cacheKey, WEATHER_CACHE_MS, async () => {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(location.latitude));
      url.searchParams.set("longitude", String(location.longitude));
      url.searchParams.set("timezone", location.timezone);
      url.searchParams.set("forecast_days", "3");
      url.searchParams.set("current", "temperature_2m,apparent_temperature,is_day,weather_code");
      url.searchParams.set(
        "daily",
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
      );
      if (config.weather.units === "imperial") {
        url.searchParams.set("temperature_unit", "fahrenheit");
        url.searchParams.set("wind_speed_unit", "mph");
        url.searchParams.set("precipitation_unit", "inch");
      }

      const response = forecastResponseSchema.parse(await this.request(url, {
        timeoutMs: 5_000,
        maxBytes: 256 * 1024,
        fixedProvider: true,
        label: "Weather forecast"
      }));

      const days = response.daily.time.slice(0, 3).flatMap((date, index) => {
        const weatherCode = response.daily.weather_code[index];
        const high = response.daily.temperature_2m_max[index];
        const low = response.daily.temperature_2m_min[index];
        if (weatherCode === undefined || high === undefined || low === undefined) return [];
        return [{
          date,
          weatherCode,
          condition: weatherCondition(weatherCode),
          high,
          low,
          precipitationChance: response.daily.precipitation_probability_max?.[index] ?? null
        }];
      });

      return {
        location,
        units: config.weather.units,
        temperature: response.current.temperature_2m,
        apparentTemperature: response.current.apparent_temperature ?? null,
        weatherCode: response.current.weather_code,
        condition: weatherCondition(response.current.weather_code),
        isDay: response.current.is_day !== 0,
        days
      } satisfies WeatherSummaryDto;
    });
  }

  private async loadRelease(repository: string): Promise<CachedValue<ReleaseItemDto>> {
    const cacheKey = `release:${repository}`;
    const cachedFailure = this.failures.get(cacheKey);
    if (cachedFailure && cachedFailure.expiresAt > this.now()) {
      throw new Error(cachedFailure.message);
    }

    try {
      const release = await this.cached(cacheKey, RELEASE_CACHE_MS, async () => {
        const [owner, name] = repository.split("/");
        const url = new URL(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/latest`
        );
        const response = releaseResponseSchema.parse(await this.request(url, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "homelab-dashboard",
            "X-GitHub-Api-Version": "2022-11-28"
          },
          timeoutMs: 5_000,
          maxBytes: 256 * 1024,
          fixedProvider: true,
          label: `GitHub release ${repository}`
        }));

        return {
          repository,
          name: response.name?.trim() || response.tag_name,
          tag: response.tag_name,
          publishedAt: response.published_at,
          url: response.html_url
        } satisfies ReleaseItemDto;
      });
      this.failures.delete(cacheKey);
      return release;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${repository} release is unavailable`;
      this.failures.set(cacheKey, { message, expiresAt: this.now() + RELEASE_CACHE_MS });
      throw error;
    }
  }

  async getSummary(config: DashboardUtilitiesConfigDto): Promise<DashboardUtilitiesSummaryDto> {
    const weatherPromise: Promise<UtilityResultDto<WeatherSummaryDto>> =
      !config.weather.enabled || !config.weather.location
        ? Promise.resolve(disabledResult())
        : this.loadWeather(config)
            .then((weather) => ({
              state: "ready" as const,
              data: weather.value,
              fetchedAt: weather.fetchedAt,
              stale: weather.stale,
              error: weather.stale ? "Weather refresh failed; showing the last available forecast." : null
            }))
            .catch((error: unknown) => ({
              state: "error" as const,
              data: null,
              fetchedAt: null,
              stale: false,
              error: error instanceof Error ? error.message : "Weather is unavailable"
            }));

    const releasePromise: Promise<UtilityResultDto<ReleaseItemDto[]>> =
      !config.releases.enabled || config.releases.repositories.length === 0
        ? Promise.resolve(disabledResult())
        : Promise.all(config.releases.repositories.map(async (repository) => {
            try {
              return { release: await this.loadRelease(repository), error: null };
            } catch (error) {
              return {
                release: null,
                error: error instanceof Error ? error.message : `${repository} release is unavailable`
              };
            }
          })).then((results) => {
            const available = results.flatMap((result) => result.release ? [result.release] : []);
            const errors = results.flatMap((result) => result.error ? [result.error] : []);
            if (available.length === 0) {
              return {
                state: "error" as const,
                data: null,
                fetchedAt: null,
                stale: false,
                error: errors[0] ?? "Software releases are unavailable"
              };
            }

            const items = available
              .map((result) => result.value)
              .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
              .slice(0, 5);
            const fetchedAt = available
              .map((result) => result.fetchedAt)
              .sort((left, right) => right.localeCompare(left))[0] ?? null;

            return {
              state: "ready" as const,
              data: items,
              fetchedAt,
              stale: available.some((result) => result.stale),
              error: errors.length > 0
                ? `${errors.length} tracked ${errors.length === 1 ? "repository" : "repositories"} could not be refreshed.`
                : null
            };
          });

    const [weather, releases] = await Promise.all([weatherPromise, releasePromise]);
    return { weather, releases };
  }
}
