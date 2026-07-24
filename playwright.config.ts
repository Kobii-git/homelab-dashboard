import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4180",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ],
  webServer: {
    command: "sh -c 'rm -f data/e2e.db; RUST_LOG=info DATABASE_URL=file:../data/e2e.db npx prisma db push --skip-generate; DATABASE_URL=file:../data/e2e.db npm run seed:demo; NODE_ENV=test DATABASE_URL=file:../data/e2e.db ADMIN_PASSWORD=e2e-admin-password COOKIE_SECRET=e2e-cookie-secret-with-more-than-32-characters PUBLIC_STATUS_MODE=services PORT=4180 HOST=127.0.0.1 npx tsx scripts/e2e-server.ts'",
    url: "http://127.0.0.1:4180/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
