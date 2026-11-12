// Overview lane — a band between the ruler and the first track that draws a
// host-provided step series (PlaylistOverviewData.primary) as an area toned
// by thresholds, plus optional secondary / baseline curves, threshold lines
// and annotations. The canvas does not know what the values mean.
//
// Canon §3.8 / §3.10 — cached layer, three tiers by dirty key:
//   - Frame (backgrounds, zero line, dashed thresholds + labels, scale
//     labels, title): rebuilt only when the data object reference, the
//     viewport width or the lane geometry change. Scroll / zoom do not touch
//     it (the dashed thresholds were half the cost of a scroll rebuild).
//   - Curves (secondary, primary area + line, baseline, annotations): the
//     frame keys + scrollX + pxPerBeat.
//   - Dynamic (playhead line through the lane + the dot where it crosses
//     the primary curve): redrawn only when the play x / dot y / dot tone
//     change, or after a curve rebuild.
//   Hover, selection, playhead, a drag that keeps the data reference… never
//   clear() or re-emit the frame or the curves.
//   - Culling: each curve is walked from the first step visible on screen
//     (binary search, O(log n)) to the last visible one — never the whole
//     series. The dot evaluates the series at the play time with a binary
//     search (no allocation). The y-scale is computed over the whole data
//     once per data reference (stable while scrolling), never per frame.
//
// All DisplayObjects are created by renderer-impl's init block and passed in
// (the perf lint only allows `new Graphics/Text/Container` there).
import type { Container, Graphics } from "pixi.js";
import {
  sortedUpperBound,
  stepSeriesValueAt,
  type PlaylistOverviewAnnotation,
  type PlaylistOverviewData,
  type PlaylistOverviewThreshold,
  type PlaylistPresentation,
  type PlaylistStepSeries,
} from "../../playlist-core";
import { COLORS } from "../palette";
import { addText, clearTextLayer, disposeTextLayer } from "../text-pool";

const PLOT_PAD_TOP = 12;
const PLOT_PAD_BOTTOM = 6;
const SCALE_PAD_RATIO = 0.08;
const LINE_WIDTH = 2;
const DASH_PX = 5;
const GAP_PX = 4;
const LABEL_SIZE = 10;
const LABEL_CHAR_PX = 6;
const PILL_HEIGHT = 16;
const TITLE_SIZE = 13;
const TITLE_CHAR_PX = 7.8;
const PIN_RADIUS = 3.5;
const DOT_RADIUS = 4.5;
const GUIDE_DOT_PX = 2;

export const OVERVIEW_TONE_POSITIVE = 0;
export const OVERVIEW_TONE_WARNING = 1;
export const OVERVIEW_TONE_DANGER = 2;

// Global scale of one PlaylistOverviewData. Mutable + reused: recomputed in
// place only when the data reference changes.
export interface OverviewScale {
  // Padded primary-scale bounds (primary ∪ baseline ∪ thresholds ∪ 0).
  min: number;
  max: number;
  // Raw (unpadded) primary ∪ baseline extents, for the scale labels.
  dataMin: number;
  dataMax: number;
  // Secondary curve on its own scale (∪ 0). hasSecondary false = skip it.
  secMin: number;
  secMax: number;
  hasSecondary: boolean;
  // Values strictly below dangerLevel tone danger; below warningLevel tone
  // warning; anything else positive. -Infinity when no such threshold.
  dangerLevel: number;
  warningLevel: number;
  // 0 = linear; > 0 = symlog constant (min/max above are in symlog space).
  symlog: number;
}

// Symmetric log transform (monotonic, odd): linear near 0, log far away.
export function symlogOf(value: number, constant: number): number {
  if (constant <= 0) return value;
  return value < 0
    ? -Math.log1p(-value / constant)
    : Math.log1p(value / constant);
}

export function createOverviewScale(): OverviewScale {
  return {
    symlog: 0,
    min: -1,
    max: 1,
    dataMin: 0,
    dataMax: 0,
    secMin: 0,
    secMax: 0,
    hasSecondary: false,
    dangerLevel: Number.NEGATIVE_INFINITY,
    warningLevel: Number.NEGATIVE_INFINITY,
  };
}

