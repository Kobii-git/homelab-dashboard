import { searchQuerySchema } from "../validation.js";
import type { RouteContext } from "./types.js";

export async function registerSearchRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const q = (query.q ?? "").toLowerCase();
    const limit = query.limit ?? 20;

    const [resources, connections, checks, incidents, credentials] = await Promise.all([
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
      prisma.connection.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q } },
                { host: { contains: q } },
                { type: { contains: q } },
                { resource: { name: { contains: q } } }
              ]
            }
          : undefined,
        include: { resource: true },
        take: limit,
        orderBy: [{ favorite: "desc" }, { host: "asc" }]
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
      }),
      prisma.credential.findMany({
        where: q
          ? {
              OR: [{ label: { contains: q } }, { username: { contains: q } }]
            }
          : undefined,
        take: limit,
        orderBy: [{ label: "asc" }],
        select: { id: true, label: true, username: true }
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
      ...connections.map((connection) => ({
        id: connection.id,
        type: "connection",
        title: connection.name ?? connection.resource.name,
        subtitle: `${connection.type.toUpperCase()} ${connection.host}:${connection.port}`,
        action: "startSession",
        payload: { connectionId: connection.id }
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
      ...credentials.map((credential) => ({
        id: credential.id,
        type: "credential",
        title: credential.label,
        subtitle: credential.username ?? "vault item",
        action: "openVault",
        payload: { credentialId: credential.id }
      })),
      {
        id: "nav-dashboard",
        type: "navigation",
        title: "Dashboard",
        subtitle: "Open pro console dashboard",
        action: "navigate",
        payload: { view: "dashboard" }
      },
      {
        id: "nav-access",
        type: "navigation",
        title: "Access",
        subtitle: "Open remote manager",
        action: "navigate",
        payload: { view: "access" }
      }
    ].slice(0, limit);
  });
}
