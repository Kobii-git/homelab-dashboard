import type { RouteContext } from "./types.js";

export async function registerExportRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/export", async () => {
    const [
      groups,
      resources,
      connections,
      checks,
      credentials,
      folders,
      tags,
      notes,
      alertChannels,
      alertRules,
      maintenanceWindows
    ] = await Promise.all([
      prisma.dashboardGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.resource.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { tags: true, group: true }
      }),
      prisma.connection.findMany({
        orderBy: [{ sortOrder: "asc" }, { host: "asc" }],
        include: { tags: true, resource: { select: { id: true, name: true } } }
      }),
      prisma.healthCheck.findMany({ include: { resource: { select: { id: true, name: true } } } }),
      prisma.credential.findMany({
        select: {
          id: true,
          label: true,
          username: true,
          notes: true,
          folderId: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
          tags: true
        }
      }),
      prisma.folder.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.tag.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
      prisma.note.findMany({ orderBy: [{ updatedAt: "desc" }] }),
      prisma.alertChannel.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          enabled: true,
          configSummaryJson: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.alertRule.findMany(),
      prisma.maintenanceWindow.findMany()
    ]);

    return {
      exportedAt: new Date().toISOString(),
      version: "0.2.0",
      groups,
      resources,
      connections,
      checks,
      credentials,
      folders,
      tags,
      notes,
      alertChannels: alertChannels.map((channel) => ({
        ...channel,
        configSummary: JSON.parse(channel.configSummaryJson || "{}")
      })),
      alertRules,
      maintenanceWindows
    };
  });
}
