import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  getTrackIndexById,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

describe("Fase 2 — selection reducer", () => {
  it("SELECT_ALL_CLIPS selects every clip id", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "SELECT_ALL_CLIPS" }, M);
    expect(s1.selection.clipIds.length).toBe(s0.clips.length);
  });

  it("INVERT_CLIP_SELECTION flips selected/unselected ids", () => {
    const s0 = {
      ...createDemoPlaylistState(),
      selection: {
        clipIds: ["clip-drums-1"],
        automationPointIds: [],
      },
    };
    const s1 = playlistReducer(s0, { type: "INVERT_CLIP_SELECTION" }, M);
    expect(s1.selection.clipIds).not.toContain("clip-drums-1");
    expect(s1.selection.clipIds.length).toBe(s0.clips.length - 1);
  });

  it("SET_CLIPBOARD assigns the clipboard payload", () => {
    const s0 = createDemoPlaylistState();
    const clipboard = { entries: [], span: 0 };
    const s1 = playlistReducer(
      s0,
      { type: "SET_CLIPBOARD", clipboard },
      M,
    );
    expect(s1.clipboard).toBe(clipboard);
  });

  it("PASTE_CLIPS appends clips and selects them", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      {
        type: "PASTE_CLIPS",
        entries: [
          {
            clip: {
              id: "c-paste",
              type: "audio",
              trackId: "ignored",
              start: 50,
              duration: 4,
              label: "p",
              color: "#fff",
            },
            trackIndex: 0,
          },
        ],
        selectIds: ["c-paste"],
      },
      M,
    );
    const pasted = s1.clips.find((c) => c.id === "c-paste");
    expect(pasted).toBeDefined();
    expect(pasted?.trackId).toBe(s1.tracks[0]!.id);
    expect(s1.selection.clipIds).toEqual(["c-paste"]);
  });

  it("PASTE_CLIPS materializes virtual tracks beyond the current count", () => {
    const s0 = createDemoPlaylistState();
    const targetIndex = s0.tracks.length + 2;
    const s1 = playlistReducer(
      s0,
      {
        type: "PASTE_CLIPS",
        entries: [
          {
            clip: {
              id: "c-virt",
              type: "audio",
              trackId: "ignored",
              start: 0,
              duration: 4,
              label: "v",
              color: "#fff",
            },
            trackIndex: targetIndex,
          },
        ],
        selectIds: ["c-virt"],
      },
      M,
    );
    expect(s1.tracks.length).toBeGreaterThan(targetIndex);
  });
});

describe("Fase 2 — selection wrappers", () => {
  it("selectAllClips followed by deselectAll", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.selectAllClips();
    expect(core.getState().selection.clipIds.length).toBe(
      core.getState().clips.length,
    );
    core.deselectAll();
    expect(core.getState().selection.clipIds).toEqual([]);
  });

  it("toggleClipSelection adds and removes ids", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleClipSelection("clip-drums-1");
    expect(core.getState().selection.clipIds).toContain("clip-drums-1");
    core.toggleClipSelection("clip-drums-1");
    expect(core.getState().selection.clipIds).not.toContain("clip-drums-1");
  });

  it("addClipsToSelection unions the ids", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.addClipsToSelection(["clip-bass-1", "clip-drums-1"]);
    const ids = core.getState().selection.clipIds;
    expect(ids).toContain("clip-drums-1");
    expect(ids).toContain("clip-bass-1");
    expect(ids.length).toBe(2);
  });

  it("extendClipSelection from anchor selects everything in start order between", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.extendClipSelection("clip-vocal-1");
    const sorted = [...core.getState().clips].sort(
      (a, b) => a.start - b.start,
    );
    const startIdx = sorted.findIndex((c) => c.id === "clip-drums-1");
    const endIdx = sorted.findIndex((c) => c.id === "clip-vocal-1");
    const expected = sorted
      .slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1)
      .map((c) => c.id);
    expect(core.getState().selection.clipIds).toEqual(expected);
  });

  it("invertClipSelection flips the set", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.invertClipSelection();
    const ids = core.getState().selection.clipIds;
    expect(ids).not.toContain("clip-drums-1");
    expect(ids.length).toBe(core.getState().clips.length - 1);
  });
});

describe("Fase 2 — clipboard wrappers", () => {
  it("copyToClipboard stores entries with relative offsets", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-bass-1"],
      automationPointIds: [],
    });
    expect(core.copyToClipboard()).toBe(true);
    const cb = core.getState().clipboard;
    expect(cb).not.toBeNull();
    expect(cb!.entries.length).toBe(2);
    const minStart = Math.min(
      ...cb!.entries.map((entry) => entry.startOffset),
    );
    expect(minStart).toBe(0);
  });

  it("copyToClipboard returns false on empty selection", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    expect(core.copyToClipboard()).toBe(false);
    expect(core.getState().clipboard).toBeNull();
  });

  it("pasteClipboard places clips at playhead and selects them", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.copyToClipboard();
    core.setPlayPosition(50);
    const newIds = core.pasteClipboard();
    expect(newIds.length).toBe(1);
    const newClip = core.getState().clips.find((c) => c.id === newIds[0]);
    expect(newClip?.start).toBe(50);
    expect(core.getState().selection.clipIds).toEqual(newIds);
  });

  it("pasteClipboard preserves relative track offsets", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-bass-1"],
      automationPointIds: [],
    });
    core.copyToClipboard();
    core.setPlayPosition(80);
    const newIds = core.pasteClipboard({ atTrackIndex: 4 });
    expect(newIds.length).toBe(2);
    const trackIndices = newIds.map((id) => {
      const clip = core.getState().clips.find((c) => c.id === id)!;
      return getTrackIndexById(core.getState(), clip.trackId);
    });
    expect(Math.min(...trackIndices)).toBe(4);
    // Original drums was on track 0, bass on track 1 → offsets 0 and 1.
    expect(Math.max(...trackIndices) - Math.min(...trackIndices)).toBe(1);
  });

  it("cutSelection copies and removes in a single undo step", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.cutSelection();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeUndefined();
    expect(core.getState().clipboard?.entries.length).toBe(1);
    core.undo();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeDefined();
  });

  it("duplicateSelectionRight clones selection shifted by its span", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const original = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!;
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    const newIds = core.duplicateSelectionRight();
    expect(newIds.length).toBe(1);
    const dup = core.getState().clips.find((c) => c.id === newIds[0])!;
    expect(dup.start).toBe(original.start + original.duration);
  });

  it("duplicateSelectionRight is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    const before = core.getState().clips.length;
    core.duplicateSelectionRight();
    expect(core.getState().clips.length).toBe(before + 1);
    core.undo();
    expect(core.getState().clips.length).toBe(before);
  });

  it("setClipSelection additive unions; non-additive replaces", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({ clipIds: ["clip-drums-1"], automationPointIds: [] });
    core.setClipSelection(["clip-bass-1"], { additive: true });
    const ids = core.getState().selection.clipIds;
    expect(ids).toContain("clip-drums-1");
    expect(ids).toContain("clip-bass-1");
    core.setClipSelection(["clip-vocal-1"]);
    expect(core.getState().selection.clipIds).toEqual(["clip-vocal-1"]);
  });
});
