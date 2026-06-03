import net from "node:net";
import tls from "node:tls";

export async function testTcpReachable(host: string, port: number, timeoutMs = 3000): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, latencyMs: Math.max(1, Date.now() - startedAt) });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, error: "Connection timed out" }));
    socket.once("error", (error) => finish({ ok: false, error: error.message }));
  });
}

export async function testGuacdReachable(host: string, port: number): Promise<boolean> {
  const result = await testTcpReachable(host, port, 2000);
  return result.ok;
}

function parseSslTarget(target: string): { host: string; port: number; servername: string } {
  if (target.includes("://")) {
    const url = new URL(target);
    return {
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname
    };
  }

  const [host, portValue] = target.split(":");
  if (!host) {
    throw new Error("SSL target must be a URL or host:port");
  }

  return {
    host,
    port: portValue ? Number(portValue) : 443,
    servername: host
  };
}

export async function checkSslCertificate(target: string, timeoutMs: number): Promise<{
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
}> {
  const startedAt = Date.now();

  try {
    const { host, port, servername } = parseSslTarget(target);
    const cert = await new Promise<tls.PeerCertificate>((resolve, reject) => {
      const socket = tls.connect({ host, port, servername, rejectUnauthorized: false }, () => {
        const peer = socket.getPeerCertificate();
        socket.end();
        if (!peer || Object.keys(peer).length === 0) {
          reject(new Error("No certificate returned"));
          return;
        }
        resolve(peer);
      });
      socket.setTimeout(timeoutMs);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Timeout"));
      });
      socket.once("error", reject);
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