function seriesMin(series: PlaylistStepSeries, acc: number): number {
  let out = Math.min(acc, series.initial);
  const values = series.values;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (v < out) out = v;
  }
  return out;
}

function seriesMax(series: PlaylistStepSeries, acc: number): number {
  let out = Math.max(acc, series.initial);
  const values = series.values;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (v > out) out = v;
  }
  return out;
}

// O(series length): call once per data reference, not per frame.
export function computeOverviewScale(
  data: PlaylistOverviewData,
  out: OverviewScale = createOverviewScale(),
): OverviewScale {
  let dataMin = seriesMin(data.primary, Number.POSITIVE_INFINITY);
  let dataMax = seriesMax(data.primary, Number.NEGATIVE_INFINITY);
  if (data.baseline) {
    dataMin = seriesMin(data.baseline, dataMin);
    dataMax = seriesMax(data.baseline, dataMax);
  }
  // A host domain (e.g. round steps with hysteresis) fixes the scale: small
  // edits no longer move the whole curve. Never narrower than the data.
  if (data.domain) {
    dataMin = Math.min(dataMin, data.domain.min);
    dataMax = Math.max(dataMax, data.domain.max);
  }
  let min = Math.min(dataMin, 0);
  let max = Math.max(dataMax, 0);
  let dangerLevel = Number.NEGATIVE_INFINITY;
  let warningLevel = Number.NEGATIVE_INFINITY;
  for (const threshold of data.thresholds) {
    if (threshold.value < min) min = threshold.value;
    if (threshold.value > max) max = threshold.value;
    if (threshold.tone === "danger") {
      if (threshold.value > dangerLevel) dangerLevel = threshold.value;
    } else if (threshold.value > warningLevel) {
      warningLevel = threshold.value;
    }
  }
  const constant =
    data.scale && data.scale.kind === "symlog" && data.scale.constant > 0
      ? data.scale.constant
      : 0;
  out.symlog = constant;
  min = symlogOf(min, constant);
  max = symlogOf(max, constant);
  const range = max - min;
  const pad = range > 0 ? range * SCALE_PAD_RATIO : 1;
  out.min = min - pad;
  out.max = max + pad;
  out.dataMin = dataMin;
  out.dataMax = dataMax;
  out.dangerLevel = dangerLevel;
  out.warningLevel = warningLevel;
  if (data.secondary) {
    out.secMin = seriesMin(data.secondary, 0);
    out.secMax = seriesMax(data.secondary, 0);
    out.hasSecondary = out.secMax > out.secMin;
  } else {
    out.secMin = 0;
    out.secMax = 0;
    out.hasSecondary = false;
  }
  return out;
}

export function overviewToneOf(value: number, scale: OverviewScale): number {
  if (value < scale.dangerLevel) return OVERVIEW_TONE_DANGER;
  if (value < scale.warningLevel) return OVERVIEW_TONE_WARNING;
  return OVERVIEW_TONE_POSITIVE;
}

function toneColor(tone: number): number {
  if (tone === OVERVIEW_TONE_DANGER) return COLORS.toneDanger;
  if (tone === OVERVIEW_TONE_WARNING) return COLORS.toneWarning;
  return COLORS.tonePositive;
}

function thresholdColor(threshold: PlaylistOverviewThreshold): number {
  return threshold.tone === "danger" ? COLORS.toneDanger : COLORS.toneWarning;
}

function annotationColor(annotation: PlaylistOverviewAnnotation): number {
  if (annotation.tone === "danger") return COLORS.toneDanger;
  if (annotation.tone === "warning") return COLORS.toneWarning;
  return COLORS.toneInfo;
}

function defaultFormatValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// Walks the steps of `series` that intersect [fromBeat, toBeat]: visit is
// called once per visible segment with its clipped beat range and value.
// O(log n + visible segments): the start is found by binary search.
export function walkVisibleSteps(
  series: PlaylistStepSeries,
  fromBeat: number,
  toBeat: number,
  visit: (segmentFrom: number, segmentTo: number, value: number) => void,
): void {
  if (!(toBeat > fromBeat)) return;
  const beats = series.beats;
  const values = series.values;
  const n = Math.min(beats.length, values.length);
  let index = Math.min(sortedUpperBound(beats, fromBeat), n);
  let value = index === 0 ? series.initial : values[index - 1]!;
  let from = fromBeat;
  for (;;) {
    const next = index < n ? beats[index]! : Number.POSITIVE_INFINITY;
    const to = next < toBeat ? next : toBeat;
    if (to > from) visit(from, to, value);
    if (next >= toBeat) return;
    value = values[index]!;
    if (next > from) from = next;
    index += 1;
  }
}

