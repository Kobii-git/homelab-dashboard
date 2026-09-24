import { isLocalEndpointPath } from "./endpointUrl.js";
import { z } from "zod";
import {
  DASHBOARD_SEARCH_ENGINES,
  HEALTH_CHECK_TYPES,
  HEALTH_STATUSES,
  MONITORING_MODES,
  RESOURCE_KINDS,
  WEATHER_UNITS
} from "../shared/types.js";

const nullableText = z.string().trim().min(1).max(2000).optional().nullable();

function normalizeHttpUrl(value: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const parsed = new URL(candidate);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("Must be an HTTP or HTTPS URL with a hostname");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs must not contain embedded credentials");
  }
  return parsed.toString();
}

const httpUrl = z.string().trim().min(1).max(500).transform((value, context) => {
  try {
    return normalizeHttpUrl(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid URL"
    });
    return z.NEVER;
  }
});

const nullableHttpUrl = httpUrl.optional().nullable();
const hostValue = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => !/[\s/\\]/.test(value) && !value.startsWith("-"), "Must be a hostname or IP address")
  .optional()
  .nullable();
const iconValue = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => {
    if (/^[a-z\d][a-z\d._-]{0,119}$/i.test(value)) return true;
    try {
      normalizeHttpUrl(value);
      return /^https?:\/\//i.test(value);
    } catch {
      return false;
    }
  }, "Must be an icon slug or an HTTP/HTTPS URL without credentials")
  .optional()
  .nullable();

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(256)
});

export const dashboardGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).optional(),
  collapsed: z.boolean().optional()
});

export const dashboardGroupPatchSchema = dashboardGroupSchema.partial();

const healthCheckSettingsBaseSchema = z.object({
  type: z.enum(HEALTH_CHECK_TYPES),
  target: z.string().trim().min(1).max(500),
  intervalSeconds: z.number().int().min(15).max(86400).optional(),
  timeoutMs: z.number().int().min(250).max(30000).optional(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  successThreshold: z.number().int().min(1).max(20).optional()
});

const healthCheckSettingsSchema = healthCheckSettingsBaseSchema.superRefine((value, context) => {
  const error = validateHealthCheckTarget(value.type, value.target);
  if (error) context.addIssue({ code: "custom", path: ["target"], message: error });
});

export const resourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(RESOURCE_KINDS),
  url: nullableHttpUrl,
  description: nullableText,
  icon: iconValue,
  color: z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color").optional().nullable(),
  host: hostValue,
  favorite: z.boolean().optional(),
  monitoringMode: z.enum(MONITORING_MODES).optional(),
  manualStatus: z.enum(HEALTH_STATUSES).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  groupId: z.string().cuid().optional().nullable(),
  primaryCheck: healthCheckSettingsSchema.optional()
});

export const resourcePatchSchema = resourceSchema.partial();

const healthCheckBaseSchema = z.object({
  resourceId: z.string().cuid(),
  type: z.enum(HEALTH_CHECK_TYPES),
  target: z.string().trim().min(1).max(500),
  intervalSeconds: z.number().int().min(15).max(86400).optional(),
  timeoutMs: z.number().int().min(250).max(30000).optional(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  successThreshold: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
  primary: z.boolean().optional()
});

export function validateHealthCheckTarget(type: string, target: string): string | null {
  const value = target.trim();
  try {
    if (type === "http") {
      const normalized = normalizeHttpUrl(value);
      if (!/^https?:\/\//i.test(value)) return "HTTP targets must include http:// or https://";
      void normalized;
      return null;
    }
    if (type === "ping") {
      return !value || /[\s/\\]/.test(value) || value.includes("://") || value.startsWith("-")
        ? "Ping targets must be a hostname or IP address"
        : null;
    }
    if (type === "tcp") {
      const parsed = value.includes("://") ? new URL(value) : new URL(`tcp://${value}`);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : 0));
      return !parsed.username && !parsed.password && parsed.hostname && Number.isInteger(port) && port >= 1 && port <= 65_535
        ? null
        : "TCP targets must include a valid hostname and port without credentials";
    }
    if (type === "ssl") {
      const parsed = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
      if (parsed.username || parsed.password || !parsed.hostname) return "SSL targets must be a hostname or URL";
      if (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65_535)) return "SSL port is invalid";
      return null;
    }
  } catch {
    return `Invalid ${type.toUpperCase()} target`;
  }
  return "Unsupported health-check type";
}

export const healthCheckSchema = healthCheckBaseSchema.superRefine((value, context) => {
  const error = validateHealthCheckTarget(value.type, value.target);
  if (error) context.addIssue({ code: "custom", path: ["target"], message: error });
});

export const healthCheckPatchSchema = healthCheckBaseSchema.partial();

