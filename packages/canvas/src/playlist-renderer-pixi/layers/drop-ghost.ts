// Drop preview ghost — semi-transparent outline at the snapped destination
// of a drag/resize gesture. Reads `presentation.dragPreviewView` (already
// pre-projected to screen coordinates by the presentation layer).
//
// Stacked lanes (playlist-core/lanes.ts) add two dashed shapes, after the
// shift planner of postalhub-dashboard:
//   - the FREE LANE: the empty lane the row under a dragged clip opens
//     below its lanes — drop there to stack at the same time as another;
//   - a clip ABOUT TO BE CREATED (Draw tool with a host create flow): the
//     range and lane it would take, nothing created yet.
// Redrawn only when the drag preview changes (the layer is cached).
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation, PlaylistRect } from "../../playlist-core";
import { COLORS } from "../palette";

const DASH = 6;
const GAP = 4;

// Dashed outline of a rect (Pixi has no native dash): straight segments
// along the four edges, then one stroke.
function dashedRect(graphics: Graphics, rect: PlaylistRect): void {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;
  for (let x = x0; x < x1; x += DASH + GAP) {
    const end = Math.min(x + DASH, x1);
    graphics.moveTo(x, y0).lineTo(end, y0);
    graphics.moveTo(x, y1).lineTo(end, y1);
  }
  for (let y = y0; y < y1; y += DASH + GAP) {
    const end = Math.min(y + DASH, y1);
    graphics.moveTo(x0, y).lineTo(x0, end);
    graphics.moveTo(x1, y).lineTo(x1, end);
  }
}

export function drawDropGhost(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const view = presentation.dragPreviewView;
  if (!view) return;
  const free = view.freeLaneRect;
  if (free && free.width > 0 && free.height > 0) {
    graphics
      .roundRect(free.x, free.y, free.width, free.height, 6)
      .fill({ color: COLORS.selected, alpha: 0.03 });
    dashedRect(graphics, free);
    graphics.stroke({ color: COLORS.textMuted, width: 1, alpha: 0.6 });
  }
  for (const rect of view.rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (view.creating) {
      graphics
        .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
        .fill({ color: COLORS.selected, alpha: 0.12 });
      dashedRect(graphics, rect);
      graphics.stroke({ color: COLORS.selected, width: 1.5, alpha: 0.9 });
      continue;
    }
    graphics
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: COLORS.selected, alpha: 0.06 })
      .stroke({ color: COLORS.selected, width: 1.5, alpha: 0.5 });
  }
}
