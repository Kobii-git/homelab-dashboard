import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import type { AppEnv } from "./env.js";

type AddressFamily = 4 | 6;

export type ResolvedOutboundTarget = {
  hostname: string;
  address: string;
  family: AddressFamily;
  lookup: LookupFunction;
};

type ParsedCidr = {
  network: bigint;
  prefix: number;
  bits: 32 | 128;
};

type OutboundPolicyState = {
  enforce: boolean;
  allowedCidrs: ParsedCidr[];
  allowedHosts: Set<string>;
  allowInsecureIntegrations: boolean;
};

const FIXED_PROVIDER_HOSTS = new Set([
  "api.github.com",
  "api.open-meteo.com",
  "cdn.jsdelivr.net",
  "geocoding-api.open-meteo.com"
]);
const FIXED_PROVIDER_CONCURRENCY = 4;
const DNS_LOOKUP_TIMEOUT_MS = 3_000;
let fixedProviderActive = 0;
const fixedProviderWaiters: Array<() => void> = [];

let state: OutboundPolicyState = {
  enforce: false,
  allowedCidrs: [],
  allowedHosts: new Set(),
  allowInsecureIntegrations: false
};

function ipv4ToBigInt(address: string): bigint {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error(`Invalid IPv4 address: ${address}`);
  }
  return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6ToBigInt(address: string): bigint {
  const normalized = address.toLowerCase().split("%")[0];
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return (0xffffn << 32n) | ipv4ToBigInt(mapped[1]);

  const halves = normalized.split("::");
  if (halves.length > 2) throw new Error(`Invalid IPv6 address: ${address}`);
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const expandIpv4 = (parts: string[]): string[] => parts.flatMap((part) => {
    if (!part.includes(".")) return [part];
    const value = ipv4ToBigInt(part);
    return [
      Number((value >> 16n) & 0xffffn).toString(16),
      Number(value & 0xffffn).toString(16)
    ];
  });
  const leftParts = expandIpv4(left);
  const rightParts = expandIpv4(right);
  const missing = 8 - leftParts.length - rightParts.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) throw new Error(`Invalid IPv6 address: ${address}`);
  const parts = halves.length === 2
    ? [...leftParts, ...Array.from({ length: missing }, () => "0"), ...rightParts]
    : leftParts;
  if (parts.length !== 8) throw new Error(`Invalid IPv6 address: ${address}`);
  return parts.reduce((value, part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) throw new Error(`Invalid IPv6 address: ${address}`);
    return (value << 16n) | BigInt(`0x${part}`);
  }, 0n);
}

function addressValue(address: string): { value: bigint; bits: 32 | 128 } {
  const family = net.isIP(address);
  if (family === 4) return { value: ipv4ToBigInt(address), bits: 32 };
  if (family === 6) return { value: ipv6ToBigInt(address), bits: 128 };
  throw new Error(`Unable to resolve a valid IP address for ${address}`);
}

export function parseCidr(cidr: string): ParsedCidr {
  const [address, rawPrefix, ...extra] = cidr.trim().split("/");
  if (!address || extra.length > 0) throw new Error(`Invalid CIDR: ${cidr}`);
  const { value, bits } = addressValue(address);
  const prefix = rawPrefix === undefined ? bits : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) throw new Error(`Invalid CIDR: ${cidr}`);
  const hostBits = BigInt(bits - prefix);
  const network = hostBits === BigInt(bits) ? 0n : (value >> hostBits) << hostBits;
  return { network, prefix, bits };
}

function inCidr(address: string, cidr: ParsedCidr): boolean {
  const { value, bits } = addressValue(address);
  if (bits !== cidr.bits) return false;
  const hostBits = BigInt(bits - cidr.prefix);
  return (hostBits === BigInt(bits) ? 0n : (value >> hostBits) << hostBits) === cidr.network;
}

const ALWAYS_FORBIDDEN_CIDRS = [
  "0.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::/128",
  "::1/128",
  "fe80::/10",
  "ff00::/8",
  "100::/64",
  "2001:db8::/32",
  "fd00:ec2::254/128",
  "::/96",
  "::ffff:0:0/96"
].map(parseCidr);

function mappedIpv4(address: string): string | null {
  const match = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return match?.[1] ?? null;
}

function isAlwaysForbidden(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) return isAlwaysForbidden(mapped);
  return ALWAYS_FORBIDDEN_CIDRS.some((cidr) => inCidr(address, cidr));
}

