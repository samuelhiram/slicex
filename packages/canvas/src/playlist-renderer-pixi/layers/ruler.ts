// Ruler chrome (top band with the time labels) + the timeline grid that drops
// behind clips. The orchestrator owns the dirty-key cache for the grid;
// this module just emits draw commands when invoked.
//
// Two layouts:
//   - single tier (default axis): tick lines + labels.
//   - two tiers, when the axis provides "group" bands (e.g. months): the
//     group labels sit on the upper tier (sticky at the left edge while
//     their span is on screen), the tick labels on the lower tier. Labels
//     may be centred in their cell, dimmed (weekends) or emphasised (today:
//     a pill in the "now" colour).
//
// Label collisions are resolved here, where the screen positions are known
// (the axis only knows beats): an emphasised pill wins over any label it
// would touch, and no label is drawn over the track-header corner (the
// chrome text layer is not masked).
import type { Container, Graphics } from "pixi.js";
import {
  getTracksTop,
  type PlaylistPresentation,
  type PlaylistRulerTickPresentation,
} from "../../playlist-core";
import { COLORS } from "../palette";
import { addText } from "../text-pool";

const GROUP_LABEL_SIZE = 12;
const GROUP_CHAR_PX = 7.2;
const TICK_LABEL_SIZE = 11;
// Conservative advance of the 11px / 500-600 tick labels (Inter digits are
// ~6.6px): estimates only, no canvas measuring (deterministic, headless).
export const RULER_TICK_CHAR_PX = 6.6;
const PILL_HEIGHT = 18;
const PILL_PAD_X = 7;
const LABEL_GAP = 4;
const LEFT_LABEL_OFFSET = 5;
const MAJOR_TICK_PX = 6;

// Upper-tier height of a two-tier ruler.
export function rulerTierSplit(rulerHeight: number): number {
  return Math.round(rulerHeight * 0.46);
}

function hasGroups(presentation: PlaylistPresentation): boolean {
  const bands = presentation.rulerBands;
  for (let i = 0; i < bands.length; i += 1) {
    if (bands[i]!.kind === "group") return true;
  }
  return false;
}

// Horizontal extent of a tick label (pill included) — written into the
// module scratch below so the per-frame loop allocates nothing.
let extentLeft = 0;
let extentRight = 0;

function measureLabel(
  tick: PlaylistRulerTickPresentation,
  label: string,
  minX: number,
): void {
  if (tick.emphasis) {
    const width = label.length * RULER_TICK_CHAR_PX + PILL_PAD_X * 2;
    const centre = tick.centered ? tick.labelX : tick.x;
    extentLeft = Math.max(minX + 2, centre - width / 2);
    extentRight = extentLeft + width;
    return;
  }
  const width = label.length * RULER_TICK_CHAR_PX;
  if (tick.centered) {
    extentLeft = tick.labelX - width / 2;
  } else {
    extentLeft = tick.x + LEFT_LABEL_OFFSET;
  }
  extentRight = extentLeft + width;
}

function drawTickLabel(
  graphics: Graphics,
  textLayer: Container,
  tick: PlaylistRulerTickPresentation,
  label: string,
  y: number,
): void {
  if (tick.emphasis) {
    const top = y - (PILL_HEIGHT - TICK_LABEL_SIZE - 3) / 2;
    graphics
      .roundRect(extentLeft, top, extentRight - extentLeft, PILL_HEIGHT, PILL_HEIGHT / 2)
      .fill({ color: COLORS.playPosition });
    addText(textLayer, label, (extentLeft + extentRight) / 2, y, {
      color: COLORS.nowText,
      size: TICK_LABEL_SIZE,
      weight: "600",
      anchorX: 0.5,
    });
    return;
  }
  if (tick.centered) {
    addText(textLayer, label, tick.labelX, y, {
      color: tick.dim ? COLORS.textMuted : COLORS.text,
      size: TICK_LABEL_SIZE,
      weight: "500",
      anchorX: 0.5,
    });
    return;
  }
  addText(textLayer, label, tick.x + LEFT_LABEL_OFFSET, y, {
    color: COLORS.textMuted,
    size: TICK_LABEL_SIZE,
    weight: "500",
  });
}

