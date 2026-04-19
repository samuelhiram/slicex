import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Exclude E2E/playwright tests and node_modules from unit test runs
    exclude: ["**/node_modules/**", "**/*.pw.ts", "**/*.e2e.*"],
    // Discover only TypeScript unit specs.
    include: ["**/*.spec.ts", "**/*.spec.tsx"],
  },
});
