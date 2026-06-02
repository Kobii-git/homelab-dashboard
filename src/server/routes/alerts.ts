import {
  decryptAlertConfig,
  encryptAlertConfig,
  markDeliveryAttempted,
  summarizeAlertConfig
} from "../alerting.js";
import {
  serializeAlertChannel,
  serializeAlertDelivery,
  serializeAlertRule
} from "../serializers.js";
import {
  alertChannelPatchSchema,
  alertChannelSchema,
  alertRulePatchSchema,
  alertRuleSchema,
  idParamSchema
} from "../validation.js";
import type { RouteContext } from "./types.js";

export async function registerAlertRoutes({ app, prisma, env }: RouteContext): Promise<void> {
  app.get("/api/alert-channels", async () => {
    const channels = await prisma.alertChannel.findMany({ orderBy: [{ name: "asc" }] });
    return channels.map(serializeAlertChannel);
  });

  app.post("/api/alert-channels", async (request, reply) => {
    const body = alertChannelSchema.parse(request.body);
    const encrypted = encryptAlertConfig(body.config ?? {}, env.vaultKey);
    const channel = await prisma.alertChannel.create({
      data: {
        name: body.name,
        type: body.type,
        enabled: body.enabled ?? true,
        configSummaryJson: JSON.stringify(summarizeAlertConfig(body.type, body.config ?? {})),
        encryptedConfigBlob: encrypted.encryptedBlob,
        iv: encrypted.iv,
        authTag: encrypted.authTag
      }
    });
    reply.code(201);
    return serializeAlertChannel(channel);
  });

  app.patch("/api/alert-channels/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = alertChannelPatchSchema.parse(request.body);
    const encrypted = body.config ? encryptAlertConfig(body.config, env.vaultKey) : undefined;
    const channel = await prisma.alertChannel.update({
      where: { id },
      data: {
        name: body.name,
        type: body.type,
        enabled: body.enabled,
        configSummaryJson:
          body.type && body.config
            ? JSON.stringify(summarizeAlertConfig(body.type, body.config))
            : undefined,
        encryptedConfigBlob: encrypted?.encryptedBlob,
        iv: encrypted?.iv,
        authTag: encrypted?.authTag
      }
    });
    return serializeAlertChannel(channel);
  });

  app.delete("/api/alert-channels/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.alertChannel.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/alert-channels/:id/test", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const channel = await prisma.alertChannel.findUniqueOrThrow({ where: { id } });
    const config = decryptAlertConfig(channel, env.vaultKey);
    const delivery = await prisma.alertDelivery.create({
      data: {
        channelId: channel.id,
        event: "incident.opened",
        status: "queued",
        payloadJson: JSON.stringify({
          test: true,
          channel: channel.name,
          target: channel.type === "webhook" ? config.url : config.to
        })
      }
    });
    await markDeliveryAttempted(prisma, delivery.id, "sent");
    return serializeAlertDelivery({ ...delivery, status: "sent", attempts: 1, sentAt: new Date() });
  });

  app.get("/api/alert-rules", async () => {
    const rules = await prisma.alertRule.findMany({
      orderBy: [{ enabled: "desc" }, { name: "asc" }]
    });
    return rules.map(serializeAlertRule);
  });

  app.post("/api/alert-rules", async (request, reply) => {
    const body = alertRuleSchema.parse(request.body);
    const rule = await prisma.alertRule.create({
      data: {
        name: body.name,
        channelId: body.channelId,
        event: body.event,
        enabled: body.enabled ?? true,
        cooldownSeconds: body.cooldownSeconds ?? 900
      }
    });
    reply.code(201);
    return serializeAlertRule(rule);
  });

  app.patch("/api/alert-rules/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = alertRulePatchSchema.parse(request.body);
    const rule = await prisma.alertRule.update({ where: { id }, data: body });
    return serializeAlertRule(rule);
  });

  app.delete("/api/alert-rules/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.alertRule.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/alert-deliveries", async () => {
    const deliveries = await prisma.alertDelivery.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 100
    });
    return deliveries.map(serializeAlertDelivery);
  });
}
