// Canvas geometry of the finance shell, picked once from the window height
// when the playlist is built (the core's metrics are fixed per instance).
//
// Short windows (laptops at 125–150 % scaling are ~650–770 px tall) spend
// the height where it pays: a slightly shorter money lane and tighter rows,
// so the plan shows ~8 rows instead of ~5. Tall windows keep the roomy
// layout. The DOM overlays (side rail, readout, banners, valley card) align
// to the same numbers through the CSS variables of `shellLayoutStyle`.
import type { CSSProperties } from "react";
import type { PlaylistMetrics } from "@slicex/canvas";
import { FINANCE_PLAYLIST_METRICS } from "./mapping";

export type ShellDensity = "comfortable" | "compact" | "tight";

/** Window heights (CSS px) at which the canvas switches density. */
export const COMFORTABLE_MIN_HEIGHT = 860;
export const COMPACT_MIN_HEIGHT = 720;

const LANE_HEIGHT: Record<ShellDensity, number> = {
  comfortable: 112,
  compact: 96,
  tight: 88,
};

// 60 px still fits the header's name + subtitle + meter (track-rows hides
// them under 58) and a clip's name + amount.
const TRACK_HEIGHT: Record<ShellDensity, number> = {
  comfortable: FINANCE_PLAYLIST_METRICS.trackHeight,
  compact: 60,
  tight: 60,
};

export function shellDensityFor(viewportHeight: number): ShellDensity {
  if (!Number.isFinite(viewportHeight) || viewportHeight >= COMFORTABLE_MIN_HEIGHT) {
    return "comfortable";
  }
  return viewportHeight >= COMPACT_MIN_HEIGHT ? "compact" : "tight";
}

export function financeShellMetrics(density: ShellDensity): PlaylistMetrics {
  return {
    ...FINANCE_PLAYLIST_METRICS,
    trackHeight: TRACK_HEIGHT[density],
    overviewLaneHeight: LANE_HEIGHT[density],
  };
}

/** CSS variables the DOM overlays use to sit below the ruler + money lane. */
export function shellLayoutStyle(metrics: PlaylistMetrics): CSSProperties {
  return {
    "--pl-ruler-h": `${metrics.rulerHeight}px`,
    "--pl-lane-h": `${metrics.overviewLaneHeight}px`,
    "--pl-header-w": `${metrics.trackHeaderWidth}px`,
  } as CSSProperties;
}
