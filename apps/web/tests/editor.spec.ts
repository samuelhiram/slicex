import { test, expect } from "@playwright/test";

test("editor page loads", async ({ page }) => {
  await page.goto("/");
  // Wait for client-side hydration to render the H1 (increase timeout in slow CI)
  await page.waitForSelector("h1", { timeout: 10000 });
  await expect(page.locator("h1")).toHaveText(/SliceX/);
});
