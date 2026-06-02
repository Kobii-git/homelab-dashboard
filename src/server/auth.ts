import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "./env.js";

export const SESSION_COOKIE = "homelab_session";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyAdminPassword(password: string, env: AppEnv): boolean {
  return safeEqual(password, env.adminPassword);
}

export function createAuthToken(env: AppEnv): string {
  return crypto
    .createHmac("sha256", env.cookieSecret)
    .update(`homelab-dashboard:${env.adminPassword}`)
    .digest("base64url");
}

export function isAuthenticated(request: FastifyRequest, env: AppEnv): boolean {
  const token = request.cookies?.[SESSION_COOKIE];

  if (!token) {
    return false;
  }

  return safeEqual(token, createAuthToken(env));
}
