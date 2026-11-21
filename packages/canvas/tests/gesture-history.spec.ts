// Gesture ↔ undo history contract (R2-BRIDGE-1 + PlaylistCore.getGestureBase).
//
// A pointer-down that CREATES or changes clips (paint click, Shift clone-drag,
// Delete / Mute click, Draw double-click) must land in ONE undo entry together
// with the drag that follows and with any host follow-up a microtask folds in
// through core.amend (the financial bridge relabels / makes unique / flags
// noSlice on clips it just saw appear). It used to be two: the creating
// dispatch was pushed on its own BEFORE the controller opened the gesture, so
// one Ctrl+Z only reverted the drag + fix-ups and left the uncorrected clip
// (or, for clone-drag, a hidden duplicate under the original).
//
// Plain selection clicks, sub-snap jitter and marquee drags must keep NOT
// creating undo entries.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistCore,
  type PlaylistState,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = createDemoPlaylistState().viewport.pxPerBeat;

type Listener = (event: PointerEvent) => void;

interface Mods {
  shiftKey?: boolean;
  altKey?: boolean;
  detail?: number;
  timeStamp?: number;
}

function xAt(beat: number): number {
  return M.trackHeaderWidth + beat * PX;
}

function yAt(trackIndex: number): number {
  return M.rulerHeight + trackIndex * M.trackHeight + M.trackHeight / 2;
}

function pointerEvent(x: number, y: number, mods: Mods = {}): PointerEvent {
  return {
    timeStamp: mods.timeStamp ?? 0,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: x,
    clientY: y,
    altKey: mods.altKey ?? false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: mods.shiftKey ?? false,
    detail: mods.detail ?? 1,
    preventDefault() {},
  } as unknown as PointerEvent;
}

function setup(tool: PlaylistState["tool"]) {
  const core = createPlaylistCore(createDemoPlaylistState());
  core.setViewportSize(1200, 700);
  core.setTool(tool);
  const listeners = new Map<string, Listener>();
  const host = {
    style: { cursor: "" } as Record<string, string>,
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
  } as unknown as HTMLElement;
  const controller = createPlaylistInteractionController(host, core);
  const fire = (type: string, x: number, y: number, mods?: Mods) =>
    listeners.get(type)?.(pointerEvent(x, y, mods));
  return {
    core,
    controller,
    down: (x: number, y: number, mods?: Mods) => fire("pointerdown", x, y, mods),
    move: (x: number, y: number, mods?: Mods) => fire("pointermove", x, y, mods),
    up: (x: number, y: number, mods?: Mods) => fire("pointerup", x, y, mods),
  };
}

// Mimics the financial bridge: every clip that appears gets a follow-up fix
// in a microtask, folded into the current undo entry through core.amend.
function attachHostFixups(core: PlaylistCore, label = "fixed"): void {
  let known = new Set(core.getState().clips.map((c) => c.id));
  core.subscribe((state) => {
    const fresh = state.clips.filter((c) => !known.has(c.id)).map((c) => c.id);
    known = new Set(state.clips.map((c) => c.id));
    if (fresh.length === 0) return;
    queueMicrotask(() => {
      core.amend(() => {
        for (const id of fresh) core.setClipLabel(id, label);
      });
    });
  });
}

const flushMicrotasks = () => Promise.resolve();

function ids(state: PlaylistState): string[] {
  return state.clips.map((c) => c.id);
}

