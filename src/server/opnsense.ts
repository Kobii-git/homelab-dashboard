import http from "node:http";
import https from "node:https";
import { Prisma, type IntegrationSample, type IntegrationSource, type PrismaClient } from "@prisma/client";
import type {
  HealthStatus,
  IntegrationSourceDto,
  OpnsenseGatewayDto,
  OpnsenseImportSuggestionDto,
  OpnsenseInterfaceDto,
  OpnsenseSnapshotDto
} from "../shared/types.js";
import type { OpnsenseEnvConfig } from "./env.js";
import type { SchedulerUpdate } from "./healthChecks.js";

export const OPNSENSE_PROVIDER = "opnsense";
export const INTEGRATION_SAMPLE_RETENTION = 1440;

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 3_000_000;
const OPNSENSE_ORANGE = "#d94f00";

type ConfiguredOpnsenseEnv = OpnsenseEnvConfig & {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
};

type OpnsenseEndpointKey =
  | "systemInformation"
  | "systemResources"
  | "systemDisk"
  | "systemTemperature"
  | "interfacesInfo"
  | "interfaceStatistics"
  | "gateways"
  | "firmwareInfo"
  | "firmwareRunning"
  | "pfStatistics"
  | "firewallLog";

type OpnsenseEndpoint = {
  key: OpnsenseEndpointKey;
  path: string;
  optional?: boolean;
};

type OpnsenseOutcome = {
  status: "online" | "offline";
  error?: string;
  snapshot?: OpnsenseSnapshotDto;
};

type IntegrationSourceWithSamples = IntegrationSource & {
  samples?: IntegrationSample[];
};

const ENDPOINTS: Record<OpnsenseEndpointKey, OpnsenseEndpoint> = {
  systemInformation: {
    key: "systemInformation",
    path: "/api/diagnostics/system/system_information"
  },
  systemResources: {
    key: "systemResources",
    path: "/api/diagnostics/system/system_resources"
  },
  systemDisk: {
    key: "systemDisk",
    path: "/api/diagnostics/system/system_disk",
    optional: true
  },
  systemTemperature: {
    key: "systemTemperature",
    path: "/api/diagnostics/system/system_temperature",
    optional: true
  },
  interfacesInfo: {
    key: "interfacesInfo",
    path: "/api/interfaces/overview/interfaces_info/true",
    optional: true
  },
  interfaceStatistics: {
    key: "interfaceStatistics",
    path: "/api/diagnostics/interface/get_interface_statistics",
    optional: true
  },
  gateways: {
    key: "gateways",
    path: "/api/routing/settings/search_gateway",
    optional: true
  },
  firmwareInfo: {
    key: "firmwareInfo",
    path: "/api/core/firmware/info",
    optional: true
  },
  firmwareRunning: {
    key: "firmwareRunning",
    path: "/api/core/firmware/running",
    optional: true
  },
  pfStatistics: {
    key: "pfStatistics",
    path: "/api/diagnostics/firewall/pf_statistics",
    optional: true
  },
  firewallLog: {
    key: "firewallLog",
    path: "/api/diagnostics/firewall/log",
    optional: true
  }
};

const ALLOWED_PATHS = new Set(Object.values(ENDPOINTS).map((endpoint) => endpoint.path));

export function isOpnsenseConfigured(config: OpnsenseEnvConfig): config is ConfiguredOpnsenseEnv {
  return Boolean(config.enabled && config.configured && config.baseUrl && config.apiKey && config.apiSecret);
}

export function sanitizeIntegrationError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic redacted");
  }
  return "OPNsense request failed";
}

export function opnsenseRuntimeConfig(config: OpnsenseEnvConfig) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    name: config.name,
    baseUrl: config.baseUrl,
    tlsVerify: config.tlsVerify,
    pollIntervalSeconds: config.pollIntervalSeconds
  };
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function valueFor(source: unknown, keys: string[]): unknown {
  const record = asRecord(source);
  const wanted = new Set(keys.map(normalizedKey));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizedKey(key))) {
      return value;
    }
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "available", "required"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "none", "ok"].includes(normalized)) return false;
  }
  return undefined;
}

function firstString(source: unknown, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(valueFor(source, [key]));
    if (value) return value;
  }
  return null;
}

function firstNumber(source: unknown, keys: string[]): number | null {
  for (const key of keys) {
    const value = numberValue(valueFor(source, [key]));
    if (value !== undefined) return value;
  }
  return null;
}

