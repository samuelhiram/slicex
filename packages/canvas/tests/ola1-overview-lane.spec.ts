// Ola 1 — overview lane (metrics.overviewLaneHeight > 0).
//
//   1. Without a lane (default metrics) the layout, hit-testing and the
//      controller behave exactly as before — every track-area consumer now
//      goes through getTracksTop(metrics), which IS rulerHeight then.
//   2. With a lane, a band of that height sits between the ruler and the
//      first track: every geometry consumer shifts (rows, clips, ghost,
//      scrollbars, mask rect, screenY↔track), and the lane behaves like the
//      ruler (seek + scrub). Its header cell is inert chrome.
//   3. The lane layer draws a cached scene graph: rebuilt only on its dirty
//      keys (data ref, scrollX, pxPerBeat, width, lane geometry).
import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  DEFAULT_PLAYLIST_METRICS,
  getTracksTop,
  getVerticalScrollableRange,
  screenYToTrackIndex,
  stepSeriesValueAt,
  trackIndexToScreenY,
  type PlaylistMetrics,
  type PlaylistOverviewData,
  type PlaylistState,
  type PlaylistStepSeries,
} from "../src/playlist-core";
import {
  createPlaylistInteractionController,
  hitTestPlaylist,
} from "../src/playlist-interaction";
import {
  computeOverviewScale,
  createOverviewLaneLayer,
  overviewToneOf,
  OVERVIEW_TONE_DANGER,
  OVERVIEW_TONE_POSITIVE,
  OVERVIEW_TONE_WARNING,
  walkVisibleSteps,
} from "../src/playlist-renderer-pixi/layers/overview-lane";

const M = DEFAULT_PLAYLIST_METRICS;
const LANE = 80;
const LANE_M: PlaylistMetrics = { ...DEFAULT_PLAYLIST_METRICS, overviewLaneHeight: LANE };

function sizedDemoState(overrides: Partial<PlaylistState["viewport"]> = {}): PlaylistState {
  const state = createDemoPlaylistState();
  return {
    ...state,
    viewport: { ...state.viewport, width: 1200, height: 700, ...overrides },
  };
}

function stepSeries(count: number, valueAt: (i: number) => number, initial = 0): PlaylistStepSeries {
  const beats: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    beats.push(i);
    values.push(valueAt(i));
  }
  return { initial, beats, values };
}

function overviewData(primary: PlaylistStepSeries): PlaylistOverviewData {
  return {
    title: "Cash",
    primary,
    secondary: stepSeries(40, (i) => 1000 - i * 10),
    baseline: stepSeries(40, (i) => 300 + i * 5),
    thresholds: [
      { value: 0, tone: "danger", label: "zero" },
      { value: 500, tone: "warning", label: "reserve" },
    ],
    annotations: [
      { beat: 6, value: -200, label: "valley", tone: "danger" },
      { beat: 5000, value: 100, label: "far away", tone: "info" },
    ],
    formatValue: (v) => `$${Math.round(v)}`,
  };
}

type Listener = (event: PointerEvent) => void;

