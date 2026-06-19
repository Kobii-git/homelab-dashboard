import type { HostMetricSample, HostMonitor, PrismaClient } from "@prisma/client";
import type { HostMonitorDto } from "../shared/types.js";

const SAMPLE_RETENTION = 1440;
const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5000;

type GlancesOutcome = {
  status: "online" | "offline";
  error?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  diskPercent?: number;
  diskUsedBytes?: number;
  diskTotalBytes?: number;
  networkRxBytesPerSec?: number;
  networkTxBytesPerSec?: number;
  temperatureC?: number;
  containersRunning?: number;
  containersTotal?: number;
};

type HostMonitorWithSamples = HostMonitor & {
  samples?: HostMetricSample[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function glancesUrl(baseUrl: string, endpoint: string): string {
  const normalized = normalizedBaseUrl(baseUrl);
  const url = new URL(normalized);
  const path = url.pathname.replace(/\/+$/, "");
  const apiRoot = /\/api\/\d+$/i.test(path) ? path : `${path}/api/4`;
  return `${url.origin}${apiRoot}${endpoint}`;
}

async function fetchJson(baseUrl: string, endpoint: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(glancesUrl(baseUrl, endpoint), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Glances ${endpoint} returned HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function optionalFetch(baseUrl: string, endpoint: string): Promise<unknown | null> {
  try {
    return await fetchJson(baseUrl, endpoint);
  } catch {
    return null;
  }
}

function pickFilesystem(raw: unknown, primaryMount: string): Record<string, unknown> {
  const filesystems = asArray(raw).map(asRecord);
  const wanted = primaryMount.trim() || "/";
  return filesystems.find((item) => {
    const mount = stringValue(item.mnt_point) ?? stringValue(item.mount_point) ?? stringValue(item.mountpoint);
    return mount === wanted;
  }) ?? filesystems[0] ?? {};
}

function parseFilesystem(raw: unknown, primaryMount: string): Pick<
  GlancesOutcome,
  "diskPercent" | "diskUsedBytes" | "diskTotalBytes"
> {
  const fs = pickFilesystem(raw, primaryMount);
  const total = firstNumber(fs, ["size", "total"]);
  const used = firstNumber(fs, ["used"]);
  const percent = clampPercent(firstNumber(fs, ["percent", "used_percent"]));

  return {
    diskPercent: percent ?? (total && used !== undefined ? clampPercent((used / total) * 100) : undefined),
    diskUsedBytes: used,
    diskTotalBytes: total
  };
}

function pickNetwork(raw: unknown, networkInterface: string | null): Record<string, unknown> {
  const interfaces = asArray(raw).map(asRecord);
  if (networkInterface) {
    const wanted = networkInterface.trim();
    const match = interfaces.find((item) => {
      const name = stringValue(item.interface_name) ?? stringValue(item.name) ?? stringValue(item.key);
      return name === wanted;
    });
    if (match) {
      return match;
    }
  }

  return interfaces.find((item) => {
    const name = stringValue(item.interface_name) ?? stringValue(item.name) ?? stringValue(item.key) ?? "";
    return name !== "lo" && name !== "lo0";
  }) ?? interfaces[0] ?? {};
}

function parseNetwork(raw: unknown, networkInterface: string | null): Pick<
  GlancesOutcome,
  "networkRxBytesPerSec" | "networkTxBytesPerSec"
> {
  const network = pickNetwork(raw, networkInterface);
  return {
    networkRxBytesPerSec: firstNumber(network, ["rx", "bytes_recv_rate", "rx_rate", "download", "cumulative_rx"]),
    networkTxBytesPerSec: firstNumber(network, ["tx", "bytes_sent_rate", "tx_rate", "upload", "cumulative_tx"])
  };
}

function parseContainers(raw: unknown): Pick<GlancesOutcome, "containersRunning" | "containersTotal"> {
  const containers = asArray(raw).map(asRecord);
  const running = containers.filter((container) => {
    const status = `${stringValue(container.status) ?? ""} ${stringValue(container.state) ?? ""}`.toLowerCase();
    return status.includes("running") || status.includes("up");
  }).length;

  return {
    containersRunning: containers.length > 0 ? running : undefined,
    containersTotal: containers.length > 0 ? containers.length : undefined
  };
}

function parseTemperature(raw: Record<string, unknown>): number | undefined {
  const direct = firstNumber(raw, ["temperature", "temperatureC", "temp", "cpu_temp"]);
  if (direct !== undefined) {
    return Math.round(direct * 10) / 10;
  }

  const sensors = asArray(raw.sensors).map(asRecord);
  const sensor = sensors.find((item) => firstNumber(item, ["value", "temperature", "current"]) !== undefined);
  const value = sensor ? firstNumber(sensor, ["value", "temperature", "current"]) : undefined;
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

async function collectGlancesMetrics(monitor: Pick<
  HostMonitor,
  "baseUrl" | "primaryMount" | "networkInterface"
>): Promise<GlancesOutcome> {
  try {
    const [quicklookRaw, memRaw] = await Promise.all([
      fetchJson(monitor.baseUrl, "/quicklook"),
      fetchJson(monitor.baseUrl, "/mem")
    ]);
    const [fsRaw, networkRaw, containersRaw] = await Promise.all([
      optionalFetch(monitor.baseUrl, "/fs"),
      optionalFetch(monitor.baseUrl, "/network"),
      optionalFetch(monitor.baseUrl, "/containers")
    ]);

    const quicklook = asRecord(quicklookRaw);
    const mem = asRecord(memRaw);
    const memoryTotal = firstNumber(mem, ["total"]);
    const memoryUsed = firstNumber(mem, ["used"]);
    const memoryPercent = clampPercent(firstNumber(mem, ["percent"]) ?? numberValue(quicklook.mem));

    return {
      status: "online",
      cpuPercent: clampPercent(firstNumber(quicklook, ["cpu", "total"])),
      memoryPercent: memoryPercent ?? (memoryTotal && memoryUsed !== undefined ? clampPercent((memoryUsed / memoryTotal) * 100) : undefined),
      memoryUsedBytes: memoryUsed,
      memoryTotalBytes: memoryTotal,
      ...(fsRaw ? parseFilesystem(fsRaw, monitor.primaryMount) : {}),
      ...(networkRaw ? parseNetwork(networkRaw, monitor.networkInterface) : {}),
      ...(containersRaw ? parseContainers(containersRaw) : {}),
      temperatureC: parseTemperature(quicklook)
    };
  } catch (error) {
    return {
      status: "offline",
      error: error instanceof Error ? error.message : "Glances metrics fetch failed"
    };
  }
}

export async function runHostMetricSample(
  prisma: PrismaClient,
  monitor: HostMonitor
): Promise<GlancesOutcome> {
  const outcome = await collectGlancesMetrics(monitor);

  await prisma.$transaction(async (tx) => {
    await tx.hostMetricSample.create({
      data: {
        monitorId: monitor.id,
        status: outcome.status,
        error: outcome.error,
        cpuPercent: outcome.cpuPercent,
        memoryPercent: outcome.memoryPercent,
        memoryUsedBytes: outcome.memoryUsedBytes,
        memoryTotalBytes: outcome.memoryTotalBytes,
        diskPercent: outcome.diskPercent,
        diskUsedBytes: outcome.diskUsedBytes,
        diskTotalBytes: outcome.diskTotalBytes,
        networkRxBytesPerSec: outcome.networkRxBytesPerSec,
        networkTxBytesPerSec: outcome.networkTxBytesPerSec,
        temperatureC: outcome.temperatureC,
        containersRunning: outcome.containersRunning,
        containersTotal: outcome.containersTotal
      }
    });

    await tx.hostMonitor.update({
      where: { id: monitor.id },
      data: {
        latestStatus: outcome.status,
        latestError: outcome.error ?? null,
        latestSampledAt: new Date(),
        latestCpuPercent: outcome.cpuPercent,
        latestMemoryPercent: outcome.memoryPercent,
        latestMemoryUsedBytes: outcome.memoryUsedBytes,
        latestMemoryTotalBytes: outcome.memoryTotalBytes,
        latestDiskPercent: outcome.diskPercent,
        latestDiskUsedBytes: outcome.diskUsedBytes,
        latestDiskTotalBytes: outcome.diskTotalBytes,
        latestNetworkRxBytesPerSec: outcome.networkRxBytesPerSec,
        latestNetworkTxBytesPerSec: outcome.networkTxBytesPerSec,
        latestTemperatureC: outcome.temperatureC,
        latestContainersRunning: outcome.containersRunning,
        latestContainersTotal: outcome.containersTotal
      }
    });

    const stale = await tx.hostMetricSample.findMany({
      where: { monitorId: monitor.id },
      orderBy: { sampledAt: "desc" },
      skip: SAMPLE_RETENTION,
      select: { id: true }
    });

    if (stale.length > 0) {
      await tx.hostMetricSample.deleteMany({
        where: { id: { in: stale.map((sample) => sample.id) } }
      });
    }
  });

  return outcome;
}

export function startMetricsScheduler(
  prisma: PrismaClient,
  intervalMs = 15_000,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS
): () => void {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const monitors = await prisma.hostMonitor.findMany({ where: { enabled: true } });
      const now = Date.now();
      const due = monitors.filter((monitor) => {
        if (!monitor.latestSampledAt) {
          return true;
        }
        return now - monitor.latestSampledAt.getTime() >= sampleIntervalMs;
      });

      await Promise.allSettled(due.map((monitor) => runHostMetricSample(prisma, monitor)));
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

export function toHostMonitorDto(monitor: HostMonitorWithSamples): HostMonitorDto {
  return {
    id: monitor.id,
    name: monitor.name,
    baseUrl: monitor.baseUrl,
    enabled: monitor.enabled,
    sortOrder: monitor.sortOrder,
    primaryMount: monitor.primaryMount,
    networkInterface: monitor.networkInterface,
    latestStatus: monitor.latestStatus as HostMonitorDto["latestStatus"],
    latestError: monitor.latestError,
    latestSampledAt: monitor.latestSampledAt?.toISOString() ?? null,
    latestCpuPercent: monitor.latestCpuPercent,
    latestMemoryPercent: monitor.latestMemoryPercent,
    latestMemoryUsedBytes: monitor.latestMemoryUsedBytes,
    latestMemoryTotalBytes: monitor.latestMemoryTotalBytes,
    latestDiskPercent: monitor.latestDiskPercent,
    latestDiskUsedBytes: monitor.latestDiskUsedBytes,
    latestDiskTotalBytes: monitor.latestDiskTotalBytes,
    latestNetworkRxBytesPerSec: monitor.latestNetworkRxBytesPerSec,
    latestNetworkTxBytesPerSec: monitor.latestNetworkTxBytesPerSec,
    latestTemperatureC: monitor.latestTemperatureC,
    latestContainersRunning: monitor.latestContainersRunning,
    latestContainersTotal: monitor.latestContainersTotal,
    samples: monitor.samples?.map((sample) => ({
      id: sample.id,
      monitorId: sample.monitorId,
      status: sample.status as HostMonitorDto["latestStatus"],
      error: sample.error,
      cpuPercent: sample.cpuPercent,
      memoryPercent: sample.memoryPercent,
      memoryUsedBytes: sample.memoryUsedBytes,
      memoryTotalBytes: sample.memoryTotalBytes,
      diskPercent: sample.diskPercent,
      diskUsedBytes: sample.diskUsedBytes,
      diskTotalBytes: sample.diskTotalBytes,
      networkRxBytesPerSec: sample.networkRxBytesPerSec,
      networkTxBytesPerSec: sample.networkTxBytesPerSec,
      temperatureC: sample.temperatureC,
      containersRunning: sample.containersRunning,
      containersTotal: sample.containersTotal,
      sampledAt: sample.sampledAt.toISOString()
    }))
  };
}

export { SAMPLE_RETENTION };
