import { serializeWidget } from "../serializers.js";
import {
  dashboardWidgetPatchSchema,
  dashboardWidgetSchema,
  idParamSchema
} from "../validation.js";
import type { RouteContext } from "./types.js";

const defaultWidgets = [
  { type: "serviceStatus", title: "Service Status", x: 0, y: 0, w: 6, h: 3, sortOrder: 0 },
  { type: "incidents", title: "Incidents", x: 6, y: 0, w: 6, h: 3, sortOrder: 1 },
  { type: "favorites", title: "Favorites", x: 0, y: 3, w: 4, h: 3, sortOrder: 2 },
  { type: "failingChecks", title: "Failing Checks", x: 4, y: 3, w: 4, h: 3, sortOrder: 3 },
  { type: "recentSessions", title: "Recent Sessions", x: 8, y: 3, w: 4, h: 3, sortOrder: 4 },
  { type: "vaultHealth", title: "Vault Health", x: 0, y: 6, w: 4, h: 2, sortOrder: 5 },
  { type: "notes", title: "Pinned Notes", x: 4, y: 6, w: 4, h: 2, sortOrder: 6 }
];

async function ensureDefaultWidgets(prisma: RouteContext["prisma"]): Promise<void> {
  const existingWidgets = await prisma.dashboardWidget.findMany({
    select: { type: true, sortOrder: true }
  });
  const existingTypes = new Set(existingWidgets.map((widget) => widget.type));
  const missingWidgets = defaultWidgets.filter((widget) => !existingTypes.has(widget.type));

  if (missingWidgets.length === 0) {
    return;
  }

  const maxSortOrder = existingWidgets.reduce((max, widget) => Math.max(max, widget.sortOrder), -1);
  await prisma.dashboardWidget.createMany({
    data: missingWidgets.map((widget, index) => ({
      ...widget,
      configJson: "{}",
      enabled: true,
      sortOrder: existingWidgets.length > 0 ? maxSortOrder + index + 1 : widget.sortOrder
    }))
  });
}

export async function registerWidgetRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/dashboard/widgets", async () => {
    await ensureDefaultWidgets(prisma);
    const widgets = await prisma.dashboardWidget.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    return widgets.map(serializeWidget);
  });

  app.post("/api/dashboard/widgets", async (request, reply) => {
    const body = dashboardWidgetSchema.parse(request.body);
    const widget = await prisma.dashboardWidget.create({
      data: {
        type: body.type,
        title: body.title,
        configJson: JSON.stringify(body.config ?? {}),
        x: body.x ?? 0,
        y: body.y ?? 0,
        w: body.w ?? 4,
        h: body.h ?? 3,
        sortOrder: body.sortOrder ?? 0,
        enabled: body.enabled ?? true
      }
    });

    reply.code(201);
    return serializeWidget(widget);
  });

  app.patch("/api/dashboard/widgets/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = dashboardWidgetPatchSchema.parse(request.body);
    const { config, ...rest } = body;
    const widget = await prisma.dashboardWidget.update({
      where: { id },
      data: {
        ...rest,
        configJson: config ? JSON.stringify(config) : undefined
      }
    });

    return serializeWidget(widget);
  });

  app.delete("/api/dashboard/widgets/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.dashboardWidget.delete({ where: { id } });
    return { ok: true };
  });
}
