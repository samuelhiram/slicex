// Loop region — the band on the ruler between the two earliest loop markers.
// Drawn on chromeGraphics above the ruler chrome.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawLoopRegion(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const region = presentation.loopRegion;
  if (!region || !region.isVisible) return;
  const { rect } = region;
  // Background tint on the ruler so the loop range is unmistakable.
  graphics
    .rect(rect.x, rect.y, rect.width, Math.max(2, rect.height - 6))
    .fill({ color: COLORS.loopRegion, alpha: 0.18 });
  graphics
    .rect(rect.x, rect.y + rect.height - 4, rect.width, 3)
    .fill({ color: COLORS.loopRegion, alpha: 0.7 });
}
