// R2-BRIDGE-4 (canvas part): no clip-producing path lands a clip on a locked
// track. createClip / createClips always refused; pasteClipboard (Ctrl+V),
// duplicateSelectionRight (Ctrl+B) and cloneClipsInPlace (Shift clone-drag)
// now skip the entries whose DESTINATION track is locked and keep the rest.
// A clip pasted onto a locked lane could never be fixed up by a host (every
// clip mutator refuses locked clips), so it kept its source's sourceId forever.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  type PlaylistState,
} from "../src/playlist-core";

function trackOf(state: PlaylistState, clipId: string): number {
  const clip = state.clips.find((c) => c.id === clipId)!;
  return state.tracks.findIndex((t) => t.id === clip.trackId);
}

describe("pasteClipboard skips locked destination tracks", () => {
  it("pastes only the entries whose destination is unlocked", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipSelection(["clip-drums-1", "clip-bass-1"]); // tracks 0 and 1
    core.copyToClipboard();
    core.toggleTrackLock(1);
    const before = core.getState().clips.length;
    const pasted = core.pasteClipboard({ atTime: 60, atTrackIndex: 0 });
    const state = core.getState();
    expect(pasted).toHaveLength(1);
    expect(state.clips).toHaveLength(before + 1);
    expect(trackOf(state, pasted[0]!)).toBe(0);
    expect(state.clips.find((c) => c.id === pasted[0])!.start).toBe(60);
    expect(state.selection.clipIds).toEqual(pasted);
    expect(state.clips.filter((c) => trackOf(state, c.id) === 1)).toHaveLength(1);
  });

  it("is a no-op (no clip, no undo entry) when every destination is locked", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipSelection(["clip-drums-1"]);
    core.copyToClipboard();
    core.toggleTrackLock(0);
    const before = core.getState();
    expect(core.pasteClipboard({ atTime: 80 })).toEqual([]);
    expect(core.getState()).toBe(before);
    // Only the lock toggle was recorded.
    core.undo();
    expect(core.canUndo()).toBe(false);
    expect(core.getState().clips).toHaveLength(before.clips.length);
  });

  it("pastes into the same lane once it is unlocked", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipSelection(["clip-drums-1"]);
    core.copyToClipboard();
    core.toggleTrackLock(0);
    expect(core.pasteClipboard({ atTime: 80, atTrackIndex: 0 })).toEqual([]);
    core.toggleTrackLock(0);
    expect(core.pasteClipboard({ atTime: 80, atTrackIndex: 0 })).toHaveLength(1);
  });
});

describe("duplicateSelectionRight skips clips on locked tracks", () => {
  it("duplicates the unlocked part of the selection, shifted by the full span", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    // drums-1: 0..16 on track 0, bass-1: 4..22 on track 1 → span 22.
    core.setClipSelection(["clip-drums-1", "clip-bass-1"]);
    core.toggleTrackLock(1);
    const before = core.getState().clips.length;
    const ids = core.duplicateSelectionRight();
    const state = core.getState();
    expect(ids).toHaveLength(1);
    expect(state.clips).toHaveLength(before + 1);
    const copy = state.clips.find((c) => c.id === ids[0])!;
    expect(trackOf(state, copy.id)).toBe(0);
    expect(copy.start).toBe(22);
    expect(copy.sourceId).toBe("clip-drums-1");
  });

  it("returns [] without dispatching when the whole selection is locked", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipSelection(["clip-bass-1"]);
    core.toggleTrackLock(1);
    const before = core.getState();
    expect(core.duplicateSelectionRight()).toEqual([]);
    expect(core.getState()).toBe(before);
  });
});

describe("cloneClipsInPlace skips clips on locked tracks", () => {
  it("clones only the clips whose (own) track is unlocked", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(1);
    const before = core.getState().clips.length;
    const ids = core.cloneClipsInPlace(["clip-drums-1", "clip-bass-1"]);
    const state = core.getState();
    expect(ids).toHaveLength(1);
    expect(state.clips).toHaveLength(before + 1);
    expect(trackOf(state, ids[0]!)).toBe(0);
    expect(state.selection.clipIds).toEqual(ids);
  });

  it("returns [] without dispatching when every source track is locked", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(1);
    const before = core.getState();
    expect(core.cloneClipsInPlace(["clip-bass-1"])).toEqual([]);
    expect(core.getState()).toBe(before);
  });
});
