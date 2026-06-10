export type AppEnv = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  adminPassword: string | null;
  cookieSecret: string;
  cookieSecure: boolean;
};

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
  };
}
