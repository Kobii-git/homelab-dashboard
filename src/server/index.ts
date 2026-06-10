import "./bootstrap-env.js";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { getEnv, type AppEnv } from "./env.js";

async function getOrCreate(prisma: PrismaClient, key: string, generate: () => string): Promise<string> {
  const existing = await prisma.systemConfig.findUnique({ where: { key } });
  if (existing) return existing.value;
  const value = generate();
  await prisma.systemConfig.create({ data: { key, value } });
  return value;
}

async function resolveSecrets(
  partial: ReturnType<typeof getEnv>,
  prisma: PrismaClient
): Promise<AppEnv> {
  const cookieSecret =
    partial.cookieSecret ??
    (await getOrCreate(prisma, "cookie_secret", () => crypto.randomBytes(32).toString("hex")));

  return { ...partial, cookieSecret };
}

const rawEnv = getEnv();
const prisma = new PrismaClient();

// Push schema then resolve runtime secrets so the app always has valid secrets
await prisma.$executeRawUnsafe("SELECT 1").catch(() => null); // warm connection

const env = await resolveSecrets(rawEnv, prisma);
const app = await createApp({ env, prisma });

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`Homelab Dashboard listening on http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  console.error(error);
  process.exit(1);
}
