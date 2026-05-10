import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  type PlaylistRegularClip,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";
const M = DEFAULT_PLAYLIST_METRICS;

describe("Fase 1 — reducer additions", () => {
  it("SET_TOOL switches the active tool", () => {
    const s0 = { ...createDemoPlaylistState(), tool: "select" as const };
    const s1 = playlistReducer(s0, { type: "SET_TOOL", tool: "draw" }, M);
    expect(s1.tool).toBe("draw");
  });

  it("SET_TOOL with same tool returns same state", () => {
    const s0 = { ...createDemoPlaylistState(), tool: "draw" as const };
    const s1 = playlistReducer(s0, { type: "SET_TOOL", tool: "draw" }, M);
    expect(s1).toBe(s0);
  });

  it("CREATE_CLIP appends a new clip", () => {
    const s0 = createDemoPlaylistState();
    const newClip: PlaylistRegularClip = {
      id: "c-new",
      type: "audio",
      trackId: s0.tracks[0]!.id,
      start: 50,
      duration: 4,
      label: "new",
      color: "#fff",
    };
    const s1 = playlistReducer(s0, { type: "CREATE_CLIP", clip: newClip }, M);
    expect(s1.clips.find((c) => c.id === "c-new")).toBeDefined();
    expect(s1.clips.length).toBe(s0.clips.length + 1);
  });

  it("CREATE_CLIP with duplicate id is a no-op", () => {
    const s0 = createDemoPlaylistState();
    const dup: PlaylistRegularClip = {
      id: "clip-drums-1",
      type: "audio",
      trackId: s0.tracks[0]!.id,
      start: 50,
      duration: 4,
      label: "x",
      color: "#fff",
    };
    const s1 = playlistReducer(s0, { type: "CREATE_CLIP", clip: dup }, M);
    expect(s1).toBe(s0);
  });

  it("DELETE_CLIP removes the clip and its selection entry", () => {
    const s0 = {
      ...createDemoPlaylistState(),
      selection: {
        clipIds: ["clip-drums-1"],
        automationPointIds: [],
      },
    };
    const s1 = playlistReducer(
      s0,
      { type: "DELETE_CLIP", clipId: "clip-drums-1" },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")).toBeUndefined();
    expect(s1.selection.clipIds).toEqual([]);
  });

  it("TOGGLE_CLIP_MUTE flips muted on the target clip only", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "TOGGLE_CLIP_MUTE", clipId: "clip-drums-1" },
      M,
    );
    expect(s1.clips.find((c) => c.id === "clip-drums-1")?.muted).toBe(true);
    const s2 = playlistReducer(
      s1,
      { type: "TOGGLE_CLIP_MUTE", clipId: "clip-drums-1" },
      M,
    );
    expect(s2.clips.find((c) => c.id === "clip-drums-1")?.muted).toBe(false);
  });
});

describe("Fase 1 — PlaylistCore wrappers", () => {
  it("createClip returns a unique id and the clip is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const id = core.createClip({
      trackIndex: 0,
      start: 100,
      duration: 4,
      type: "pattern",
    });
    expect(id).toMatch(/^clip-/);
    expect(core.canUndo()).toBe(true);
    core.undo();
    expect(core.getState().clips.find((c) => c.id === id)).toBeUndefined();
  });

  it("deleteClip removes the clip and is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.deleteClip("clip-drums-1");
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeUndefined();
    core.undo();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeDefined();
  });

  it("toggleClipMute flips muted and is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleClipMute("clip-drums-1");
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.muted,
    ).toBe(true);
    core.undo();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.muted,
    ).toBeFalsy();
  });

  it("setTool is not undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setTool("draw");
    expect(core.getState().tool).toBe("draw");
    expect(core.canUndo()).toBe(false);
  });
});
