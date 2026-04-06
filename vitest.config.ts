import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude E2E/playwright tests and node_modules from unit test runs
    exclude: [
      "**/node_modules/**",
      "apps/web/tests/**",
      "**/*.pw.ts",
      "**/*.e2e.*",
    ],
    // Run only tests under packages by default
    include: ["packages/**/tests/**"],
  },
});
