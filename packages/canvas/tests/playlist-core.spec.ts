import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
} from "../src/playlist-core";

describe("PlaylistCore — undo/redo and gesture brackets", () => {
  it("undo reverts a discrete doc-mutating action", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState().tracks[0]!.label;
    core.renameTrack(0, "renamed");
    expect(core.getState().tracks[0]!.label).toBe("renamed");
    expect(core.canUndo()).toBe(true);
    core.undo();
    expect(core.getState().tracks[0]!.label).toBe(before);
    expect(core.canRedo()).toBe(true);
  });

  it("redo restores after undo", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.renameTrack(0, "v1");
    core.undo();
    core.redo();
    expect(core.getState().tracks[0]!.label).toBe("v1");
  });

  it("UI-only mutations are not undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    expect(core.canUndo()).toBe(false);
    core.setSelection({ clipIds: ["clip-drums-1"] });
    expect(core.canUndo()).toBe(false);
    core.setHover({ kind: "clip", clipId: "clip-drums-1" });
    expect(core.canUndo()).toBe(false);
  });

  it("gesture brackets coalesce many mutations into a single undo entry", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const initialStart = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!.start;

    core.beginGesture();
    for (let t = 1; t <= 10; t += 1) {
      core.moveClips([{ id: "clip-drums-1", start: t, trackIndex: 0 }]);
    }
    core.endGesture();

    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")!.start,
    ).toBe(10);
    expect(core.canUndo()).toBe(true);

    core.undo();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")!.start,
    ).toBe(initialStart);
    expect(core.canUndo()).toBe(false);
  });

  it("undo while gesture is open clears the gesture cleanly", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.renameTrack(0, "first");
    core.beginGesture();
    core.moveClips([{ id: "clip-drums-1", start: 99, trackIndex: 0 }]);
    core.undo();
    expect(core.getState().tracks[0]!.label).not.toBe("first");
    core.endGesture();
    core.beginGesture();
    core.endGesture();
  });

  it("dispatching a doc-mutating action discards future after undo", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.renameTrack(0, "v1");
    core.renameTrack(0, "v2");
    core.undo();
    expect(core.canRedo()).toBe(true);
    core.renameTrack(0, "v3");
    expect(core.canRedo()).toBe(false);
    expect(core.getState().tracks[0]!.label).toBe("v3");
  });

  it("addAutomationPoint returns a new id and is undoable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const id = core.addAutomationPoint("clip-auto-1", 4, 0.5);
    expect(id).not.toBeNull();
    expect(core.canUndo()).toBe(true);
    core.undo();
    const clip = core
      .getState()
      .clips.find((c) => c.id === "clip-auto-1");
    expect(
      clip?.type === "automation" && clip.points.some((p) => p.id === id),
    ).toBe(false);
  });

  it("subscribers see new state after dispatch", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const seen: string[] = [];
    const sub = core.subscribe((s) => seen.push(s.tracks[0]!.label));
    core.renameTrack(0, "alpha");
    core.renameTrack(0, "beta");
    sub.unsubscribe();
    expect(seen).toContain("alpha");
    expect(seen).toContain("beta");
  });
});
