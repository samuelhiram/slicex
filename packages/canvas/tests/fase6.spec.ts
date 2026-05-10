import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";
import { TOOLS } from "../src/playlist-interaction/tools";
import type { PlaylistHit } from "../src/playlist-interaction/hit-test";

const M = DEFAULT_PLAYLIST_METRICS;

function mockEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    ...overrides,
  } as unknown as PointerEvent;
}

describe("Fase 6 — clip stretch/slip reducer", () => {
  it("SET_CLIP_CONTENT_OFFSET stores the value", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "SET_CLIP_CONTENT_OFFSET", clipId: "clip-drums-1", contentOffset: 3.5 },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")?.contentOffset).toBe(3.5);
  });

  it("SET_CLIP_STRETCH_RATIO clamps to a minimum positive value", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "SET_CLIP_STRETCH_RATIO", clipId: "clip-drums-1", stretchRatio: -5 },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")?.stretchRatio).toBe(0.01);
  });

  it("STRETCH_RESIZE_CLIP scales stretchRatio by duration factor", () => {
    const s0 = createDemoPlaylistState();
    const original = s0.clips.find((c) => c.id === "clip-drums-1")!;
    const s1 = playlistReducer(
      s0,
      {
        type: "STRETCH_RESIZE_CLIP",
        clipId: "clip-drums-1",
        edge: "right",
        time: original.start + original.duration * 2,
      },
      M,
    );
    const after = s1.clips.find((c) => c.id === "clip-drums-1")!;
    expect(after.duration).toBeCloseTo(original.duration * 2);
    expect(after.stretchRatio).toBeCloseTo(2);
  });

  it("STRETCH_RESIZE_CLIP from the left edge keeps the right edge anchored", () => {
    const s0 = createDemoPlaylistState();
    const original = s0.clips.find((c) => c.id === "clip-drums-1")!;
    const end = original.start + original.duration;
    const s1 = playlistReducer(
      s0,
      {
        type: "STRETCH_RESIZE_CLIP",
        clipId: "clip-drums-1",
        edge: "left",
        time: original.start + original.duration * 0.5,
      },
      M,
    );
    const after = s1.clips.find((c) => c.id === "clip-drums-1")!;
    expect(after.start + after.duration).toBeCloseTo(end);
    expect(after.stretchRatio).toBeCloseTo(0.5);
  });

  it("TOGGLE_STRETCH_MODE flips the global flag", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "TOGGLE_STRETCH_MODE" }, M);
    expect(s1.stretchMode).toBe(true);
    const s2 = playlistReducer(s1, { type: "TOGGLE_STRETCH_MODE" }, M);
    expect(s2.stretchMode).toBe(false);
  });

  it("SET_STRETCH_MODE returns same state when value is unchanged", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "SET_STRETCH_MODE", enabled: false }, M);
    expect(s1).toBe(s0);
  });
});

describe("Fase 6 — PlaylistCore wrappers", () => {
  it("sliceClipsAtTime splits intersecting clips and selects the new ids", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const cutTime = 8;
    const newIds = core.sliceClipsAtTime(cutTime);
    expect(newIds.length).toBeGreaterThan(0);
    for (const id of newIds) {
      const right = core.getState().clips.find((c) => c.id === id)!;
      expect(right.start).toBe(cutTime);
    }
    // The original drums clip (0..16) should now end at the cut.
    const drums = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!;
    expect(drums.start + drums.duration).toBeCloseTo(cutTime);
  });

  it("sliceClipsAtTime is undoable as a single step", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState().clips.length;
    core.sliceClipsAtTime(8);
    expect(core.getState().clips.length).toBeGreaterThan(before);
    core.undo();
    expect(core.getState().clips.length).toBe(before);
  });

  it("sliceClipsAtTime carries contentOffset to the right half", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    // pre-slip the drums clip by one beat so the right half has a known offset
    core.setClipContentOffset("clip-drums-1", 1);
    core.setClipStretchRatio("clip-drums-1", 1);
    core.sliceClipsAtTime(8);
    const right = core
      .getState()
      .clips.find((c) => c.start === 8 && c.sourceId === "clip-drums-1")!;
    // base offset 1 + 8 beats already consumed → 9
    expect(right.contentOffset).toBeCloseTo(9);
    expect(right.sourceId).toBe("clip-drums-1");
  });

  it("sliceClipsAtTime skips clips on locked tracks", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0); // drums track
    const before = core.getState().clips.length;
    const newIds = core.sliceClipsAtTime(8);
    // Other tracks may still have intersecting clips; just assert drums survive intact
    const drumsClipsAfter = core
      .getState()
      .clips.filter((c) => c.trackId === core.getState().tracks[0]!.id);
    expect(drumsClipsAfter.length).toBe(2); // drums-1 and drums-2 untouched
    expect(core.getState().clips.length).toBeGreaterThanOrEqual(before);
    expect(newIds.every((id) => !id.startsWith("clip-drums"))).toBe(true);
  });

  it("toggleStretchMode is not undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleStretchMode();
    expect(core.getState().stretchMode).toBe(true);
    expect(core.canUndo()).toBe(false);
    core.toggleStretchMode();
    expect(core.getState().stretchMode).toBe(false);
  });

  it("setClipContentOffset / setClipStretchRatio are undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipContentOffset("clip-drums-1", 2);
    core.setClipStretchRatio("clip-drums-1", 1.5);
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.stretchRatio,
    ).toBe(1.5);
    core.undo();
    core.undo();
    const after = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    expect(after.contentOffset ?? 0).toBe(0);
    expect(after.stretchRatio ?? 1).toBe(1);
  });

  it("lock enforcement blocks slip / stretch mutators", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    core.setClipContentOffset("clip-drums-1", 5);
    core.setClipStretchRatio("clip-drums-1", 3);
    core.stretchResizeClip("clip-drums-1", "right", 99);
    const after = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    expect(after.contentOffset ?? 0).toBe(0);
    expect(after.stretchRatio ?? 1).toBe(1);
  });
});

describe("Fase 6 — slip / slice tools", () => {
  function clipHit(id: string, core: ReturnType<typeof createPlaylistCore>): PlaylistHit {
    const clip = core.getState().clips.find((c) => c.id === id)!;
    return { kind: "clip", clip, clipId: clip.id };
  }

  it("slip tool returns a slip-drag gesture on clip body", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.slip.onPointerDown({
      core,
      metrics: M,
      point: { x: 200, y: M.rulerHeight + 10 },
      hit: clipHit("clip-drums-1", core),
      event: mockEvent(),
    });
    expect(gesture?.kind).toBe("slip-drag");
    if (gesture?.kind === "slip-drag") {
      expect(gesture.clipId).toBe("clip-drums-1");
      expect(gesture.startContentOffset).toBe(0);
      expect(gesture.startStretchRatio).toBe(1);
    }
  });

  it("slip tool returns null on empty area (nothing to slip)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.slip.onPointerDown({
      core,
      metrics: M,
      point: { x: 800, y: M.rulerHeight + 6 * M.trackHeight + 10 },
      hit: { kind: "empty" },
      event: mockEvent(),
    });
    expect(gesture).toBeNull();
  });

  it("slice tool returns a slice-drag gesture from any starting point", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.slice.onPointerDown({
      core,
      metrics: M,
      point: { x: 500, y: M.rulerHeight + 10 },
      hit: { kind: "empty" },
      event: mockEvent(),
    });
    expect(gesture?.kind).toBe("slice-drag");
  });
});
