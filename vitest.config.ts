import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Exclude E2E/playwright tests and node_modules from unit test runs
    exclude: [
      "**/node_modules/**",
      "**/*.pw.ts",
      "**/*.e2e.*",
    ],
    // Run only tests under packages by default
    include: [
      "packages/**/tests/**",
      "apps/web/tests/**/*.unit.spec.{ts,tsx}",
    ],
  },
});
