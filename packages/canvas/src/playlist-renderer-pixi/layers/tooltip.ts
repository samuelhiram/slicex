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

const splitLinesNone: readonly string[] = [];

export interface TooltipContext {
  container: Container;
  background: Graphics;
  textLayer: Container;
}

export const TOOLTIP_OFFSET_X = 12;
export const TOOLTIP_OFFSET_Y = -22;
export const TOOLTIP_HEIGHT = 22;
export const TOOLTIP_PADDING_X = 9;
export const TOOLTIP_CHAR_WIDTH = 6.5; // approximate advance for size-11 / 600 Inter
// Extra height of each detail line (e.g. "Caja $12,000", "+$9,000 Sueldo").
export const TOOLTIP_DETAIL_HEIGHT = 15;

// The detail's lines, split once per distinct string (providers return the
// SAME string while unchanged, so steady frames never split again).
let splitSource: string | null = null;
let splitLines: readonly string[] = [];
function detailLines(detail: string): readonly string[] {
  if (detail !== splitSource) {
    splitSource = detail;
    splitLines = detail.split("\n");
  }
  return splitLines;
}

/**
 * Draws the tooltip; `detail` adds lines under the main text ("\n"
 * separated). Returns the pill height (0 when hidden) so pills attached
 * below (drag annotation) can sit under it.
 */
export function drawTooltip(
  ctx: TooltipContext,
  presentation: PlaylistPresentation,
  detail: string | null = null,
): number {
  const view = presentation.tooltipView;
  if (!view) {
    ctx.container.visible = false;
    return 0;
  }
  ctx.container.visible = true;
  const text = view.text;
  const lines = detail ? detailLines(detail) : splitLinesNone;
  let chars = Math.max(text.length, 1);
  for (let i = 0; i < lines.length; i += 1) chars = Math.max(chars, lines[i]!.length);
  const pillWidth = chars * TOOLTIP_CHAR_WIDTH + TOOLTIP_PADDING_X * 2;
  const height = TOOLTIP_HEIGHT + lines.length * TOOLTIP_DETAIL_HEIGHT;
  const x = Math.round(view.x + TOOLTIP_OFFSET_X);
  const y = Math.round(view.y + TOOLTIP_OFFSET_Y);
  // High-contrast chip (inverse of the surface), like a native tooltip.
  ctx.background
    .roundRect(x, y, pillWidth, height, 6)
    .fill({ color: COLORS.tooltipBackground, alpha: 0.96 });
  addText(ctx.textLayer, text, x + TOOLTIP_PADDING_X, y + 4, {
    color: COLORS.tooltipText,
    size: 11,
    weight: "600",
  });
  for (let i = 0; i < lines.length; i += 1) {
    addText(ctx.textLayer, lines[i]!, x + TOOLTIP_PADDING_X, y + 4 + (i + 1) * TOOLTIP_DETAIL_HEIGHT, {
      color: COLORS.tooltipText,
      size: 11,
      weight: "500",
    });
  }
  return height;
}
