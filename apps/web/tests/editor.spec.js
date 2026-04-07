import { test, expect } from "@playwright/test";
test("editor page loads", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("h1", { timeout: 10000 });
    await expect(page.locator("h1")).toHaveText(/SliceX/);
    await page.waitForSelector("#editor-root canvas", { timeout: 10000 });
    await expect(page.locator("#editor-root canvas")).toBeVisible();
});
