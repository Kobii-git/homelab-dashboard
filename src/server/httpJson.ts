import http from "node:http";
import https from "node:https";
import {
  assertIntegrationTransport,
  resolveOutboundTarget,
  withFixedProviderLimit
} from "./outboundPolicy.js";

export type JsonRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  form?: URLSearchParams;
  timeoutMs: number;
  maxBytes: number;
  tlsVerify?: boolean;
  credentialed?: boolean;
  fixedProvider?: boolean;
  label: string;
};

export async function boundedJsonRequest(url: URL | string, options: JsonRequestOptions): Promise<unknown> {
  const target = typeof url === "string" ? new URL(url) : url;
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`${options.label} URL must use HTTP or HTTPS`);
  }
  if (target.username || target.password) {
    throw new Error(`${options.label} URL must not contain embedded credentials`);
  }
  assertIntegrationTransport(target, options);

  return withFixedProviderLimit(options.fixedProvider === true, () =>
    performBoundedJsonRequest(target, options)
  );
}

async function performBoundedJsonRequest(target: URL, options: JsonRequestOptions): Promise<unknown> {
  const resolved = await resolveOutboundTarget(target.hostname, {
    fixedProvider: options.fixedProvider
  });

  if (options.body !== undefined && options.form !== undefined) {
    throw new Error(`${options.label} request cannot include both JSON and form data`);
  }
  const body = options.form?.toString() ?? (options.body === undefined ? null : JSON.stringify(options.body));
  const contentType = options.form ? "application/x-www-form-urlencoded" : "application/json";
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finishResolve = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const request = transport.request(
      target,
      {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": contentType, "Content-Length": String(Buffer.byteLength(body)) } : {}),
          ...(options.headers ?? {})
        },
        rejectUnauthorized: options.tlsVerify ?? true,
        lookup: resolved.lookup,
        maxHeaderSize: 16 * 1024
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.destroy();
          finishReject(new Error(`${options.label} returned HTTP ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > options.maxBytes) {
            const error = new Error(`${options.label} response exceeded ${options.maxBytes} bytes`);
            response.destroy();
            request.destroy();
            finishReject(error);
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          const responseBody = Buffer.concat(chunks).toString("utf8");
          try {
            finishResolve(responseBody ? JSON.parse(responseBody) : {});
          } catch {
            finishReject(new Error(`${options.label} returned invalid JSON`));
          }
        });
        response.on("error", finishReject);
      }
    );

    timeout = setTimeout(() => {
      request.destroy(new Error(`${options.label} timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    request.on("error", finishReject);
    if (body) request.write(body);
    request.end();
  });
}
