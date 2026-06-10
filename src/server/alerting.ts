import type { AlertChannel, Incident, PrismaClient } from "@prisma/client";
import { decryptJson, encryptJson, type EncryptedPayload } from "./vault.js";

export type AlertChannelConfig = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  smtpHost?: string;
  smtpPort?: number;
  from?: string;
  to?: string;
  subjectPrefix?: string;
};

export function summarizeAlertConfig(type: string, config: AlertChannelConfig): Record<string, unknown> {
  if (type === "webhook") {
    return {
      target: config.url ? safeHost(config.url) : "not configured",
      method: config.method ?? "POST"
    };
  }

  return {
    smtpHost: config.smtpHost ?? "not configured",
    from: config.from ?? null,
    to: config.to ?? null
  };
}

function safeHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "invalid url";
  }
}

export function encryptAlertConfig(config: AlertChannelConfig, vaultKey?: string): EncryptedPayload {
  return encryptJson(config, vaultKey);
}

export function decryptAlertConfig(channel: AlertChannel, vaultKey?: string): AlertChannelConfig {
  return decryptJson<AlertChannelConfig>(
    {
      encryptedBlob: channel.encryptedConfigBlob,
      iv: channel.iv,
      authTag: channel.authTag
    },
    vaultKey
  );
}

export async function queueAlertDeliveries(
  prisma: PrismaClient,
  event: "incident.opened" | "incident.resolved" | "incident.acknowledged",
  incident: Incident
): Promise<void> {
  const rules = await prisma.alertRule.findMany({
    where: { event, enabled: true, channel: { enabled: true } },
    include: { channel: true }
  });

  const now = Date.now();
  const dueRules = rules.filter((rule) => {
    if (!rule.lastTriggeredAt || rule.cooldownSeconds === 0) {
      return true;
    }

    return now - rule.lastTriggeredAt.getTime() >= rule.cooldownSeconds * 1000;
  });

  await prisma.$transaction(
    dueRules.flatMap((rule) => [
      prisma.alertDelivery.create({
        data: {
          channelId: rule.channelId,
          ruleId: rule.id,
          incidentId: incident.id,
          event,
          status: "queued",
          payloadJson: JSON.stringify({
            event,
            incidentId: incident.id,
            title: incident.title,
            status: incident.status,
            severity: incident.severity,
            openedAt: incident.openedAt
          })
        }
      }),
      prisma.alertRule.update({
        where: { id: rule.id },
        data: { lastTriggeredAt: new Date() }
      })
    ])
  );
}

export async function markDeliveryAttempted(
  prisma: PrismaClient,
  deliveryId: string,
  status: "sent" | "failed",
  error?: string
): Promise<void> {
  await prisma.alertDelivery.update({
    where: { id: deliveryId },
    data: {
      status,
      error: error ?? null,
      attempts: { increment: 1 },
      sentAt: status === "sent" ? new Date() : undefined
    }
  });
}
