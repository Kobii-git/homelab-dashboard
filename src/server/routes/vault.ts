import { verifyAdminPassword } from "../auth.js";
import { createAuditEvent } from "../audit.js";
import { serializeAuditEvent } from "../serializers.js";
import {
  folderPatchSchema,
  folderSchema,
  idParamSchema,
  tagPatchSchema,
  tagSchema,
  vaultRevealSchema
} from "../validation.js";
import { decryptCredential } from "../vault.js";
import type { RouteContext } from "./types.js";

export async function registerVaultRoutes({ app, prisma, env }: RouteContext): Promise<void> {
  app.get("/api/vault/folders", async () =>
    prisma.folder.findMany({
      where: { type: { in: ["credential", "mixed"] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    })
  );

  app.post("/api/vault/folders", async (request, reply) => {
    const body = folderSchema.parse(request.body);
    const folder = await prisma.folder.create({ data: body });
    await createAuditEvent(prisma, {
      action: "folder.created",
      entityType: "folder",
      entityId: folder.id,
      summary: `Created folder ${folder.name}`
    });
    reply.code(201);
    return folder;
  });

  app.patch("/api/vault/folders/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = folderPatchSchema.parse(request.body);
    const folder = await prisma.folder.update({ where: { id }, data: body });
    await createAuditEvent(prisma, {
      action: "folder.updated",
      entityType: "folder",
      entityId: folder.id,
      summary: `Updated folder ${folder.name}`
    });
    return folder;
  });

  app.delete("/api/vault/folders/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.folder.delete({ where: { id } });
    await createAuditEvent(prisma, {
      action: "folder.deleted",
      entityType: "folder",
      entityId: id,
      summary: "Deleted folder"
    });
    return { ok: true };
  });

  app.get("/api/tags", async () =>
    prisma.tag.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] })
  );

  app.post("/api/tags", async (request, reply) => {
    const body = tagSchema.parse(request.body);
    const tag = await prisma.tag.create({
      data: {
        name: body.name,
        color: body.color ?? null,
        type: body.type ?? "general"
      }
    });
    reply.code(201);
    return tag;
  });

  app.patch("/api/tags/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = tagPatchSchema.parse(request.body);
    return prisma.tag.update({ where: { id }, data: body });
  });

  app.delete("/api/tags/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.tag.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/vault/audit", async () => {
    const events = await prisma.auditEvent.findMany({
      where: {
        OR: [
          { entityType: "credential" },
          { action: { contains: "vault" } },
          { action: { contains: "credential" } }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return events.map(serializeAuditEvent);
  });

  app.post("/api/vault/reveal", async (request, reply) => {
    const body = vaultRevealSchema.parse(request.body);

    if (!verifyAdminPassword(body.password, env)) {
      await createAuditEvent(prisma, {
        action: "vault.reveal.denied",
        entityType: "credential",
        entityId: body.credentialId,
        summary: "Denied credential reveal attempt"
      });
      reply.code(403).send({ error: "Re-authentication failed" });
      return;
    }

    const credential = await prisma.credential.findUnique({ where: { id: body.credentialId } });

    if (!credential) {
      reply.code(404).send({ error: "Credential not found" });
      return;
    }

    const secret = decryptCredential(
      {
        encryptedBlob: credential.encryptedBlob,
        iv: credential.iv,
        authTag: credential.authTag
      },
      env.vaultKey
    );

    await prisma.credential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() }
    });
    await createAuditEvent(prisma, {
      action: "vault.reveal",
      entityType: "credential",
      entityId: credential.id,
      summary: `Revealed credential ${credential.label}`,
      metadata: { label: credential.label }
    });

    return {
      id: credential.id,
      label: credential.label,
      username: secret.username ?? credential.username,
      password: secret.password ?? null,
      domain: secret.domain ?? null,
      privateKey: secret.privateKey ?? null,
      passphrase: secret.passphrase ?? null,
      expiresInSeconds: 30
    };
  });
}
