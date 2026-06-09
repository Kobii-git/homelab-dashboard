import { searchQuerySchema } from "../validation.js";
import type { RouteContext } from "./types.js";

export async function registerSearchRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const q = (query.q ?? "").toLowerCase();
    const limit = query.limit ?? 20;

    const [resources, checks, incidents] = await Promise.all([
      prisma.resource.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q } },
                { host: { contains: q } },
                { url: { contains: q } },
                { kind: { contains: q } }
              ]
            }
          : undefined,
        take: limit,
        orderBy: [{ favorite: "desc" }, { name: "asc" }]
      }),
      prisma.healthCheck.findMany({
        where: q
          ? {
              OR: [
                { target: { contains: q } },
                { type: { contains: q } },
                { resource: { name: { contains: q } } }
              ]
            }
          : undefined,
        include: { resource: true },
        take: limit,
        orderBy: [{ latestStatus: "asc" }, { target: "asc" }]
      }),
      prisma.incident.findMany({
        where: q
          ? {
              OR: [
                { title: { contains: q } },
                { summary: { contains: q } },
                { resource: { name: { contains: q } } }
              ]
            }
          : { status: { in: ["open", "acknowledged", "muted"] } },
        include: { resource: true },
        take: limit,
        orderBy: [{ openedAt: "desc" }]
      })
    ]);

    return [
      ...resources.map((resource) => ({
        id: resource.id,
        type: "resource",
        title: resource.name,
        subtitle: resource.url ?? resource.host ?? resource.kind,
        action: resource.url ? "openUrl" : "openResource",
        payload: { resourceId: resource.id, url: resource.url }
      })),
      ...checks.map((check) => ({
        id: check.id,
        type: "check",
        title: check.resource.name,
        subtitle: `${check.type} ${check.target}`,
        action: "runCheck",
        payload: { checkId: check.id }
      })),
      ...incidents.map((incident) => ({
        id: incident.id,
        type: "incident",
        title: incident.title,
        subtitle: `${incident.status} · ${incident.resource?.name ?? "unlinked"}`,
        action: "openIncident",
        payload: { incidentId: incident.id }
      })),
      { id: "nav-dashboard", type: "navigation", title: "Dashboard", subtitle: "Overview and resource tiles", action: "navigate", payload: { view: "dashboard" } },
      { id: "nav-monitoring", type: "navigation", title: "Monitoring", subtitle: "Health checks and incidents", action: "navigate", payload: { view: "monitoring" } },
      { id: "nav-alerts", type: "navigation", title: "Alerts", subtitle: "Alert channels and delivery rules", action: "navigate", payload: { view: "alerts" } },
      { id: "nav-inventory", type: "navigation", title: "Inventory", subtitle: "Manage resources and checks", action: "navigate", payload: { view: "inventory" } }
    ].slice(0, limit);
  });
}
