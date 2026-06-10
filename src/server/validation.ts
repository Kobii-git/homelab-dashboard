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

export const settingsSchema = z.object({
  autoPingIntervalSeconds: z.number().int().min(15).max(86400)
});

export const idParamSchema = z.object({
  id: z.string().cuid()
});

export function nullishToUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item === null ? undefined : item])
  ) as T;
}
