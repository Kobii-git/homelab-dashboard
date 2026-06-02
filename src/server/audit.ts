import type { PrismaClient } from "@prisma/client";

type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function createAuditEvent(prisma: PrismaClient, input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actor: "admin",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadataJson: JSON.stringify(input.metadata ?? {})
    }
  });
}
