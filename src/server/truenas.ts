import { Prisma, type IntegrationSample, type IntegrationSource, type PrismaClient } from "@prisma/client";
import WebSocket from "ws";
import type { HealthStatus, IntegrationSourceDto, TrueNasCapacityDto, TrueNasSnapshotDto } from "../shared/types.js";
import type { TrueNasEnvConfig } from "./env.js";
import type { SchedulerUpdate } from "./healthChecks.js";
import { assertIntegrationTransport, resolveOutboundTarget } from "./outboundPolicy.js";

export const TRUENAS_PROVIDER = "truenas";
export const TRUENAS_SAMPLE_RETENTION = 1440;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_MESSAGE_BYTES = 512 * 1024;

type ConfiguredTrueNasEnv = TrueNasEnvConfig & {
  baseUrl: string;
  username: string;
  apiKey: string;
  poolName: string;
};

type TrueNasOutcome = {
  status: "online" | "offline";
  error?: string;
  snapshot?: TrueNasSnapshotDto;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function propertyNumber(value: unknown): number | null {
  const direct = numberValue(value);
  if (direct != null) return direct;
  const record = asRecord(value);
  return numberValue(record.parsed) ?? numberValue(record.rawvalue) ?? numberValue(record.value);
}

function validBytes(value: number | null): value is number {
  return value != null && Number.isSafeInteger(value) && value >= 0;
}

export function isTrueNasConfigured(config: TrueNasEnvConfig): config is ConfiguredTrueNasEnv {
  return Boolean(config.enabled && config.configured && config.baseUrl && config.username && config.apiKey && config.poolName);
}

export function sanitizeTrueNasError(error: unknown): string {
  const message = error instanceof Error && error.message.trim() ? error.message : "TrueNAS request failed";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer redacted")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic redacted")
    .replace(/api[_ -]?key[^,}\s]*/gi, "API key redacted")
    .slice(0, 240);
}

export function trueNasRuntimeConfig(config: TrueNasEnvConfig) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    name: config.name,
    baseUrl: config.baseUrl,
    poolName: config.poolName,
    datasetName: config.datasetName,
    tlsVerify: config.tlsVerify,
    pollIntervalSeconds: config.pollIntervalSeconds
  };
}

class TrueNasRpcClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly config: ConfiguredTrueNasEnv) {}

  async connect(): Promise<void> {
    const httpUrl = new URL(this.config.baseUrl);
    assertIntegrationTransport(httpUrl, { credentialed: true, tlsVerify: this.config.tlsVerify });
    if (httpUrl.protocol !== "https:") throw new Error("TrueNAS requires HTTPS/WSS");
    const resolved = await resolveOutboundTarget(httpUrl.hostname);
    const url = new URL("/api/current", httpUrl);
    url.protocol = "wss:";

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout;
      const socket = new WebSocket(url, {
        lookup: resolved.lookup,
        rejectUnauthorized: this.config.tlsVerify,
        handshakeTimeout: REQUEST_TIMEOUT_MS,
        maxPayload: MAX_MESSAGE_BYTES
      });
      this.socket = socket;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      timeout = setTimeout(() => {
        socket.terminate();
        fail(new Error("TrueNAS connection timed out"));
      }, REQUEST_TIMEOUT_MS);
      socket.once("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", fail);
      socket.on("message", (data) => this.onMessage(data));
      socket.on("close", () => {
        fail(new Error("TrueNAS connection closed during setup"));
        this.rejectPending(new Error("TrueNAS connection closed"));
      });
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    if (buffer.length > MAX_MESSAGE_BYTES) {
      this.rejectPending(new Error("TrueNAS response exceeded the message size limit"));
      this.socket?.terminate();
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = asRecord(JSON.parse(buffer.toString("utf8")));
    } catch {
      this.rejectPending(new Error("TrueNAS returned invalid JSON"));
      this.socket?.terminate();
      return;
    }
    const id = numberValue(message.id);
    if (id == null) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const rpcError = asRecord(message.error);
    if (Object.keys(rpcError).length > 0) {
      pending.reject(new Error(stringValue(rpcError.message) ?? "TrueNAS JSON-RPC call failed"));
    } else {
      pending.resolve(message.result);
    }
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("TrueNAS connection is not open");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`TrueNAS ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("TrueNAS request exceeded the message size limit"));
        return;
      }
      this.socket!.send(payload, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 500);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, "complete");
    });
    this.rejectPending(new Error("TrueNAS connection closed"));
  }
}

function poolCapacity(value: unknown, expectedName: string): TrueNasSnapshotDto["pool"] {
  const pool = asRecord(value);
  const name = stringValue(pool.name) ?? expectedName;
  const reportedSize = propertyNumber(pool.size);
  const reportedUsed = propertyNumber(pool.allocated);
  const reportedFree = propertyNumber(pool.free);
  const sizeBytes = validBytes(reportedSize)
    ? reportedSize
    : validBytes(reportedUsed) && validBytes(reportedFree)
      ? reportedUsed + reportedFree
      : null;
  const usedBytes = validBytes(reportedUsed)
    ? reportedUsed
    : validBytes(sizeBytes) && validBytes(reportedFree)
      ? sizeBytes - reportedFree
      : null;
  const freeBytes = validBytes(reportedFree)
    ? reportedFree
    : validBytes(sizeBytes) && validBytes(usedBytes)
      ? sizeBytes - usedBytes
      : null;
  if (!validBytes(sizeBytes) || !validBytes(usedBytes) || !validBytes(freeBytes) || sizeBytes === 0 || usedBytes > sizeBytes || freeBytes > sizeBytes) {
    throw new Error("TrueNAS returned invalid pool capacity data");
  }
  return {
    name,
    health: stringValue(pool.status) ?? stringValue(pool.health) ?? "UNKNOWN",
    statusDetail: stringValue(pool.status_detail) ?? stringValue(pool.statusDetail),
    sizeBytes,
    usedBytes,
    freeBytes
  };
}

function datasetCapacity(value: unknown, expectedName: string): TrueNasCapacityDto {
  const dataset = asRecord(value);
  const usedBytes = propertyNumber(dataset.used);
  const freeBytes = propertyNumber(dataset.available);
  if (!validBytes(usedBytes) || !validBytes(freeBytes) || usedBytes + freeBytes === 0) {
    throw new Error("TrueNAS returned invalid dataset capacity data");
  }
  return {
    name: stringValue(dataset.id) ?? stringValue(dataset.name) ?? expectedName,
    sizeBytes: usedBytes + freeBytes,
    usedBytes,
    freeBytes
  };
}

export async function collectTrueNasSnapshot(config: TrueNasEnvConfig): Promise<TrueNasOutcome> {
  if (!isTrueNasConfigured(config)) return { status: "offline", error: "TrueNAS integration is not configured" };
  const client = new TrueNasRpcClient(config);
  try {
    await client.connect();
    const authenticated = await client.call("auth.login_ex", [{
      mechanism: "API_KEY_PLAIN",
      username: config.username,
      api_key: config.apiKey,
      login_options: { user_info: false }
    }]);
    const authRecord = asRecord(authenticated);
    if (stringValue(authRecord.response_type)?.toUpperCase() !== "SUCCESS") throw new Error("TrueNAS authentication failed");
    const poolResult = await client.call("pool.query", [[["name", "=", config.poolName]], { get: true }]);
    const poolRaw = Array.isArray(poolResult) ? asArray(poolResult)[0] : poolResult;
    if (!poolRaw || Object.keys(asRecord(poolRaw)).length === 0) throw new Error("Configured TrueNAS pool was not found");
    const datasetRaw = config.datasetName
      ? await client.call("pool.dataset.query", [[["id", "=", config.datasetName]], { get: true }])
      : null;
    const datasetValue = Array.isArray(datasetRaw) ? asArray(datasetRaw)[0] : datasetRaw;
    if (config.datasetName && (!datasetValue || Object.keys(asRecord(datasetValue)).length === 0)) {
      throw new Error("Configured TrueNAS dataset was not found");
    }
    const pool = poolCapacity(poolRaw, config.poolName);
    const dataset = config.datasetName && datasetValue ? datasetCapacity(datasetValue, config.datasetName) : null;
    const capacity = dataset ?? pool;
    const usedPercent = capacity.sizeBytes > 0 ? (capacity.usedBytes / capacity.sizeBytes) * 100 : 0;
    const warnings: string[] = [];
    if (!["ONLINE", "HEALTHY"].includes(pool.health.toUpperCase())) warnings.push(`Pool health is ${pool.health}`);
    if (usedPercent >= 90) warnings.push("Storage is critically full");
    else if (usedPercent >= 80) warnings.push("Storage is nearing capacity");
    return {
      status: "online",
      snapshot: {
        provider: "truenas",
        status: "online",
        sampledAt: new Date().toISOString(),
        warnings,
        pool,
        dataset
      }
    };
  } catch (error) {
    return { status: "offline", error: sanitizeTrueNasError(error) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function resetLatestState() {
  return { status: "unknown", latestError: null, latestSnapshot: Prisma.JsonNull, latestSampledAt: null } as const;
}

export async function syncConfiguredTrueNasSource(prisma: PrismaClient, config: TrueNasEnvConfig): Promise<IntegrationSource | null> {
  const existing = await prisma.integrationSource.findFirst({
    where: { provider: TRUENAS_PROVIDER },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  if (!isTrueNasConfigured(config)) {
    if (existing?.enabled) return prisma.integrationSource.update({ where: { id: existing.id }, data: { enabled: false } });
    return existing ?? null;
  }
  if (!existing) {
    return prisma.integrationSource.create({
      data: { provider: TRUENAS_PROVIDER, name: config.name, baseUrl: config.baseUrl, enabled: true }
    });
  }
  const moved = existing.baseUrl !== config.baseUrl;
  return prisma.$transaction(async (tx) => {
    const source = await tx.integrationSource.update({
      where: { id: existing.id },
      data: { name: config.name, baseUrl: config.baseUrl, enabled: true, ...(moved ? resetLatestState() : {}) }
    });
    if (moved) await tx.integrationSample.deleteMany({ where: { sourceId: existing.id } });
    return source;
  });
}

export async function runTrueNasSample(prisma: PrismaClient, source: IntegrationSource, config: TrueNasEnvConfig): Promise<TrueNasOutcome> {
  if (source.provider !== TRUENAS_PROVIDER || !isTrueNasConfigured(config)) {
    return { status: "offline", error: "TrueNAS integration is not configured" };
  }
  const outcome = await collectTrueNasSnapshot(config);
  const sampledAt = new Date();
  const snapshot = outcome.snapshot ? outcome.snapshot as unknown as Prisma.InputJsonValue : Prisma.JsonNull;
  await prisma.$transaction(async (tx) => {
    await tx.integrationSample.create({ data: { sourceId: source.id, status: outcome.status, error: outcome.error ?? null, snapshot } });
    await tx.integrationSource.update({
      where: { id: source.id },
      data: { status: outcome.status, latestError: outcome.error ?? null, latestSnapshot: snapshot, latestSampledAt: sampledAt }
    });
    const stale = await tx.integrationSample.findMany({
      where: { sourceId: source.id }, orderBy: { sampledAt: "desc" }, skip: TRUENAS_SAMPLE_RETENTION, select: { id: true }
    });
    if (stale.length > 0) await tx.integrationSample.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
  });
  return outcome;
}

export function startTrueNasScheduler(
  prisma: PrismaClient,
  config: TrueNasEnvConfig,
  intervalMs = 15_000,
  observer?: (update: SchedulerUpdate) => void
): () => void {
  let running = false;
  const tick = async () => {
    if (running) {
      observer?.({ skippedTickAt: new Date() });
      return;
    }
    const startedAt = Date.now();
    running = true;
    observer?.({ running: true, lastTickAt: new Date(), lastError: null });
    try {
      const source = await syncConfiguredTrueNasSource(prisma, config);
      const due = source && isTrueNasConfigured(config) && source.enabled && (!source.latestSampledAt || Date.now() - source.latestSampledAt.getTime() >= config.pollIntervalSeconds * 1000);
      observer?.({ lastDueCount: due ? 1 : 0 });
      if (due) await runTrueNasSample(prisma, source, config);
      observer?.({ running: false, lastCompletedAt: new Date(), lastDurationMs: Date.now() - startedAt, lastError: null });
    } catch (error) {
      observer?.({ running: false, lastCompletedAt: new Date(), lastDurationMs: Date.now() - startedAt, lastError: sanitizeTrueNasError(error) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}

export function trueNasSourceDto(source: IntegrationSource & { samples?: IntegrationSample[] }): IntegrationSourceDto {
  const snapshot = (value: Prisma.JsonValue | null): TrueNasSnapshotDto | null =>
    value && typeof value === "object" && !Array.isArray(value) && (value as { provider?: string }).provider === "truenas"
      ? value as unknown as TrueNasSnapshotDto
      : null;
  return {
    id: source.id,
    provider: "truenas",
    name: source.name,
    baseUrl: source.baseUrl,
    enabled: source.enabled,
    status: source.status as HealthStatus,
    latestError: source.latestError,
    latestSnapshot: snapshot(source.latestSnapshot),
    latestSampledAt: source.latestSampledAt?.toISOString() ?? null,
    sortOrder: source.sortOrder,
    samples: source.samples?.map((sample) => ({
      id: sample.id,
      sourceId: sample.sourceId,
      status: sample.status as HealthStatus,
      error: sample.error,
      snapshot: snapshot(sample.snapshot),
      sampledAt: sample.sampledAt.toISOString()
    }))
  };
}
