// Timeline overlay — play position triangle/line in the timeline area plus
// the marquee selection rectangle. Drawn on overlayGraphics inside the
// masked timeline container so it gets clipped by the ruler/header band.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawTimelineOverlay(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, playPosition, marquee, layout } = presentation;

  if (playPosition.isVisible) {
    // A thin "now" line; the knob on the ruler is drawn by play-position.
    graphics
      .moveTo(playPosition.x + 0.5, metrics.rulerHeight)
      .lineTo(playPosition.x + 0.5, layout.sceneRect.height)
      .stroke({ color: COLORS.playPosition, width: 1.5 });
  }

  if (marquee) {
    graphics
      .rect(
        marquee.rect.x,
        marquee.rect.y,
        marquee.rect.width,
        marquee.rect.height,
      )
      .fill({ color: COLORS.marquee, alpha: 0.08 })
      .stroke({ color: COLORS.marquee, width: 1, alpha: 0.9 });
  }
}
