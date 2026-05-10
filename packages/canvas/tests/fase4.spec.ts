import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  getTrackHeight,
  getTrackHeightByIndex,
  getTrackTopByIndex,
  isTrackEffectivelyMuted,
  screenYToTrackIndex,
  trackIndexToScreenY,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

describe("Fase 4 — track flags reducer", () => {
  it("TOGGLE_TRACK_MUTE flips muted", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "TOGGLE_TRACK_MUTE", trackIndex: 0 }, M);
    expect(s1.tracks[0]!.muted).toBe(true);
    const s2 = playlistReducer(s1, { type: "TOGGLE_TRACK_MUTE", trackIndex: 0 }, M);
    expect(s2.tracks[0]!.muted).toBe(false);
  });

  it("TOGGLE_TRACK_SOLO flips soloed", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "TOGGLE_TRACK_SOLO", trackIndex: 1 }, M);
    expect(s1.tracks[1]!.soloed).toBe(true);
  });

  it("TOGGLE_TRACK_LOCK flips locked", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "TOGGLE_TRACK_LOCK", trackIndex: 2 }, M);
    expect(s1.tracks[2]!.locked).toBe(true);
  });

  it("SET_TRACK_HEIGHT clamps to [trackMinHeight, trackMaxHeight]", () => {
    const s0 = createDemoPlaylistState();
    const tooSmall = playlistReducer(
      s0,
      { type: "SET_TRACK_HEIGHT", trackIndex: 0, height: 5 },
      M,
    );
    expect(tooSmall.tracks[0]!.height).toBe(M.trackMinHeight);
    const tooBig = playlistReducer(
      s0,
      { type: "SET_TRACK_HEIGHT", trackIndex: 0, height: 9999 },
      M,
    );
    expect(tooBig.tracks[0]!.height).toBe(M.trackMaxHeight);
    const ok = playlistReducer(
      s0,
      { type: "SET_TRACK_HEIGHT", trackIndex: 0, height: 100 },
      M,
    );
    expect(ok.tracks[0]!.height).toBe(100);
  });

  it("REORDER_TRACK moves a track", () => {
    const s0 = createDemoPlaylistState();
    const original = s0.tracks.map((t) => t.id);
    const s1 = playlistReducer(
      s0,
      { type: "REORDER_TRACK", fromIndex: 0, toIndex: 3 },
      M,
    );
    const reordered = s1.tracks.map((t) => t.id);
    expect(reordered.indexOf(original[0]!)).toBe(3);
  });

  it("REORDER_TRACK is a no-op when from = to", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "REORDER_TRACK", fromIndex: 1, toIndex: 1 },
      M,
    );
    expect(s1).toBe(s0);
  });
});

describe("Fase 4 — per-track height geometry", () => {
  it("getTrackHeight clamps within [min, max]", () => {
    const m = DEFAULT_PLAYLIST_METRICS;
    expect(getTrackHeight({ id: "x", label: "x", color: "#fff" }, m)).toBe(
      m.trackHeight,
    );
    expect(
      getTrackHeight({ id: "x", label: "x", color: "#fff", height: 5 }, m),
    ).toBe(m.trackMinHeight);
    expect(
      getTrackHeight({ id: "x", label: "x", color: "#fff", height: 9999 }, m),
    ).toBe(m.trackMaxHeight);
    expect(
      getTrackHeight({ id: "x", label: "x", color: "#fff", height: 120 }, m),
    ).toBe(120);
  });

  it("getTrackTopByIndex accumulates per-track heights", () => {
    const s0 = playlistReducer(
      createDemoPlaylistState(),
      { type: "SET_TRACK_HEIGHT", trackIndex: 0, height: 100 },
      M,
    );
    expect(getTrackTopByIndex(s0, 0, M)).toBe(0);
    expect(getTrackTopByIndex(s0, 1, M)).toBe(100);
    expect(getTrackTopByIndex(s0, 2, M)).toBe(100 + M.trackHeight);
  });

  it("screenYToTrackIndex respects variable heights", () => {
    const s0 = playlistReducer(
      createDemoPlaylistState(),
      { type: "SET_TRACK_HEIGHT", trackIndex: 0, height: 100 },
      M,
    );
    // Track 0 is 100 px tall starting at rulerHeight.
    expect(screenYToTrackIndex(s0, M.rulerHeight + 10, M)).toBe(0);
    expect(screenYToTrackIndex(s0, M.rulerHeight + 99, M)).toBe(0);
    expect(screenYToTrackIndex(s0, M.rulerHeight + 101, M)).toBe(1);
  });

  it("trackIndexToScreenY composes with screenYToTrackIndex", () => {
    const s0 = playlistReducer(
      createDemoPlaylistState(),
      { type: "SET_TRACK_HEIGHT", trackIndex: 0, height: 100 },
      M,
    );
    const y = trackIndexToScreenY(s0, 1, M);
    expect(screenYToTrackIndex(s0, y + 1, M)).toBe(1);
  });

  it("getTrackHeightByIndex returns metric default for out-of-range", () => {
    const s0 = createDemoPlaylistState();
    expect(getTrackHeightByIndex(s0, 999, M)).toBe(M.trackHeight);
  });
});

