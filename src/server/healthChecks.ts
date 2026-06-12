import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import type { HealthCheck, PrismaClient } from "@prisma/client";
import { checkSslCertificate } from "./connectivity.js";

const execFileAsync = promisify(execFile);

type CheckOutcome = {
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
};

function elapsedSince(startedAt: number): number {
  return Math.max(1, Date.now() - startedAt);
}

async function checkHttp(target: string, timeoutMs: number): Promise<CheckOutcome> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual"
    });

    return {
      status: response.status < 500 ? "online" : "offline",
      latencyMs: elapsedSince(startedAt),
      error: response.status < 500 ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      status: "offline",
      latencyMs: elapsedSince(startedAt),
      error: error instanceof Error ? error.message : "HTTP check failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseTcpTarget(target: string): { host: string; port: number } {
  if (target.includes("://")) {
    const url = new URL(target);
    return {
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80))
    };
  }

  const [host, port] = target.split(":");

  if (!host || !port) {
    throw new Error("TCP target must be host:port or a URL");
  }

  return { host, port: Number(port) };
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

    const socket = net.createConnection({ host, port });

    const finish = (outcome: CheckOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ status: "online", latencyMs: elapsedSince(startedAt) }));
    socket.once("timeout", () => finish({ status: "offline", latencyMs: elapsedSince(startedAt), error: "Timeout" }));
    socket.once("error", (error) => finish({
      status: "offline",
      latencyMs: elapsedSince(startedAt),
      error: error.message
    }));
  });
}

async function checkPing(target: string, timeoutMs: number): Promise<CheckOutcome> {
  const startedAt = Date.now();
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = process.platform === "win32"
    ? ["-n", "1", "-w", String(timeoutMs), target]
    : ["-c", "1", "-W", String(timeoutSeconds), target];

  try {
    await execFileAsync("ping", args, { timeout: timeoutMs + 500 });
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
    await tx.healthResult.create({
      data: {
        checkId: check.id,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        error: outcome.error
      }
    });

    const nextFailures = outcome.status === "offline" ? check.consecutiveFailures + 1 : 0;
    const nextSuccesses = outcome.status === "online" ? check.consecutiveSuccesses + 1 : 0;
    const transitioned = check.latestStatus !== outcome.status;

    await tx.healthCheck.update({
      where: { id: check.id },
      data: {
        latestStatus: outcome.status,
        latestLatencyMs: outcome.latencyMs,
        latestCheckedAt: new Date(),
        latestError: outcome.error ?? null,
        consecutiveFailures: nextFailures,
        consecutiveSuccesses: nextSuccesses,
        lastTransitionAt: transitioned ? new Date() : check.lastTransitionAt
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

export function startHealthScheduler(prisma: PrismaClient, intervalMs = 15000): () => void {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
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

      await Promise.allSettled(due.map((check) => runHealthCheck(prisma, check)));
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
