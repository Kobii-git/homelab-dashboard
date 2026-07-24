import { execFile } from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { promisify } from "node:util";
import type { HealthCheck, PrismaClient } from "@prisma/client";
import { checkSslCertificate } from "./connectivity.js";
import { resolveOutboundTarget } from "./outboundPolicy.js";

const execFileAsync = promisify(execFile);

type CheckOutcome = {
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
};

export type SchedulerUpdate = {
  running?: boolean;
  lastTickAt?: Date;
  lastCompletedAt?: Date;
  lastError?: string | null;
  lastDueCount?: number;
  lastDurationMs?: number;
  skippedTickAt?: Date;
};

type SchedulerObserver = (update: SchedulerUpdate) => void;

function elapsedSince(startedAt: number): number {
  return Math.max(1, Date.now() - startedAt);
}

async function checkHttp(target: string, timeoutMs: number): Promise<CheckOutcome> {
  const startedAt = Date.now();
  try {
    const url = new URL(target);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("HTTP check URL must use HTTP or HTTPS without embedded credentials");
    }
    const resolved = await resolveOutboundTarget(url.hostname);
    const transport = url.protocol === "https:" ? https : http;
    return await new Promise<CheckOutcome>((resolve) => {
      let settled = false;
      let timeout: NodeJS.Timeout;
      const finish = (outcome: CheckOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        request.destroy();
        resolve(outcome);
      };
      const request = transport.request(url, {
        method: "GET",
        lookup: resolved.lookup,
        maxHeaderSize: 16 * 1024,
        rejectUnauthorized: true
      }, (response) => {
        const online = (response.statusCode ?? 500) < 500;
        response.destroy();
        finish({
          status: online ? "online" : "offline",
          latencyMs: elapsedSince(startedAt),
          error: online ? undefined : `HTTP ${response.statusCode ?? 500}`
        });
      });
      timeout = setTimeout(() => finish({
        status: "offline",
        latencyMs: elapsedSince(startedAt),
        error: "Timeout"
      }), timeoutMs);
      request.once("error", (error) => finish({
        status: "offline",
        latencyMs: elapsedSince(startedAt),
        error: error.message
      }));
      request.end();
    });
  } catch (error) {
    return {
      status: "offline",
      latencyMs: elapsedSince(startedAt),
      error: error instanceof Error ? error.message : "HTTP check failed"
    };
  }
}

function parseTcpTarget(target: string): { host: string; port: number } {
  const url = new URL(target.includes("://") ? target : `tcp://${target}`);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : url.protocol === "http:" ? 80 : 0));
  if (url.username || url.password || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("TCP target must be host:port or a URL");
  }
  return { host: url.hostname, port };
}

async function checkTcp(target: string, timeoutMs: number): Promise<CheckOutcome> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let host: string;
    let port: number;

    try {
      ({ host, port } = parseTcpTarget(target));
    } catch (error) {
      resolve({
        status: "offline",
        latencyMs: elapsedSince(startedAt),
        error: error instanceof Error ? error.message : "Invalid TCP target"
      });
      return;
    }

    let socket: net.Socket;

    const finish = (outcome: CheckOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      socket?.destroy();
      resolve(outcome);
    };
    void resolveOutboundTarget(host).then((resolved) => {
      socket = net.createConnection({ host: resolved.address, family: resolved.family, port });
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish({ status: "online", latencyMs: elapsedSince(startedAt) }));
      socket.once("timeout", () => finish({ status: "offline", latencyMs: elapsedSince(startedAt), error: "Timeout" }));
      socket.once("error", (error) => finish({
        status: "offline",
        latencyMs: elapsedSince(startedAt),
        error: error.message
      }));
    }).catch((error: unknown) => finish({
      status: "offline",
      latencyMs: elapsedSince(startedAt),
      error: error instanceof Error ? error.message : "Target resolution failed"
    }));
  });
}

