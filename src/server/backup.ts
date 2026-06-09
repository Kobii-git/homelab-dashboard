import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BACKUP_FORMAT_VERSION, type BackupPayload, type ImportPreview, type ImportResult } from "../shared/backup.js";
import { createAuditEvent } from "./audit.js";

const backupEntitySchema = {
  tag: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().nullable(),
    type: z.string().min(1)
  }),
  group: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    sortOrder: z.number().int(),
    collapsed: z.boolean()
  }),
  resource: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    url: z.string().nullable(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    host: z.string().nullable(),
    notes: z.string().nullable(),
    favorite: z.boolean(),
    sortOrder: z.number().int(),
    groupId: z.string().nullable(),
    tagIds: z.array(z.string())
  }),
  check: z.object({
    id: z.string().min(1),
    resourceId: z.string().min(1),
    type: z.string().min(1),
    target: z.string().min(1),
    intervalSeconds: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    enabled: z.boolean(),
    failureThreshold: z.number().int().positive(),
    successThreshold: z.number().int().positive()
  }),
  note: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    pinned: z.boolean(),
    resourceId: z.string().nullable()
  }),
  alertChannel: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    enabled: z.boolean(),
    configSummaryJson: z.string(),
    encryptedConfigBlob: z.string().min(1),
    iv: z.string().min(1),
    authTag: z.string().min(1)
  }),
  alertRule: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    channelId: z.string().min(1),
    event: z.string().min(1),
    enabled: z.boolean(),
    cooldownSeconds: z.number().int().nonnegative()
  }),
  maintenanceWindow: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    enabled: z.boolean(),
    scopeJson: z.string(),
    notes: z.string().nullable()
  }),
  widget: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    configJson: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int(),
    h: z.number().int(),
    sortOrder: z.number().int(),
    enabled: z.boolean()
  })
};

export const backupPayloadSchema = z.object({
  version: z.string().min(1),
  exportedAt: z.string().min(1),
  tags: z.array(backupEntitySchema.tag),
  groups: z.array(backupEntitySchema.group),
  resources: z.array(backupEntitySchema.resource),
  checks: z.array(backupEntitySchema.check),
  notes: z.array(backupEntitySchema.note),
  alertChannels: z.array(backupEntitySchema.alertChannel),
  alertRules: z.array(backupEntitySchema.alertRule),
  maintenanceWindows: z.array(backupEntitySchema.maintenanceWindow),
  widgets: z.array(backupEntitySchema.widget)
});

function tagIdsFromRelation(items: Array<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

function tagConnect(tagIds: string[]) {
  return tagIds.length > 0 ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {};
}

function emptyCounts(): Record<string, number> {
  return {
    tags: 0,
    groups: 0,
    resources: 0,
    checks: 0,
    notes: 0,
    alertChannels: 0,
    alertRules: 0,
    maintenanceWindows: 0,
    widgets: 0
  };
}

export async function buildBackupPayload(prisma: PrismaClient): Promise<BackupPayload> {
  const [
    tags,
    groups,
    resources,
    checks,
    notes,
    alertChannels,
    alertRules,
    maintenanceWindows,
    widgets
  ] = await Promise.all([
    prisma.tag.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.dashboardGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.resource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { tags: true }
    }),
    prisma.healthCheck.findMany({ orderBy: [{ createdAt: "asc" }] }),
    prisma.note.findMany({ orderBy: [{ updatedAt: "desc" }] }),
    prisma.alertChannel.findMany({ orderBy: [{ name: "asc" }] }),
    prisma.alertRule.findMany({ orderBy: [{ name: "asc" }] }),
    prisma.maintenanceWindow.findMany({ orderBy: [{ startsAt: "asc" }] }),
    prisma.dashboardWidget.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
  ]);

  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      type: tag.type
    })),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      collapsed: group.collapsed
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      kind: resource.kind,
      url: resource.url,
      description: resource.description,
      icon: resource.icon,
      color: resource.color,
      host: resource.host,
      notes: resource.notes,
      favorite: resource.favorite,
      sortOrder: resource.sortOrder,
      groupId: resource.groupId,
      tagIds: tagIdsFromRelation(resource.tags)
    })),
    checks: checks.map((check) => ({
      id: check.id,
      resourceId: check.resourceId,
      type: check.type,
      target: check.target,
      intervalSeconds: check.intervalSeconds,
      timeoutMs: check.timeoutMs,
      enabled: check.enabled,
      failureThreshold: check.failureThreshold,
      successThreshold: check.successThreshold
    })),
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      pinned: note.pinned,
      resourceId: note.resourceId
    })),
    alertChannels: alertChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
      configSummaryJson: channel.configSummaryJson,
      encryptedConfigBlob: channel.encryptedConfigBlob,
      iv: channel.iv,
      authTag: channel.authTag
    })),
    alertRules: alertRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      channelId: rule.channelId,
      event: rule.event,
      enabled: rule.enabled,
      cooldownSeconds: rule.cooldownSeconds
    })),
    maintenanceWindows: maintenanceWindows.map((window) => ({
      id: window.id,
      name: window.name,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      enabled: window.enabled,
      scopeJson: window.scopeJson,
      notes: window.notes
    })),
    widgets: widgets.map((widget) => ({
      id: widget.id,
      type: widget.type,
      title: widget.title,
      configJson: widget.configJson,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      sortOrder: widget.sortOrder,
      enabled: widget.enabled
    }))
  };
}