function findFirstValue(source: unknown, keys: string[], depth = 4): unknown {
  if (depth < 0 || source == null) return undefined;
  const direct = valueFor(source, keys);
  if (direct !== undefined) return direct;

  if (Array.isArray(source)) {
    for (const item of source) {
      const value = findFirstValue(item, keys, depth - 1);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  const record = asRecord(source);
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const found = findFirstValue(value, keys, depth - 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function findFirstString(source: unknown, keys: string[]): string | null {
  return stringValue(findFirstValue(source, keys)) ?? null;
}

function findFirstNumber(source: unknown, keys: string[]): number | null {
  const value = numberValue(findFirstValue(source, keys));
  return value === undefined ? null : value;
}

function clampPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function roundMetric(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function statusValue(value: unknown): HealthStatus {
  const status = `${stringValue(value) ?? ""}`.toLowerCase();
  if (!status) return "unknown";
  if (status.includes("down") || status.includes("offline") || status.includes("critical") || status.includes("loss")) {
    return "offline";
  }
  if (status.includes("up") || status.includes("online") || status.includes("active") || status.includes("ok")) {
    return "online";
  }
  return "unknown";
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function rowsFrom(raw: unknown, preferredKeys: string[]): Array<Record<string, unknown> & { __key?: string }> {
  if (Array.isArray(raw)) return raw.map((item) => asRecord(item));

  const record = asRecord(raw);
  for (const key of preferredKeys) {
    const value = valueFor(record, [key]);
    if (Array.isArray(value)) return value.map((item) => asRecord(item));
  }

  return Object.entries(record)
    .filter(([, value]) => value && typeof value === "object")
    .map(([key, value]) => ({ ...asRecord(value), __key: key }));
}

function authHeader(config: ConfiguredOpnsenseEnv): string {
  return `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`;
}

async function requestJson(config: ConfiguredOpnsenseEnv, endpoint: OpnsenseEndpoint): Promise<unknown> {
  if (!ALLOWED_PATHS.has(endpoint.path)) {
    throw new Error("OPNsense endpoint is not allowlisted");
  }

  const url = new URL(endpoint.path, config.baseUrl);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authHeader(config),
          "User-Agent": "homelab-dashboard"
        },
        rejectUnauthorized: config.tlsVerify
      },
      (response) => {
        let body = "";
        let size = 0;

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error(`OPNsense ${endpoint.key} response was too large`));
            return;
          }
          body += chunk;
        });

        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`OPNsense ${endpoint.key} returned HTTP ${statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`OPNsense ${endpoint.key} returned invalid JSON`));
          }
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`OPNsense ${endpoint.key} timed out after ${REQUEST_TIMEOUT_MS} ms`));
    });

    request.on("error", (error) => reject(error));
    request.end();
  });
}

async function optionalJson(config: ConfiguredOpnsenseEnv, endpoint: OpnsenseEndpoint): Promise<{ data: unknown | null; error: string | null }> {
  try {
    return { data: await requestJson(config, endpoint), error: null };
  } catch (error) {
    return { data: null, error: sanitizeIntegrationError(error) };
  }
}

function parseSystemSnapshot(
  info: unknown,
  resources: unknown,
  disk: unknown,
  temperature: unknown,
  firmwareInfo: unknown,
  firmwareRunning: unknown
): OpnsenseSnapshotDto["system"] {
  const cpu = valueFor(resources, ["cpu", "cpu_usage", "processor"]) ?? resources;
  const memory = valueFor(resources, ["memory", "mem", "ram"]) ?? resources;
  const swap = valueFor(resources, ["swap"]) ?? resources;
  const diskRecord = valueFor(disk, ["disk", "root", "system_disk", "filesystem"]) ?? disk;

  return {
    hostname: findFirstString(info, ["hostname", "fqdn", "name", "host"]),
    version: findFirstString(firmwareInfo, ["product_version", "productVersion", "version"]) ??
      findFirstString(info, ["version", "product_version"]),
    uptime: findFirstString(info, ["uptime"]) ?? findFirstString(resources, ["uptime"]),
    cpuPercent: clampPercent(firstNumber(cpu, ["percent", "usage", "used", "total", "cpu"]) ?? findFirstNumber(resources, ["cpuPercent", "cpu_usage"])),
    memoryPercent: clampPercent(firstNumber(memory, ["percent", "used_percent", "usage"]) ?? findFirstNumber(resources, ["memoryPercent", "mem"])),
    diskPercent: clampPercent(firstNumber(diskRecord, ["percent", "used_percent", "usage"]) ?? findFirstNumber(disk, ["diskPercent", "used_percent"])),
    swapPercent: clampPercent(firstNumber(swap, ["percent", "used_percent", "usage"]) ?? findFirstNumber(resources, ["swapPercent"])),
    temperatureC: roundMetric(findFirstNumber(temperature, ["temperature", "temperatureC", "temp", "cpu_temp", "value"])),
  };
}

function parseFirmware(info: unknown, running: unknown): OpnsenseSnapshotDto["firmware"] {
  const updateAvailableRaw = findFirstValue(info, ["updateAvailable", "updates", "upgrade", "needsUpdate"]);
  const needsRebootRaw = findFirstValue(info, ["needsReboot", "reboot", "rebootRequired"]);

  return {
    product: findFirstString(info, ["product", "productName", "name"]),
    version: findFirstString(info, ["product_version", "productVersion", "version"]),
    runningVersion: findFirstString(running, ["version", "product_version", "runningVersion"]),
    latestVersion: findFirstString(info, ["latest", "latestVersion", "newVersion"]),
    updateAvailable: booleanValue(updateAvailableRaw) ?? null,
    needsReboot: booleanValue(needsRebootRaw) ?? null
  };
}

function parseFirewall(pfStatistics: unknown, firewallLog: unknown): OpnsenseSnapshotDto["firewall"] {
  const logRows = rowsFrom(firewallLog, ["rows", "logs", "items"]);
  return {
    stateCount: findFirstNumber(pfStatistics, ["states", "stateCount", "current", "entries"]),
    srcNodes: findFirstNumber(pfStatistics, ["srcNodes", "sourceNodes", "src_nodes"]),
    fragmentCount: findFirstNumber(pfStatistics, ["fragments", "fragmentCount"]),
    logEntries: logRows.length > 0 ? logRows.length : null
  };
}

function parseGateways(raw: unknown): OpnsenseGatewayDto[] {
  return rowsFrom(raw, ["rows", "gateways", "items"]).map((row, index) => {
    const name = firstString(row, ["name", "descr", "description", "gateway"]) ?? row.__key ?? `Gateway ${index + 1}`;
    const loss = firstNumber(row, ["loss", "lossPercent", "loss_percentage"]);

    return {
      id: `gateway-${slug(name)}`,
      name,
      status: statusValue(firstString(row, ["status", "status_translated", "monitor_status"])),
      address: firstString(row, ["gateway", "address", "ip", "monitor"]),
      interfaceName: firstString(row, ["interface", "if", "ifname"]),
      delayMs: roundMetric(firstNumber(row, ["delay", "rtt", "latency", "avgDelay"])),
      lossPercent: clampPercent(loss),
      description: firstString(row, ["descr", "description"])
    };
  });
}

function interfaceStatsFor(
  stats: Array<Record<string, unknown> & { __key?: string }>,
  iface: Record<string, unknown> & { __key?: string }
): Record<string, unknown> {
  const keys = [
    firstString(iface, ["identifier", "if", "ifname", "device", "name"]),
    iface.__key
  ].filter((value): value is string => Boolean(value));

  return stats.find((candidate) => {
    const candidateKeys = [
      firstString(candidate, ["identifier", "if", "ifname", "device", "name", "interface"]),
      candidate.__key
    ].filter((value): value is string => Boolean(value));
    return candidateKeys.some((candidateKey) => keys.some((key) => candidateKey === key));
  }) ?? {};
}

function parseInterfaces(infoRaw: unknown, statsRaw: unknown): OpnsenseInterfaceDto[] {
  const stats = rowsFrom(statsRaw, ["rows", "interfaces", "statistics", "items"]);
  return rowsFrom(infoRaw, ["rows", "interfaces", "items"]).map((row, index) => {
    const statsRow = interfaceStatsFor(stats, row);
    const identifier = firstString(row, ["identifier", "if", "ifname"]) ?? row.__key ?? null;
    const device = firstString(row, ["device", "interface", "name"]);
    const name = firstString(row, ["description", "descr", "name"]) ?? identifier ?? device ?? `Interface ${index + 1}`;

    return {
      id: `interface-${slug(identifier ?? device ?? name)}`,
      name,
      identifier,
      device,
      status: statusValue(firstString(row, ["status", "link_state", "linkStatus", "enable"])),
      ipv4: firstString(row, ["ipv4", "ipaddr", "ip", "address"]),
      ipv6: firstString(row, ["ipv6", "ipaddrv6"]),
      mac: firstString(row, ["mac", "macaddr", "hwaddr"]),
      receivedBytesPerSec: firstNumber(statsRow, ["bytes_recv_rate_per_sec", "rx_rate", "inbytesrate", "rate_bits_in", "receivedBytesPerSec"]),
      sentBytesPerSec: firstNumber(statsRow, ["bytes_sent_rate_per_sec", "tx_rate", "outbytesrate", "rate_bits_out", "sentBytesPerSec"]),
      bytesReceived: firstNumber(statsRow, ["bytes_recv", "inbytes", "bytesReceived", "rx"]),
      bytesSent: firstNumber(statsRow, ["bytes_sent", "outbytes", "bytesSent", "tx"])
    };
  });
}

function createImportSuggestions(config: ConfiguredOpnsenseEnv, snapshot: Omit<OpnsenseSnapshotDto, "importSuggestions">): OpnsenseImportSuggestionDto[] {
  const suggestions: OpnsenseImportSuggestionDto[] = [{
    id: "opnsense-firewall",
    name: `${config.name} Firewall`,
    kind: "server",
    url: config.baseUrl,
    host: snapshot.system.hostname,
    description: "OPNsense firewall web console.",
    icon: "opnsense",
    color: OPNSENSE_ORANGE,
    source: "firewall"
  }];

  for (const gateway of snapshot.gateways) {
    suggestions.push({
      id: `opnsense-${gateway.id}`,
      name: `${gateway.name} gateway`,
      kind: "server",
      url: null,
      host: gateway.address,
      description: gateway.description ?? `OPNsense gateway${gateway.interfaceName ? ` on ${gateway.interfaceName}` : ""}.`,
      icon: "opnsense",
      color: OPNSENSE_ORANGE,
      source: "gateway"
    });
  }

  for (const iface of snapshot.interfaces) {
    suggestions.push({
      id: `opnsense-${iface.id}`,
      name: `${iface.name} interface`,
      kind: "other",
      url: null,
      host: iface.ipv4,
      description: `OPNsense interface${iface.device ? ` ${iface.device}` : ""}.`,
      icon: "opnsense",
      color: OPNSENSE_ORANGE,
      source: "interface"
    });
  }

  return suggestions.filter((suggestion, index, list) =>
    list.findIndex((item) => item.id === suggestion.id) === index
  );
}

export async function collectOpnsenseSnapshot(config: ConfiguredOpnsenseEnv): Promise<OpnsenseOutcome> {
  try {
    const [systemInformation, systemResources] = await Promise.all([
      requestJson(config, ENDPOINTS.systemInformation),
      requestJson(config, ENDPOINTS.systemResources)
    ]);

    const optional = await Promise.all([
      optionalJson(config, ENDPOINTS.systemDisk),
      optionalJson(config, ENDPOINTS.systemTemperature),
      optionalJson(config, ENDPOINTS.interfacesInfo),
      optionalJson(config, ENDPOINTS.interfaceStatistics),
      optionalJson(config, ENDPOINTS.gateways),
      optionalJson(config, ENDPOINTS.firmwareInfo),
      optionalJson(config, ENDPOINTS.firmwareRunning),
      optionalJson(config, ENDPOINTS.pfStatistics),
      optionalJson(config, ENDPOINTS.firewallLog)
    ]);
    const [
      systemDisk,
      systemTemperature,
      interfacesInfo,
      interfaceStatistics,
      gateways,
      firmwareInfo,
      firmwareRunning,
      pfStatistics,
      firewallLog
    ] = optional;
    const warnings = optional.map((item) => item.error).filter((item): item is string => Boolean(item));

    const snapshotBase: Omit<OpnsenseSnapshotDto, "importSuggestions"> = {
      provider: OPNSENSE_PROVIDER,
      status: "online",
      sampledAt: new Date().toISOString(),
      warnings,
      system: parseSystemSnapshot(
        systemInformation,
        systemResources,
        systemDisk.data,
        systemTemperature.data,
        firmwareInfo.data,
        firmwareRunning.data
      ),
      firmware: parseFirmware(firmwareInfo.data, firmwareRunning.data),
      firewall: parseFirewall(pfStatistics.data, firewallLog.data),
      gateways: parseGateways(gateways.data),
      interfaces: parseInterfaces(interfacesInfo.data, interfaceStatistics.data)
    };

    return {
      status: "online",
      snapshot: {
        ...snapshotBase,
        importSuggestions: createImportSuggestions(config, snapshotBase)
      }
    };
  } catch (error) {
    return {
      status: "offline",
      error: sanitizeIntegrationError(error)
    };
  }
}

function emptyLatestIntegrationState() {
  return {
    status: "unknown",
    latestError: null,
    latestSnapshot: Prisma.JsonNull,
    latestSampledAt: null
  } as const;
}

export async function syncConfiguredIntegrationSources(
  prisma: PrismaClient,
  config: OpnsenseEnvConfig
): Promise<IntegrationSource | null> {
  const existing = await prisma.integrationSource.findFirst({
    where: { provider: OPNSENSE_PROVIDER },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });

  if (!isOpnsenseConfigured(config)) {
    if (existing?.enabled) {
      return prisma.integrationSource.update({
        where: { id: existing.id },
        data: { enabled: false }
      });
    }
    return existing ?? null;
  }

  if (!existing) {
    return prisma.integrationSource.create({
      data: {
        provider: OPNSENSE_PROVIDER,
        name: config.name,
        baseUrl: config.baseUrl,
        enabled: true
      }
    });
  }

  const moved = existing.baseUrl !== config.baseUrl;
  return prisma.$transaction(async (tx) => {
    const source = await tx.integrationSource.update({
      where: { id: existing.id },
      data: {
        provider: OPNSENSE_PROVIDER,
        name: config.name,
        baseUrl: config.baseUrl,
        enabled: true,
        ...(moved ? emptyLatestIntegrationState() : {})
      }
    });

    if (moved) {
      await tx.integrationSample.deleteMany({ where: { sourceId: existing.id } });
    }

    return source;
  });
}

export async function runIntegrationSample(
  prisma: PrismaClient,
  source: IntegrationSource,
  config: OpnsenseEnvConfig
): Promise<OpnsenseOutcome> {
  if (source.provider !== OPNSENSE_PROVIDER || !isOpnsenseConfigured(config)) {
    return { status: "offline", error: "OPNsense integration is not configured" };
  }

  const outcome = await collectOpnsenseSnapshot(config);
  const sampledAt = new Date();
  const snapshotJson = outcome.snapshot
    ? outcome.snapshot as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull;

  await prisma.$transaction(async (tx) => {
    await tx.integrationSample.create({
      data: {
        sourceId: source.id,
        status: outcome.status,
        error: outcome.error ?? null,
        snapshot: snapshotJson
      }
    });

    await tx.integrationSource.update({
      where: { id: source.id },
      data: {
        status: outcome.status,
        latestError: outcome.error ?? null,
        latestSnapshot: snapshotJson,
        latestSampledAt: sampledAt
      }
    });

    const stale = await tx.integrationSample.findMany({
      where: { sourceId: source.id },
      orderBy: { sampledAt: "desc" },
      skip: INTEGRATION_SAMPLE_RETENTION,
      select: { id: true }
    });

    if (stale.length > 0) {
      await tx.integrationSample.deleteMany({
        where: { id: { in: stale.map((sample) => sample.id) } }
      });
    }
  });

  return outcome;
}

function snapshotFromJson(value: Prisma.JsonValue | null): OpnsenseSnapshotDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as unknown as OpnsenseSnapshotDto;
}

export function toIntegrationSourceDto(source: IntegrationSourceWithSamples): IntegrationSourceDto {
  return {
    id: source.id,
    provider: source.provider as IntegrationSourceDto["provider"],
    name: source.name,
    baseUrl: source.baseUrl,
    enabled: source.enabled,
    status: source.status as HealthStatus,
    latestError: source.latestError,
    latestSnapshot: snapshotFromJson(source.latestSnapshot),
    latestSampledAt: source.latestSampledAt?.toISOString() ?? null,
    sortOrder: source.sortOrder,
    samples: source.samples?.map((sample) => ({
      id: sample.id,
      sourceId: sample.sourceId,
      status: sample.status as HealthStatus,
      error: sample.error,
      snapshot: snapshotFromJson(sample.snapshot),
      sampledAt: sample.sampledAt.toISOString()
    }))
  };
}

export function startIntegrationScheduler(
  prisma: PrismaClient,
  config: OpnsenseEnvConfig,
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
      const source = await syncConfiguredIntegrationSources(prisma, config);
      const now = Date.now();
      const due = source && isOpnsenseConfigured(config) && source.enabled && (
        !source.latestSampledAt ||
        now - source.latestSampledAt.getTime() >= config.pollIntervalSeconds * 1000
      )
        ? [source]
        : [];

      observer?.({ lastDueCount: due.length });
      await Promise.allSettled(due.map((item) => runIntegrationSample(prisma, item, config)));
      observer?.({
        running: false,
        lastCompletedAt: new Date(),
        lastDurationMs: Date.now() - startedAt,
        lastError: null
      });
    } catch (error) {
      observer?.({
        running: false,
        lastCompletedAt: new Date(),
        lastDurationMs: Date.now() - startedAt,
        lastError: sanitizeIntegrationError(error)
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  return () => clearInterval(timer);
}
