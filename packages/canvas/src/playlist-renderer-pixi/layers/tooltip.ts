// Floating time tooltip near the cursor during drag/hover. The renderer
// owns one Container with a Graphics background pill + a Text label, both
// created in init. This module positions and updates them based on
// `presentation.tooltipView`.
//
// Stub: F2 keeps this empty; F3 wires it.
import type { Container, Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";

export interface TooltipContext {
  container: Container;
  background: Graphics;
  textLayer: Container;
}

export function drawTooltip(
  _ctx: TooltipContext,
  _presentation: PlaylistPresentation,
): void {
  // intentionally empty in F2; implemented in F3.
}
