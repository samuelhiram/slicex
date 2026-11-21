// Extend grabber of the selected clip (see getClipExtendHandle): a vertical
// pill at the centre of the visible timeline, inside the clip, that moves
// the clip's right end. Drawn per frame on the masked timeline overlay (it
// follows scroll and the pointer, so it can't live in the cached clip node);
// a few rects, no allocations.
import type { Graphics } from "pixi.js";
import type { PlaylistClipExtendHandle } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawClipExtendHandle(
  graphics: Graphics,
  handle: PlaylistClipExtendHandle,
): void {
  const { pillRect: pill } = handle;
  if (pill.width <= 0 || pill.height <= 0) return;
  const strong = handle.active || handle.hovered;
  const radius = pill.width / 2;

  // Soft lift so it reads as an object above the card's text.
  graphics
    .roundRect(pill.x - 1, pill.y + 1, pill.width + 2, pill.height + 2, radius + 1)
    .fill({ color: 0x000000, alpha: COLORS.shadowAlpha });
  // A ring in the surface colour separates it from whatever is under it.
  graphics
    .roundRect(pill.x - 2, pill.y - 2, pill.width + 4, pill.height + 4, radius + 2)
    .fill({ color: COLORS.panelStrong });
  graphics
    .roundRect(pill.x, pill.y, pill.width, pill.height, radius)
    .fill({ color: strong ? COLORS.selected : COLORS.panelStrong })
    .stroke({ color: COLORS.selected, width: 1.5 });
  // Grip: one centred line (inverse on the filled state).
  const gripH = Math.max(4, pill.height - 12);
  graphics
    .roundRect(handle.x - 1, pill.y + (pill.height - gripH) / 2, 2, gripH, 1)
    .fill({ color: strong ? COLORS.textInverse : COLORS.selected });
}