export function drawRulerChrome(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
): void {
  const { layout, metrics } = presentation;
  const rulerHeight = metrics.rulerHeight;
  const left = metrics.trackHeaderWidth;
  const right = layout.sceneRect.width;

  graphics
    .rect(
      layout.trackHeaderRect.x,
      layout.trackHeaderRect.y,
      layout.trackHeaderRect.width,
      layout.trackHeaderRect.height,
    )
    .fill({ color: COLORS.panel });
  graphics
    .rect(
      layout.rulerRect.x,
      layout.rulerRect.y,
      layout.rulerRect.width,
      layout.rulerRect.height,
    )
    .fill({ color: COLORS.panel });
  graphics
    .rect(0, 0, layout.trackHeaderRect.width, rulerHeight)
    .fill({ color: COLORS.panel });

  const twoTier = hasGroups(presentation);
  const tierTop = twoTier ? rulerTierSplit(rulerHeight) : 0;
  const bands = presentation.rulerBands;

  // Shaded columns (e.g. weekends) on the label tier, under the labels.
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]!;
    if (band.kind !== "shade") continue;
    const x0 = Math.max(band.x0, left);
    const x1 = Math.min(band.x1, right);
    if (x1 <= x0) continue;
    graphics
      .rect(x0, tierTop, x1 - x0, rulerHeight - tierTop)
      .fill({ color: COLORS.weekend });
  }

  // Upper tier: group labels, sticky at the left edge of the timeline and
  // pushed out by the next group (like a sticky section header). The
  // separator only divides the upper tier, so it never crosses a label of
  // the lower one.
  if (twoTier) {
    for (let i = 0; i < bands.length; i += 1) {
      const band = bands[i]!;
      if (band.kind !== "group") continue;
      if (band.x1 <= left || band.x0 >= right) continue;
      if (band.x0 >= left) {
        graphics
          .moveTo(Math.round(band.x0) + 0.5, 6)
          .lineTo(Math.round(band.x0) + 0.5, tierTop)
          .stroke({ color: COLORS.gridMajor, width: 1 });
      }
      const label = band.label;
      if (!label) continue;
      const width = label.length * GROUP_CHAR_PX;
      let x = Math.max(band.x0, left) + 10;
      if (x + width > band.x1 - 8) x = band.x1 - 8 - width;
      if (x < band.x0 + 6 || x < left + 4) continue;
      addText(textLayer, label, x, 6, {
        color: COLORS.text,
        size: GROUP_LABEL_SIZE,
        weight: "600",
      });
    }
  }

  // Lower tier (or the only tier): tick marks + labels.
  const ticks = presentation.rulerTicks;
  const labelY = twoTier
    ? tierTop + Math.round((rulerHeight - tierTop - TICK_LABEL_SIZE) / 2) - 2
    : 11;

  // Pass 1: the emphasised pill (if any) claims its span first.
  let pillLeft = Number.POSITIVE_INFINITY;
  let pillRight = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ticks.length; i += 1) {
    const tick = ticks[i]!;
    if (!tick.emphasis || !tick.label) continue;
    measureLabel(tick, tick.label, left);
    pillLeft = extentLeft;
    pillRight = extentRight;
    break;
  }

  // Pass 2: marks + labels. A label is skipped when it would reach into the
  // header corner or touch the pill.
  for (let i = 0; i < ticks.length; i += 1) {
    const tick = ticks[i]!;
    if (tick.isBar && tick.x >= left) {
      graphics
        .moveTo(tick.x, rulerHeight - MAJOR_TICK_PX)
        .lineTo(tick.x, rulerHeight)
        .stroke({ color: COLORS.gridMajor, width: 1 });
    }
    const label = tick.label;
    if (!label) continue;
    measureLabel(tick, label, left);
    if (!tick.emphasis) {
      if (extentLeft < left + 2) continue;
      if (
        extentRight > pillLeft - LABEL_GAP &&
        extentLeft < pillRight + LABEL_GAP
      ) {
        continue;
      }
    }
    drawTickLabel(graphics, textLayer, tick, label, labelY);
  }

  graphics
    .moveTo(0, rulerHeight - 0.5)
    .lineTo(right, rulerHeight - 0.5)
    .stroke({ color: COLORS.rowLine, width: 1 });
  graphics
    .moveTo(left - 0.5, 0)
    .lineTo(left - 0.5, layout.sceneRect.height)
    .stroke({ color: COLORS.rowLine, width: 1 });
}

export function drawTimelineGrid(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, rulerTicks, rulerBands, layout } = presentation;
  // Grid runs through the track area only (below the overview lane).
  const top = getTracksTop(metrics);
  const bottom = layout.sceneRect.height;
  for (let i = 0; i < rulerBands.length; i += 1) {
    const band = rulerBands[i]!;
    if (band.kind !== "shade") continue;
    const x0 = Math.max(band.x0, metrics.trackHeaderWidth);
    if (band.x1 <= x0) continue;
    graphics
      .rect(x0, top, band.x1 - x0, bottom - top)
      .fill({ color: COLORS.weekend });
  }
  for (const tick of rulerTicks) {
    if (tick.x < metrics.trackHeaderWidth) continue;
    graphics
      .moveTo(tick.x, top)
      .lineTo(tick.x, bottom)
      .stroke({
        color: tick.isBar ? COLORS.gridMajor : COLORS.gridMinor,
        width: 1,
      });
  }
}
