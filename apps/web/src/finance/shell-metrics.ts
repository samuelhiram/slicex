// Canvas geometry of the finance shell, picked once from the window height
// when the playlist is built (the core's metrics are fixed per instance).
//
// Short windows (laptops at 125–150 % scaling are ~650–770 px tall) spend
// the height where it pays: a slightly shorter money lane and tighter rows,
// so the plan shows ~8 rows instead of ~5. Tall windows keep the roomy
// layout. The DOM overlays (side rail, readout, banners, valley card) align
// to the same numbers through the CSS variables of `shellLayoutStyle`.
//
// UX-29: very short windows (≤ 500 px: a laptop at 200 % zoom is 640×360,
// at 400 % 320×256) fold the money lane to ~a title row and use slim rows,
// so at 640×360 — header, banner in the flow and all — at least three
// event lines show whole. Picked at mount like the others: switching it
// live needs metrics the core can change in place (P2-19, pending).
import type { CSSProperties } from "react";
import { getHorizontalScrollbarHeight, type PlaylistMetrics } from "@slicex/canvas";
import { FINANCE_PLAYLIST_METRICS } from "./mapping";

export type ShellDensity = "comfortable" | "compact" | "tight" | "short";

/** Window heights (CSS px) at which the canvas switches density. */
export const COMFORTABLE_MIN_HEIGHT = 860;
export const COMPACT_MIN_HEIGHT = 720;
/** At or below this height the shell is "short" (UX-29). */
export const SHORT_MAX_HEIGHT = 500;

// The money lane: a compact chart (its cell holds only the "Caja" title —
// the day's reading and "Pagar deudas" live in the header).
const LANE_HEIGHT: Record<ShellDensity, number> = {
  comfortable: 80,
  compact: 72,
  tight: 64,
  short: 48,
};

// 60 px still fits the header's name + subtitle + meter (track-rows hides
// them under 58) and a clip's name + amount.
const TRACK_HEIGHT: Record<ShellDensity, number> = {
  comfortable: FINANCE_PLAYLIST_METRICS.trackHeight,
  compact: 60,
  tight: 60,
  // Below the 58 px where track-rows drops the subtitle and the meter: the
  // row keeps its name (and the clips theirs). Only on very short windows.
  short: 44,
};

export function shellDensityFor(viewportHeight: number): ShellDensity {
  if (!Number.isFinite(viewportHeight) || viewportHeight >= COMFORTABLE_MIN_HEIGHT) {
    return "comfortable";
  }
  if (viewportHeight >= COMPACT_MIN_HEIGHT) return "compact";
  return viewportHeight > SHORT_MAX_HEIGHT ? "tight" : "short";
}

/**
 * Window widths (CSS px) under which the header column (the event lines'
 * names) narrows: on a phone the full 216 px left the timeline ~150 px.
 */
export const NARROW_MAX_WIDTH = 639;
/** The header column on narrow windows: an 11-character name, its yearly impact. */
export const NARROW_HEADER_WIDTH = 132;

export function financeShellMetrics(
  density: ShellDensity,
  viewportWidth: number = Number.POSITIVE_INFINITY,
): PlaylistMetrics {
  return {
    ...FINANCE_PLAYLIST_METRICS,
    trackHeight: TRACK_HEIGHT[density],
    overviewLaneHeight: LANE_HEIGHT[density],
    trackHeaderWidth:
      Number.isFinite(viewportWidth) && viewportWidth <= NARROW_MAX_WIDTH
        ? NARROW_HEADER_WIDTH
        : FINANCE_PLAYLIST_METRICS.trackHeaderWidth,
  };
}

/** CSS variables the DOM overlays use to sit below the ruler + money lane. */
export function shellLayoutStyle(metrics: PlaylistMetrics): CSSProperties {
  return {
    "--pl-ruler-h": `${metrics.rulerHeight}px`,
    "--pl-lane-h": `${metrics.overviewLaneHeight}px`,
    "--pl-header-w": `${metrics.trackHeaderWidth}px`,
    // The horizontal scrollbar (navigator): what floats at the bottom of the
    // stage stays clear of it.
    "--pl-hbar-h": `${getHorizontalScrollbarHeight(metrics)}px`,
  } as CSSProperties;
}