describe("R2-BRIDGE-1 — creating pointer-down + drag + host amend = one undo entry", () => {
  it("paint click + microtask amend + pointerup: one undo removes the clip", async () => {
    const { core, controller, down, up } = setup("paint");
    attachHostFixups(core);
    const before = core.getState();
    down(xAt(40), yAt(2));
    await flushMicrotasks();
    up(xAt(40), yAt(2));
    controller.destroy();

    const created = core.getState().clips.filter((c) => !ids(before).includes(c.id));
    expect(created).toHaveLength(1);
    expect(created[0]!.label).toBe("fixed");

    expect(core.undo()).toBe(true);
    expect(ids(core.getState())).toEqual(ids(before));
    expect(core.canUndo()).toBe(false);

    // Redo brings back the corrected clip, never the uncorrected one.
    expect(core.redo()).toBe(true);
    const redone = core.getState().clips.find((c) => c.id === created[0]!.id);
    expect(redone?.label).toBe("fixed");
  });

  it("paint click + drag that paints more cells: still one undo entry", async () => {
    const { core, controller, down, move, up } = setup("paint");
    attachHostFixups(core);
    const before = core.getState();
    down(xAt(40), yAt(2));
    await flushMicrotasks();
    move(xAt(52), yAt(2));
    await flushMicrotasks();
    up(xAt(52), yAt(2));
    controller.destroy();
    expect(core.getState().clips.length).toBeGreaterThan(before.clips.length + 1);

    core.undo();
    expect(ids(core.getState())).toEqual(ids(before));
    expect(core.canUndo()).toBe(false);
  });

  it("Shift clone-drag: one undo removes the clone (no hidden duplicate under the original)", async () => {
    const { core, controller, down, move, up } = setup("select");
    attachHostFixups(core);
    const before = core.getState();
    down(xAt(22), yAt(0), { shiftKey: true });
    await flushMicrotasks();
    move(xAt(30), yAt(0), { shiftKey: true });
    up(xAt(30), yAt(0), { shiftKey: true });
    controller.destroy();

    const after = core.getState();
    expect(after.clips).toHaveLength(before.clips.length + 1);
    const clone = after.clips.find((c) => !ids(before).includes(c.id))!;
    expect(clone.start).toBe(26);
    expect(clone.label).toBe("fixed");
    expect(after.clips.find((c) => c.id === "clip-drums-2")!.start).toBe(18);

    expect(core.undo()).toBe(true);
    expect(ids(core.getState())).toEqual(ids(before));
    expect(core.canUndo()).toBe(false);
  });

  it("Delete-tool click + drag: the clicked clip and the swept ones restore with one undo", () => {
    const { core, controller, down, move, up } = setup("delete");
    const before = core.getState();
    down(xAt(8), yAt(0));
    move(xAt(10), yAt(1));
    up(xAt(10), yAt(1));
    controller.destroy();
    const left = ids(core.getState());
    expect(left).not.toContain("clip-drums-1");
    expect(left).not.toContain("clip-bass-1");

    core.undo();
    expect(ids(core.getState())).toEqual(ids(before));
    expect(core.canUndo()).toBe(false);
  });

  it("Mute-tool click + drag: one undo unmutes every touched clip", () => {
    const { core, controller, down, move, up } = setup("mute");
    down(xAt(8), yAt(0));
    move(xAt(10), yAt(1));
    up(xAt(10), yAt(1));
    controller.destroy();
    const muted = (id: string) =>
      core.getState().clips.find((c) => c.id === id)!.muted === true;
    expect(muted("clip-drums-1")).toBe(true);
    expect(muted("clip-bass-1")).toBe(true);

    core.undo();
    expect(muted("clip-drums-1")).toBe(false);
    expect(muted("clip-bass-1")).toBe(false);
    expect(core.canUndo()).toBe(false);
  });

  it("Draw double-click + microtask amend: one undo removes the clip", async () => {
    const { core, controller, down, up } = setup("draw");
    attachHostFixups(core);
    const before = core.getState();
    down(xAt(50), yAt(3), { detail: 1, timeStamp: 0 });
    up(xAt(50), yAt(3));
    down(xAt(50), yAt(3), { detail: 2, timeStamp: 100 });
    await flushMicrotasks();
    up(xAt(50), yAt(3));
    controller.destroy();
    const created = core.getState().clips.filter((c) => !ids(before).includes(c.id));
    expect(created).toHaveLength(1);
    expect(created[0]!.label).toBe("fixed");

    core.undo();
    expect(ids(core.getState())).toEqual(ids(before));
    expect(core.canUndo()).toBe(false);
  });

  it("Draw drag-create is still exactly one undo entry", async () => {
    const { core, controller, down, move, up } = setup("draw");
    core.setSnapMode("none");
    attachHostFixups(core);
    const before = core.getState();
    down(xAt(50), yAt(3));
    move(xAt(56), yAt(3));
    await flushMicrotasks();
    move(xAt(58), yAt(3));
    up(xAt(58), yAt(3));
    controller.destroy();
    expect(core.getState().clips).toHaveLength(before.clips.length + 1);

    core.undo();
    expect(ids(core.getState())).toEqual(ids(before));
    expect(core.canUndo()).toBe(false);
  });
});

