// Ola 1 — PlaylistCoreOptions.virtualTracks + the "axis" snap mode.
//
// virtualTracks (default true = FL "infinite tracks"):
//   false → no virtual "Track N" rows; vertical extent / scroll stop at the
//   last real track (getMaxScrollY itself stays infinite); no gesture
//   materialises a track.
// "axis" snap: nearest PlaylistTimeAxis.snapTargets target; without an axis
//   (or targets) it behaves like "beat"; Alt bypasses it like any mode.
import { describe, expect, it } from "vitest";
import { createPlaylistInteractionController } from "../src/playlist-interaction";
import { brushSnapStep } from "../src/playlist-interaction/brush";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getMaxScrollY,
  getRealTracksScrollLimit,
  getVerticalContentExtent,
  snapStepBeats,
  snapTime,
  type PlaylistState,
  type PlaylistTimeAxis,
} from "../src/playlist-core";

const M = DEFAULT_PLAYLIST_METRICS;

function sizedDemoState(height = 700): PlaylistState {
  const state = createDemoPlaylistState();
  return { ...state, viewport: { ...state.viewport, width: 1200, height } };
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

describe("virtualTracks — default true keeps FL infinite tracks", () => {
  it("virtual rows, unbounded scrollY and track materialisation are unchanged", () => {
    const core = createPlaylistCore(sizedDemoState());
    expect(core.virtualTracks).toBe(true);
    expect(core.maxTrackIndex()).toBe(Number.POSITIVE_INFINITY);
    core.updateViewport({ scrollY: 1_000_000 });
    expect(core.getState().viewport.scrollY).toBe(1_000_000);
    expect(core.getPresentation().trackRows.every((row) => row.isVirtual)).toBe(true);
    const id = core.createClip({ trackIndex: 12, start: 0, duration: 4 });
    expect(id).not.toBe("");
    expect(core.getState().tracks.length).toBe(13);
  });
});

describe("virtualTracks: false", () => {
  function finite(height = 700) {
    return createPlaylistCore(sizedDemoState(height), { virtualTracks: false });
  }

  it("draws no virtual rows below the real tracks", () => {
    const core = createPlaylistCore(sizedDemoState(2000), { virtualTracks: false });
    const rows = core.getPresentation().trackRows;
    expect(rows.length).toBe(8);
    expect(rows.some((row) => row.isVirtual)).toBe(false);
  });

  it("vertical extent covers the real tracks only; scrollY stops at the last track", () => {
    const core = finite(400);
    const state = core.getState();
    const realHeight = 8 * M.trackHeight;
    expect(
      getVerticalContentExtent(state, M, core.getLayoutOptions()),
    ).toBe(realHeight + M.scrollbarSize);
    const limit = getRealTracksScrollLimit(state, M);
    expect(limit).toBe(realHeight + M.scrollbarSize - (400 - M.rulerHeight));
    core.updateViewport({ scrollY: 1_000_000 });
    expect(core.getState().viewport.scrollY).toBe(limit);
    // At the limit the last track's bottom rests on the horizontal scrollbar.
    const last = core.getPresentation().trackRows.at(-1)!;
    expect(last.rowRect.y + last.rowRect.height).toBe(400 - M.scrollbarSize);
    // Repeating the clamped scroll is idempotent (no notify).
    let notifies = 0;
    const sub = core.subscribe(() => {
      notifies += 1;
    });
    for (let i = 0; i < 100; i += 1) core.updateViewport({ scrollY: 5_000 + i });
    sub.unsubscribe();
    expect(notifies).toBe(0);
    core.updateViewport({ scrollY: -50 });
    expect(core.getState().viewport.scrollY).toBe(0);
    // getMaxScrollY itself stays infinite (canon §2.5).
    expect(getMaxScrollY(state, M)).toBe(Number.POSITIVE_INFINITY);
  });

  it("tracks that fit the viewport do not scroll; a taller viewport pulls scrollY back", () => {
    const core = finite(400);
    core.updateViewport({ scrollY: 10_000 });
    expect(core.getState().viewport.scrollY).toBeGreaterThan(0);
    core.setViewportSize(1200, 2000);
    expect(core.getState().viewport.scrollY).toBe(0);
    core.updateViewport({ scrollY: 300 });
    expect(core.getState().viewport.scrollY).toBe(0);
    const thumb = core.getPresentation().scrollbars.vertical;
    expect(thumb.thumbRect.height).toBe(thumb.trackRect.height);
  });

  it("no gesture materialises a track", () => {
    const core = finite();
    const tracks = core.getState().tracks;
    expect(core.maxTrackIndex()).toBe(7);
    expect(core.createClip({ trackIndex: 8, start: 0, duration: 4 })).toBe("");
    expect(core.createClips([
      { trackIndex: 9, start: 0, duration: 4 },
      { trackIndex: 7, start: 100, duration: 4 },
    ]).length).toBe(1);
    expect(core.getState().tracks).toBe(tracks);
    core.moveClips([{ id: "clip-bass-1", start: 4, trackIndex: 20 }]);
    const bass = core.getState().clips.find((c) => c.id === "clip-bass-1")!;
    expect(bass.trackId).toBe("track-8");
    expect(core.getState().tracks.length).toBe(8);
    core.nudgeSelection(0, 1); // nothing selected → no-op
    core.setSelection({ clipIds: ["clip-bass-1"], automationPointIds: [] });
    core.nudgeSelection(0, 1);
    expect(core.getState().tracks.length).toBe(8);
    // Paste below the last track: skipped like a locked destination.
    core.copyToClipboard();
    expect(core.pasteClipboard({ atTime: 50, atTrackIndex: 12 })).toEqual([]);
    expect(core.pasteClipboard({ atTime: 50, atTrackIndex: 7 }).length).toBe(1);
    expect(core.getState().tracks.length).toBe(8);
  });

  it("dragging a clip below the last track lands it on the last track", () => {
    const core = finite(2000);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-bass-1")!;
    const x = view.rect.x + 40;
    listeners.get("pointerdown")!(pointer(x, view.rect.y + 30));
    listeners.get("pointermove")!(pointer(x, M.rulerHeight + 14 * M.trackHeight));
    expect(core.getState().dragPreview).toMatchObject({ kind: "clip-move", previewTrackIndex: 7 });
    listeners.get("pointerup")!(pointer(x, M.rulerHeight + 14 * M.trackHeight));
    const bass = core.getState().clips.find((c) => c.id === "clip-bass-1")!;
    expect(bass.trackId).toBe("track-8");
    expect(core.getState().tracks.length).toBe(8);
    controller.destroy();
  });
});

describe('snap mode "axis"', () => {
  // Irregular targets (like month starts): 0, 31, 59, 90, 120, ...
  const MONTHS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  function monthAxis(calls: Array<[number, number]> = []): PlaylistTimeAxis {
    return {
      ticks: () => [],
      formatTime: (beat) => `d${beat}`,
      snapTargets(from, to) {
        calls.push([from, to]);
        const out: number[] = [];
        for (let year = Math.floor(from / 365) - 1; year <= Math.ceil(to / 365); year += 1) {
          for (const start of MONTHS.slice(0, 12)) {
            const beat = year * 365 + start;
            if (beat >= from && beat <= to) out.push(beat);
          }
        }
        return out;
      },
    };
  }

  function axisState(): PlaylistState {
    const state = sizedDemoState();
    return { ...state, snap: { mode: "axis", lastActiveMode: "axis" } };
  }

  it("snaps to the nearest target; Alt bypasses", () => {
    const axis = monthAxis();
    const state = axisState();
    expect(snapTime(40, state, false, M, axis)).toBe(31);
    expect(snapTime(50, state, false, M, axis)).toBe(59);
    expect(snapTime(400, state, false, M, axis)).toBe(396); // 365 + 31
    expect(snapTime(40.3, state, true, M, axis)).toBe(40.3);
    const core = createPlaylistCore(axisState(), { timeAxis: axis });
    expect(core.snapTime(100)).toBe(90);
    expect(core.snapTime(100, true)).toBe(100);
  });

  it("without an axis or targets it behaves like beat", () => {
    const state = axisState();
    expect(snapTime(40.4, state, false, M, null)).toBe(40);
    expect(snapTime(40.6, state)).toBe(41);
    const noTargets: PlaylistTimeAxis = { ticks: () => [], formatTime: String };
    expect(snapTime(12.7, state, false, M, noTargets)).toBe(13);
    const empty: PlaylistTimeAxis = { ...noTargets, snapTargets: () => [] };
    expect(snapTime(12.2, state, false, M, empty)).toBe(12);
    expect(snapStepBeats("axis")).toBe(0);
    expect(brushSnapStep(state, M)).toBe(1);
  });

  it("widens the search window when no target is near", () => {
    const sparse: PlaylistTimeAxis = {
      ticks: () => [],
      formatTime: String,
      snapTargets: (from, to) => (1000 >= from && 1000 <= to ? [1000] : []),
    };
    expect(snapTime(700, axisState(), false, M, sparse)).toBe(1000);
  });

  it("asks the host once per window while a drag stays inside it", () => {
    const calls: Array<[number, number]> = [];
    const core = createPlaylistCore(axisState(), { timeAxis: monthAxis(calls) });
    for (let i = 0; i < 200; i += 1) core.snapTime(70 + (i % 50) / 10);
    expect(calls.length).toBe(1);
  });

  it("drives the controller's clip drag (bar length from the core's metrics)", () => {
    const axis = monthAxis();
    const core = createPlaylistCore(axisState(), { timeAxis: axis });
    core.updateViewport({ pxPerBeat: 10 });
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-bass-1")!; // start 4
    const y = view.rect.y + 30;
    listeners.get("pointerdown")!(pointer(view.rect.x + 20, y));
    // +52 beats → raw start 56 → nearest month start 59.
    listeners.get("pointermove")!(pointer(view.rect.x + 20 + 520, y));
    listeners.get("pointerup")!(pointer(view.rect.x + 20 + 520, y));
    expect(core.getState().clips.find((c) => c.id === "clip-bass-1")!.start).toBe(59);
    controller.destroy();
  });

  it("bar snap uses the core's metrics (beatsPerBar), not the defaults", () => {
    const state = { ...sizedDemoState(), snap: { mode: "bar" as const, lastActiveMode: "bar" as const } };
    const core = createPlaylistCore(state, { metrics: { ...M, beatsPerBar: 7 } });
    expect(core.snapTime(10)).toBe(7);
    expect(core.snapTime(11)).toBe(14);
  });
});
