import { test, expect } from "./playwright";

const RELOADS = 10;
const WAIT_FOR_PIXI_MS = 3_000;

interface Sample {
  reload: number;
  hasSurface: boolean;
  hasCanvas: boolean;
  canvasWidth: number;
  canvasHeight: number;
  cssWidth: number;
  cssHeight: number;
  toolbarButtons: number;
  loadingVisible: boolean;
  errorVisible: boolean;
}

async function sample(page: import("@playwright/test").Page, reload: number): Promise<Sample> {
  return await page.evaluate(
    ({ reload }) => {
      const surface = document.querySelector(
        ".playlist-shell__surface",
      ) as HTMLElement | null;
      const canvas = surface?.querySelector("canvas") as HTMLCanvasElement | null;
      const status = document.querySelector(
        ".playlist-shell__status",
      ) as HTMLElement | null;
      const toolbar = document.querySelector(
        ".playlist-shell__toolbar",
      ) as HTMLElement | null;
      return {
        reload,
        hasSurface: surface != null,
        hasCanvas: canvas != null,
        canvasWidth: canvas?.width ?? 0,
        canvasHeight: canvas?.height ?? 0,
        cssWidth: canvas?.getBoundingClientRect().width ?? 0,
        cssHeight: canvas?.getBoundingClientRect().height ?? 0,
        toolbarButtons:
          toolbar?.querySelectorAll(".playlist-shell__tool").length ?? 0,
        loadingVisible: status?.textContent?.includes("Cargando") ?? false,
        errorVisible: status?.getAttribute("role") === "alert",
      };
    },
    { reload },
  );
}

test.describe("reload stress", () => {
  test("page survives N reloads with the canvas mounted each time", async ({
    page,
  }, testInfo) => {
    const samples: Sample[] = [];
    await page.goto("/");
    // First load
    await page.waitForSelector(".playlist-shell__surface canvas", {
      timeout: WAIT_FOR_PIXI_MS,
    });
    samples.push(await sample(page, 0));

    for (let i = 1; i <= RELOADS; i += 1) {
      await page.reload();
      // Wait for the surface to exist, then check for a canvas inside.
      await page
        .waitForSelector(".playlist-shell__surface", { timeout: WAIT_FOR_PIXI_MS })
        .catch(() => {});
      // Canvas may take a moment to attach because of Pixi's async init.
      await page
        .waitForSelector(".playlist-shell__surface canvas", {
          timeout: WAIT_FOR_PIXI_MS,
        })
        .catch(() => {});
      // Give the renderer one more rAF for the first paint to land.
      await page.waitForTimeout(60);
      const s = await sample(page, i);
      samples.push(s);
    }

    const report = samples
      .map(
        (s) =>
          `#${s.reload}: canvas=${s.hasCanvas} pix=${s.canvasWidth}x${s.canvasHeight} css=${Math.round(s.cssWidth)}x${Math.round(s.cssHeight)} toolbar=${s.toolbarButtons} loading=${s.loadingVisible} error=${s.errorVisible}`,
      )
      .join("\n");
    await testInfo.attach("reload-samples", {
      body: report,
      contentType: "text/plain",
    });

    const failed = samples.filter(
      (s) => !s.hasCanvas || s.canvasWidth < 50 || s.canvasHeight < 50,
    );
    if (failed.length > 0) {
      const failedDetail = failed
        .map(
          (s) =>
            `reload #${s.reload}: hasCanvas=${s.hasCanvas} ${s.canvasWidth}x${s.canvasHeight} css ${Math.round(s.cssWidth)}x${Math.round(s.cssHeight)}`,
        )
        .join("\n");
      throw new Error(
        `Canvas was not properly mounted on ${failed.length}/${samples.length} reloads:\n${failedDetail}\n\nFull report:\n${report}`,
      );
    }

    // Sanity: toolbar should render the 8 tool buttons + Str = 9 buttons.
    for (const s of samples) {
      expect(s.toolbarButtons, `toolbar buttons on reload #${s.reload}`).toBeGreaterThanOrEqual(8);
      expect(s.loadingVisible, `loading overlay visible on reload #${s.reload}`).toBe(false);
      expect(s.errorVisible, `error overlay visible on reload #${s.reload}`).toBe(false);
    }
  });
});
