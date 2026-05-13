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
    graphics
      .roundRect(playPosition.x - 7, 3, 14, metrics.rulerHeight - 6, 3)
      .fill({ color: COLORS.playPosition })
      .stroke({ color: COLORS.text, width: 1, alpha: 0.8 });
    graphics
      .moveTo(playPosition.x - 7, metrics.rulerHeight - 1)
      .lineTo(playPosition.x + 7, metrics.rulerHeight - 1)
      .lineTo(playPosition.x, metrics.rulerHeight + 7)
      .lineTo(playPosition.x - 7, metrics.rulerHeight - 1)
      .fill({ color: COLORS.playPosition });
    graphics
      .moveTo(playPosition.x + 0.5, 0)
      .lineTo(playPosition.x + 0.5, layout.sceneRect.height)
      .stroke({ color: COLORS.playPosition, width: 2 });
  }

  if (marquee) {
    graphics
      .rect(
        marquee.rect.x,
        marquee.rect.y,
        marquee.rect.width,
        marquee.rect.height,
      )
      .fill({ color: COLORS.marquee, alpha: 0.13 })
      .stroke({ color: COLORS.marquee, width: 1.5, alpha: 0.75 });
  }
}
