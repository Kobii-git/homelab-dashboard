export type AppEnv = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  adminPassword: string;
  cookieSecret: string;
  vaultKey?: string;
  guacdHost: string;
  guacdPort: number;
};

function requireProductionValue(name: string, value: string | undefined): string {
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error(`${name} is required in production`);
  }

  return value ?? "";
}

export function getEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const adminPassword =
    nodeEnv === "production"
      ? requireProductionValue("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD)
      : process.env.ADMIN_PASSWORD ?? "admin";

  const cookieSecret =
    nodeEnv === "production"
      ? requireProductionValue("COOKIE_SECRET", process.env.COOKIE_SECRET)
      : process.env.COOKIE_SECRET ?? "dev-cookie-secret-change-me-please-32";

  if (cookieSecret.length < 32) {
    throw new Error("COOKIE_SECRET must be at least 32 characters");
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 4173),
    databaseUrl: process.env.DATABASE_URL ?? "file:../data/homelab.db",
    adminPassword,
    cookieSecret,
    vaultKey: process.env.HOMELAB_VAULT_KEY,
    guacdHost: process.env.GUACD_HOST ?? "guacd",
    guacdPort: Number(process.env.GUACD_PORT ?? 4822)
  };
}
