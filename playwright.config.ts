import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const e2eDataDirectory = mkdtempSync(path.join(tmpdir(), "homelab-dashboard-e2e-"));
process.once("exit", () => rmSync(e2eDataDirectory, { recursive: true, force: true }));

const browserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ...(process.env.HOMEPAGE_EDGE === "1" ? [{ name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } }] : []),
  ...(process.env.HOMEPAGE_CROSS_BROWSER === "1" ? [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ] : [])
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1, // Serialize writes within each browser’s disposable configuration store.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4180",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: browserProjects.map((project, index) => ({
    ...project, use: { ...project.use, baseURL: `http://127.0.0.1:${4180 + index}` }
  })),
  webServer: browserProjects.map((project, index) => ({
    command: "npx prisma db push --skip-generate && npm run seed:demo && npx tsx scripts/e2e-server.ts",
    env: {
      RUST_LOG: "info",
      DATABASE_URL: `file:${path.join(e2eDataDirectory, `${project.name}.db`)}`,
      NODE_ENV: "test",
      ADMIN_PASSWORD: "e2e-admin-password",
      COOKIE_SECRET: "e2e-cookie-secret-with-more-than-32-characters",
      PUBLIC_STATUS_MODE: "services",
      PORT: String(4180 + index),
      HOST: "127.0.0.1"
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    url: `http://127.0.0.1:${4180 + index}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000
  }))
});
