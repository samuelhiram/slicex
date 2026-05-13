// Snap indicator — vertical 1px line at the next snap point during drag.
// The Graphics instance is created in renderer-impl init and reused; this
// module emits draw commands when `presentation.snapIndicatorX` is non-null.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawSnapIndicator(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const x = presentation.snapIndicatorX;
  if (x == null) return;
  const { metrics, layout } = presentation;
  graphics
    .moveTo(Math.round(x) + 0.5, metrics.rulerHeight)
    .lineTo(Math.round(x) + 0.5, layout.sceneRect.height)
    .stroke({ color: COLORS.selected, width: 1, alpha: 0.55 });
}
