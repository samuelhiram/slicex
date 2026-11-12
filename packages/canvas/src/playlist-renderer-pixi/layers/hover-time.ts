// Hover-time indicator: a faint vertical line at the beat cell (a day, for
// the finance host) under the pointer, across the overview lane and the
// rows, plus the cell's name in a pill on the ruler's lower tier — where
// dates are read, never over the curve or the clips' text. Reads
// state.hoverTime (set by the controller with `hoverTimeIndicator`).
//
// Its own Graphics + text layer above the overview lane, cleared every frame
// like the other dynamic layers: a rect or two and one pooled Text, no
// allocation (the label string is cached per cell by the renderer).
import type { Container, Graphics } from "pixi.js";
import { getHorizontalScrollbarHeight, type PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";
import { addText } from "../text-pool";
import { RULER_TICK_CHAR_PX, rulerTickLabelY } from "./ruler";

export const HOVER_LINE_ALPHA = 0.3;
// A wide cell is also shaded (zoomed in, the line alone reads as a border).
export const HOVER_BAND_ALPHA = 0.045;
export const HOVER_BAND_MIN_PX = 10;
const PILL_HEIGHT = 18;
const PILL_PAD_X = 7;
const LABEL_SIZE = 11;

export function drawHoverTime(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
  label: string | null,
): void {
  const state = presentation.state;
  const time = state.hoverTime;
  if (time === null || time === undefined) return;
  const metrics = presentation.metrics;
  const viewport = state.viewport;
  const left = metrics.trackHeaderWidth;
  const right = viewport.width - metrics.scrollbarSize;
  const bottom = viewport.height - getHorizontalScrollbarHeight(metrics);
  const pxPerBeat = viewport.pxPerBeat;
  const cellLeft = left + time * pxPerBeat - viewport.scrollX;
  const center = cellLeft + pxPerBeat / 2;
  if (center < left || center > right || bottom <= metrics.rulerHeight) return;

  // The pill names the cell; the line hangs from it down to the rows.
  let lineTop = metrics.rulerHeight;
  if (label) {
    const y = rulerTickLabelY(presentation);
    const width = label.length * RULER_TICK_CHAR_PX + PILL_PAD_X * 2;
    const pillLeft = Math.min(Math.max(left + 2, center - width / 2), right - 2 - width);
    const pillTop = y - (PILL_HEIGHT - LABEL_SIZE - 3) / 2;
    graphics
      .roundRect(pillLeft, pillTop, width, PILL_HEIGHT, PILL_HEIGHT / 2)
      .fill({ color: COLORS.tooltipBackground, alpha: 0.94 });
    addText(textLayer, label, pillLeft + width / 2, y, {
      color: COLORS.tooltipText,
      size: LABEL_SIZE,
      weight: "600",
      anchorX: 0.5,
    });
    lineTop = Math.min(metrics.rulerHeight, pillTop + PILL_HEIGHT);
  }

  if (pxPerBeat >= HOVER_BAND_MIN_PX) {
    const x0 = Math.max(left, cellLeft);
    const x1 = Math.min(right, cellLeft + pxPerBeat);
    if (x1 > x0) {
      graphics
        .rect(x0, metrics.rulerHeight, x1 - x0, bottom - metrics.rulerHeight)
        .fill({ color: COLORS.hover, alpha: HOVER_BAND_ALPHA });
    }
  }
  graphics
    .rect(Math.round(center), lineTop, 1, bottom - lineTop)
    .fill({ color: COLORS.hover, alpha: HOVER_LINE_ALPHA });
}