export const healthCheckTestSchema = healthCheckSettingsBaseSchema.pick({
  type: true,
  target: true,
  timeoutMs: true
}).superRefine((value, context) => {
  const error = validateHealthCheckTarget(value.type, value.target);
  if (error) context.addIssue({ code: "custom", path: ["target"], message: error });
});

const glancesBaseUrl = httpUrl;

export const hostMonitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: glancesBaseUrl,
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  primaryMount: z.string().trim().min(1).max(160).optional(),
  networkInterface: z.string().trim().min(1).max(120).optional().nullable()
});

export const hostMonitorPatchSchema = hostMonitorSchema.partial();

const httpBaseUrl = httpUrl;

const endpointPath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isLocalEndpointPath, "Must be a same-origin path without backslashes or whitespace");

const envVarName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Z_][A-Z0-9_]*$/, "Use an uppercase environment variable name")
  .optional()
  .nullable();

export const apiWidgetFieldMappingSchema = z.object({
  label: z.string().trim().min(1).max(80),
  path: z.string().trim().max(240),
  suffix: z.string().trim().max(32).optional().nullable(),
  kind: z.enum(["text", "number", "percent", "bytes", "duration", "count"]).optional().nullable()
});

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_WIDGET_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
const authHeaderName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => HTTP_TOKEN.test(value), "Must be a valid HTTP header name")
  .refine((value) => !FORBIDDEN_WIDGET_HEADERS.has(value.toLowerCase()) && !value.toLowerCase().startsWith("proxy-"), {
    message: "This header cannot be set by an API widget"
  })
  .optional()
  .nullable();

export const apiWidgetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().trim().min(1).max(120).optional(),
  baseUrl: httpBaseUrl,
  endpointPath,
  authType: z.enum(["none", "bearer", "header", "basic", "pihole"]).optional(),
  authHeaderName,
  authEnvVar: envVarName,
  authValuePrefix: z.string().trim().max(120).optional().nullable(),
  tlsVerify: z.boolean().optional(),
  fieldMappings: z.array(apiWidgetFieldMappingSchema).min(1).max(12),
  enabled: z.boolean().optional(),
  pollIntervalSeconds: z.number().int().min(15).max(86400).optional(),
  sortOrder: z.number().int().min(0).optional()
});

export const apiWidgetPatchSchema = apiWidgetSchema.partial();

export const weatherLocationSchema = z.object({
  label: z.string().trim().min(1).max(180),
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(120),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timezone: z.string().trim().min(1).max(120)
});

const releaseRepository = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use a public GitHub repository in owner/name format");

export const dashboardUtilitiesConfigSchema = z.object({
  searchEngine: z.enum(DASHBOARD_SEARCH_ENGINES),
  weather: z.object({
    enabled: z.boolean(),
    units: z.enum(WEATHER_UNITS),
    location: weatherLocationSchema.nullable()
  }).refine((value) => !value.enabled || value.location !== null, {
    path: ["location"],
    message: "Choose a weather location before enabling weather"
  }),
  releases: z.object({
    enabled: z.boolean(),
    repositories: z.array(releaseRepository).max(12)
  }).transform((value) => ({
    ...value,
    repositories: [...new Set(value.repositories.map((repository) => repository.toLowerCase()))]
  }))
});

export const dashboardHomeConfigSchema = z.object({
  agendaEnabled: z.boolean(),
  tasksEnabled: z.boolean(),
  mailEnabled: z.boolean(),
  mediaEnabled: z.boolean(),
  storageEnabled: z.boolean(),
  plexWidgetId: z.string().cuid().nullable(),
  radarrWidgetId: z.string().cuid().nullable(),
  mediaRegion: z.string().trim().regex(/^[A-Z]{2}$/, "Use a two-letter uppercase region"),
  mediaLanguage: z.string().trim().regex(/^[a-z]{2}-[A-Z]{2}$/, "Use a language such as en-US"),
  mediaLimit: z.number().int().min(1).max(12)
});

export const settingsSchema = z.object({
  autoPingIntervalSeconds: z.number().int().min(15).max(86400).optional(),
  dashboardUtilities: dashboardUtilitiesConfigSchema.optional(),
  dashboardHome: dashboardHomeConfigSchema.optional()
}).refine((value) => value.autoPingIntervalSeconds !== undefined || value.dashboardUtilities !== undefined || value.dashboardHome !== undefined, {
  message: "Provide at least one setting"
});

export const reorderSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(500)
}).refine((value) => new Set(value.ids).size === value.ids.length, {
  path: ["ids"],
  message: "IDs must be unique"
});

export const idParamSchema = z.object({
  id: z.string().cuid()
});

export function nullishToUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item === null ? undefined : item])
  ) as T;
}
