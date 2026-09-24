export type AppEnv = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  appOrigin: string | null;
  trustedProxyCidrs: string[];
  adminPassword: string | null;
  cookieSecret: string;
  cookieSecure: boolean;
  sessionMaxAgeSeconds: number;
  setupCode: string | null;
  publicStatusMode: "disabled" | "aggregate" | "services";
  outboundAllowedCidrs: string[];
  outboundAllowedHosts: string[];
  allowInsecureIntegrations: boolean;
  apiWidgetSecretAllowlist: string[];
  opnsense: OpnsenseEnvConfig;
  google: GoogleEnvConfig;
  todoist: TodoistEnvConfig;
  tmdb: TmdbEnvConfig;
  truenas: TrueNasEnvConfig;
  ai: AiEnvConfig;
};

export type GoogleEnvConfig = {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  calendarIds: string[];
};

export type TodoistEnvConfig = {
  configured: boolean;
  apiToken: string | null;
};

export type TmdbEnvConfig = {
  configured: boolean;
  bearerToken: string | null;
};

export type TrueNasEnvConfig = {
  enabled: boolean;
  configured: boolean;
  name: string;
  baseUrl: string | null;
  username: string | null;
  apiKey: string | null;
  poolName: string | null;
  datasetName: string | null;
  tlsVerify: boolean;
  pollIntervalSeconds: number;
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
const SESSION_MAX_AGE_HOURS_DEFAULT = 24 * 7;
const SESSION_MAX_AGE_HOURS_MIN = 1;
const SESSION_MAX_AGE_HOURS_MAX = 24 * 30;

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

function listEnv(value: string | undefined): string[] {
  return [...new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
}

function allowedHostList(value: string | undefined): string[] {
  return listEnv(value).map((entry) => {
    const normalized = entry.toLowerCase().replace(/\.$/, "");
    const valid = normalized.length <= 253 &&
      normalized.split(".").every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      );
    if (!valid || normalized.includes("*")) {
      throw new Error(`OUTBOUND_ALLOWED_HOSTS contains an invalid exact hostname: ${entry}`);
    }
    return normalized;
  });
}

function normalizedAppOrigin(value: string | null, production: boolean): string | null {
  if (!value) {
    if (production) throw new Error("APP_ORIGIN is required in production");
    return null;
  }
  const url = new URL(value);
  if (
    (production && url.protocol !== "https:") ||
    (!production && url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_ORIGIN must be an exact HTTPS origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function publicStatusModeEnv(value: string | undefined): AppEnv["publicStatusMode"] {
  if (!value) return "disabled";
  if (value === "disabled" || value === "aggregate" || value === "services") return value;
  throw new Error("PUBLIC_STATUS_MODE must be disabled, aggregate, or services");
}

function normalizedBaseUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) return null;
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

export function getGoogleEnv(): GoogleEnvConfig {
  const clientId = textEnv(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = textEnv(process.env.GOOGLE_CLIENT_SECRET);
  const refreshToken = textEnv(process.env.GOOGLE_REFRESH_TOKEN);
  return {
    configured: Boolean(clientId && clientSecret && refreshToken),
    clientId,
    clientSecret,
    refreshToken,
    calendarIds: listEnv(process.env.GOOGLE_CALENDAR_IDS).length > 0
      ? listEnv(process.env.GOOGLE_CALENDAR_IDS)
      : ["primary"]
  };
}

export function getTodoistEnv(): TodoistEnvConfig {
  const apiToken = textEnv(process.env.TODOIST_API_TOKEN);
  return { configured: Boolean(apiToken), apiToken };
}

export function getTmdbEnv(): TmdbEnvConfig {
  const bearerToken = textEnv(process.env.TMDB_BEARER_TOKEN);
  return { configured: Boolean(bearerToken), bearerToken };
}

export function getTrueNasEnv(): TrueNasEnvConfig {
  const enabled = boolEnv(process.env.TRUENAS_ENABLED, false);
  const baseUrl = normalizedBaseUrl(textEnv(process.env.TRUENAS_BASE_URL));
  const username = textEnv(process.env.TRUENAS_USERNAME);
  const apiKey = textEnv(process.env.TRUENAS_API_KEY);
  const poolName = textEnv(process.env.TRUENAS_POOL);
  return {
    enabled,
    configured: Boolean(enabled && baseUrl && username && apiKey && poolName),
    name: textEnv(process.env.TRUENAS_NAME) ?? "TrueNAS",
    baseUrl,
    username,
    apiKey,
    poolName,
    datasetName: textEnv(process.env.TRUENAS_MEDIA_DATASET),
    tlsVerify: boolEnv(process.env.TRUENAS_TLS_VERIFY, true),
    pollIntervalSeconds: intEnv(process.env.TRUENAS_POLL_INTERVAL_SECONDS, 60, 15, 86400)
  };
}

export function getEnv(): Omit<AppEnv, "cookieSecret"> & {
  cookieSecret: string | null;
} {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  const cookieSecret = textEnv(process.env.COOKIE_SECRET);
  const adminPassword = textEnv(process.env.ADMIN_PASSWORD);
  if (production && (!cookieSecret || cookieSecret.length < 32)) {
    throw new Error("COOKIE_SECRET must be at least 32 characters in production");
  }
  if (production && adminPassword && adminPassword.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters in production");
  }
  const appOrigin = normalizedAppOrigin(textEnv(process.env.APP_ORIGIN), production);
  const trustedProxyCidrs = listEnv(process.env.TRUST_PROXY_CIDRS);
  if (production && trustedProxyCidrs.length === 0) {
    throw new Error("TRUST_PROXY_CIDRS must identify the HTTPS reverse proxy in production");
  }
  const outboundAllowedCidrs = listEnv(process.env.OUTBOUND_ALLOWED_CIDRS);
  if (production && outboundAllowedCidrs.length === 0) {
    throw new Error("OUTBOUND_ALLOWED_CIDRS must define the monitored network boundary in production");
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 4173),
    databaseUrl: process.env.DATABASE_URL ?? "file:../data/homelab.db",
    appOrigin,
    trustedProxyCidrs,
    adminPassword,
    cookieSecret,
    cookieSecure: production || process.env.COOKIE_SECURE === "true",
    sessionMaxAgeSeconds: intEnv(
      process.env.SESSION_MAX_AGE_HOURS,
      SESSION_MAX_AGE_HOURS_DEFAULT,
      SESSION_MAX_AGE_HOURS_MIN,
      SESSION_MAX_AGE_HOURS_MAX
    ) * 60 * 60,
    setupCode: textEnv(process.env.SETUP_CODE),
    publicStatusMode: publicStatusModeEnv(process.env.PUBLIC_STATUS_MODE),
    outboundAllowedCidrs,
    outboundAllowedHosts: allowedHostList(process.env.OUTBOUND_ALLOWED_HOSTS),
    allowInsecureIntegrations: boolEnv(process.env.ALLOW_INSECURE_INTEGRATIONS, false),
    apiWidgetSecretAllowlist: (process.env.API_WIDGET_SECRET_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Z_][A-Z0-9_]*$/.test(value)),
    opnsense: getOpnsenseEnv(),
    google: getGoogleEnv(),
    todoist: getTodoistEnv(),
    tmdb: getTmdbEnv(),
    truenas: getTrueNasEnv(),
    ai: getAiEnv()
  };
}
