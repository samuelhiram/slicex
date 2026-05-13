// Drop preview ghost — semi-transparent outline at the snapped destination
// of a drag/resize gesture. Reads `presentation.dragPreviewView`.
//
// Stub: F2 leaves this as a no-op. F3 implements the roundRect outline.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";

export function drawDropGhost(
  _graphics: Graphics,
  _presentation: PlaylistPresentation,
): void {
  // intentionally empty in F2; implemented in F3.
}
