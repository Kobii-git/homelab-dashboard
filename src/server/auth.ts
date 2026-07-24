import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "./env.js";

export const SESSION_COOKIE = "homelab_session";
export const REAUTH_COOKIE = "homelab_reauth";
export const REAUTH_MAX_AGE_SECONDS = 5 * 60;

const SESSION_VERSION_KEY = "auth_session_version";
const SETUP_CODE_KEY = "setup_bootstrap_hash";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const SCRYPT_KEY_LENGTH = 64;
const BASE32_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type SessionPayload = {
  iat: number;
  exp: number;
  nonce: string;
  version: number;
  credentialTag: string;
};

function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function verifyScryptPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, rawN, rawR, rawP, saltValue, hashValue, ...extra] = stored.split("$");
  if (algorithm !== "scrypt" || extra.length > 0) return false;
  if (Number(rawN) !== SCRYPT_N || Number(rawR) !== SCRYPT_R || Number(rawP) !== SCRYPT_P) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (salt.length < 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    return safeEqual(await deriveScrypt(password, salt), expected);
  } catch {
    return false;
  }
}

async function verifyLegacyPbkdf2Password(password: string, stored: string): Promise<boolean> {
  const idx = stored.indexOf(":");
  if (idx < 0) return false;
  const salt = stored.slice(0, idx);
  const hexHash = stored.slice(idx + 1);
  if (!salt || !/^[a-f\d]+$/i.test(hexHash) || hexHash.length % 2 !== 0) return false;

  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100_000, 64, "sha256", (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return safeEqual(derived, Buffer.from(hexHash, "hex"));
}

export async function verifyHashedPassword(password: string, stored: string): Promise<boolean> {
  return stored.startsWith("scrypt$")
    ? verifyScryptPassword(password, stored)
    : verifyLegacyPbkdf2Password(password, stored);
}

export async function verifyAdminLogin(
  username: string | undefined,
  password: string,
  env: AppEnv,
  prisma: PrismaClient
): Promise<boolean> {
  if (env.adminPassword) {
    return safeEqual(password, env.adminPassword);
  }

  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  if (!account || !username || account.username.toLowerCase() !== username.toLowerCase()) return false;
  if (!(await verifyHashedPassword(password, account.passwordHash))) return false;

  if (!account.passwordHash.startsWith("scrypt$")) {
    await prisma.adminAccount.update({
      where: { id: account.id },
      data: { passwordHash: await hashPassword(password) }
    });
  }
  return true;
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

async function getSessionVersion(prisma: PrismaClient): Promise<number> {
  const config = await prisma.systemConfig.findUnique({ where: { key: SESSION_VERSION_KEY } });
  const value = Number.parseInt(config?.value ?? "1", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export async function incrementSessionVersion(prisma: PrismaClient): Promise<number> {
  const next = (await getSessionVersion(prisma)) + 1;
  await prisma.systemConfig.upsert({
    where: { key: SESSION_VERSION_KEY },
    create: { key: SESSION_VERSION_KEY, value: String(next) },
    update: { value: String(next) }
  });
  return next;
}

async function getCredentialMaterial(env: AppEnv, prisma: PrismaClient): Promise<string | null> {
  if (env.adminPassword) return `env:${env.adminPassword}`;
  const account = await prisma.adminAccount.findUnique({ where: { id: "admin" } });
  return account ? `database:${account.passwordHash}` : null;
}

function credentialFingerprint(material: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`credential:${material}`).digest("base64url");
}

export async function createAuthToken(env: AppEnv, prisma: PrismaClient, now = new Date()): Promise<string> {
  const material = await getCredentialMaterial(env, prisma);
  if (!material) throw new Error("Cannot issue a session before an admin credential exists");
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    iat,
    exp: iat + env.sessionMaxAgeSeconds,
    nonce: crypto.randomBytes(16).toString("base64url"),
    version: await getSessionVersion(prisma),
    credentialTag: credentialFingerprint(material, env.cookieSecret)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.cookieSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function parseSessionPayload(encoded: string): SessionPayload | null {
  if (encoded.length > 2048) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      !Number.isSafeInteger(value.iat) ||
      !Number.isSafeInteger(value.exp) ||
      !Number.isSafeInteger(value.version) ||
      typeof value.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{20,30}$/.test(value.nonce) ||
      typeof value.credentialTag !== "string"
    ) {
      return null;
    }
    return value as SessionPayload;
  } catch {
    return null;
  }
}

export async function isAuthenticated(
  request: FastifyRequest,
  env: AppEnv,
  prisma: PrismaClient,
  now = new Date()
): Promise<boolean> {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = crypto.createHmac("sha256", env.cookieSecret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return false;

  const payload = parseSessionPayload(encoded);
  if (!payload) return false;
  const current = Math.floor(now.getTime() / 1000);
  if (payload.iat > current + 60 || payload.exp <= current || payload.exp <= payload.iat) return false;
  if (payload.exp - payload.iat > env.sessionMaxAgeSeconds) return false;
  if (payload.version !== (await getSessionVersion(prisma))) return false;

  const material = await getCredentialMaterial(env, prisma);
  if (!material) return false;
  return safeEqual(payload.credentialTag, credentialFingerprint(material, env.cookieSecret));
}

type ReauthPayload = {
  iat: number;
  exp: number;
  nonce: string;
  sessionTag: string;
};

function reauthSessionTag(sessionToken: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`reauth:${sessionToken}`).digest("base64url");
}

export function createReauthToken(request: FastifyRequest, env: AppEnv, now = new Date()): string {
  const sessionToken = request.cookies?.[SESSION_COOKIE];
  if (!sessionToken) throw new Error("Cannot reauthenticate without an active session");
  const iat = Math.floor(now.getTime() / 1000);
  const payload: ReauthPayload = {
    iat,
    exp: iat + REAUTH_MAX_AGE_SECONDS,
    nonce: crypto.randomBytes(16).toString("base64url"),
    sessionTag: reauthSessionTag(sessionToken, env.cookieSecret)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.cookieSecret).update(`reauth-token:${encoded}`).digest("base64url");
  return `${encoded}.${signature}`;
}

export function isRecentlyReauthenticated(request: FastifyRequest, env: AppEnv, now = new Date()): boolean {
  const sessionToken = request.cookies?.[SESSION_COOKIE];
  const token = request.cookies?.[REAUTH_COOKIE];
  if (!sessionToken || !token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = crypto
    .createHmac("sha256", env.cookieSecret)
    .update(`reauth-token:${encoded}`)
    .digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ReauthPayload>;
    const current = Math.floor(now.getTime() / 1000);
    if (
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      typeof payload.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{20,30}$/.test(payload.nonce) ||
      typeof payload.sessionTag !== "string" ||
      payload.exp! <= current ||
      payload.iat! > current + 60 ||
      payload.exp! - payload.iat! > REAUTH_MAX_AGE_SECONDS
    ) {
      return false;
    }
    return safeEqual(payload.sessionTag, reauthSessionTag(sessionToken, env.cookieSecret));
  } catch {
    return false;
  }
}

function setupCodeHmac(code: string, secret: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return crypto.createHmac("sha256", secret).update(`setup:${normalized}`).digest("base64url");
}

function generateSetupCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(12);
  for (let index = 0; index < 12; index += 1) {
    code += BASE32_ALPHABET[bytes[index] & 31];
  }
  return code;
}

export async function initializeSetupCode(
  prisma: PrismaClient,
  env: AppEnv,
  requestedCode?: string
): Promise<string | null> {
  const account = env.adminPassword
    ? null
    : await prisma.adminAccount.findUnique({ where: { id: "admin" }, select: { id: true } });
  if (env.adminPassword || account) {
    await prisma.systemConfig.deleteMany({ where: { key: SETUP_CODE_KEY } });
    return null;
  }

  if (env.nodeEnv === "production" && !requestedCode) {
    throw new Error("SETUP_CODE is required on the first production boot when ADMIN_PASSWORD is not set");
  }
  const code = requestedCode ?? generateSetupCode();
  if (!/^[A-Z2-9]{12}$/.test(code)) throw new Error("The configured setup code must be 12 base32 characters");
  await prisma.systemConfig.upsert({
    where: { key: SETUP_CODE_KEY },
    create: { key: SETUP_CODE_KEY, value: setupCodeHmac(code, env.cookieSecret) },
    update: { value: setupCodeHmac(code, env.cookieSecret) }
  });
  return code;
}

export async function verifySetupCode(code: string, env: AppEnv, prisma: PrismaClient): Promise<boolean> {
  const stored = await prisma.systemConfig.findUnique({ where: { key: SETUP_CODE_KEY } });
  return Boolean(stored && safeEqual(stored.value, setupCodeHmac(code, env.cookieSecret)));
}

export async function clearSetupCode(prisma: PrismaClient): Promise<void> {
  await prisma.systemConfig.deleteMany({ where: { key: SETUP_CODE_KEY } });
}