async function checkPing(target: string, timeoutMs: number): Promise<CheckOutcome> {
  const startedAt = Date.now();
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = process.platform === "win32"
    ? ["-n", "1", "-w", String(timeoutMs)]
    : ["-c", "1", "-W", String(timeoutSeconds)];

  try {
    const resolved = await resolveOutboundTarget(target);
    await execFileAsync("ping", [...args, resolved.address], { timeout: timeoutMs + 500 });
    return { status: "online", latencyMs: elapsedSince(startedAt) };
  } catch (error) {
    return {
      status: "offline",
      latencyMs: elapsedSince(startedAt),
      error: error instanceof Error ? error.message : "Ping failed"
    };
  }
}

async function applyHealthOutcome(
  prisma: PrismaClient,
  check: HealthCheck,
  outcome: CheckOutcome
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const currentCheck = await tx.healthCheck.findUnique({
      where: { id: check.id },
      select: {
        type: true,
        target: true,
        enabled: true,
        latestStatus: true,
        consecutiveFailures: true,
        consecutiveSuccesses: true,
        failureThreshold: true,
        successThreshold: true,
        lastTransitionAt: true,
        resource: {
          select: { monitoringMode: true }
        }
      }
    });

    if (
      !currentCheck ||
      !currentCheck.enabled ||
      currentCheck.resource.monitoringMode !== "auto" ||
      currentCheck.type !== check.type ||
      currentCheck.target !== check.target
    ) {
      return;
    }

    await tx.healthResult.create({
      data: {
        checkId: check.id,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        error: outcome.error
      }
    });

    const nextFailures = outcome.status === "offline" ? currentCheck.consecutiveFailures + 1 : 0;
    const nextSuccesses = outcome.status === "online" ? currentCheck.consecutiveSuccesses + 1 : 0;
    const nextStableStatus =
      outcome.status === "offline" && nextFailures >= currentCheck.failureThreshold
        ? "offline"
        : outcome.status === "online" && nextSuccesses >= currentCheck.successThreshold
          ? "online"
          : currentCheck.latestStatus;
    const transitioned = currentCheck.latestStatus !== nextStableStatus;
    const checkedAt = new Date();

    await tx.healthCheck.update({
      where: { id: check.id },
      data: {
        latestStatus: nextStableStatus,
        latestLatencyMs: outcome.latencyMs,
        latestCheckedAt: checkedAt,
        latestError: outcome.error ?? null,
        consecutiveFailures: nextFailures,
        consecutiveSuccesses: nextSuccesses,
        lastTransitionAt: transitioned ? checkedAt : currentCheck.lastTransitionAt
      }
    });

    const stale = await tx.healthResult.findMany({
      where: { checkId: check.id },
      orderBy: { checkedAt: "desc" },
      skip: 300,
      select: { id: true }
    });

    if (stale.length > 0) {
      await tx.healthResult.deleteMany({
        where: { id: { in: stale.map((result) => result.id) } }
      });
    }
  });
}

export async function runHealthCheck(
  prisma: PrismaClient,
  check: HealthCheck
): Promise<CheckOutcome> {
  let outcome: CheckOutcome;

  if (check.type === "http") {
    outcome = await checkHttp(check.target, check.timeoutMs);
  } else if (check.type === "tcp") {
    outcome = await checkTcp(check.target, check.timeoutMs);
  } else if (check.type === "ping") {
    outcome = await checkPing(check.target, check.timeoutMs);
  } else if (check.type === "ssl") {
    outcome = await checkSslCertificate(check.target, check.timeoutMs);
  } else {
    outcome = { status: "offline", error: `Unsupported check type: ${check.type}` };
  }

  await applyHealthOutcome(prisma, check, outcome);

  return outcome;
}

export function startHealthScheduler(
  prisma: PrismaClient,
  intervalMs = 15000,
  observer?: SchedulerObserver
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
      const checks = await prisma.healthCheck.findMany({
        where: {
          enabled: true,
          resource: {
            monitoringMode: "auto"
          }
        }
      });
      const now = Date.now();
      const due = checks.filter((check) => {
        if (!check.latestCheckedAt) {
          return true;
        }

        return now - check.latestCheckedAt.getTime() >= check.intervalSeconds * 1000;
      });

      observer?.({ lastDueCount: due.length });
      for (let index = 0; index < due.length; index += 8) {
        await Promise.allSettled(due.slice(index, index + 8).map((check) => runHealthCheck(prisma, check)));
      }
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
        lastError: error instanceof Error ? error.message : "Health scheduler failed"
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
