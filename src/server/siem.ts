import net from "node:net";
import os from "node:os";
import tls from "node:tls";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { resolveOutboundTarget } from "./outboundPolicy.js";

const CONFIG_KEY = "siem_auth_v1";
const MAX_QUEUE = 256;
const SEND_TIMEOUT_MS = 3_000;
const hostname = os.hostname().replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 80) || "homelab-dashboard";

const destinationSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253).regex(/^[A-Za-z0-9.:[\]-]*$/, "Use a hostname or IP address"),
  port: z.number().int().min(1).max(65535),
  transport: z.enum(["tcp", "tls"])
}).strict().refine(value => !value.enabled || value.host.length > 0, "Host is required when enabled");

export const siemConfigSchema = z.object({
  wazuh: destinationSchema.safeExtend({ transport: z.literal("tcp") }),
  sentinel: destinationSchema
}).strict();

export type SiemConfig = z.infer<typeof siemConfigSchema>;
type DestinationName = keyof SiemConfig;
type SecurityEvent = {
  id: string;
  timestamp: string;
  product: "homelab-dashboard";
  event: string;
  result: "success" | "failure";
  account: "admin";
  clientIp: string;
  objectType?: string;
  objectId?: string;
};

export const DEFAULT_SIEM_CONFIG: SiemConfig = {
  wazuh: { enabled: false, host: "", port: 514, transport: "tcp" },
  sentinel: { enabled: false, host: "", port: 514, transport: "tcp" }
};

function parseStoredConfig(value: string | null | undefined): SiemConfig {
  if (!value) return DEFAULT_SIEM_CONFIG;
  try { return siemConfigSchema.parse(JSON.parse(value)); }
  catch { return DEFAULT_SIEM_CONFIG; }
}

export async function readSiemConfig(prisma: Pick<PrismaClient, "systemConfig">): Promise<SiemConfig> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  return parseStoredConfig(row?.value);
}

export async function saveSiemConfig(prisma: Pick<PrismaClient, "systemConfig">, input: unknown): Promise<SiemConfig> {
  const config = siemConfigSchema.parse(input);
  for (const destination of Object.values(config)) {
    if (destination.enabled) {
      try { await resolveOutboundTarget(destination.host, { timeoutMs: SEND_TIMEOUT_MS }); }
      catch { throw new SiemDestinationError(); }
    }
  }
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) }
  });
  return config;
}

export class SiemDestinationError extends Error {}

function syslogMessage(event: SecurityEvent): string {
  const date = new Date(event.timestamp);
  const [day, month, , time] = date.toUTCString().slice(5).split(" ");
  const stamp = `${month} ${day.padStart(2, " ")} ${time}`;
  const severity = event.result === "failure" ? 4 : 6;
  return `<${16 * 8 + severity}>${stamp} ${hostname} homelab-dashboard: ${JSON.stringify(event)}\n`;
}

export async function sendSyslog(destination: SiemConfig[DestinationName], event: SecurityEvent): Promise<void> {
  const resolved = await resolveOutboundTarget(destination.host, { timeoutMs: SEND_TIMEOUT_MS });
  const payload = syslogMessage(event);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = destination.transport === "tls"
      ? tls.connect({ host: resolved.address, port: destination.port,
          servername: net.isIP(destination.host) ? undefined : destination.host, rejectUnauthorized: true })
      : net.createConnection({ host: resolved.address, family: resolved.family, port: destination.port });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(SEND_TIMEOUT_MS, () => finish(new Error("SIEM delivery timed out")));
    socket.once("error", finish);
    socket.once(destination.transport === "tls" ? "secureConnect" : "connect", () => {
      socket.write(payload, error => finish(error ?? undefined));
    });
  });
}

export class SiemForwarder {
  private config: SiemConfig = DEFAULT_SIEM_CONFIG;
  private queue: Array<{ destination: DestinationName; config: SiemConfig[DestinationName]; event: SecurityEvent }> = [];
  private sending = false;
  private closed = false;
  private delivery: Record<DestinationName, { sent: number; failed: number; dropped: number; lastSentAt: string | null; lastFailureAt: string | null }> = {
    wazuh: { sent: 0, failed: 0, dropped: 0, lastSentAt: null, lastFailureAt: null },
    sentinel: { sent: 0, failed: 0, dropped: 0, lastSentAt: null, lastFailureAt: null }
  };

  constructor(private readonly send: typeof sendSyslog = sendSyslog) {}

  configure(config: SiemConfig): void {
    this.queue = this.queue.filter(item => {
      const keep = JSON.stringify(item.config) === JSON.stringify(config[item.destination]);
      if (!keep) this.delivery[item.destination].dropped++;
      return keep;
    });
    this.config = config;
  }
  status() { return { config: this.config, delivery: this.delivery, queued: this.queue.length }; }

  record(event: Omit<SecurityEvent, "id" | "timestamp" | "product" | "account">): void {
    if (this.closed) return;
    const record: SecurityEvent = {
      id: crypto.randomUUID(), timestamp: new Date().toISOString(), product: "homelab-dashboard", account: "admin", ...event
    };
    for (const destination of (["wazuh", "sentinel"] as const)) {
      if (!this.config[destination].enabled) continue;
      if (this.queue.length >= MAX_QUEUE) { this.delivery[destination].dropped++; continue; }
      this.queue.push({ destination, config: { ...this.config[destination] }, event: record });
    }
    void this.drain();
  }

  async test(destination: DestinationName): Promise<void> {
    const config = this.config[destination];
    if (!config.enabled) throw new Error("SIEM destination is disabled");
    try {
      await this.send(config, {
        id: crypto.randomUUID(), timestamp: new Date().toISOString(), product: "homelab-dashboard",
        event: "siem.test", result: "success", account: "admin", clientIp: "unknown"
      });
      this.delivery[destination].sent++;
      this.delivery[destination].lastSentAt = new Date().toISOString();
    } catch (error) {
      this.delivery[destination].failed++;
      this.delivery[destination].lastFailureAt = new Date().toISOString();
      throw error;
    }
  }

  private async drain(): Promise<void> {
    if (this.sending || this.closed) return;
    this.sending = true;
    try {
      while (!this.closed && this.queue.length > 0) {
        const item = this.queue.shift()!;
        try {
          await this.send(item.config, item.event);
          this.delivery[item.destination].sent++;
          this.delivery[item.destination].lastSentAt = new Date().toISOString();
        } catch {
          this.delivery[item.destination].failed++;
          this.delivery[item.destination].lastFailureAt = new Date().toISOString();
        }
      }
    } finally { this.sending = false; }
  }

  close(): void { this.closed = true; this.queue.length = 0; }
}
