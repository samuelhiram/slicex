// Generic PlaylistCore APIs a host (the financial bridge) builds on:
//   - amend(mutate): follow-up dispatches fold into the current undo entry.
//   - PlaylistClip.noSlice + setClipNoSlice: clips no slice path may cut.
//   - PlaylistCoreOptions.stretchEnabled: stretch mode can be switched off.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  playlistReducer,
  type PlaylistClip,
  type PlaylistState,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

function clipOf(state: PlaylistState, id: string): PlaylistClip {
  return state.clips.find((c) => c.id === id)!;
}

describe("PlaylistCore.amend", () => {
  it("paste then amend(setClipLabel): one undo returns to pre-paste, redo returns the amended state", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipSelection(["clip-drums-1"]);
    core.copyToClipboard();
    const prePaste = core.getState();
    const [pastedId] = core.pasteClipboard({ atTime: 40, atTrackIndex: 0 });
    expect(pastedId).toBeDefined();

    let notifies = 0;
    const sub = core.subscribe(() => {
      notifies += 1;
    });
    core.amend(() => {
      core.setClipLabel(pastedId!, "Amended");
    });
    sub.unsubscribe();
    expect(notifies).toBe(1); // listeners still see every dispatch
    const amended = core.getState();
    expect(clipOf(amended, pastedId!).label).toBe("Amended");

    expect(core.undo()).toBe(true);
    expect(core.getState()).toBe(prePaste);
    expect(core.getState().clips.some((c) => c.id === pastedId)).toBe(false);

    expect(core.redo()).toBe(true);
    expect(core.getState()).toBe(amended);
    expect(clipOf(core.getState(), pastedId!).label).toBe("Amended");
    expect(core.canRedo()).toBe(false);
  });

  it("is nesting-safe and restores normal undo afterwards", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const initial = core.getState();
    core.setClipLabel("clip-drums-1", "A");
    core.amend(() => {
      core.setClipLabel("clip-drums-1", "B");
      core.amend(() => {
        core.setClipColor("clip-drums-1", "#123456");
      });
      core.setClipLabel("clip-bass-1", "C");
    });
    // Back to normal: this one pushes its own entry.
    core.setClipLabel("clip-drums-1", "D");
    expect(clipOf(core.getState(), "clip-drums-1").label).toBe("D");

    core.undo();
    const amended = core.getState();
    expect(clipOf(amended, "clip-drums-1").label).toBe("B");
    expect(clipOf(amended, "clip-drums-1").color).toBe("#123456");
    expect(clipOf(amended, "clip-bass-1").label).toBe("C");
    // A, B, colour and C were one step.
    core.undo();
    expect(core.getState()).toBe(initial);
    expect(core.canUndo()).toBe(false);
  });

  it("unwinds the counter when mutate throws", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    expect(() =>
      core.amend(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    core.setClipLabel("clip-drums-1", "pushed");
    expect(core.canUndo()).toBe(true);
  });

  it("a gesture opened inside amend folds into the present entry", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const initial = core.getState();
    core.setClipLabel("clip-drums-1", "A");
    core.amend(() => {
      core.beginGesture();
      core.setClipLabel("clip-drums-1", "B");
      core.setClipColor("clip-drums-1", "#abcdef");
      core.endGesture();
    });
    expect(clipOf(core.getState(), "clip-drums-1").label).toBe("B");
    core.undo();
    expect(core.getState()).toBe(initial);
    expect(core.canUndo()).toBe(false);
  });

  it("inside an open gesture it behaves like the gesture (one entry on close)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    core.beginGesture();
    core.setClipLabel("clip-drums-1", "X");
    core.amend(() => core.setClipColor("clip-drums-1", "#010203"));
    core.endGesture();
    core.undo();
    expect(core.getState()).toBe(before);
    expect(core.canUndo()).toBe(false);
  });
});

