import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "./env.js";

export const SESSION_COOKIE = "homelab_session";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export function verifyHashedPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64) as Buffer;
  const storedBuf = Buffer.from(hash, "hex");
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export async function verifyAdminLogin(
  username: string | undefined,
  password: string,
  env: AppEnv,
  prisma: PrismaClient
): Promise<boolean> {
  // Legacy mode: env var password, username not checked
  if (env.adminPassword) {
    return safeEqual(password, env.adminPassword);
  }
  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  if (!account) return false;
  if (username && account.username !== username) return false;
  return verifyHashedPassword(password, account.passwordHash);
}

// Kept for vault reveal (password only, no username check)
export async function verifyAdminPassword(
  password: string,
  env: AppEnv,
  prisma: PrismaClient
): Promise<boolean> {
  if (env.adminPassword) {
    return safeEqual(password, env.adminPassword);
  }
  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  if (!account) return false;
  return verifyHashedPassword(password, account.passwordHash);
}

export function createAuthToken(env: AppEnv): string {
  return crypto.createHmac("sha256", env.cookieSecret).update("homelab-session-v2").digest("base64url");
}

export function isAuthenticated(request: FastifyRequest, env: AppEnv): boolean {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return false;
  return safeEqual(token, createAuthToken(env));
}
