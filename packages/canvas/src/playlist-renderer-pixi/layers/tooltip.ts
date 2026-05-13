// Floating time tooltip near the cursor during drag/hover. The renderer
// owns one Container with a Graphics background pill + a Text label, both
// created in init. This module positions and updates them based on
// `presentation.tooltipView`.
//
// Layout: anchor at (anchor.x + 12, anchor.y - 22). Pill height is fixed
// at 18px, width derives from the text length (~6.2 px per char @ size 11
// — close enough for the dark-theme pill and keeps us off Pixi's text
// metrics, which require a render pass to be accurate).
import type { Container, Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";
import { addText } from "../text-pool";

export interface TooltipContext {
  container: Container;
  background: Graphics;
  textLayer: Container;
}

const TOOLTIP_OFFSET_X = 12;
const TOOLTIP_OFFSET_Y = -22;
const TOOLTIP_HEIGHT = 18;
const TOOLTIP_PADDING_X = 8;
const TOOLTIP_CHAR_WIDTH = 6.2; // approximate advance for size-11 sans

export function drawTooltip(
  ctx: TooltipContext,
  presentation: PlaylistPresentation,
): void {
  const view = presentation.tooltipView;
  if (!view) {
    ctx.container.visible = false;
    return;
  }
  ctx.container.visible = true;
  const text = view.text;
  const textWidth = Math.max(text.length, 1) * TOOLTIP_CHAR_WIDTH;
  const pillWidth = textWidth + TOOLTIP_PADDING_X * 2;
  const x = Math.round(view.x + TOOLTIP_OFFSET_X);
  const y = Math.round(view.y + TOOLTIP_OFFSET_Y);
  ctx.background
    .roundRect(x, y, pillWidth, TOOLTIP_HEIGHT, 4)
    .fill({ color: COLORS.panelStrong, alpha: 0.92 })
    .stroke({ color: COLORS.text, width: 1, alpha: 0.4 });
  addText(ctx.textLayer, text, x + TOOLTIP_PADDING_X, y + 3, {
    color: COLORS.text,
    size: 11,
    weight: "600",
  });
}
