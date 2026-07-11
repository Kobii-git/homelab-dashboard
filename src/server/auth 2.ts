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
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha256");
  return `${salt}:${hash.toString("hex")}`;
}

export function verifyHashedPassword(password: string, stored: string): boolean {
  const idx = stored.indexOf(":");
  if (idx < 0) return false;
  const salt = stored.slice(0, idx);
  const hexHash = stored.slice(idx + 1);
  if (!salt || !hexHash) return false;
  const derived = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha256");
  const storedBuf = Buffer.from(hexHash, "hex");
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export async function verifyAdminLogin(
  username: string | undefined,
  password: string,
  env: AppEnv,
  prisma: PrismaClient
): Promise<boolean> {
  // Legacy: env var password (no username check)
  if (env.adminPassword) {
    return safeEqual(password, env.adminPassword);
  }
  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  if (!account) return false;
  // Username check is case-insensitive; omitting username skips the check
  if (username && account.username.toLowerCase() !== username.toLowerCase()) return false;
  return verifyHashedPassword(password, account.passwordHash);
}

export async function verifyAdminPassword(
  password: string,
  env: AppEnv,
  prisma: PrismaClient
): Promise<boolean> {
  if (env.adminPassword) return safeEqual(password, env.adminPassword);
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
