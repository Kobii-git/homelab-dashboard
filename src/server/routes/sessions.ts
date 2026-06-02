import { createAuditEvent } from "../audit.js";
import { serializeSessionHistory } from "../serializers.js";
import { idParamSchema, sessionEndSchema } from "../validation.js";
import type { RouteContext } from "./types.js";

export async function registerSessionRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/sessions/history", async () => {
    const sessions = await prisma.sessionHistory.findMany({
      orderBy: [{ startedAt: "desc" }],
      take: 100
    });
    return sessions.map(serializeSessionHistory);
  });

  app.patch("/api/sessions/history/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = sessionEndSchema.parse(request.body);
    const session = await prisma.sessionHistory.update({
      where: { id },
      data: {
        status: body.status ?? "closed",
        error: body.error ?? null,
        endedAt: new Date()
      }
    });
    await createAuditEvent(prisma, {
      action: "session.closed",
      entityType: "session",
      entityId: session.id,
      summary: `Closed ${session.protocol.toUpperCase()} session to ${session.host}`
    });
    return serializeSessionHistory(session);
  });
}