function dashH(g: Graphics, x0: number, x1: number, y: number): void {
  for (let x = x0; x < x1; x += DASH_PX + GAP_PX) {
    g.moveTo(x, y).lineTo(Math.min(x + DASH_PX, x1), y);
  }
}

function dashV(g: Graphics, x: number, y0: number, y1: number): void {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = top; y < bottom; y += DASH_PX + GAP_PX) {
    g.moveTo(x, y).lineTo(x, Math.min(y + DASH_PX, bottom));
  }
}

export interface OverviewLaneParts {
  // Holds everything below; hidden while the metrics have no lane.
  container: Container;
  // Frame: backgrounds, zero line, thresholds (+ labels), scale labels,
  // title, separators. Independent of scroll / zoom.
  frameGraphics: Graphics;
  frameText: Container;
  // Curves: secondary, primary area + line, baseline, annotations.
  curveGraphics: Graphics;
  curveText: Container;
  // Playhead line through the lane + the dot on the primary curve.
  dynamicGraphics: Graphics;
}

export interface OverviewLaneStats {
  // Frame rebuilds: data reference, viewport width or lane geometry changed.
  frameRebuilds: number;
  // Curve geometry rebuilds: the frame keys + scrollX / pxPerBeat.
  rebuilds: number;
  // Playhead line / dot redraws.
  dynamicRedraws: number;
}

export interface OverviewLaneLayer {
  sync(
    presentation: PlaylistPresentation,
    data: PlaylistOverviewData | null,
  ): void;
  readonly stats: OverviewLaneStats;
  // Rebuild every tier on the next sync (e.g. the theme changed).
  invalidate(): void;
  dispose(): void;
}

