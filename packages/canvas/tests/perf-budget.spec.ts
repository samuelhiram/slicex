// Performance budgets enforced by CI.
//
// Each test in this file maps to a rule in docs/performance-canon.md.
// IF A TEST FAILS, DO NOT RELAX THE BUDGET. Fix the regression instead.
// Tolerances are generous on purpose; if they ever fail, performance has
// gotten meaningfully worse, not "the test is flaky".
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  type PlaylistState,
} from "../src/playlist-core";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

function viewportState(overrides: {
  width?: number;
  height?: number;
  scrollX?: number;
  scrollY?: number;
  pxPerBeat?: number;
}): PlaylistState {
  const base = createDemoPlaylistState();
  return {
    ...base,
    viewport: {
      ...base.viewport,
      width: overrides.width ?? 1200,
      height: overrides.height ?? 700,
      scrollX: overrides.scrollX ?? 0,
      scrollY: overrides.scrollY ?? 0,
      pxPerBeat: overrides.pxPerBeat ?? base.viewport.pxPerBeat,
    },
  };
}

function stateWithManyClips(count: number): PlaylistState {
  const base = viewportState({ width: 1200, height: 700 });
  const trackId = base.tracks[0]!.id;
  return {
    ...base,
    clips: Array.from({ length: count }, (_, i) => ({
      id: `c-${i}`,
      type: "audio" as const,
      trackId,
      start: i * 8,
      duration: 4,
      label: "x",
      color: "#fff",
    })),
  };
}

function stateWithManyTracks(count: number): PlaylistState {
  const base = viewportState({ width: 1200, height: 700 });
  return {
    ...base,
    tracks: Array.from({ length: count }, (_, i) => ({
      id: `t-${i}`,
      label: `T${i}`,
      color: "#fff",
    })),
  };
}