describe("PlaylistClip.noSlice", () => {
  function coreWithNoSliceDrums() {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipNoSlice("clip-drums-1", true);
    return core;
  }

  it("setClipNoSlice is undoable and idempotent", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    core.setClipNoSlice("clip-drums-1", true);
    const flagged = core.getState();
    expect(clipOf(flagged, "clip-drums-1").noSlice).toBe(true);
    let notifies = 0;
    core.subscribe(() => {
      notifies += 1;
    });
    core.setClipNoSlice("clip-drums-1", true);
    expect(core.getState()).toBe(flagged);
    expect(notifies).toBe(0);
    core.setClipNoSlice("clip-drums-1", false);
    expect("noSlice" in clipOf(core.getState(), "clip-drums-1")).toBe(false);
    core.undo();
    expect(core.getState()).toBe(flagged);
    core.undo();
    expect(core.getState()).toBe(before);
  });

  it("setClipNoSlice respects locked tracks", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const drums = clipOf(core.getState(), "clip-drums-1");
    const trackIndex = core
      .getState()
      .tracks.findIndex((t) => t.id === drums.trackId);
    core.toggleTrackLock(trackIndex);
    core.setClipNoSlice("clip-drums-1", true);
    expect(clipOf(core.getState(), "clip-drums-1").noSlice).toBeUndefined();
  });

  it("sliceClipsAtTime skips noSlice clips and still cuts the others", () => {
    const core = coreWithNoSliceDrums();
    const drums = clipOf(core.getState(), "clip-drums-1");
    const cut = drums.start + drums.duration / 2;
    const crossing = core
      .getState()
      .clips.filter(
        (c) =>
          c.id !== drums.id && cut > c.start + 1e-6 && cut < c.start + c.duration - 1e-6,
      ).length;
    const newIds = core.sliceClipsAtTime(cut);
    expect(newIds.length).toBe(crossing);
    expect(clipOf(core.getState(), "clip-drums-1").duration).toBe(drums.duration);
  });

  it("the raw SLICE_CLIPS_AT_TIME reducer refuses to cut a noSlice clip", () => {
    const state = playlistReducer(
      createDemoPlaylistState(),
      { type: "SET_CLIP_NO_SLICE", clipId: "clip-drums-1", noSlice: true },
      M,
    );
    const drums = clipOf(state, "clip-drums-1");
    const cut = drums.start + 1;
    const right: PlaylistClip = {
      ...drums,
      id: "drums-right",
      start: cut,
      duration: drums.start + drums.duration - cut,
    };
    const next = playlistReducer(
      state,
      { type: "SLICE_CLIPS_AT_TIME", time: cut, clipIds: [drums.id], newClips: [right] },
      M,
    );
    expect(next).toBe(state);
    // Without the inherited flag the index-aligned right half is dropped too.
    const { noSlice: _flag, ...unflagged } = right;
    const next2 = playlistReducer(
      state,
      {
        type: "SLICE_CLIPS_AT_TIME",
        time: cut,
        clipIds: [drums.id],
        newClips: [unflagged as PlaylistClip],
      },
      M,
    );
    expect(next2).toBe(state);
  });

  it("the Slice tool gesture and the Insert key skip noSlice clips", () => {
    const core = coreWithNoSliceDrums();
    core.setViewportSize(1200, 700);
    core.setSnapMode("none");
    const listeners = new Map<string, (event: unknown) => void>();
    const host = {
      style: {} as Record<string, string>,
      focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }),
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      setPointerCapture() {},
      releasePointerCapture() {},
      dispatchEvent: () => true,
    } as unknown as HTMLElement;
    const controller = createPlaylistInteractionController(host, core);
    const drums = clipOf(core.getState(), "clip-drums-1");
    const drumsTrackClips = core
      .getState()
      .clips.filter((c) => c.trackId === drums.trackId).length;
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const x = view.bodyRect.x + view.bodyRect.width / 2;
    const y = view.bodyRect.y + view.bodyRect.height / 2;
    const pointer = (px: number, py: number) => ({
      pointerId: 1,
      button: 0,
      clientX: px,
      clientY: py,
      detail: 1,
      timeStamp: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
    });
    core.setTool("slice");
    listeners.get("pointerdown")!(pointer(x, y));
    listeners.get("pointermove")!(pointer(x, y + 2));
    listeners.get("pointerup")!(pointer(x, y + 2));
    expect(clipOf(core.getState(), "clip-drums-1").duration).toBe(drums.duration);

    core.setPlayPosition(drums.start + 1);
    listeners.get("keydown")!({
      key: "Insert",
      code: "Insert",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
    });
    controller.destroy();
    expect(clipOf(core.getState(), "clip-drums-1").duration).toBe(drums.duration);
    // No right half of drums appeared on its track.
    expect(
      core.getState().clips.filter((c) => c.trackId === drums.trackId).length,
    ).toBe(drumsTrackClips);
  });

  it("copy / paste / clone / duplicate / normalize keep the flag", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    // createClip input carries it; normalizeState preserves it.
    const created = core.createClip({ trackIndex: 0, start: 60, duration: 4, noSlice: true });
    expect(clipOf(core.getState(), created).noSlice).toBe(true);
    const [batch] = core.createClips([{ trackIndex: 0, start: 70, duration: 4, noSlice: true }]);
    expect(clipOf(core.getState(), batch!).noSlice).toBe(true);
    core.moveClips([{ id: created, start: 62, trackIndex: 0 }]); // forces normalize of a new array
    expect(clipOf(core.getState(), created).noSlice).toBe(true);

    core.setClipSelection([created]);
    core.copyToClipboard();
    const [pasted] = core.pasteClipboard({ atTime: 90, atTrackIndex: 1 });
    expect(clipOf(core.getState(), pasted!).noSlice).toBe(true);

    const [clone] = core.cloneClipsInPlace([created]);
    expect(clipOf(core.getState(), clone!).noSlice).toBe(true);

    core.setClipSelection([created]);
    const [dup] = core.duplicateSelectionRight();
    expect(clipOf(core.getState(), dup!).noSlice).toBe(true);

    // Initial state through the constructor keeps it as well.
    const seeded = createPlaylistCore({
      ...createDemoPlaylistState(),
      clips: createDemoPlaylistState().clips.map((c) =>
        c.id === "clip-drums-1" ? { ...c, noSlice: true } : c,
      ),
    });
    expect(clipOf(seeded.getState(), "clip-drums-1").noSlice).toBe(true);
  });
});

