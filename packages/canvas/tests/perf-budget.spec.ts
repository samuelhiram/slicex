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
