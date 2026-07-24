import http from "node:http";
import https from "node:https";
import {
  resolveOutboundTarget,
  withFixedProviderLimit
} from "./outboundPolicy.js";

const MAX_ICON_BYTES = 512 * 1024;
const ICON_TIMEOUT_MS = 4_000;
const ICON_CACHE_MS = 24 * 60 * 60_000;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon"
]);

type CachedIcon = {
  body: Buffer;
  contentType: string;
  expiresAt: number;
};

const cache = new Map<string, CachedIcon>();

function hasPrefix(body: Buffer, bytes: number[]): boolean {
  return body.length >= bytes.length && bytes.every((value, index) => body[index] === value);
}

export function isValidIconBody(body: Buffer, contentType: string): boolean {
  if (contentType === "image/png") {
    return body.length >= 24 &&
      hasPrefix(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === "image/jpeg") {
    return body.length >= 4 &&
      hasPrefix(body, [0xff, 0xd8, 0xff]) &&
      body[body.length - 2] === 0xff &&
      body[body.length - 1] === 0xd9;
  }
  if (contentType === "image/webp") {
    return body.length >= 16 &&
      body.subarray(0, 4).toString("ascii") === "RIFF" &&
      body.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (contentType === "image/x-icon" || contentType === "image/vnd.microsoft.icon") {
    return body.length >= 22 && hasPrefix(body, [0x00, 0x00, 0x01, 0x00]);
  }
  return false;
}

export function serverIconSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export async function fetchProxiedIcon(
  url: URL,
  options: { fixedProvider?: boolean } = {}
): Promise<{ body: Buffer; contentType: string }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Icon URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Icon URL must not contain embedded credentials");
  }
  const cached = cache.get(url.toString());
  if (cached && cached.expiresAt > Date.now()) {
    return { body: cached.body, contentType: cached.contentType };
  }

  const icon = await withFixedProviderLimit(options.fixedProvider === true, async () => {
    const resolved = await resolveOutboundTarget(url.hostname, options);
    const transport = url.protocol === "https:" ? https : http;
    return new Promise<{ body: Buffer; contentType: string }>((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout;
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const request = transport.request(url, {
        method: "GET",
        headers: { Accept: "image/png,image/jpeg,image/webp,image/x-icon" },
        lookup: resolved.lookup,
        maxHeaderSize: 16 * 1024,
        rejectUnauthorized: true
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.destroy();
          finishReject(new Error(`Icon provider returned HTTP ${status}`));
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
          response.destroy();
          finishReject(new Error("Icon provider returned an unsupported image type"));
          return;
        }
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > MAX_ICON_BYTES) {
          response.destroy();
          finishReject(new Error("Icon exceeds the response size limit"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_ICON_BYTES) {
            response.destroy();
            finishReject(new Error("Icon exceeds the response size limit"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          const body = Buffer.concat(chunks);
          if (!isValidIconBody(body, contentType)) {
            finishReject(new Error("Icon content does not match a supported image format"));
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve({ body, contentType });
        });
        response.on("error", finishReject);
      });
      timeout = setTimeout(() => request.destroy(new Error("Icon request timed out")), ICON_TIMEOUT_MS);
      request.on("error", finishReject);
      request.end();
    });
  });

  cache.set(url.toString(), {
    ...icon,
    expiresAt: Date.now() + ICON_CACHE_MS
  });
  if (cache.size > 500) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  return icon;
}
