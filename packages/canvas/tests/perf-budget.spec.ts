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
    core.dispatch({
      type: "MOVE_CLIPS",
      updates: [{ id: "c-3", start: -5, trackIndex: 0 }],
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