describe("R2-BRIDGE-1 — non-mutating pointer gestures stay out of the undo history", () => {
  it("a select click on a clip changes the selection but adds no undo entry", () => {
    const { core, controller, down, up } = setup("select");
    down(xAt(8), yAt(0));
    up(xAt(8), yAt(0));
    controller.destroy();
    expect(core.getState().selection.clipIds).toEqual(["clip-drums-1"]);
    expect(core.canUndo()).toBe(false);
  });

  it("a select click with sub-snap jitter adds no undo entry", () => {
    const { core, controller, down, move, up } = setup("select");
    const before = core.getState();
    down(xAt(8), yAt(0));
    move(xAt(8) + 3, yAt(0));
    move(xAt(8) + 1, yAt(0));
    up(xAt(8) + 1, yAt(0));
    controller.destroy();
    expect(core.getState().clips).toBe(before.clips);
    expect(core.canUndo()).toBe(false);
  });

  it("a marquee drag selects but adds no undo entry", () => {
    const { core, controller, down, move, up } = setup("select");
    down(xAt(1), yAt(0) - 30);
    move(xAt(12), yAt(1) + 20);
    up(xAt(12), yAt(1) + 20);
    controller.destroy();
    expect(core.getState().selection.clipIds.length).toBeGreaterThan(0);
    expect(core.getState().marquee).toBeNull();
    expect(core.canUndo()).toBe(false);
  });

  it("undo of a select drag keeps the selection made by its pointer-down", () => {
    const { core, controller, down, move, up } = setup("select");
    down(xAt(8), yAt(0));
    move(xAt(12), yAt(0));
    up(xAt(12), yAt(0));
    controller.destroy();
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(4);
    core.undo();
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(0);
    expect(core.getState().selection.clipIds).toEqual(["clip-drums-1"]);
    expect(core.canUndo()).toBe(false);
  });
});

describe("PlaylistCore.getGestureBase", () => {
  it("is null while no gesture is open", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    expect(core.getGestureBase()).toBeNull();
    core.setClipLabel("clip-drums-1", "x");
    expect(core.getGestureBase()).toBeNull();
  });

  it("is the state the gesture's undo entry returns to", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.beginGesture();
    // Nothing undoable yet: the base is the present itself.
    expect(core.getGestureBase()).toBe(core.getState());
    // Non-undoable changes before the first document change move it along
    // (they are not part of the gesture's undo entry).
    core.setSelection({ clipIds: ["clip-drums-1"] });
    const selected = core.getState();
    expect(core.getGestureBase()).toBe(selected);
    core.moveClips([{ id: "clip-drums-1", start: 4, trackIndex: 0 }]);
    expect(core.getGestureBase()).toBe(selected);
    core.moveClips([{ id: "clip-drums-1", start: 8, trackIndex: 0 }]);
    core.setClipLabel("clip-drums-1", "moved");
    expect(core.getGestureBase()).toBe(selected);
    // Nested gestures report the outermost base.
    core.beginGesture();
    core.setClipColor("clip-drums-1", "#123456");
    expect(core.getGestureBase()).toBe(selected);
    core.endGesture();
    expect(core.getGestureBase()).toBe(selected);
    core.endGesture();
    expect(core.getGestureBase()).toBeNull();

    core.undo();
    expect(core.getState()).toBe(selected);
  });

  it("amend inside the gesture never moves a base already fixed", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    core.beginGesture();
    const id = core.createClip({ trackIndex: 2, start: 40, duration: 4 });
    core.amend(() => core.setClipLabel(id, "fixed"));
    expect(core.getGestureBase()).toBe(before);
    core.endGesture();
    core.undo();
    expect(core.getState()).toBe(before);
  });

  it("is cleared by undo / redo", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipLabel("clip-drums-1", "a");
    core.beginGesture();
    core.setClipLabel("clip-drums-1", "b");
    core.undo();
    expect(core.getGestureBase()).toBeNull();
    core.beginGesture();
    core.redo();
    expect(core.getGestureBase()).toBeNull();
  });
});
