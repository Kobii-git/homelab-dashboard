import { z } from "zod";
import { HEALTH_CHECK_TYPES, HEALTH_STATUSES, MONITORING_MODES, RESOURCE_KINDS } from "../shared/types.js";

const nullableText = z.string().trim().min(1).max(2000).optional().nullable();

export const loginSchema = z.object({
  username: z.string().trim().min(1).optional(),
  password: z.string().min(1)
});

export const dashboardGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).optional(),
  collapsed: z.boolean().optional()
});

export const dashboardGroupPatchSchema = dashboardGroupSchema.partial();

export const resourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(RESOURCE_KINDS),
  url: nullableText,
  description: nullableText,
  icon: nullableText,
  color: nullableText,
  host: nullableText,
  favorite: z.boolean().optional(),
  monitoringMode: z.enum(MONITORING_MODES).optional(),
  manualStatus: z.enum(HEALTH_STATUSES).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  groupId: z.string().cuid().optional().nullable()
});

export const resourcePatchSchema = resourceSchema.partial();

export const healthCheckSchema = z.object({
  resourceId: z.string().cuid(),
  type: z.enum(HEALTH_CHECK_TYPES),
  target: z.string().trim().min(1).max(500),
  intervalSeconds: z.number().int().min(15).max(86400).optional(),
  timeoutMs: z.number().int().min(250).max(30000).optional(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  successThreshold: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional()
});

export const healthCheckPatchSchema = healthCheckSchema.partial();

const glancesBaseUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an HTTP or HTTPS URL");

export const hostMonitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: glancesBaseUrl,
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  primaryMount: z.string().trim().min(1).max(160).optional(),
  networkInterface: z.string().trim().min(1).max(120).optional().nullable()
});

export const hostMonitorPatchSchema = hostMonitorSchema.partial();

const httpBaseUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an HTTP or HTTPS URL");

const endpointPath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), "Must start with a single slash");

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

export const apiWidgetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().trim().min(1).max(120).optional(),
  baseUrl: httpBaseUrl,
  endpointPath,
  authType: z.enum(["none", "bearer", "header", "basic", "pihole"]).optional(),
  authHeaderName: z.string().trim().min(1).max(120).optional().nullable(),
  authEnvVar: envVarName,
  authValuePrefix: z.string().trim().max(120).optional().nullable(),
  tlsVerify: z.boolean().optional(),
  fieldMappings: z.array(apiWidgetFieldMappingSchema).min(1).max(12),
  enabled: z.boolean().optional(),
  pollIntervalSeconds: z.number().int().min(15).max(86400).optional(),
  sortOrder: z.number().int().min(0).optional()
});

export const apiWidgetPatchSchema = apiWidgetSchema.partial();

export const settingsSchema = z.object({
  autoPingIntervalSeconds: z.number().int().min(15).max(86400)
});

export const reorderSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(500)
});

export const idParamSchema = z.object({
  id: z.string().cuid()
});

export function nullishToUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item === null ? undefined : item])
  ) as T;
}