describe("perf budget — presentation builds under viewport-relative cost", () => {
  it("createPlaylistPresentation at scrollY=1_000_000 completes < 50ms", () => {
    const state = viewportState({ scrollY: 1_000_000 });
    const t0 = performance.now();
    createPlaylistPresentation(state, M);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it("createPlaylistPresentation at scrollX=1_000_000 completes < 50ms", () => {
    const state = viewportState({ scrollX: 1_000_000 });
    const t0 = performance.now();
    createPlaylistPresentation(state, M);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it("createPlaylistPresentation with 1000 clips completes < 30ms", () => {
    const state = stateWithManyClips(1000);
    const t0 = performance.now();
    createPlaylistPresentation(state, M);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(30);
  });

  it("createPlaylistPresentation with 1000 tracks completes < 30ms", () => {
    const state = stateWithManyTracks(1000);
    const t0 = performance.now();
    createPlaylistPresentation(state, M);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(30);
  });
});

describe("perf budget — viewport culling caps the emitted view counts", () => {
  it("clipViews scale with viewport, not clip count (1000 clips)", () => {
    const state = stateWithManyClips(1000);
    const pres = createPlaylistPresentation(state, M);
    // The visible window holds about (viewportWidth / (8 beats * pxPerBeat))
    // clips. Cap is generous so the test only fails on actual regression.
    expect(pres.clipViews.length).toBeLessThan(50);
  });

  it("trackRows cap when scrolling far past content", () => {
    const state = viewportState({ scrollY: 1_000_000 });
    const pres = createPlaylistPresentation(state, M);
    expect(pres.trackRows.length).toBeLessThan(40);
  });

  it("rulerTicks cap when scrolling far past content", () => {
    const state = viewportState({ scrollX: 1_000_000 });
    const pres = createPlaylistPresentation(state, M);
    expect(pres.rulerTicks.length).toBeLessThan(200);
  });
});

describe("perf budget — hot-path actions are idempotent", () => {
  // Each of these gets invoked ≥30Hz (pointermove, rAF, ResizeObserver).
  // Dispatching with no semantic change must NOT notify subscribers.
  function expectNoNotify(label: string, run: () => void) {
    const core = createPlaylistCore(createDemoPlaylistState());
    // prime any initial state so the run() really is a no-op
    core.setViewportSize(1200, 700);
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    try {
      for (let i = 0; i < 500; i += 1) {
        run();
      }
    } finally {
      sub.unsubscribe();
    }
    expect(count, `${label} should not notify when nothing changes`).toBe(0);
  }

  it("ADVANCE_PLAY_POSITION while not playing", () => {
    expectNoNotify("advancePlayPosition !running", () => {
      const core = createPlaylistCore(createDemoPlaylistState());
      core.advancePlayPosition(0.016);
    });
  });

  it("SET_HOVER with the same hover", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setHover({ kind: "clip", clipId: "clip-drums-1" });
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setHover({ kind: "clip", clipId: "clip-drums-1" });
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_PLAY_POSITION with the same time", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setPlayPosition(12);
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setPlayPosition(12);
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_VIEWPORT_SIZE with the same size", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setViewportSize(1200, 700);
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("UPDATE_VIEWPORT with the same viewport", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.updateViewport({});
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_TOOL with the same tool", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setTool("select");
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_SNAP_MODE with the same mode", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setSnapMode("beat");
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_TRANSPORT_MODE with the same mode", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setTransportMode("song");
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  // Fase 8 / F1 — three new overlay actions that fire ≥30Hz during drag.
  // Idempotency is the same canon §4 contract as the actions above.
  it("SET_DRAG_PREVIEW with the same preview", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setDragPreview({
      kind: "clip-resize",
      clipId: "clip-drums-1",
      edge: "right",
      previewStart: 0,
      previewDuration: 16,
    });
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setDragPreview({
        kind: "clip-resize",
        clipId: "clip-drums-1",
        edge: "right",
        previewStart: 0,
        previewDuration: 16,
      });
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_SNAP_HINT with the same hint", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSnapHint({ time: 4, visible: true });
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setSnapHint({ time: 4, visible: true });
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_TOOLTIP with the same tooltip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setTooltip({
      kind: "time",
      text: "3.2.0",
      anchor: { x: 100, y: 50 },
    });
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.setTooltip({
        kind: "time",
        text: "3.2.0",
        anchor: { x: 100, y: 50 },
      });
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  // PERF2-3 — the controller calls moveClips / resizeClip on EVERY
  // pointermove of a drag; between snap steps the target is where the clip
  // already is. Inside the drag's gesture, after a first real move, the
  // repeats must be no-ops (no notify, same clips array → O(1) subscribers).
  it("MOVE_CLIPS to the clip's current start / track (mid-drag)", () => {
    const core = createPlaylistCore(stateWithManyClips(1000));
    core.beginGesture();
    core.moveClips([{ id: "c-3", start: 25, trackIndex: 0 }]);
    const { clips } = core.getState();
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.moveClips([{ id: "c-3", start: 25, trackIndex: 0 }]);
      core.dispatch({
        type: "MOVE_CLIPS",
        updates: [
          { id: "c-3", start: 25, trackIndex: 0 },
          { id: "c-4", start: 32, trackIndex: 0 },
          { id: "c-0", start: -7, trackIndex: 0 }, // clamps to its start 0
        ],
      });
    }
    sub.unsubscribe();
    core.endGesture();
    expect(count).toBe(0);
    expect(core.getState().clips).toBe(clips);
  });

  it("MOVE_CLIPS no-op outside a gesture records no undo entry", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.moveClips([{ id: "clip-bass-1", start: 4, trackIndex: 1 }]);
    }
    sub.unsubscribe();
    expect(count).toBe(0);
    expect(core.canUndo()).toBe(false);
  });

  it("RESIZE_CLIP to the clip's current edge (mid-drag)", () => {
    const core = createPlaylistCore(stateWithManyClips(1000));
    core.setClipContentOffset("c-5", 1.5);
    core.beginGesture();
    core.resizeClip("c-3", "right", 30); // c-3: 24..28 → 24..30
    core.resizeClip("c-6", "right", 48.1); // c-6: clamped to minClipDuration
    const { clips } = core.getState();
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 500; i += 1) {
      core.resizeClip("c-3", "right", 30);
      core.resizeClip("c-3", "left", 24);
      // Still below the minimum: clamps to the duration it already has.
      core.resizeClip("c-6", "right", 48.05);
      // Left edge of a slipped clip at its own start: offset shifts by 0.
      core.resizeClip("c-5", "left", 40);
    }
    sub.unsubscribe();
    core.endGesture();
    expect(count).toBe(0);
    expect(core.getState().clips).toBe(clips);
    expect(core.getState().clips.find((c) => c.id === "c-6")!.duration).toBe(
      M.minClipDuration,
    );
  });
});

describe("perf budget — getMaxScrollY/X stay infinite (timeline is unbounded)", () => {
  // Caps reintroduced here are regressions; the renderer-side cull is the
  // correct way to bound cost, not artificially limiting the user's scroll.
  it("scrollY = 1_000_000 is preserved (not clamped)", () => {
    const core = createPlaylistCore(viewportState({}));
    core.updateViewport({ scrollY: 1_000_000 });
    expect(core.getState().viewport.scrollY).toBe(1_000_000);
  });

  it("scrollX = 1_000_000 is preserved (not clamped)", () => {
    const core = createPlaylistCore(viewportState({}));
    core.updateViewport({ scrollX: 1_000_000 });
    expect(core.getState().viewport.scrollX).toBe(1_000_000);
  });
});

describe("perf budget — dispatch is cheap when state is stable", () => {
  it("10000 idempotent dispatches stay under 100 ms", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      core.setHover({ kind: "clip", clipId: "clip-drums-1" });
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});

// SYNC-15 — a dispatch that does not touch clips/tracks must hand back the
// SAME state.clips / state.tracks arrays. normalizeState used to clone every
// clip on every dispatch, so hover / playhead / viewport (60 Hz) cost O(N)
// allocations and defeated every `state.clips === last` short-circuit in
// subscribers (renderer, financial bridge). Canon §1.1.
describe("perf budget — UI dispatches keep clips/tracks identity", () => {
  function expectIdentityKept(label: string, run: (core: ReturnType<typeof createPlaylistCore>, i: number) => void) {
    const core = createPlaylistCore(stateWithManyClips(1000));
    core.setPlayPositionRunning(true);
    const { clips, tracks } = core.getState();
    let notifies = 0;
    const sub = core.subscribe(() => {
      notifies += 1;
    });
    for (let i = 0; i < 60; i += 1) {
      run(core, i);
    }
    sub.unsubscribe();
    expect(notifies, `${label} must still notify (state changed)`).toBeGreaterThan(0);
    expect(core.getState().clips, `${label} reallocated state.clips`).toBe(clips);
    expect(core.getState().tracks, `${label} reallocated state.tracks`).toBe(tracks);
  }

  it("setHover across clips", () => {
    expectIdentityKept("setHover", (core, i) =>
      core.setHover({ kind: "clip", clipId: `c-${i % 2}` }),
    );
  });

  it("setPlayPosition", () => {
    expectIdentityKept("setPlayPosition", (core, i) => core.setPlayPosition(i + 1));
  });

  it("advancePlayPosition while playing", () => {
    expectIdentityKept("advancePlayPosition", (core) =>
      core.advancePlayPosition(0.25),
    );
  });

  it("updateViewport scroll + zoom", () => {
    expectIdentityKept("updateViewport", (core, i) =>
      core.updateViewport({ scrollX: i * 10, pxPerBeat: 20 + (i % 5) }),
    );
  });

  it("a clip edit still yields a new, normalized clips array (tracks kept)", () => {
    const core = createPlaylistCore(stateWithManyClips(10));
    const { clips, tracks } = core.getState();
    // To an empty row: nothing to stack on, so no track changes (dropping
    // it on c-0 would stack it in a 2nd lane and resize track 0 —
    // lanes.spec.ts covers that).
    core.dispatch({
      type: "MOVE_CLIPS",
      updates: [{ id: "c-3", start: -5, trackIndex: 1 }],
    });
    const next = core.getState();
    expect(next.clips).not.toBe(clips);
    expect(next.clips.find((c) => c.id === "c-3")!.start).toBe(0);
    expect(next.tracks).toBe(tracks);
    // Track-only edit: tracks rebuilt, clips array reused; undo restores.
    core.renameTrack(0, "Renamed");
    expect(core.getState().clips).toBe(next.clips);
    expect(core.getState().tracks).not.toBe(tracks);
    core.undo();
    expect(core.getState().tracks[0]!.label).toBe(tracks[0]!.label);
    expect(core.getState().clips).toBe(next.clips);
  });

  it("1000 hover changes over 1000 clips stay under 30 ms", () => {
    const core = createPlaylistCore(stateWithManyClips(1000));
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      core.setHover({ kind: "clip", clipId: `c-${i % 2}` });
    }
    expect(performance.now() - t0).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// Ola 1 — host visual providers (canon §3.8 / §3.10 "Providers del host").
// The overview lane and the clip content are cached scene graphs: steady
// frames (hover, playhead, selection) must not re-emit their geometry, and
// a long step series costs O(log n + visible steps) per rebuild.
import { Container, Graphics } from "pixi.js";
import type {
  PlaylistClipContent,
  PlaylistOverviewData,
  PlaylistStepSeries,
} from "../src/playlist-core";
import { createClipNodeRegistry } from "../src/playlist-renderer-pixi/clip-node-registry";
import { createOverviewLaneLayer } from "../src/playlist-renderer-pixi/layers/overview-lane";

const LANE_METRICS = { ...M, overviewLaneHeight: 96 };

function dailySeries(count: number): PlaylistStepSeries {
  const beats = new Array<number>(count);
  const values = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    beats[i] = i;
    values[i] = Math.round(Math.sin(i / 9) * 5000 + Math.cos(i / 31) * 3000);
  }
  return { initial: 0, beats, values };
}

function laneData(primary: PlaylistStepSeries): PlaylistOverviewData {
  return {
    title: "Primary",
    primary,
    secondary: primary,
    baseline: primary,
    thresholds: [
      { value: 0, tone: "danger", label: "0" },
      { value: 2000, tone: "warning", label: "reserve" },
    ],
    annotations: [{ beat: 40, value: -3000, label: "low", tone: "danger" }],
  };
}

function laneLayer() {
  const parts = {
    container: new Container(),
    frameGraphics: new Graphics(),
    frameText: new Container(),
    curveGraphics: new Graphics(),
    curveText: new Container(),
    dynamicGraphics: new Graphics(),
  };
  return { parts, layer: createOverviewLaneLayer(parts) };
}

describe("perf budget — overview lane is a cached layer", () => {
  it("0 geometry rebuilds across 100 hover / playhead / selection frames", () => {
    const core = createPlaylistCore(viewportState({}), { metrics: LANE_METRICS });
    const data = laneData(dailySeries(1000));
    const { layer } = laneLayer();
    layer.sync(core.getPresentation(), data);
    const rebuilds = layer.stats.rebuilds;
    for (let i = 0; i < 100; i += 1) {
      if (i % 3 === 0) core.setHover({ kind: "clip", clipId: `clip-drums-${1 + (i % 2)}` });
      else if (i % 3 === 1) core.setPlayPosition(i / 3);
      else core.setSelection({ clipIds: i % 2 ? ["clip-bass-1"] : [], automationPointIds: [] });
      layer.sync(core.getPresentation(), data);
    }
    expect(layer.stats.rebuilds - rebuilds).toBe(0);
  });

  it("1000-point series: a rebuild walks only the visible steps", () => {
    // 1200px wide at 28 px/beat ≈ 38 visible beats of a 1000-step series.
    const core = createPlaylistCore(viewportState({ scrollX: 400 * 28 }), {
      metrics: LANE_METRICS,
    });
    const countLineTos = (series: PlaylistStepSeries): number => {
      const { parts, layer } = laneLayer();
      let lineTos = 0;
      for (const graphics of [parts.frameGraphics, parts.curveGraphics]) {
        const lineTo = graphics.lineTo.bind(graphics);
        graphics.lineTo = ((x: number, y: number) => {
          lineTos += 1;
          return lineTo(x, y);
        }) as typeof graphics.lineTo;
      }
      layer.sync(core.getPresentation(), laneData(series));
      return lineTos;
    };
    const thousand = countLineTos(dailySeries(1000));
    // Same visible window over a 100x longer series: identical geometry.
    expect(countLineTos(dailySeries(100_000))).toBe(thousand);
    // ~38 visible steps × 4 curve passes × 2 points + dashed thresholds /
    // baseline. Walking the whole 1000-step series would be ≥ 8000.
    expect(thousand).toBeLessThan(1000);
  });

  // Measured ≈ 0.26 ms / rebuild isolated, ≤ 0.7 ms under the full parallel
  // suite. 1.5 ms (< 10% of a 60 Hz frame) is the regression line.
  it("1000-point series: 100 scroll rebuilds < 150 ms; 100k points too (O(log n + visible))", () => {
    const core = createPlaylistCore(viewportState({}), { metrics: LANE_METRICS });
    const data = laneData(dailySeries(1000));
    const { layer } = laneLayer();
    layer.sync(core.getPresentation(), data); // warm-up (scale computed once)
    const t0 = performance.now();
    for (let i = 1; i <= 100; i += 1) {
      core.updateViewport({ scrollX: i * 37 });
      layer.sync(core.getPresentation(), data);
    }
    const thousand = performance.now() - t0;
    expect(layer.stats.rebuilds).toBe(101);
    expect(thousand).toBeLessThan(150);

    const huge = laneData(dailySeries(100_000));
    layer.sync(core.getPresentation(), huge); // scale pass over 100k (once)
    const t1 = performance.now();
    for (let i = 1; i <= 100; i += 1) {
      core.updateViewport({ scrollX: 50_000 * 28 + i * 37 });
      layer.sync(core.getPresentation(), huge);
    }
    expect(performance.now() - t1).toBeLessThan(150);
  });
});

describe("perf budget — clip content repaints only on reference change", () => {
  it("100 hover / playhead frames with stable content refs → 0 body redraws", () => {
    const core = createPlaylistCore(stateWithManyClips(1000));
    core.setViewportSize(1200, 700);
    const cache = new Map<string, PlaylistClipContent>();
    const registry = createClipNodeRegistry(
      {
        text: 0xffffff,
        textMuted: 0x999999,
        selected: 0x00ff00,
        hover: 0x0000ff,
        rowLine: 0x333333,
        panel: 0x111111,
        panelStrong: 0x222222,
        automationLine: 0xff00ff,
      },
      {
        getClipContent: (id) => {
          let content = cache.get(id);
          if (!content) {
            content = { kind: "events", beats: [1, 2, 3, 900], values: [1, -1, 0.5, 1] };
            cache.set(id, content);
          }
          return content;
        },
      },
    );
    const parent = new Container();
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    let redraws = 0;
    for (const child of parent.children) {
      const body = (child as Container).children[0] as Graphics;
      const clear = body.clear.bind(body);
      body.clear = () => {
        redraws += 1;
        return clear();
      };
    }
    for (let i = 0; i < 100; i += 1) {
      if (i % 2) core.setPlayPosition(i);
      else core.setSelection({ clipIds: [], automationPointIds: [] });
      registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    }
    expect(redraws).toBe(0);
    registry.destroy();
  });
});
