// Play-position rounded rect + triangle on the ruler (chromeGraphics).
// The full-height vertical line + the in-timeline triangle live on the
// overlay layer (drawTimelineOverlay) so they're clipped by the mask.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawPlayPositionRulerMarker(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, playPosition } = presentation;
  if (!playPosition.isVisible) return;
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
}