export function createOverviewLaneLayer(
  parts: OverviewLaneParts,
): OverviewLaneLayer {
  const stats: OverviewLaneStats = {
    frameRebuilds: 0,
    rebuilds: 0,
    dynamicRedraws: 0,
  };
  const scale = createOverviewScale();
  let scaleData: PlaylistOverviewData | null = null;

  // Dirty keys. Frame: data ref + width + lane geometry. Curves: those +
  // scrollX + pxPerBeat.
  let built = false;
  let lastData: PlaylistOverviewData | null = null;
  let lastScrollX = 0;
  let lastPxPerBeat = 0;
  let lastWidth = 0;
  let lastLaneY = 0;
  let lastLaneHeight = 0;
  let lastHeaderWidth = 0;

  // Plot box + data of the last frame rebuild (the curves and the dynamic
  // layer map values with it).
  let plotTop = 0;
  let plotBottom = 0;
  let plotData: PlaylistOverviewData | null = null;

  // Dirty keys of the dynamic layer.
  let lastPlayX = Number.NEGATIVE_INFINITY;
  let lastDotY = Number.NEGATIVE_INFINITY;
  let lastDotTone = -2;
  // Flat [x, y, w, h, …] of annotation labels placed in the current rebuild.
  const placedLabels: number[] = [];

  const yOf = (value: number): number => {
    const span = scale.max - scale.min;
    const t = symlogOf(value, scale.symlog);
    const ratio = span > 0 ? (t - scale.min) / span : 0.5;
    return plotBottom - ratio * (plotBottom - plotTop);
  };
  // Crisp 1px horizontals.
  const yLine = (value: number): number => Math.round(yOf(value)) + 0.5;

  function rebuildFrame(
    presentation: PlaylistPresentation,
    data: PlaylistOverviewData | null,
  ): void {
    stats.frameRebuilds += 1;
    const g = parts.frameGraphics;
    const text = parts.frameText;
    g.clear();
    clearTextLayer(text);
    const lane = presentation.layout.overviewRect;
    const head = presentation.layout.overviewHeaderRect;
    const laneBottom = lane.y + lane.height;
    const right = lane.x + lane.width;
    plotTop = lane.y + Math.min(PLOT_PAD_TOP, lane.height * 0.25);
    plotBottom = laneBottom - Math.min(PLOT_PAD_BOTTOM, lane.height * 0.15);
    plotData = data && lane.width > 0 ? data : null;

    g.rect(head.x, head.y, head.width, head.height).fill({
      color: COLORS.panel,
    });
    g.rect(lane.x, lane.y, lane.width, lane.height).fill({
      color: COLORS.overviewBackground,
    });

    if (plotData) {
      const frameData = plotData;
      if (frameData !== scaleData) {
        computeOverviewScale(frameData, scale);
        scaleData = frameData;
      }
      // Zero line.
      const yZero = yLine(0);
      g.moveTo(lane.x, yZero)
        .lineTo(right, yZero)
        .stroke({ color: COLORS.overviewZeroLine, width: 1, alpha: 0.9 });
      // Thresholds: dashed lines (their labels are drawn with the curves,
      // above the series, see drawFixedLabels).
      for (const threshold of frameData.thresholds) {
        const y = yLine(threshold.value);
        if (y < lane.y || y > laneBottom) continue;
        dashH(g, lane.x, right, y);
        g.stroke({ color: thresholdColor(threshold), width: 1, alpha: 0.7 });
      }
      // Guides: faint dotted lines at the host's round values (their labels
      // go with the other fixed labels, see drawFixedLabels).
      const guides = frameData.guides;
      if (guides && guides.length > 0) {
        let drew = false;
        for (let i = 0; i < guides.length; i += 1) {
          const y = yLine(guides[i]!);
          if (y < plotTop - 0.5 || y > plotBottom + 0.5) continue;
          for (let x = lane.x; x < right; x += GUIDE_DOT_PX * 3) {
            g.moveTo(x, y).lineTo(Math.min(x + GUIDE_DOT_PX, right), y);
          }
          drew = true;
        }
        if (drew) g.stroke({ color: COLORS.overviewZeroLine, width: 1, alpha: 0.75 });
      }
      const maxTitleChars = Math.floor((head.width - 24) / TITLE_CHAR_PX);
      addText(text, truncate(frameData.title, maxTitleChars), 16, lane.y + 12, {
        size: TITLE_SIZE,
        color: COLORS.text,
        weight: "600",
      });
    }

    g.moveTo(0, laneBottom - 0.5)
      .lineTo(right, laneBottom - 0.5)
      .stroke({ color: COLORS.rowLine, width: 1 });
    g.moveTo(head.width - 0.5, head.y)
      .lineTo(head.width - 0.5, laneBottom)
      .stroke({ color: COLORS.rowLine, width: 1 });
  }

  // Curves over the visible beat range only. Runs after rebuildFrame on the
  // same frame whenever the frame rebuilt (scale / plot box are current).
  function rebuildCurves(presentation: PlaylistPresentation): void {
    stats.rebuilds += 1;
    const g = parts.curveGraphics;
    const text = parts.curveText;
    g.clear();
    clearTextLayer(text);
    const data = plotData;
    if (!data) return;
    const lane = presentation.layout.overviewRect;
    const right = lane.x + lane.width;
    const viewport = presentation.state.viewport;
    const pxPerBeat = viewport.pxPerBeat;
    const scrollX = viewport.scrollX;
    const fromBeat = scrollX / pxPerBeat;
    const viewEndBeat = (scrollX + lane.width) / pxPerBeat;
    // No curve past the data's end (e.g. the projection horizon).
    const toBeat =
      data.endBeat !== undefined ? Math.min(viewEndBeat, data.endBeat) : viewEndBeat;
    const xOf = (beat: number): number => lane.x + beat * pxPerBeat - scrollX;
    const yZero = yLine(0);
    if (data.endBeat !== undefined && data.endBeat < viewEndBeat) {
      const endX = Math.max(lane.x, xOf(data.endBeat));
      g.rect(endX, lane.y, right - endX, lane.height).fill({
        color: COLORS.gridMinor,
        alpha: 0.75,
      });
      dashV(g, Math.round(endX) + 0.5, lane.y + 2, lane.y + lane.height - 2);
      g.stroke({ color: COLORS.overviewBaseline, width: 1, alpha: 0.6 });
    }

    // 1. Secondary curve: faint area on its own scale, from the bottom.
    const secondary = data.secondary;
    if (secondary && scale.hasSecondary) {
      const secSpan = scale.secMax - scale.secMin;
      const secY = (value: number): number =>
        plotBottom - ((value - scale.secMin) / secSpan) * (plotBottom - plotTop);
      {
        // Line only: a filled area would compete with the primary curve.
        let lineStarted = false;
        walkVisibleSteps(secondary, fromBeat, toBeat, (from, to, value) => {
          const y = Math.round(secY(value)) + 0.5;
          if (!lineStarted) {
            g.moveTo(xOf(from), y);
            lineStarted = true;
          }
          g.lineTo(xOf(from), y).lineTo(xOf(to), y);
        });
        // Legible on its own (the header cell names it "Deuda"): UX-11.
        g.stroke({ color: COLORS.overviewSecondary, width: 1.25, alpha: 0.7 });
      }
    }

    // 2. Primary area: one polygon per run of equal tone AND sign, so every
    // polygon is simple (never crosses the zero line).
    let runKey = -1;
    let runEndX = lane.x;
    const closeRun = (): void => {
      g.lineTo(runEndX, yZero)
        .closePath()
        .fill({ color: toneColor(runKey >> 1), alpha: COLORS.areaAlpha });
    };
    walkVisibleSteps(data.primary, fromBeat, toBeat, (from, to, value) => {
      const x0 = xOf(from);
      const x1 = xOf(to);
      const y = yLine(value);
      const key = overviewToneOf(value, scale) * 2 + (value < 0 ? 1 : 0);
      if (key !== runKey) {
        if (runKey >= 0) closeRun();
        g.moveTo(x0, yZero);
        runKey = key;
      }
      g.lineTo(x0, y).lineTo(x1, y);
      runEndX = x1;
    });
    if (runKey >= 0) closeRun();

    // 3. Primary step line on top, toned per run, continuous.
    let lineTone = -1;
    let lastY = 0;
    walkVisibleSteps(data.primary, fromBeat, toBeat, (from, to, value) => {
      const x0 = xOf(from);
      const x1 = xOf(to);
      const y = yLine(value);
      const tone = overviewToneOf(value, scale);
      if (lineTone < 0) {
        g.moveTo(x0, y);
        lineTone = tone;
      } else if (tone !== lineTone) {
        g.stroke({ color: toneColor(lineTone), width: LINE_WIDTH });
        g.moveTo(x0, lastY);
        lineTone = tone;
      }
      g.lineTo(x0, y).lineTo(x1, y);
      lastY = y;
    });
    if (lineTone >= 0) {
      g.stroke({ color: toneColor(lineTone), width: LINE_WIDTH });
    }

    // 4. Baseline: gray dashed step line on the primary scale.
    const baseline = data.baseline;
    if (baseline) {
      let prevY = Number.NaN;
      let drew = false;
      walkVisibleSteps(baseline, fromBeat, toBeat, (from, to, value) => {
        const x0 = xOf(from);
        const y = yLine(value);
        if (prevY === prevY && prevY !== y) dashV(g, x0, prevY, y);
        dashH(g, x0, xOf(to), y);
        prevY = y;
        drew = true;
      });
      if (drew) {
        g.stroke({ color: COLORS.overviewBaseline, width: 1, alpha: 0.75 });
      }
    }

    // 5. Labels, above the curves (and the horizon shade): the fixed ones
    // (threshold names at the left edge, scale extents at the right) claim
    // their boxes first, then every pin, then the annotation pills, which
    // avoid all of them. Rebuild-time only.
    placedLabels.length = 0;
    drawFixedLabels(g, text, lane, data);
    const annotations = data.annotations;
    for (let i = 0; i < annotations.length; i += 1) {
      const annotation = annotations[i]!;
      const x = xOf(annotation.beat);
      if (x < lane.x - PIN_RADIUS || x > right + PIN_RADIUS) continue;
      const y = clampNumber(yOf(annotation.value), plotTop, plotBottom);
      g.circle(x, y, PIN_RADIUS)
        .fill({ color: annotationColor(annotation) })
        .stroke({ color: COLORS.overviewBackground, width: 2 });
      placedLabels.push(x - PIN_RADIUS - 1, y - PIN_RADIUS - 1, PIN_RADIUS * 2 + 2, PIN_RADIUS * 2 + 2);
    }
    for (let i = 0; i < annotations.length; i += 1) {
      const annotation = annotations[i]!;
      const label = annotation.label;
      if (label.length === 0) continue;
      const x = xOf(annotation.beat);
      if (x < lane.x - PIN_RADIUS || x > right + PIN_RADIUS) continue;
      const y = clampNumber(yOf(annotation.value), plotTop, plotBottom);
      const color = annotationColor(annotation);
      const width = label.length * LABEL_CHAR_PX + 14;
      const labelX = clampNumber(
        x - width / 2,
        lane.x + 2,
        Math.max(lane.x + 2, right - width - 2),
      );
      const above =
        y - PILL_HEIGHT - 6 >= lane.y + 1 ? y - PILL_HEIGHT - 6 : y + 6;
      const below =
        y + 6 + PILL_HEIGHT <= lane.y + lane.height ? y + 6 : above;
      const labelY = isFree(labelX, above, width, PILL_HEIGHT)
        ? above
        : isFree(labelX, below, width, PILL_HEIGHT)
          ? below
          : Number.NaN;
      if (Number.isNaN(labelY)) continue;
      placedLabels.push(labelX, labelY, width, PILL_HEIGHT);
      g.roundRect(labelX, labelY, width, PILL_HEIGHT, PILL_HEIGHT / 2)
        .fill({ color: COLORS.panelStrong })
        .stroke({ color, width: 1, alpha: 0.55 });
      addText(text, label, labelX + 7, labelY + 2, {
        size: LABEL_SIZE,
        color,
        weight: "600",
      });
    }
  }

  // True when [x, x + width] × [y, y + height] (plus a 4px gap) overlaps no
  // box placed in this rebuild.
  function isFree(x: number, y: number, width: number, height: number): boolean {
    for (let i = 0; i < placedLabels.length; i += 4) {
      if (
        x < placedLabels[i]! + placedLabels[i + 2]! + 4 &&
        x + width + 4 > placedLabels[i]! &&
        y < placedLabels[i + 1]! + placedLabels[i + 3]! &&
        y + height > placedLabels[i + 1]!
      ) {
        return false;
      }
    }
    return true;
  }

  // Threshold names (left edge, next to their dashed line) and the scale
  // extents (right edge), each on a small backing in the lane colour so the
  // series or the horizon shade never runs through the text.
  function drawFixedLabels(
    g: Graphics,
    text: Container,
    lane: { x: number; y: number; width: number; height: number },
    data: PlaylistOverviewData,
  ): void {
    const laneBottom = lane.y + lane.height;
    const right = lane.x + lane.width;
    for (const threshold of data.thresholds) {
      if (!threshold.label) continue;
      const lineY = yLine(threshold.value);
      if (lineY < lane.y || lineY > laneBottom) continue;
      const y = lineY - 15 >= lane.y + 1 ? lineY - 15 : lineY + 2;
      const width = threshold.label.length * LABEL_CHAR_PX + 8;
      const x = lane.x + 4;
      g.roundRect(x, y, width, 14, 4).fill({
        color: COLORS.overviewBackground,
        alpha: 0.88,
      });
      addText(text, threshold.label, x + 4, y + 1, {
        size: LABEL_SIZE,
        color: thresholdColor(threshold),
        weight: "600",
      });
      placedLabels.push(x, y, width, 14);
    }
    if (scale.dataMax > scale.dataMin) {
      const format = data.formatValue ?? defaultFormatValue;
      const topY = clampNumber(yOf(scale.dataMax) - 7, lane.y + 1, laneBottom - 15);
      const bottomY = clampNumber(yOf(scale.dataMin) - 7, lane.y + 1, laneBottom - 15);
      drawScaleLabel(g, text, format(scale.dataMax), right, topY);
      if (bottomY - topY >= 14) {
        drawScaleLabel(g, text, format(scale.dataMin), right, bottomY);
      }
      // Guide labels where they fit (never over another fixed label).
      const guides = data.guides;
      if (guides) {
        for (let i = 0; i < guides.length; i += 1) {
          const value = guides[i]!;
          const lineY = yLine(value);
          if (lineY < plotTop - 0.5 || lineY > plotBottom + 0.5) continue;
          const label = format(value);
          const y = clampNumber(lineY - 7, lane.y + 1, laneBottom - 15);
          const width = label.length * LABEL_CHAR_PX + 8;
          if (!isFree(right - 4 - width, y, width, 14)) continue;
          drawScaleLabel(g, text, label, right, y);
        }
      }
    }
  }

  function drawScaleLabel(
    g: Graphics,
    text: Container,
    label: string,
    right: number,
    y: number,
  ): void {
    const width = label.length * LABEL_CHAR_PX + 8;
    const x = right - 4 - width;
    g.roundRect(x, y, width, 14, 4).fill({
      color: COLORS.overviewBackground,
      alpha: 0.88,
    });
    addText(text, label, right - 8, y + 1, {
      size: LABEL_SIZE,
      color: COLORS.textMuted,
      weight: "500",
      anchorX: 1,
    });
    placedLabels.push(x, y, width, 14);
  }

  function syncDynamic(
    presentation: PlaylistPresentation,
    force: boolean,
  ): void {
    const play = presentation.playPosition;
    const playX = play.isVisible ? play.x : Number.NEGATIVE_INFINITY;
    let dotY = Number.NEGATIVE_INFINITY;
    let dotTone = -1;
    if (play.isVisible && plotData) {
      const value = stepSeriesValueAt(plotData.primary, play.time);
      dotY = Math.round(clampNumber(yOf(value), plotTop, plotBottom));
      dotTone = overviewToneOf(value, scale);
    }
    if (
      !force &&
      playX === lastPlayX &&
      dotY === lastDotY &&
      dotTone === lastDotTone
    ) {
      return;
    }
    lastPlayX = playX;
    lastDotY = dotY;
    lastDotTone = dotTone;
    stats.dynamicRedraws += 1;
    const g = parts.dynamicGraphics;
    g.clear();
    if (!play.isVisible) return;
    const lane = presentation.layout.overviewRect;
    const top = lane.y;
    const bottom = lane.y + lane.height;
    // Continue the playhead line (knob on the ruler) through the lane.
    g.moveTo(playX + 0.5, top)
      .lineTo(playX + 0.5, bottom)
      .stroke({ color: COLORS.playPosition, width: 1.5 });
    if (dotTone >= 0) {
      g.circle(playX + 0.5, dotY, DOT_RADIUS)
        .fill({ color: toneColor(dotTone) })
        .stroke({ color: COLORS.overviewBackground, width: 2 });
    }
  }

  function sync(
    presentation: PlaylistPresentation,
    data: PlaylistOverviewData | null,
  ): void {
    const lane = presentation.layout.overviewRect;
    if (lane.height <= 0) {
      if (parts.container.visible) parts.container.visible = false;
      return;
    }
    if (!parts.container.visible) parts.container.visible = true;
    const viewport = presentation.state.viewport;
    const headerWidth = presentation.layout.overviewHeaderRect.width;
    const frameDirty =
      !built ||
      data !== lastData ||
      viewport.width !== lastWidth ||
      lane.y !== lastLaneY ||
      lane.height !== lastLaneHeight ||
      headerWidth !== lastHeaderWidth;
    const curvesDirty =
      frameDirty ||
      viewport.scrollX !== lastScrollX ||
      viewport.pxPerBeat !== lastPxPerBeat;
    if (frameDirty) {
      rebuildFrame(presentation, data);
      built = true;
      lastData = data;
      lastWidth = viewport.width;
      lastLaneY = lane.y;
      lastLaneHeight = lane.height;
      lastHeaderWidth = headerWidth;
    }
    if (curvesDirty) {
      rebuildCurves(presentation);
      lastScrollX = viewport.scrollX;
      lastPxPerBeat = viewport.pxPerBeat;
    }
    syncDynamic(presentation, curvesDirty);
  }

  function dispose(): void {
    parts.frameGraphics.clear();
    parts.curveGraphics.clear();
    parts.dynamicGraphics.clear();
    disposeTextLayer(parts.frameText);
    disposeTextLayer(parts.curveText);
    built = false;
    lastData = null;
    scaleData = null;
    plotData = null;
  }

  function invalidate(): void {
    built = false;
    lastPlayX = Number.NEGATIVE_INFINITY;
  }

  return { sync, stats, invalidate, dispose };
}