describe("Fase 4 — isTrackEffectivelyMuted", () => {
  it("returns true when track.muted", () => {
    const state = createDemoPlaylistState();
    state.tracks[0]!.muted = true;
    expect(isTrackEffectivelyMuted(state, state.tracks[0]!)).toBe(true);
  });

  it("returns true for non-soloed track when another is soloed", () => {
    const state = createDemoPlaylistState();
    state.tracks[0]!.soloed = true;
    expect(isTrackEffectivelyMuted(state, state.tracks[1]!)).toBe(true);
    expect(isTrackEffectivelyMuted(state, state.tracks[0]!)).toBe(false);
  });

  it("returns false when no flags are active", () => {
    const state = createDemoPlaylistState();
    expect(isTrackEffectivelyMuted(state, state.tracks[0]!)).toBe(false);
  });
});

describe("Fase 4 — lock enforcement on PlaylistCore wrappers", () => {
  it("moveClips skips clips on locked source track", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    core.moveClips([{ id: "clip-drums-1", start: 99, trackIndex: 0 }]);
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.start,
    ).toBe(0);
  });

  it("moveClips skips drops onto locked target track", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(2);
    core.moveClips([{ id: "clip-drums-1", start: 99, trackIndex: 2 }]);
    const clip = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    expect(clip.start).toBe(0);
    expect(clip.trackId).toBe(core.getState().tracks[0]!.id);
  });

  it("resizeClip is a no-op on locked track", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const original = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    core.toggleTrackLock(0);
    core.resizeClip("clip-drums-1", "right", 99);
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.duration,
    ).toBe(original.duration);
  });

  it("deleteClip is a no-op on locked track", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    core.deleteClip("clip-drums-1");
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeDefined();
  });

  it("createClip returns empty string and does nothing on locked target", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    const before = core.getState().clips.length;
    const id = core.createClip({
      trackIndex: 0,
      start: 50,
      duration: 4,
      type: "pattern",
    });
    expect(id).toBe("");
    expect(core.getState().clips.length).toBe(before);
  });

  it("toggleClipMute is a no-op on locked track", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    core.toggleClipMute("clip-drums-1");
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.muted,
    ).toBeFalsy();
  });

  it("removeSelected preserves clips on locked tracks", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-bass-1"],
      automationPointIds: [],
    });
    core.toggleTrackLock(0); // drums track
    core.removeSelected();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeDefined();
    expect(
      core.getState().clips.find((c) => c.id === "clip-bass-1"),
    ).toBeUndefined();
  });
});

describe("Fase 4 — PlaylistCore track wrappers are undoable", () => {
  it("toggleTrackMute / toggleTrackSolo / toggleTrackLock create undo entries", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackMute(0);
    core.toggleTrackSolo(1);
    core.toggleTrackLock(2);
    expect(core.canUndo()).toBe(true);
    core.undo();
    expect(core.getState().tracks[2]!.locked).toBeFalsy();
    core.undo();
    expect(core.getState().tracks[1]!.soloed).toBeFalsy();
    core.undo();
    expect(core.getState().tracks[0]!.muted).toBeFalsy();
  });

  it("setTrackHeight is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setTrackHeight(0, 120);
    expect(core.getState().tracks[0]!.height).toBe(120);
    core.undo();
    expect(core.getState().tracks[0]!.height).toBeUndefined();
  });

  it("reorderTrack is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const originalFirst = core.getState().tracks[0]!.id;
    core.reorderTrack(0, 3);
    expect(core.getState().tracks[3]!.id).toBe(originalFirst);
    core.undo();
    expect(core.getState().tracks[0]!.id).toBe(originalFirst);
  });
});
