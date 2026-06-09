import type {
  AlertChannel,
  AlertDelivery,
  AlertRule,
  AuditEvent,
  DashboardWidget,
  Incident,
  MaintenanceWindow,
  Note
} from "@prisma/client";

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function serializeWidget(widget: DashboardWidget) {
  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    config: parseJsonObject(widget.configJson),
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    sortOrder: widget.sortOrder,
    enabled: widget.enabled
  };
}

export function serializeAuditEvent(event: AuditEvent) {
  return {
    id: event.id,
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    summary: event.summary,
    metadata: parseJsonObject(event.metadataJson),
    createdAt: event.createdAt
  };
}

export function serializeIncident(incident: Incident & { resource?: unknown; check?: unknown }) {
  return {
    id: incident.id,
    checkId: incident.checkId,
    resourceId: incident.resourceId,
    status: incident.status,
    severity: incident.severity,
    title: incident.title,
    summary: incident.summary,
    failureCount: incident.failureCount,
    openedAt: incident.openedAt,
    acknowledgedAt: incident.acknowledgedAt,
    resolvedAt: incident.resolvedAt,
    mutedUntil: incident.mutedUntil,
    resource: "resource" in incident ? incident.resource : undefined,
    check: "check" in incident ? incident.check : undefined
  };
}

export function serializeMaintenanceWindow(window: MaintenanceWindow) {
  return {
    id: window.id,
    name: window.name,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    enabled: window.enabled,
    scope: parseJsonObject(window.scopeJson),
    notes: window.notes,
    createdAt: window.createdAt,
    updatedAt: window.updatedAt
  };
}

export function serializeAlertChannel(channel: AlertChannel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    configSummary: parseJsonObject(channel.configSummaryJson),
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

export function serializeAlertRule(rule: AlertRule) {
  return {
    id: rule.id,
    name: rule.name,
    channelId: rule.channelId,
    event: rule.event,
    enabled: rule.enabled,
    cooldownSeconds: rule.cooldownSeconds,
    lastTriggeredAt: rule.lastTriggeredAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  };
}

export function serializeAlertDelivery(delivery: AlertDelivery) {
  return {
    id: delivery.id,
    channelId: delivery.channelId,
    ruleId: delivery.ruleId,
    incidentId: delivery.incidentId,
    event: delivery.event,
    status: delivery.status,
    attempts: delivery.attempts,
    error: delivery.error,
    sentAt: delivery.sentAt,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt
  };
}

export function serializeNote(note: Note) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    pinned: note.pinned,
    resourceId: note.resourceId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

export { parseJsonObject };
