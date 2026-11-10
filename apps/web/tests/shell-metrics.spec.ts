// Canvas density of the finance shell: picked from the window height so
// short laptop windows (125–150 % scaling) show more rows.
import { describe, expect, it } from "vitest";
import { FINANCE_PLAYLIST_METRICS } from "../src/finance/mapping";
import {
  COMFORTABLE_MIN_HEIGHT,
  COMPACT_MIN_HEIGHT,
  financeShellMetrics,
  shellDensityFor,
  shellLayoutStyle,
} from "../src/finance/shell-metrics";

describe("shellDensityFor", () => {
  it("tall windows stay comfortable; laptops get compact; very short get tight", () => {
    expect(shellDensityFor(1080)).toBe("comfortable");
    expect(shellDensityFor(COMFORTABLE_MIN_HEIGHT)).toBe("comfortable");
    expect(shellDensityFor(COMFORTABLE_MIN_HEIGHT - 1)).toBe("compact");
    // 1920×1080 at 125 % → ~1536×738 of viewport.
    expect(shellDensityFor(738)).toBe("compact");
    expect(shellDensityFor(COMPACT_MIN_HEIGHT)).toBe("compact");
    expect(shellDensityFor(COMPACT_MIN_HEIGHT - 1)).toBe("tight");
    expect(shellDensityFor(600)).toBe("tight");
  });

  it("an unknown height (no window) falls back to comfortable", () => {
    expect(shellDensityFor(Number.NaN)).toBe("comfortable");
    expect(shellDensityFor(Number.POSITIVE_INFINITY)).toBe("comfortable");
  });
});

describe("financeShellMetrics", () => {
  it("only the money lane and the row height change with the density", () => {
    const comfortable = financeShellMetrics("comfortable");
    expect(comfortable).toEqual({ ...FINANCE_PLAYLIST_METRICS, overviewLaneHeight: 112 });
    expect(financeShellMetrics("compact")).toEqual({
      ...FINANCE_PLAYLIST_METRICS,
      trackHeight: 60,
      overviewLaneHeight: 96,
    });
    expect(financeShellMetrics("tight")).toEqual({
      ...FINANCE_PLAYLIST_METRICS,
      trackHeight: 60,
      overviewLaneHeight: 88,
    });
  });

  it("rows never go below what the track header needs for name + subtitle + meter", () => {
    // track-rows.ts hides the subtitle and the meter under 58 px.
    for (const density of ["comfortable", "compact", "tight"] as const) {
      const metrics = financeShellMetrics(density);
      expect(metrics.trackHeight).toBeGreaterThanOrEqual(58);
      expect(metrics.trackHeight).toBeGreaterThanOrEqual(metrics.trackMinHeight);
      // The lane cell holds the "Caja" title row (+ "Análisis") and the
      // two-line playhead readout under it.
      expect(metrics.overviewLaneHeight).toBeGreaterThanOrEqual(88);
    }
  });
});

describe("shellLayoutStyle", () => {
  it("exposes ruler, lane and header width as CSS variables for the overlays", () => {
    const style = shellLayoutStyle(financeShellMetrics("compact")) as Record<string, string>;
    expect(style["--pl-ruler-h"]).toBe(`${FINANCE_PLAYLIST_METRICS.rulerHeight}px`);
    expect(style["--pl-lane-h"]).toBe("96px");
    expect(style["--pl-header-w"]).toBe(`${FINANCE_PLAYLIST_METRICS.trackHeaderWidth}px`);
  });
});
