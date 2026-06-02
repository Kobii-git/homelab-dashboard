import { createAuditEvent } from "../audit.js";
import { queueAlertDeliveries } from "../alerting.js";
import {
  serializeIncident,
  serializeMaintenanceWindow,
  serializeNote
} from "../serializers.js";
import {
  idParamSchema,
  incidentPatchSchema,
  incidentSchema,
  maintenanceWindowPatchSchema,
  maintenanceWindowSchema,
  notePatchSchema,
  noteSchema
} from "../validation.js";
import type { RouteContext } from "./types.js";

export async function registerIncidentRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/incidents", async (request) => {
    const url = new URL(request.raw.url ?? "/", "http://localhost");
    const includeResolved = url.searchParams.get("includeResolved") === "true";
    const incidents = await prisma.incident.findMany({
      where: includeResolved ? undefined : { status: { not: "resolved" } },
      include: { resource: true, check: true },
      orderBy: [{ status: "asc" }, { openedAt: "desc" }],
      take: 200
    });
    return incidents.map(serializeIncident);
  });

  app.post("/api/incidents", async (request, reply) => {
    const body = incidentSchema.parse(request.body);
    const incident = await prisma.incident.create({
      data: {
        checkId: body.checkId ?? null,
        resourceId: body.resourceId ?? null,
        severity: body.severity ?? "warning",
        title: body.title,
        summary: body.summary ?? null,
        status: body.status ?? "open"
      },
      include: { resource: true, check: true }
    });

    await createAuditEvent(prisma, {
      action: "incident.created",
      entityType: "incident",
      entityId: incident.id,
      summary: `Created incident ${incident.title}`
    });
    await queueAlertDeliveries(prisma, "incident.opened", incident);

    reply.code(201);
    return serializeIncident(incident);
  });

  app.patch("/api/incidents/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = incidentPatchSchema.parse(request.body);
    const data = {
      ...body,
      mutedUntil: body.mutedUntil ? new Date(body.mutedUntil) : body.mutedUntil
    };

    if (body.status === "acknowledged") {
      Object.assign(data, { acknowledgedAt: new Date() });
    }

    if (body.status === "resolved") {
      Object.assign(data, { resolvedAt: new Date() });
    }

    const incident = await prisma.incident.update({
      where: { id },
      data,
      include: { resource: true, check: true }
    });

    await createAuditEvent(prisma, {
      action: `incident.${incident.status}`,
      entityType: "incident",
      entityId: incident.id,
      summary: `Updated incident ${incident.title} to ${incident.status}`
    });

    if (incident.status === "acknowledged") {
      await queueAlertDeliveries(prisma, "incident.acknowledged", incident);
    }

    if (incident.status === "resolved") {
      await queueAlertDeliveries(prisma, "incident.resolved", incident);
    }

    return serializeIncident(incident);
  });

  app.delete("/api/incidents/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.incident.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/maintenance-windows", async () => {
    const windows = await prisma.maintenanceWindow.findMany({
      orderBy: [{ startsAt: "desc" }],
      take: 100
    });
    return windows.map(serializeMaintenanceWindow);
  });

  app.post("/api/maintenance-windows", async (request, reply) => {
    const body = maintenanceWindowSchema.parse(request.body);
    const window = await prisma.maintenanceWindow.create({
      data: {
        name: body.name,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        enabled: body.enabled ?? true,
        scopeJson: JSON.stringify(body.scope ?? {}),
        notes: body.notes ?? null
      }
    });
    reply.code(201);
    return serializeMaintenanceWindow(window);
  });

  app.patch("/api/maintenance-windows/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = maintenanceWindowPatchSchema.parse(request.body);
    const window = await prisma.maintenanceWindow.update({
      where: { id },
      data: {
        name: body.name,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        enabled: body.enabled,
        scopeJson: body.scope ? JSON.stringify(body.scope) : undefined,
        notes: body.notes
      }
    });
    return serializeMaintenanceWindow(window);
  });

  app.delete("/api/maintenance-windows/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.maintenanceWindow.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/notes", async () => {
    const notes = await prisma.note.findMany({
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 100
    });
    return notes.map(serializeNote);
  });

  app.post("/api/notes", async (request, reply) => {
    const body = noteSchema.parse(request.body);
    const note = await prisma.note.create({
      data: {
        title: body.title,
        body: body.body,
        pinned: body.pinned ?? false,
        resourceId: body.resourceId ?? null
      }
    });
    reply.code(201);
    return serializeNote(note);
  });

  app.patch("/api/notes/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = notePatchSchema.parse(request.body);
    const note = await prisma.note.update({ where: { id }, data: body });
    return serializeNote(note);
  });

  app.delete("/api/notes/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.note.delete({ where: { id } });
    return { ok: true };
  });
}
