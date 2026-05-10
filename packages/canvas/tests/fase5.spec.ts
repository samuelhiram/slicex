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

describe("Fase 5 — clip metadata reducer", () => {
  it("SET_CLIP_LABEL renames the target clip only", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "SET_CLIP_LABEL", clipId: "clip-drums-1", label: "Hi-hats" },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")?.label).toBe("Hi-hats");
    expect(s1.clips.find((c) => c.id === "clip-drums-2")?.label).toBe(
      "Break hats",
    );
  });

  it("SET_CLIP_COLOR updates the color", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "SET_CLIP_COLOR", clipId: "clip-drums-1", color: "#abcdef" },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")?.color).toBe(
      "#abcdef",
    );
  });

  it("MAKE_CLIPS_UNIQUE assigns sourceId = id on each target", () => {
    const s0 = {
      ...createDemoPlaylistState(),
      clips: createDemoPlaylistState().clips.map((c) => ({
        ...c,
        sourceId: "shared",
      })),
    };
    const s1 = playlistReducer(
      s0,
      { type: "MAKE_CLIPS_UNIQUE", clipIds: ["clip-drums-1", "clip-bass-1"] },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")?.sourceId).toBe(
      "clip-drums-1",
    );
    expect(s1.clips.find((c) => c.id === "clip-bass-1")?.sourceId).toBe(
      "clip-bass-1",
    );
    expect(s1.clips.find((c) => c.id === "clip-chords-1")?.sourceId).toBe(
      "shared",
    );
  });
});

describe("Fase 5 — PlaylistCore wrappers", () => {
  it("createClip auto-fills sourceId equal to its id", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const id = core.createClip({
      trackIndex: 0,
      start: 100,
      duration: 4,
      type: "pattern",
    });
    expect(core.getState().clips.find((c) => c.id === id)?.sourceId).toBe(id);
  });

  it("setClipLabel / setClipColor are undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const original = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!;
    core.setClipLabel("clip-drums-1", "Renamed");
    core.setClipColor("clip-drums-1", "#abcdef");
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.label,
    ).toBe("Renamed");
    core.undo();
    core.undo();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.label,
    ).toBe(original.label);
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.color,
    ).toBe(original.color);
  });

  it("makeClipUnique resets sourceId on a single clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    // pasteClipboard preserves sourceId, so use that to create siblings.
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.copyToClipboard();
    core.setPlayPosition(50);
    const [pastedId] = core.pasteClipboard();
    expect(
      core.getState().clips.find((c) => c.id === pastedId)?.sourceId,
    ).toBe("clip-drums-1");
    core.makeClipUnique(pastedId!);
    expect(
      core.getState().clips.find((c) => c.id === pastedId)?.sourceId,
    ).toBe(pastedId);
  });

  it("selectAllSimilarClips selects every clip with the same sourceId", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.copyToClipboard();
    core.setPlayPosition(50);
    const [pastedA] = core.pasteClipboard();
    core.setPlayPosition(80);
    const [pastedB] = core.pasteClipboard();
    core.selectAllSimilarClips("clip-drums-1");
    const ids = core.getState().selection.clipIds.sort();
    expect(ids).toEqual(["clip-drums-1", pastedA, pastedB].sort());
  });

  it("cloneClipsInPlace creates fresh ids that share sourceId with the source", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const newIds = core.cloneClipsInPlace(["clip-drums-1"]);
    expect(newIds.length).toBe(1);
    const original = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!;
    const clone = core.getState().clips.find((c) => c.id === newIds[0])!;
    expect(clone.start).toBe(original.start);
    expect(clone.trackId).toBe(original.trackId);
    // Source clips with no explicit sourceId become a source themselves: the
    // clone resolves sourceId to the source's id so future siblings group.
    expect(clone.sourceId).toBe(original.sourceId ?? original.id);
    expect(clone.id).not.toBe(original.id);
  });

  it("openClipContextMenu / openBackgroundContextMenu set state.contextMenu", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.openClipContextMenu("clip-drums-1", { x: 100, y: 200 });
    expect(core.getState().contextMenu).toEqual({
      kind: "clip",
      clipId: "clip-drums-1",
      position: { x: 100, y: 200 },
    });
    core.openBackgroundContextMenu(8, 2, { x: 50, y: 60 });
    expect(core.getState().contextMenu).toEqual({
      kind: "background",
      time: 8,
      trackIndex: 2,
      position: { x: 50, y: 60 },
    });
  });
});

describe("Fase 5 — lock enforcement on Fase 5 wrappers", () => {
  it("setClipLabel / setClipColor / makeClipUnique are no-ops on locked track", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const original = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!;
    core.toggleTrackLock(0);
    core.setClipLabel("clip-drums-1", "blocked");
    core.setClipColor("clip-drums-1", "#000000");
    core.makeClipUnique("clip-drums-1");
    const after = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!;
    expect(after.label).toBe(original.label);
    expect(after.color).toBe(original.color);
  });

  it("cloneClipsInPlace skips clips on locked tracks", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    const newIds = core.cloneClipsInPlace(["clip-drums-1"]);
    expect(newIds).toEqual([]);
  });
});

describe("Fase 5 — Shift+drag in select tool clones the targeted clips", () => {
  it("starts a clip-drag with fresh clones", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    const before = core.getState().clips.length;
    const hit: PlaylistHit = {
      kind: "clip",
      clip: core.getState().clips.find((c) => c.id === "clip-drums-1")!,
      clipId: "clip-drums-1",
    };
    const gesture = TOOLS.select.onPointerDown({
      core,
      metrics: M,
      point: { x: 200, y: M.rulerHeight + 10 },
      hit,
      event: mockEvent({ shiftKey: true }),
    });
    expect(gesture?.kind).toBe("clip-drag");
    expect(core.getState().clips.length).toBe(before + 1);
    if (gesture?.kind === "clip-drag") {
      // The drag operates on the clones, not on the original.
      expect(gesture.originals.map((o) => o.id)).not.toContain("clip-drums-1");
    }
  });
});
