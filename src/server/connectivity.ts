import net from "node:net";
import tls from "node:tls";
import { resolveOutboundTarget } from "./outboundPolicy.js";

export async function testTcpReachable(host: string, port: number, timeoutMs = 3000): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let socket: net.Socket;

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve({ ...result, latencyMs: Math.max(1, Date.now() - startedAt) });
    };
    void resolveOutboundTarget(host).then((resolved) => {
      socket = net.createConnection({ host: resolved.address, family: resolved.family, port });
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish({ ok: true }));
      socket.once("timeout", () => finish({ ok: false, error: "Connection timed out" }));
      socket.once("error", (error) => finish({ ok: false, error: error.message }));
    }).catch((error: unknown) => finish({
      ok: false,
      error: error instanceof Error ? error.message : "Target resolution failed"
    }));
  });
}

function parseSslTarget(target: string): { host: string; port: number; servername: string } {
  const url = new URL(target.includes("://") ? target : `https://${target}`);
  const port = Number(url.port || 443);
  if (url.username || url.password || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSL target must be a URL or host:port");
  }
  return { host: url.hostname, port, servername: url.hostname };
}

export async function checkSslCertificate(target: string, timeoutMs: number): Promise<{
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
}> {
  const startedAt = Date.now();

  try {
    const { host, port, servername } = parseSslTarget(target);
    const resolved = await resolveOutboundTarget(host, { timeoutMs });
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw new Error("Timeout");
    const cert = await new Promise<tls.PeerCertificate>((resolve, reject) => {
      let settled = false;
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const socket = tls.connect({
        host: resolved.address,
        port,
        servername: net.isIP(servername) ? undefined : servername,
        rejectUnauthorized: true
      }, () => {
        const peer = socket.getPeerCertificate();
        socket.end();
        if (!peer || Object.keys(peer).length === 0) {
          finishReject(new Error("No certificate returned"));
          return;
        }
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(peer);
      });
      const timeout = setTimeout(() => {
        socket.destroy();
        finishReject(new Error("Timeout"));
      }, remainingMs);
      socket.once("error", finishReject);
    });

    const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
    if (!validTo || Number.isNaN(validTo.getTime())) {
      return { status: "offline", latencyMs: Date.now() - startedAt, error: "Invalid certificate expiry" };
    }

    const daysLeft = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) {
      return {
        status: "offline",
        latencyMs: Date.now() - startedAt,
        error: `Certificate expired ${Math.abs(daysLeft)} days ago`
      };
    }

    if (daysLeft < 30) {
      return {
        status: "offline",
        latencyMs: Date.now() - startedAt,
        error: `Certificate expires in ${daysLeft} days`
      };
    }

    return { status: "online", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "offline",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "SSL check failed"
    };
  }
}