export function configureOutboundPolicy(env: AppEnv): void {
  state = {
    enforce: env.nodeEnv === "production" || env.outboundAllowedCidrs.length > 0 || env.outboundAllowedHosts.length > 0,
    allowedCidrs: env.outboundAllowedCidrs.map(parseCidr),
    allowedHosts: new Set(env.outboundAllowedHosts.map((host) => host.toLowerCase())),
    allowInsecureIntegrations: env.allowInsecureIntegrations
  };
}

export function resetOutboundPolicyForTests(): void {
  state = {
    enforce: false,
    allowedCidrs: [],
    allowedHosts: new Set(),
    allowInsecureIntegrations: false
  };
}

async function acquireFixedProviderSlot(): Promise<void> {
  if (fixedProviderActive < FIXED_PROVIDER_CONCURRENCY) {
    fixedProviderActive += 1;
    return;
  }
  await new Promise<void>((resolve) => fixedProviderWaiters.push(resolve));
}

function releaseFixedProviderSlot(): void {
  const waiter = fixedProviderWaiters.shift();
  if (waiter) waiter();
  else fixedProviderActive = Math.max(0, fixedProviderActive - 1);
}

export async function withFixedProviderLimit<T>(
  fixedProvider: boolean,
  operation: () => Promise<T>
): Promise<T> {
  if (!fixedProvider) return operation();
  await acquireFixedProviderSlot();
  try {
    return await operation();
  } finally {
    releaseFixedProviderSlot();
  }
}

export function assertIntegrationTransport(url: URL, options: { credentialed?: boolean; tlsVerify?: boolean }): void {
  if (options.tlsVerify === false && !state.allowInsecureIntegrations) {
    throw new Error("TLS verification cannot be disabled unless ALLOW_INSECURE_INTEGRATIONS=true");
  }
  if (options.credentialed && url.protocol !== "https:" && !state.allowInsecureIntegrations) {
    throw new Error("Credentialed integrations must use HTTPS unless ALLOW_INSECURE_INTEGRATIONS=true");
  }
}

export async function resolveOutboundTarget(
  hostname: string,
  options: { fixedProvider?: boolean; timeoutMs?: number } = {}
): Promise<ResolvedOutboundTarget> {
  const normalizedHost = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalizedHost) throw new Error("Outbound target hostname is required");
  if (options.fixedProvider && !FIXED_PROVIDER_HOSTS.has(normalizedHost)) {
    throw new Error("Outbound provider host is not allowlisted");
  }

  let timeout: NodeJS.Timeout | undefined;
  const lookupTimeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DNS_LOOKUP_TIMEOUT_MS, 10_000));
  const addresses = await Promise.race([
    dns.promises.lookup(normalizedHost, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`DNS resolution for ${normalizedHost} timed out`)),
        lookupTimeoutMs
      );
    })
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
  if (addresses.length === 0) throw new Error(`No address found for ${normalizedHost}`);
  const normalized = addresses.map((entry) => ({
    address: entry.address,
    family: entry.family as AddressFamily
  }));
  if ((state.enforce || options.fixedProvider) && normalized.some((entry) => isAlwaysForbidden(entry.address))) {
    throw new Error(`Outbound target ${normalizedHost} resolves to a forbidden address`);
  }

  if (state.enforce && !options.fixedProvider && !state.allowedHosts.has(normalizedHost)) {
    const disallowed = normalized.some((entry) =>
      !state.allowedCidrs.some((cidr) => inCidr(entry.address, cidr))
    );
    if (disallowed) throw new Error(`Outbound target ${normalizedHost} is outside the configured allowlist`);
  }

  const selected = normalized[0];
  return {
    hostname: normalizedHost,
    address: selected.address,
    family: selected.family,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: selected.address, family: selected.family }]);
        return;
      }
      callback(null, selected.address, selected.family);
    }
  };
}

export function outboundPolicySummary(): {
  enforced: boolean;
  configured: boolean;
  allowedCidrCount: number;
  allowedHostCount: number;
  allowInsecureIntegrations: boolean;
} {
  return {
    enforced: state.enforce,
    configured: state.allowedCidrs.length > 0 || state.allowedHosts.size > 0,
    allowedCidrCount: state.allowedCidrs.length,
    allowedHostCount: state.allowedHosts.size,
    allowInsecureIntegrations: state.allowInsecureIntegrations
  };
}
