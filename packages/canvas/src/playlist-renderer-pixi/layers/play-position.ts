// Play-position knob on the ruler (chromeGraphics): a small downward
// pointer at the bottom edge of the ruler, so the date labels stay legible.
// The full-height line lives on the overlay layer (drawTimelineOverlay) so
// it is clipped by the timeline mask.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export const PLAY_KNOB_HALF_WIDTH = 5;
export const PLAY_KNOB_HEIGHT = 7;

export function drawPlayPositionRulerMarker(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, playPosition } = presentation;
  if (!playPosition.isVisible) return;
  const x = playPosition.x + 0.5;
  const bottom = metrics.rulerHeight;
  graphics
    .moveTo(x - PLAY_KNOB_HALF_WIDTH, bottom - PLAY_KNOB_HEIGHT)
    .lineTo(x + PLAY_KNOB_HALF_WIDTH, bottom - PLAY_KNOB_HEIGHT)
    .lineTo(x, bottom)
    .closePath()
    .fill({ color: COLORS.playPosition });
}
