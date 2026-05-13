// Snap indicator — vertical 1px line at the next snap point during drag.
// The Graphics instance is created in renderer-impl init and reused; this
// module emits draw commands when `presentation.snapIndicatorX` is non-null.
//
// Stub: F2 leaves this as a no-op so the refactor stays mechanical. F3 wires
// the actual draw call.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";

export function drawSnapIndicator(
  _graphics: Graphics,
  _presentation: PlaylistPresentation,
): void {
  // intentionally empty in F2; implemented in F3.
}
