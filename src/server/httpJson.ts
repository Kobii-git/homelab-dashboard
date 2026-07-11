import http from "node:http";
import https from "node:https";

export type JsonRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  maxBytes: number;
  tlsVerify?: boolean;
  label: string;
};

export async function boundedJsonRequest(url: URL | string, options: JsonRequestOptions): Promise<unknown> {
  const target = typeof url === "string" ? new URL(url) : url;
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`${options.label} URL must use HTTP or HTTPS`);
  }

  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request(
      target,
      {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) } : {}),
          ...(options.headers ?? {})
        },
        rejectUnauthorized: options.tlsVerify ?? true
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finishReject(new Error(`${options.label} returned HTTP ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > options.maxBytes) {
            request.destroy(new Error(`${options.label} response exceeded ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          const responseBody = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(responseBody ? JSON.parse(responseBody) : {});
          } catch {
            reject(new Error(`${options.label} returned invalid JSON`));
          }
        });
        response.on("error", finishReject);
      }
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`${options.label} timed out after ${options.timeoutMs} ms`));
    });
    request.on("error", finishReject);
    if (body) request.write(body);
    request.end();
  });
}
