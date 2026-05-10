import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getTrackIdByIndex,
  type PlaylistCore,
  type PlaylistMetrics,
} from "../src/playlist-core";
import {
  TOOLS,
  zoomToolApplyOut,
} from "../src/playlist-interaction/tools";
import type { PlaylistHit } from "../src/playlist-interaction/hit-test";

const M: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS;

function createMockEvent(button = 0): PointerEvent {
  return {
    pointerId: 1,
    button,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
  } as unknown as PointerEvent;
}

function emptyHit(core: PlaylistCore): PlaylistHit {
  // The 'empty' kind in PlaylistHit is the catch-all; controller treats it as
  // empty timeline area. We mimic it by hitting an obviously empty point.
  void core;
  return { kind: "empty" };
}

function clipHit(core: PlaylistCore, clipId: string): PlaylistHit {
  const clip = core.getState().clips.find((c) => c.id === clipId);
  if (!clip) {
    throw new Error(`clip ${clipId} not found`);
  }
  return { kind: "clip", clip, clipId: clip.id };
}

describe("Tools — onPointerDown dispatch", () => {
  it("Select tool — empty hit starts a marquee", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.select.onPointerDown({
      core,
      metrics: M,
      point: { x: 800, y: 400 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("marquee");
  });

  it("Draw tool — empty hit creates a clip and starts clip-drag", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState().clips.length;
    const gesture = TOOLS.draw.onPointerDown({
      core,
      metrics: M,
      point: { x: 800, y: M.rulerHeight + 10 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("clip-drag");
    expect(core.getState().clips.length).toBe(before + 1);
  });

  it("Paint tool — empty hit creates a clip and starts paint-drag", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState().clips.length;
    // y points at track-7 (Perc FX) which is empty in the demo, so the
    // cellOccupied check inside paint won't suppress the create.
    const gesture = TOOLS.paint.onPointerDown({
      core,
      metrics: M,
      point: { x: 900, y: M.rulerHeight + 6 * M.trackHeight + 10 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("paint-drag");
    expect(core.getState().clips.length).toBe(before + 1);
  });

  it("Delete tool — clip hit deletes the clip and starts delete-drag", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const target = core.getState().clips[0]!;
    const gesture = TOOLS.delete.onPointerDown({
      core,
      metrics: M,
      point: { x: 0, y: 0 },
      hit: clipHit(core, target.id),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("delete-drag");
    expect(core.getState().clips.find((c) => c.id === target.id)).toBeUndefined();
  });

  it("Mute tool — clip hit toggles muted and returns null", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const target = core.getState().clips[0]!;
    const gesture = TOOLS.mute.onPointerDown({
      core,
      metrics: M,
      point: { x: 0, y: 0 },
      hit: clipHit(core, target.id),
      event: createMockEvent(),
    });
    expect(gesture).toBeNull();
    expect(
      core.getState().clips.find((c) => c.id === target.id)?.muted,
    ).toBe(true);
  });

  it("Zoom tool — LMB zooms in (pxPerBeat increases)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 600);
    const before = core.getState().viewport.pxPerBeat;
    TOOLS.zoom.onPointerDown({
      core,
      metrics: M,
      point: { x: 800, y: 200 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    expect(core.getState().viewport.pxPerBeat).toBeGreaterThan(before);
  });

  it("Zoom tool — RMB helper zooms out", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 600);
    const before = core.getState().viewport.pxPerBeat;
    zoomToolApplyOut({
      core,
      metrics: M,
      point: { x: 800, y: 200 },
      hit: emptyHit(core),
      event: createMockEvent(2),
    });
    expect(core.getState().viewport.pxPerBeat).toBeLessThan(before);
  });

  it("Slip tool stub falls back to Select behaviour", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.slip.onPointerDown({
      core,
      metrics: M,
      point: { x: 800, y: 400 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("marquee");
  });

  it("Slice tool stub falls back to Select behaviour", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.slice.onPointerDown({
      core,
      metrics: M,
      point: { x: 800, y: 400 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("marquee");
  });

  it("createClip via Draw tool resolves a track id from the hit row", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    TOOLS.draw.onPointerDown({
      core,
      metrics: M,
      point: { x: 700, y: M.rulerHeight + M.trackHeight + 5 },
      hit: emptyHit(core),
      event: createMockEvent(),
    });
    const created = core.getState().clips[core.getState().clips.length - 1]!;
    expect(created.trackId).toBe(getTrackIdByIndex(core.getState(), 1));
  });
});
