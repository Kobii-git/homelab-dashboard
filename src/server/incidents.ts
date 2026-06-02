import type { HealthCheck, Incident, PrismaClient } from "@prisma/client";
import { queueAlertDeliveries } from "./alerting.js";

export type HealthOutcome = {
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
};

type IncidentEvent = {
  event: "incident.opened" | "incident.resolved";
  incident: Incident;
};

export async function applyHealthOutcome(
  prisma: PrismaClient,
  check: HealthCheck,
  outcome: HealthOutcome
): Promise<void> {
  let incidentEvent: IncidentEvent | undefined;

  await prisma.$transaction(async (tx) => {
    await tx.healthResult.create({
      data: {
        checkId: check.id,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        error: outcome.error
      }
    });

    const nextFailures = outcome.status === "offline" ? check.consecutiveFailures + 1 : 0;
    const nextSuccesses = outcome.status === "online" ? check.consecutiveSuccesses + 1 : 0;
    const transitioned = check.latestStatus !== outcome.status;

    await tx.healthCheck.update({
      where: { id: check.id },
      data: {
        latestStatus: outcome.status,
        latestLatencyMs: outcome.latencyMs,
        latestCheckedAt: new Date(),
        latestError: outcome.error ?? null,
        consecutiveFailures: nextFailures,
        consecutiveSuccesses: nextSuccesses,
        lastTransitionAt: transitioned ? new Date() : check.lastTransitionAt
      }
    });

    if (outcome.status === "offline" && nextFailures >= check.failureThreshold) {
      const existing = await tx.incident.findFirst({
        where: {
          checkId: check.id,
          status: { in: ["open", "acknowledged", "muted"] }
        }
      });

      if (existing) {
        await tx.incident.update({
          where: { id: existing.id },
          data: {
            failureCount: nextFailures,
            summary: outcome.error ?? existing.summary
          }
        });
      } else {
        const created = await tx.incident.create({
          data: {
            checkId: check.id,
            resourceId: check.resourceId,
            status: "open",
            severity: "warning",
            title: `${check.type.toUpperCase()} check failed`,
            summary: outcome.error ?? `${check.target} is offline`,
            failureCount: nextFailures
          }
        });
        incidentEvent = { event: "incident.opened", incident: created };
      }
    }

    if (outcome.status === "online" && nextSuccesses >= check.successThreshold) {
      const incidents = await tx.incident.findMany({
        where: {
          checkId: check.id,
          status: { in: ["open", "acknowledged", "muted"] }
        }
      });

      for (const incident of incidents) {
        const resolved = await tx.incident.update({
          where: { id: incident.id },
          data: {
            status: "resolved",
            resolvedAt: new Date(),
            summary: incident.summary ?? `${check.target} recovered`
          }
        });
        incidentEvent = { event: "incident.resolved", incident: resolved };
      }
    }

    const stale = await tx.healthResult.findMany({
      where: { checkId: check.id },
      orderBy: { checkedAt: "desc" },
      skip: 100,
      select: { id: true }
    });

    if (stale.length > 0) {
      await tx.healthResult.deleteMany({
        where: { id: { in: stale.map((result) => result.id) } }
      });
    }
  });

  if (incidentEvent) {
    await queueAlertDeliveries(prisma, incidentEvent.event, incidentEvent.incident);
  }
}
