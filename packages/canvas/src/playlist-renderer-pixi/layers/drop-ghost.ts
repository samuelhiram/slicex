// Drop preview ghost — semi-transparent outline at the snapped destination
// of a drag/resize gesture. Reads `presentation.dragPreviewView` (already
// pre-projected to screen coordinates by the presentation layer).
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawDropGhost(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const view = presentation.dragPreviewView;
  if (!view || view.rects.length === 0) return;
  for (const rect of view.rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    graphics
      .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
      .stroke({ color: COLORS.selected, width: 1.5, alpha: 0.42 });
  }
}
