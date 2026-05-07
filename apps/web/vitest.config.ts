import { defineConfig } from "vitest/config";

// apps/web does not host unit tests today (Pixi UI is exercised via Playwright).
// This config exists only to keep vitest from pulling in vite.config.ts (which
// loads the Cloudflare plugin and has no place in unit-test resolution).
export default defineConfig({
  test: {
    include: [],
  },
});
