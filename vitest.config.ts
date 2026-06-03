import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // All test files share a single DATABASE_URL (set in the `npm test`
    // script), so they must run sequentially to avoid racing on the same
    // SQLite rows. Without this the suite is intermittently flaky.
    fileParallelism: false,
    testTimeout: 15000
  }
});
