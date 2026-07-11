import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/server/app.js";
import { getEnv } from "../src/server/env.js";

const prisma = new PrismaClient();
const raw = getEnv();
if (!raw.cookieSecret) throw new Error("COOKIE_SECRET is required for the E2E server");
const app = await createApp({ env: { ...raw, cookieSecret: raw.cookieSecret }, prisma, monitor: false, logger: false });

await app.listen({ host: raw.host, port: raw.port });

async function close() {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
