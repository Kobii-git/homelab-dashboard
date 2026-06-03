import { z } from "zod";
import {
  ALERT_CHANNEL_TYPES,
  ALERT_EVENTS,
  CONNECTION_TYPES,
  HEALTH_CHECK_TYPES,
  INCIDENT_STATUSES,
  RESOURCE_KINDS,
  WIDGET_TYPES
} from "../shared/types.js";

const nullableText = z.string().trim().min(1).max(2000).optional().nullable();
const optionalText = z.string().trim().min(1).max(2000).optional();

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

const tagIdsField = z.array(z.string().cuid()).optional();

export const resourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(RESOURCE_KINDS),
  url: nullableText,
  description: nullableText,
  icon: nullableText,
  color: nullableText,
  host: nullableText,
  notes: nullableText,
  favorite: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  groupId: z.string().cuid().optional().nullable(),
  tagIds: tagIdsField
});

export const resourcePatchSchema = resourceSchema.partial();

export const credentialSchema = z.object({
  label: z.string().trim().min(1).max(160),
  username: z.string().trim().max(200).optional().nullable(),
  notes: nullableText,
  folderId: z.string().cuid().optional().nullable(),
  password: z.string().max(1000).optional().nullable(),
  domain: z.string().trim().max(200).optional().nullable(),
  privateKey: z.string().max(12000).optional().nullable(),
  passphrase: z.string().max(1000).optional().nullable(),
  tagIds: tagIdsField
});

export const credentialPatchSchema = credentialSchema.partial();

export const connectionSchema = z.object({
  resourceId: z.string().cuid(),
  type: z.enum(CONNECTION_TYPES),
  name: z.string().trim().min(1).max(160).optional().nullable(),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  usernameHint: z.string().trim().max(200).optional().nullable(),
  credentialId: z.string().cuid().optional().nullable(),
  notes: nullableText,
  favorite: z.boolean().optional(),
  folderId: z.string().cuid().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  tagIds: tagIdsField
});

export const connectionPatchSchema = connectionSchema.partial();

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

export const sessionLaunchSchema = z.object({
  connectionId: z.string().cuid()
});

export const sessionEndSchema = z.object({
  status: z.string().trim().min(1).max(80).optional(),
  error: z.string().trim().max(1000).optional().nullable()
});

export const layoutSchema = z.object({
  layout: z.record(z.string(), z.unknown())
});

export const idParamSchema = z.object({
  id: z.string().cuid()
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const dashboardWidgetSchema = z.object({
  type: z.enum(WIDGET_TYPES),
  title: z.string().trim().min(1).max(120),
  config: z.record(z.string(), z.unknown()).optional(),
  x: z.number().int().min(0).max(24).optional(),
  y: z.number().int().min(0).max(1000).optional(),
  w: z.number().int().min(1).max(24).optional(),
  h: z.number().int().min(1).max(24).optional(),
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional()
});

export const dashboardWidgetPatchSchema = dashboardWidgetSchema.partial();

export const folderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["connection", "credential", "mixed"]),
  parentId: z.string().cuid().optional().nullable(),
  sortOrder: z.number().int().min(0).optional()
});

export const folderPatchSchema = folderSchema.partial();

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: nullableText,
  type: z.string().trim().min(1).max(80).optional()
});

export const tagPatchSchema = tagSchema.partial();

export const vaultRevealSchema = z.object({
  credentialId: z.string().cuid(),
  password: z.string().min(1)
});

export const incidentSchema = z.object({
  checkId: z.string().cuid().optional().nullable(),
  resourceId: z.string().cuid().optional().nullable(),
  severity: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(180),
  summary: nullableText,
  status: z.enum(INCIDENT_STATUSES).optional()
});

export const incidentPatchSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(180).optional(),
  summary: nullableText,
  mutedUntil: z.string().datetime().optional().nullable()
});

export const maintenanceWindowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  enabled: z.boolean().optional(),
  scope: z.record(z.string(), z.unknown()).optional(),
  notes: nullableText
});

export const maintenanceWindowPatchSchema = maintenanceWindowSchema.partial();

export const alertChannelSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(ALERT_CHANNEL_TYPES),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional()
});

export const alertChannelPatchSchema = alertChannelSchema.partial();

export const alertRuleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  channelId: z.string().cuid(),
  event: z.enum(ALERT_EVENTS),
  enabled: z.boolean().optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).optional()
});

export const alertRulePatchSchema = alertRuleSchema.partial();

export const noteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  pinned: z.boolean().optional(),
  resourceId: z.string().cuid().optional().nullable()
});

export const notePatchSchema = noteSchema.partial();

export const connectionTestSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  type: z.enum(CONNECTION_TYPES).optional()
});

export function nullishToUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item === null ? undefined : item])
  ) as T;
}
