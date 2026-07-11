export type AppEnv = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  adminPassword: string | null;
  cookieSecret: string;
  cookieSecure: boolean;
  apiWidgetSecretAllowlist: string[];
  opnsense: OpnsenseEnvConfig;
  ai: AiEnvConfig;
};

export type OpnsenseEnvConfig = {
  enabled: boolean;
  configured: boolean;
  name: string;
  baseUrl: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  tlsVerify: boolean;
  pollIntervalSeconds: number;
};

export type AiEnvConfig = {
  enabled: boolean;
  configured: boolean;
  providerName: string;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  tlsVerify: boolean;
  briefingIntervalSeconds: number;
  includeTargets: boolean;
};

const OPNSENSE_POLL_INTERVAL_DEFAULT = 60;
const OPNSENSE_POLL_INTERVAL_MIN = 15;
const OPNSENSE_POLL_INTERVAL_MAX = 86400;
const AI_BRIEFING_INTERVAL_DEFAULT = 21600;
const AI_BRIEFING_INTERVAL_MIN = 300;
const AI_BRIEFING_INTERVAL_MAX = 86400;

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function textEnv(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizedBaseUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function getOpnsenseEnv(): OpnsenseEnvConfig {
  const baseUrl = normalizedBaseUrl(textEnv(process.env.OPNSENSE_BASE_URL));
  const apiKey = textEnv(process.env.OPNSENSE_API_KEY);
  const apiSecret = textEnv(process.env.OPNSENSE_API_SECRET);
  const enabled = boolEnv(process.env.OPNSENSE_ENABLED, false);

  return {
    enabled,
    configured: Boolean(enabled && baseUrl && apiKey && apiSecret),
    name: textEnv(process.env.OPNSENSE_NAME) ?? "OPNsense",
    baseUrl,
    apiKey,
    apiSecret,
    tlsVerify: boolEnv(process.env.OPNSENSE_TLS_VERIFY, true),
    pollIntervalSeconds: intEnv(
      process.env.OPNSENSE_POLL_INTERVAL_SECONDS,
      OPNSENSE_POLL_INTERVAL_DEFAULT,
      OPNSENSE_POLL_INTERVAL_MIN,
      OPNSENSE_POLL_INTERVAL_MAX
    )
  };
}

export function getAiEnv(): AiEnvConfig {
  const enabled = boolEnv(process.env.AI_ENABLED, false);
  const baseUrl = normalizedBaseUrl(textEnv(process.env.AI_BASE_URL) ?? "https://api.openai.com/v1");
  const model = textEnv(process.env.AI_MODEL);

  return {
    enabled,
    configured: Boolean(enabled && baseUrl && model),
    providerName: textEnv(process.env.AI_PROVIDER_NAME) ?? "AI",
    baseUrl,
    apiKey: textEnv(process.env.AI_API_KEY),
    model,
    tlsVerify: boolEnv(process.env.AI_TLS_VERIFY, true),
    briefingIntervalSeconds: intEnv(
      process.env.AI_BRIEFING_INTERVAL_SECONDS,
      AI_BRIEFING_INTERVAL_DEFAULT,
      AI_BRIEFING_INTERVAL_MIN,
      AI_BRIEFING_INTERVAL_MAX
    ),
    includeTargets: boolEnv(process.env.AI_INCLUDE_TARGETS, false)
  };
}

export function getEnv(): Omit<AppEnv, "cookieSecret"> & {
  cookieSecret: string | null;
} {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 4173),
    databaseUrl: process.env.DATABASE_URL ?? "file:../data/homelab.db",
    adminPassword: process.env.ADMIN_PASSWORD ?? null,
    cookieSecret: process.env.COOKIE_SECRET ?? null,
    // Only require HTTPS for the session cookie when explicitly opted in.
    // Homelab installs are typically plain HTTP on a LAN, where a secure
    // cookie would be silently dropped by the browser and block login.
    cookieSecure: process.env.COOKIE_SECURE === "true",
    apiWidgetSecretAllowlist: (process.env.API_WIDGET_SECRET_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Z_][A-Z0-9_]*$/.test(value)),
    opnsense: getOpnsenseEnv(),
    ai: getAiEnv()
  };
}