function createHost() {
  const listeners = new Map<string, Listener>();
  const host = {
    style: {},
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatchEvent() {
      return true;
    },
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointer(x: number, y: number, extra: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    detail: 1,
    timeStamp: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
    ...extra,
  } as unknown as PointerEvent;
}

function texts(node: Container): string[] {
  const out: string[] = [];
  const walk = (c: Container) => {
    for (const child of c.children) {
      if (child instanceof Text) {
        if (child.visible) out.push(child.text);
      } else {
        walk(child as Container);
      }
    }
  };
  walk(node);
  return out;
}

function makeLaneLayer() {
  const parts = {
    container: new Container(),
    frameGraphics: new Graphics(),
    frameText: new Container(),
    curveGraphics: new Graphics(),
    curveText: new Container(),
    dynamicGraphics: new Graphics(),
  };
  parts.container.addChild(
    parts.frameGraphics,
    parts.frameText,
    parts.curveGraphics,
    parts.curveText,
    parts.dynamicGraphics,
  );
  return { parts, layer: createOverviewLaneLayer(parts) };
}

describe("overview lane — default metrics keep the historical layout", () => {
  it("tracks start at rulerHeight and the lane rect is empty", () => {
    expect(M.overviewLaneHeight).toBe(0);
    expect(getTracksTop(M)).toBe(M.rulerHeight);
    const state = sizedDemoState({ scrollY: 30 });
    const pres = createPlaylistPresentation(state, M);
    expect(pres.layout.overviewRect.height).toBe(0);
    expect(pres.layout.overviewHeaderRect.height).toBe(0);
    expect(pres.layout.timelineRect.y).toBe(M.rulerHeight);
    expect(pres.layout.timelineRect.height).toBe(700 - M.rulerHeight);
    expect(pres.scrollbars.vertical.trackRect.y).toBe(M.rulerHeight);
    // Historical formulas, verbatim.
    for (const row of pres.trackRows) {
      expect(row.rowRect.y).toBe(M.rulerHeight + row.index * M.trackHeight - 30);
    }
    for (const view of pres.clipViews) {
      expect(view.rect.y).toBe(
        M.rulerHeight + view.trackIndex * M.trackHeight + M.clipPaddingY - 30,
      );
    }
    expect(trackIndexToScreenY(state, 2, M)).toBe(M.rulerHeight + 2 * M.trackHeight - 30);
    expect(screenYToTrackIndex(state, M.rulerHeight + 1, M)).toBe(0);
    // Virtual rows still fill the viewport below the 8 demo tracks.
    const deep = createPlaylistPresentation(sizedDemoState({ scrollY: 600 }), M);
    expect(deep.trackRows.some((row) => row.isVirtual)).toBe(true);
  });

  it("hit-test boundary between ruler and tracks is unchanged", () => {
    const core = createPlaylistCore(sizedDemoState());
    const pres = core.getPresentation();
    expect(hitTestPlaylist(pres, { x: 700, y: M.rulerHeight }, M).kind).toBe("ruler");
    expect(hitTestPlaylist(pres, { x: 700, y: M.rulerHeight + 1 }, M).kind).not.toBe("ruler");
    // Header column right under the ruler is a track header, never chrome.
    expect(hitTestPlaylist(pres, { x: 60, y: M.rulerHeight + 20 }, M).kind).toBe("track-header");
  });
});

describe("overview lane — layout with overviewLaneHeight > 0", () => {
  const tracksTop = M.rulerHeight + LANE;

  it("reserves the band between the ruler and the first track", () => {
    expect(getTracksTop(LANE_M)).toBe(tracksTop);
    const state = sizedDemoState({ scrollY: 30 });
    const pres = createPlaylistPresentation(state, LANE_M);
    expect(pres.layout.rulerRect).toEqual({ x: M.trackHeaderWidth, y: 0, width: 1200 - M.trackHeaderWidth, height: M.rulerHeight });
    expect(pres.layout.overviewRect).toEqual({ x: M.trackHeaderWidth, y: M.rulerHeight, width: 1200 - M.trackHeaderWidth, height: LANE });
    expect(pres.layout.overviewHeaderRect).toEqual({ x: 0, y: M.rulerHeight, width: M.trackHeaderWidth, height: LANE });
    expect(pres.layout.timelineRect.y).toBe(tracksTop);
    expect(pres.layout.timelineRect.height).toBe(700 - tracksTop);
    expect(pres.layout.trackBodyRect.y).toBe(tracksTop);
    expect(pres.scrollbars.vertical.trackRect.y).toBe(tracksTop);
    expect(pres.scrollbars.vertical.trackRect.height).toBe(700 - tracksTop - M.scrollbarSize);

    const base = createPlaylistPresentation(state, M);
    // The track area is LANE px shorter, so it may emit one row fewer.
    expect(pres.trackRows.length).toBeGreaterThan(0);
    for (const row of pres.trackRows) {
      const before = base.trackRowsByIndex.get(row.index)!;
      expect(row.rowRect.y).toBe(before.rowRect.y + LANE);
      expect(row.headerRect.y).toBe(before.headerRect.y + LANE);
      expect(row.buttons.mute.y).toBe(before.buttons.mute.y + LANE);
      expect(row.resizeHandleRect.y).toBe(before.resizeHandleRect.y + LANE);
    }
    for (const view of pres.clipViews) {
      const before = base.clipViewsById.get(view.clip.id)!;
      expect(view.rect.y).toBe(before.rect.y + LANE);
      expect(view.titleRect.y).toBe(before.titleRect.y + LANE);
      for (let i = 0; i < view.automationPoints.length; i += 1) {
        expect(view.automationPoints[i]!.position.y).toBe(
          before.automationPoints[i]!.position.y + LANE,
        );
      }
    }
    // screenY ↔ track index (geometry + presentation closures agree).
    for (const index of [0, 3, 9]) {
      const y = trackIndexToScreenY(state, index, LANE_M);
      expect(y).toBe(pres.trackIndexToScreenY(index));
      expect(screenYToTrackIndex(state, y + 1, LANE_M)).toBe(index);
      expect(pres.screenYToTrackIndex(y + 1)).toBe(index);
    }
  });

  it("vertical scroll range accounts for the lane", () => {
    const state = sizedDemoState();
    // Track area shrinks by the lane height → more to scroll.
    expect(getVerticalScrollableRange(state, LANE_M)).toBe(
      getVerticalScrollableRange(state, M) + LANE,
    );
  });

  it("drop ghost follows the shifted tracks", () => {
    const core = createPlaylistCore(sizedDemoState(), { metrics: LANE_M });
    core.setDragPreview({
      kind: "clip-move",
      primaryClipId: "clip-bass-1",
      previewTrackIndex: 2,
      previewStart: 4,
      allMoves: [{ id: "clip-bass-1", start: 4, trackIndex: 2 }],
    });
    const ghost = core.getPresentation().dragPreviewView!.primaryRect!;
    expect(ghost.y).toBe(tracksTop + 2 * M.trackHeight + M.clipPaddingY);
  });

  it("hit-test: lane = ruler, lane header = chrome, nothing hit through the lane", () => {
    // Scrolled so the first track (and its clips) slide under the lane.
    const core = createPlaylistCore(sizedDemoState({ scrollY: 40 }), { metrics: LANE_M });
    const pres = core.getPresentation();
    const clipUnderLane = pres.clipViewsById.get("clip-drums-1")!;
    expect(clipUnderLane.rect.y).toBeLessThan(tracksTop);
    const probe = { x: clipUnderLane.rect.x + 30, y: tracksTop - 4 };
    expect(probe.y).toBeGreaterThan(clipUnderLane.rect.y);
    expect(hitTestPlaylist(pres, probe, LANE_M).kind).toBe("ruler");
    expect(hitTestPlaylist(pres, { x: 600, y: M.rulerHeight + 1 }, LANE_M).kind).toBe("ruler");
    expect(hitTestPlaylist(pres, { x: 60, y: M.rulerHeight + 10 }, LANE_M).kind).toBe("chrome");
    expect(hitTestPlaylist(pres, { x: 60, y: tracksTop - 1 }, LANE_M).kind).toBe("chrome");
    // Just below the lane: the (partially scrolled) first track again.
    expect(hitTestPlaylist(pres, { x: 60, y: tracksTop + 2 }, LANE_M).kind).toBe("track-header");
    expect(hitTestPlaylist(pres, { x: probe.x, y: tracksTop + 2 }, LANE_M).kind).toBe("clip");
  });

  it("pointer down + drag in the lane seeks and scrubs the play position", () => {
    const core = createPlaylistCore(sizedDemoState(), { metrics: LANE_M });
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const x = M.trackHeaderWidth + 10 * 28 + 3; // ~10.1 beats → snaps to 10
    listeners.get("pointerdown")!(pointer(x, M.rulerHeight + LANE / 2));
    expect(core.getState().playPosition.time).toBe(10);
    listeners.get("pointermove")!(pointer(x + 5 * 28, M.rulerHeight + 10));
    expect(core.getState().playPosition.time).toBe(15);
    expect(core.getState().tooltip).not.toBeNull();
    listeners.get("pointerup")!(pointer(x + 5 * 28, M.rulerHeight + 10));
    expect(core.getState().tooltip).toBeNull();
    expect(core.canUndo()).toBe(false);
    controller.destroy();
  });

  it("the lane header cell is inert (no marquee, no clip, no selection change)", () => {
    const core = createPlaylistCore(sizedDemoState(), { metrics: LANE_M });
    core.setSelection({ clipIds: ["clip-bass-1"], automationPointIds: [] });
    core.setTool("draw");
    const before = core.getState();
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    listeners.get("pointerdown")!(pointer(60, M.rulerHeight + 20));
    listeners.get("pointermove")!(pointer(90, M.rulerHeight + 40));
    listeners.get("pointerup")!(pointer(90, M.rulerHeight + 40));
    const after = core.getState();
    expect(after.clips).toBe(before.clips);
    expect(after.selection).toBe(before.selection);
    expect(after.marquee).toBeNull();
    controller.destroy();
  });
});

describe("overview lane — step series helpers", () => {
  it("stepSeriesValueAt: initial before the first step, values[i] on [beats[i], beats[i+1])", () => {
    const s: PlaylistStepSeries = { initial: 7, beats: [2, 5, 9], values: [1, 2, 3] };
    expect(stepSeriesValueAt(s, -10)).toBe(7);
    expect(stepSeriesValueAt(s, 1.99)).toBe(7);
    expect(stepSeriesValueAt(s, 2)).toBe(1);
    expect(stepSeriesValueAt(s, 4.9)).toBe(1);
    expect(stepSeriesValueAt(s, 5)).toBe(2);
    expect(stepSeriesValueAt(s, 1e9)).toBe(3);
    expect(stepSeriesValueAt({ initial: 4, beats: [], values: [] }, 3)).toBe(4);
  });

  it("walkVisibleSteps visits only the clipped visible segments", () => {
    const s: PlaylistStepSeries = { initial: 0, beats: [10, 20, 30, 40], values: [1, 2, 3, 4] };
    const seen: Array<[number, number, number]> = [];
    walkVisibleSteps(s, 15, 35, (from, to, value) => seen.push([from, to, value]));
    expect(seen).toEqual([
      [15, 20, 1],
      [20, 30, 2],
      [30, 35, 3],
    ]);
    seen.length = 0;
    walkVisibleSteps(s, 0, 5, (from, to, value) => seen.push([from, to, value]));
    expect(seen).toEqual([[0, 5, 0]]);
    seen.length = 0;
    walkVisibleSteps(s, 50, 60, (from, to, value) => seen.push([from, to, value]));
    expect(seen).toEqual([[50, 60, 4]]);
  });

  it("scale is global (primary ∪ baseline ∪ thresholds ∪ 0) and tones follow thresholds", () => {
    const data = overviewData(stepSeries(10, (i) => 100 * i - 300));
    const scale = computeOverviewScale(data);
    expect(scale.dataMin).toBe(-300);
    expect(scale.dataMax).toBe(600); // baseline 300..495 < primary max 600
    expect(scale.min).toBeLessThan(-300);
    expect(scale.max).toBeGreaterThan(600);
    expect(scale.hasSecondary).toBe(true);
    expect(scale.secMin).toBe(0);
    expect(scale.secMax).toBe(1000);
    expect(overviewToneOf(-1, scale)).toBe(OVERVIEW_TONE_DANGER);
    expect(overviewToneOf(0, scale)).toBe(OVERVIEW_TONE_WARNING);
    expect(overviewToneOf(499, scale)).toBe(OVERVIEW_TONE_WARNING);
    expect(overviewToneOf(500, scale)).toBe(OVERVIEW_TONE_POSITIVE);
    // A threshold above every value still widens the scale.
    const high = computeOverviewScale({ ...data, thresholds: [{ value: 5000, tone: "warning" }] });
    expect(high.max).toBeGreaterThan(5000);
  });
});

describe("overview lane — cached layer", () => {
  function laneCore(state: PlaylistState = sizedDemoState()) {
    return createPlaylistCore(state, { metrics: LANE_M });
  }

  it("is hidden and draws nothing without a lane", () => {
    const { parts, layer } = makeLaneLayer();
    const core = createPlaylistCore(sizedDemoState());
    layer.sync(core.getPresentation(), overviewData(stepSeries(20, (i) => i)));
    expect(parts.container.visible).toBe(false);
    expect(layer.stats.rebuilds).toBe(0);
    expect(texts(parts.container)).toEqual([]);
  });

  it("draws title, threshold labels, scale labels and only the visible annotations", () => {
    const { parts, layer } = makeLaneLayer();
    const core = laneCore();
    const data = overviewData(stepSeries(40, (i) => (i < 10 ? 800 - i * 100 : 400)));
    layer.sync(core.getPresentation(), data);
    expect(parts.container.visible).toBe(true);
    const shown = texts(parts.container);
    expect(shown).toContain("Cash");
    expect(shown).toContain("zero");
    expect(shown).toContain("reserve");
    expect(shown).toContain("valley");
    expect(shown).not.toContain("far away"); // beat 5000 is off screen
    expect(shown).toContain("$800"); // formatValue on the scale labels
    expect(parts.frameGraphics.context.instructions.length).toBeGreaterThan(3);
    expect(parts.curveGraphics.context.instructions.length).toBeGreaterThan(3);
    expect(layer.stats.rebuilds).toBe(1);
    expect(layer.stats.frameRebuilds).toBe(1);
  });

  it("rebuilds only on data ref / scrollX / pxPerBeat / width — never on hover or playhead", () => {
    const { layer, parts } = makeLaneLayer();
    const core = laneCore();
    const data = overviewData(stepSeries(200, (i) => Math.sin(i / 7) * 1000));
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.rebuilds).toBe(1);
    let clears = 0;
    for (const graphics of [parts.frameGraphics, parts.curveGraphics]) {
      const originalClear = graphics.clear.bind(graphics);
      graphics.clear = () => {
        clears += 1;
        return originalClear();
      };
    }
    const dynamicBefore = layer.stats.dynamicRedraws;
    for (let i = 0; i < 100; i += 1) {
      if (i % 2 === 0) core.setHover({ kind: "clip", clipId: i % 4 === 0 ? "clip-drums-1" : "clip-bass-1" });
      else core.setPlayPosition(i / 4);
      core.setSelection({ clipIds: [i % 3 === 0 ? "clip-bass-1" : "clip-drums-1"], automationPointIds: [] });
      layer.sync(core.getPresentation(), data);
    }
    expect(layer.stats.rebuilds).toBe(1);
    expect(clears).toBe(0);
    // The playhead layer redraws for actual playhead moves only.
    const redraws = layer.stats.dynamicRedraws - dynamicBefore;
    expect(redraws).toBeGreaterThan(0);
    expect(redraws).toBeLessThanOrEqual(50);
    // Same frame twice → nothing at all.
    const steady = layer.stats.dynamicRedraws;
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.dynamicRedraws).toBe(steady);

    expect(layer.stats.frameRebuilds).toBe(1);

    // New data reference → frame (scale, thresholds) + curves.
    layer.sync(core.getPresentation(), { ...data });
    expect(layer.stats.rebuilds).toBe(2);
    expect(layer.stats.frameRebuilds).toBe(2);
    // Scroll / zoom → curves only; the frame is scroll-independent.
    core.updateViewport({ scrollX: 120 });
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.rebuilds).toBe(3);
    expect(layer.stats.frameRebuilds).toBe(3); // data ref changed back
    core.updateViewport({ scrollX: 240 });
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.rebuilds).toBe(4);
    expect(layer.stats.frameRebuilds).toBe(3);
    core.updateViewport({ pxPerBeat: 20 });
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.rebuilds).toBe(5);
    expect(layer.stats.frameRebuilds).toBe(3);
    // Width → both.
    core.setViewportSize(1000, 700);
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.rebuilds).toBe(6);
    expect(layer.stats.frameRebuilds).toBe(4);
    // scrollY / viewport height do not affect the lane.
    core.updateViewport({ scrollY: 50 });
    core.setViewportSize(1000, 900);
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.rebuilds).toBe(6);
    expect(layer.stats.frameRebuilds).toBe(4);
    layer.dispose();
  });

  it("the playhead dot follows the curve without rebuilding", () => {
    const { layer, parts } = makeLaneLayer();
    const core = laneCore();
    const data = overviewData(stepSeries(40, (i) => (i < 20 ? 1000 : -500)));
    core.setPlayPosition(5);
    layer.sync(core.getPresentation(), data);
    const withDot = parts.dynamicGraphics.context.instructions.length;
    expect(withDot).toBeGreaterThan(0);
    const redraws = layer.stats.dynamicRedraws;
    core.setPlayPosition(25); // crosses into the danger value
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.dynamicRedraws).toBe(redraws + 1);
    expect(layer.stats.rebuilds).toBe(1);
    // Playhead off screen → no line, no dot.
    core.setPlayPosition(10_000);
    layer.sync(core.getPresentation(), data);
    expect(parts.dynamicGraphics.context.instructions.length).toBe(0);
  });

  it("null data draws an empty lane (background, no curves, no text)", () => {
    const { layer, parts } = makeLaneLayer();
    const core = laneCore();
    layer.sync(core.getPresentation(), null);
    expect(parts.container.visible).toBe(true);
    expect(texts(parts.container)).toEqual([]);
    expect(layer.stats.rebuilds).toBe(1);
    layer.sync(core.getPresentation(), null);
    expect(layer.stats.rebuilds).toBe(1);
  });
});