function collectReferenceErrors(payload: BackupPayload): string[] {
  const errors: string[] = [];
  const tagIds = new Set(payload.tags.map((item) => item.id));
  const groupIds = new Set(payload.groups.map((item) => item.id));
  const resourceIds = new Set(payload.resources.map((item) => item.id));
  const channelIds = new Set(payload.alertChannels.map((item) => item.id));

  for (const resource of payload.resources) {
    if (resource.groupId && !groupIds.has(resource.groupId)) {
      errors.push(`Resource "${resource.name}" references missing group.`);
    }
    for (const tagId of resource.tagIds) {
      if (!tagIds.has(tagId)) {
        errors.push(`Resource "${resource.name}" references missing tag.`);
      }
    }
  }

  for (const check of payload.checks) {
    if (!resourceIds.has(check.resourceId)) {
      errors.push(`Health check "${check.target}" references missing resource.`);
    }
  }

  for (const note of payload.notes) {
    if (note.resourceId && !resourceIds.has(note.resourceId)) {
      errors.push(`Note "${note.title}" references missing resource.`);
    }
  }

  for (const rule of payload.alertRules) {
    if (!channelIds.has(rule.channelId)) {
      errors.push(`Alert rule "${rule.name}" references missing channel.`);
    }
  }

  return errors;
}

export function previewBackupImport(payload: unknown): ImportPreview {
  const parsed = backupPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      valid: false,
      version: "unknown",
      exportedAt: null,
      counts: {},
      warnings: [],
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const data = parsed.data;
  const warnings: string[] = [];
  if (data.version !== BACKUP_FORMAT_VERSION) {
    warnings.push(`Backup version is ${data.version}; this app expects ${BACKUP_FORMAT_VERSION}.`);
  }

  const referenceErrors = collectReferenceErrors(data);

  return {
    valid: referenceErrors.length === 0,
    version: data.version,
    exportedAt: data.exportedAt,
    counts: {
      tags: data.tags.length,
      groups: data.groups.length,
      resources: data.resources.length,
      checks: data.checks.length,
      notes: data.notes.length,
      alertChannels: data.alertChannels.length,
      alertRules: data.alertRules.length,
      maintenanceWindows: data.maintenanceWindows.length,
      widgets: data.widgets.length
    },
    warnings,
    errors: referenceErrors
  };
}

type DbClient = PrismaClient | Prisma.TransactionClient;

async function clearInventoryConfig(prisma: DbClient): Promise<void> {
  await prisma.alertDelivery.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.healthResult.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.healthCheck.deleteMany();
  await prisma.note.deleteMany();
  await prisma.alertChannel.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.dashboardGroup.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.maintenanceWindow.deleteMany();
  await prisma.dashboardWidget.deleteMany();
}

