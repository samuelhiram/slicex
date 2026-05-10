import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  getMaxScrollX,
  getMaxScrollY,
  type PlaylistState,
} from "../src/playlist-core";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

function countNotifications(
  core: ReturnType<typeof createPlaylistCore>,
  fn: () => void,
): number {
  let count = 0;
  const sub = core.subscribe(() => {
    count += 1;
  });
  try {
    fn();
  } finally {
    sub.unsubscribe();
  }
  return count;
}

describe("perf — dispatch is idempotent for no-op actions", () => {
  it("ADVANCE_PLAY_POSITION while not running does not notify", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const calls = countNotifications(core, () => {
      // 60 frames at 16ms each — emulates one second of rAF.
      for (let i = 0; i < 60; i += 1) {
        core.advancePlayPosition(0.016);
      }
    });
    expect(calls).toBe(0);
  });

  it("SET_HOVER on the same hovered clip is a no-op after the first call", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setHover({ kind: "clip", clipId: "clip-drums-1" });
    const calls = countNotifications(core, () => {
      for (let i = 0; i < 30; i += 1) {
        core.setHover({ kind: "clip", clipId: "clip-drums-1" });
      }
    });
    expect(calls).toBe(0);
  });

  it("SET_PLAY_POSITION with the same time is a no-op", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setPlayPosition(12);
    const calls = countNotifications(core, () => {
      for (let i = 0; i < 30; i += 1) {
        core.setPlayPosition(12);
      }
    });
    expect(calls).toBe(0);
  });

  it("UPDATE_VIEWPORT with the same viewport is a no-op", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const before = core.getState();
    const calls = countNotifications(core, () => {
      core.updateViewport({});
      core.setViewportSize(1200, 700);
    });
    expect(calls).toBe(0);
    expect(core.getState()).toBe(before);
  });

  it("real ADVANCE_PLAY_POSITION after isRunning=true still notifies", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setPlayPositionRunning(true);
    const calls = countNotifications(core, () => {
      core.advancePlayPosition(0.5);
    });
    expect(calls).toBe(1);
  });
});

describe("perf — infinite scroll is preserved", () => {
  it("getMaxScrollY / getMaxScrollX stay Infinity (unbounded timeline)", () => {
    const state: PlaylistState = {
      ...createDemoPlaylistState(),
      viewport: {
        ...createDemoPlaylistState().viewport,
        width: 1000,
        height: 600,
      },
    };
    expect(getMaxScrollY(state, M)).toBe(Number.POSITIVE_INFINITY);
    expect(getMaxScrollX(state, M)).toBe(Number.POSITIVE_INFINITY);
  });

  it("scrolling far past content is allowed (no clamp)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 600);
    core.updateViewport({ scrollX: 1_000_000, scrollY: 1_000_000 });
    const v = core.getState().viewport;
    expect(v.scrollX).toBe(1_000_000);
    expect(v.scrollY).toBe(1_000_000);
  });

  it("presentation far from origin only emits the visible row band", () => {
    const state: PlaylistState = {
      ...createDemoPlaylistState(),
      viewport: {
        ...createDemoPlaylistState().viewport,
        width: 1200,
        height: 600,
        scrollX: 0,
        scrollY: 1_000_000,
      },
    };
    const t0 = performance.now();
    const pres = createPlaylistPresentation(state, M);
    const elapsed = performance.now() - t0;
    // Visible rows: ~ (height - ruler) / trackHeight + a few of overscan.
    expect(pres.trackRows.length).toBeLessThan(40);
    // Should be effectively instant — well under a frame budget.
    expect(elapsed).toBeLessThan(50);
  });

  it("presentation far on X only emits ruler ticks for the visible window", () => {
    const state: PlaylistState = {
      ...createDemoPlaylistState(),
      viewport: {
        ...createDemoPlaylistState().viewport,
        width: 1200,
        height: 600,
        scrollX: 1_000_000,
      },
    };
    const pres = createPlaylistPresentation(state, M);
    expect(pres.rulerTicks.length).toBeLessThan(200);
  });
});

describe("perf — presentation skips clips outside the viewport", () => {
  function buildStateWithManyClips(count: number): PlaylistState {
    const state = createDemoPlaylistState();
    const trackId = state.tracks[0]!.id;
    return {
      ...state,
      viewport: { ...state.viewport, width: 800, height: 400, scrollX: 0 },
      clips: Array.from({ length: count }, (_, i) => ({
        id: `gen-${i}`,
        type: "audio" as const,
        trackId,
        start: i * 8,
        duration: 4,
        label: "g",
        color: "#fff",
      })),
    };
  }

  it("only emits clip presentations within the overscan band", () => {
    const state = buildStateWithManyClips(500);
    const pres = createPlaylistPresentation(state, M);
    expect(pres.clipViews.length).toBeLessThan(state.clips.length);
    // Sanity: nothing past the right edge of the timeline can be present.
    const horizonBeats =
      state.viewport.scrollX / state.viewport.pxPerBeat +
      (state.viewport.width - M.trackHeaderWidth) / state.viewport.pxPerBeat +
      M.timelineOverscanPx / state.viewport.pxPerBeat;
    for (const view of pres.clipViews) {
      expect(view.clip.start).toBeLessThanOrEqual(horizonBeats);
    }
  });

  it("scrolling reveals a different slice of clips", () => {
    const state = buildStateWithManyClips(500);
    const presA = createPlaylistPresentation(state, M);
    const idsA = new Set(presA.clipViews.map((v) => v.clip.id));
    const scrolled: PlaylistState = {
      ...state,
      viewport: { ...state.viewport, scrollX: 4000 },
    };
    const presB = createPlaylistPresentation(scrolled, M);
    const idsB = new Set(presB.clipViews.map((v) => v.clip.id));
    // The two slices should not be identical.
    let intersection = 0;
    for (const id of idsB) if (idsA.has(id)) intersection += 1;
    expect(intersection).toBeLessThan(idsB.size);
  });
});