describe("PlaylistCoreOptions.stretchEnabled", () => {
  it("defaults to true: stretch mode toggles as before", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    expect(core.stretchEnabled).toBe(true);
    core.toggleStretchMode();
    expect(core.getState().stretchMode).toBe(true);
    core.setStretchMode(false);
    expect(core.getState().stretchMode).toBe(false);
  });

  it("false: setStretchMode / toggleStretchMode / raw actions are no-ops", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { stretchEnabled: false });
    expect(core.stretchEnabled).toBe(false);
    let notifies = 0;
    core.subscribe(() => {
      notifies += 1;
    });
    const before = core.getState();
    core.setStretchMode(true);
    core.toggleStretchMode();
    core.dispatch({ type: "TOGGLE_STRETCH_MODE" });
    core.dispatch({ type: "SET_STRETCH_MODE", enabled: true });
    core.setStretchMode(false);
    expect(core.getState()).toBe(before);
    expect(core.getState().stretchMode).toBe(false);
    expect(notifies).toBe(0);
  });

  it("false: the initial state is normalized to stretchMode false", () => {
    const core = createPlaylistCore(
      { ...createDemoPlaylistState(), stretchMode: true },
      { stretchEnabled: false },
    );
    expect(core.getState().stretchMode).toBe(false);
  });

  it("false: Shift+M does nothing and an edge drag crops instead of stretching", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { stretchEnabled: false });
    core.setViewportSize(1200, 700);
    core.setSnapMode("none");
    const listeners = new Map<string, (event: unknown) => void>();
    const host = {
      style: {} as Record<string, string>,
      focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }),
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      setPointerCapture() {},
      releasePointerCapture() {},
      dispatchEvent: () => true,
    } as unknown as HTMLElement;
    const controller = createPlaylistInteractionController(host, core);
    listeners.get("keydown")!({
      key: "M",
      code: "KeyM",
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      altKey: false,
      preventDefault() {},
    });
    expect(core.getState().stretchMode).toBe(false);

    const before = clipOf(core.getState(), "clip-chords-1");
    const view = core.getPresentation().clipViewsById.get("clip-chords-1")!;
    const x = view.resizeRightRect.x + view.resizeRightRect.width / 2;
    const y = view.resizeRightRect.y + view.resizeRightRect.height / 2;
    const pointer = (px: number) => ({
      pointerId: 1,
      button: 0,
      clientX: px,
      clientY: y,
      detail: 1,
      timeStamp: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
    });
    listeners.get("pointerdown")!(pointer(x));
    listeners.get("pointermove")!(pointer(x + 4 * core.getState().viewport.pxPerBeat));
    listeners.get("pointerup")!(pointer(x + 4 * core.getState().viewport.pxPerBeat));
    controller.destroy();
    const after = clipOf(core.getState(), "clip-chords-1");
    expect(after.duration).toBeGreaterThan(before.duration);
    expect(after.stretchRatio ?? 1).toBe(before.stretchRatio ?? 1);
  });
});

describe("PlaylistCore.touch", () => {
  it("creates an undo step with a new identity and identical content", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    core.touch();
    const after = core.getState();
    expect(after).not.toBe(before);
    expect(after.clips).toBe(before.clips);
    expect(after.tracks).toBe(before.tracks);
    expect(core.canUndo()).toBe(true);
    core.undo();
    expect(core.getState()).toBe(before);
    core.redo();
    expect(core.getState()).toBe(after);
  });

  it("inside a gesture it makes the gesture commit one entry", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    core.beginGesture();
    core.touch();
    core.endGesture();
    expect(core.canUndo()).toBe(true);
    core.undo();
    expect(core.getState()).toBe(before);
    expect(core.canUndo()).toBe(false);
  });
});
