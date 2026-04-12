import { test, expect } from "./playwright";
test("editor page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SliceX")).toBeVisible();
    await expect(page.locator("text=Balance: 0")).toBeVisible();
    await expect(page.locator("text=Playhead: No playhead")).toBeVisible();
    await page.waitForSelector("#editor-root canvas", { timeout: 10000 });
    await expect(page.locator("#editor-root canvas")).toBeVisible();
});