async function importEntities(
  prisma: DbClient,
  payload: BackupPayload,
  mode: "merge" | "replace"
): Promise<{ created: Record<string, number>; skipped: Record<string, number> }> {
  const created = emptyCounts();
  const skipped = emptyCounts();

  for (const tag of payload.tags) {
    if (mode === "merge" && (await prisma.tag.findUnique({ where: { id: tag.id } }))) {
      skipped.tags += 1;
      continue;
    }
    await prisma.tag.create({ data: tag });
    created.tags += 1;
  }

  for (const group of payload.groups) {
    if (mode === "merge" && (await prisma.dashboardGroup.findUnique({ where: { id: group.id } }))) {
      skipped.groups += 1;
      continue;
    }
    await prisma.dashboardGroup.create({ data: group });
    created.groups += 1;
  }

  for (const resource of payload.resources) {
    if (mode === "merge" && (await prisma.resource.findUnique({ where: { id: resource.id } }))) {
      skipped.resources += 1;
      continue;
    }
    await prisma.resource.create({
      data: {
        id: resource.id,
        name: resource.name,
        kind: resource.kind,
        url: resource.url,
        description: resource.description,
        icon: resource.icon,
        color: resource.color,
        host: resource.host,
        notes: resource.notes,
        favorite: resource.favorite,
        sortOrder: resource.sortOrder,
        groupId: resource.groupId,
        ...tagConnect(resource.tagIds)
      }
    });
    created.resources += 1;
  }

  for (const check of payload.checks) {
    if (mode === "merge" && (await prisma.healthCheck.findUnique({ where: { id: check.id } }))) {
      skipped.checks += 1;
      continue;
    }
    await prisma.healthCheck.create({
      data: {
        id: check.id,
        resourceId: check.resourceId,
        type: check.type,
        target: check.target,
        intervalSeconds: check.intervalSeconds,
        timeoutMs: check.timeoutMs,
        enabled: check.enabled,
        failureThreshold: check.failureThreshold,
        successThreshold: check.successThreshold,
        latestStatus: "unknown"
      }
    });
    created.checks += 1;
  }

  for (const note of payload.notes) {
    if (mode === "merge" && (await prisma.note.findUnique({ where: { id: note.id } }))) {
      skipped.notes += 1;
      continue;
    }
    await prisma.note.create({ data: note });
    created.notes += 1;
  }

  for (const channel of payload.alertChannels) {
    if (mode === "merge" && (await prisma.alertChannel.findUnique({ where: { id: channel.id } }))) {
      skipped.alertChannels += 1;
      continue;
    }
    await prisma.alertChannel.create({ data: channel });
    created.alertChannels += 1;
  }

  for (const rule of payload.alertRules) {
    if (mode === "merge" && (await prisma.alertRule.findUnique({ where: { id: rule.id } }))) {
      skipped.alertRules += 1;
      continue;
    }
    await prisma.alertRule.create({
      data: {
        id: rule.id,
        name: rule.name,
        channelId: rule.channelId,
        event: rule.event,
        enabled: rule.enabled,
        cooldownSeconds: rule.cooldownSeconds
      }
    });
    created.alertRules += 1;
  }

  for (const window of payload.maintenanceWindows) {
    if (mode === "merge" && (await prisma.maintenanceWindow.findUnique({ where: { id: window.id } }))) {
      skipped.maintenanceWindows += 1;
      continue;
    }
    await prisma.maintenanceWindow.create({
      data: {
        id: window.id,
        name: window.name,
        startsAt: new Date(window.startsAt),
        endsAt: new Date(window.endsAt),
        enabled: window.enabled,
        scopeJson: window.scopeJson,
        notes: window.notes
      }
    });
    created.maintenanceWindows += 1;
  }

  for (const widget of payload.widgets) {
    if (mode === "merge" && (await prisma.dashboardWidget.findUnique({ where: { id: widget.id } }))) {
      skipped.widgets += 1;
      continue;
    }
    await prisma.dashboardWidget.create({ data: widget });
    created.widgets += 1;
  }

  return { created, skipped };
}

export async function applyBackupImport(
  prisma: PrismaClient,
  payload: unknown,
  mode: "merge" | "replace"
): Promise<ImportResult> {
  const preview = previewBackupImport(payload);
  if (!preview.valid) {
    return {
      ...preview,
      applied: false,
      mode,
      created: emptyCounts(),
      skipped: emptyCounts()
    };
  }

  const data = backupPayloadSchema.parse(payload);

  if (mode === "replace") {
    await prisma.$transaction(async (tx) => {
      await clearInventoryConfig(tx);
      await importEntities(tx, data, "replace");
    });
    await createAuditEvent(prisma, {
      action: "backup.imported",
      entityType: "backup",
      summary: `Restored inventory backup (${data.exportedAt}) in replace mode`
    });
    return {
      ...preview,
      applied: true,
      mode,
      created: preview.counts,
      skipped: emptyCounts()
    };
  }

  const { created, skipped } = await prisma.$transaction(async (tx) => importEntities(tx, data, "merge"));
  await createAuditEvent(prisma, {
    action: "backup.imported",
    entityType: "backup",
    summary: `Merged inventory backup (${data.exportedAt})`
  });

  return {
    ...preview,
    applied: true,
    mode,
    created,
    skipped
  };
}
