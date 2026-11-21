// PlaylistInteractionOptions.rightButton: "menu" — the right button opens
// the context menu wherever it is pressed, whatever the tool: a clip's menu
// on a clip, the empty space's menu elsewhere. It never deletes or mutes
// (FL's right-button sweeps of Draw / Paint / Mute). The Zoom tool keeps
// "right button zooms out". The default ("tool") keeps FL parity.
//
// rightButton: "mute" — the right button is the silencer: held, the cursor
// is the Mute tool's and a clip flips (muted ⇄ counted) each time the
// pointer enters it — passing over it again without letting go flips it
// back; one undo entry, reported as a "mute" edit (what ended different);
// never a menu over the timeline, whatever the tool (Zoom zooms out).
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistClip,
  type PlaylistState,
  type PlaylistToolId,
} from "../src/playlist-core";
import { createPlaylistInteractionController, type PlaylistEditEvent } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const WIDTH = 1200;
const HEIGHT = 700;
const PX = 20;

type Listener = (event: Event) => void;

function pointer(x: number, y: number, button: number): PointerEvent {
  return {
    pointerId: 1,
    button,
    detail: 1,
    timeStamp: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    pointerType: "mouse",
    preventDefault() {},
  } as unknown as PointerEvent;
}

function setup(tool: PlaylistToolId, rightButton?: "tool" | "menu" | "mute") {
  const base = createDemoPlaylistState();
  const clips: PlaylistClip[] = [0, 1].map((index) => ({
    id: `c${index}`,
    type: "pattern",
    trackId: base.tracks[0]!.id,
    start: 4 + index * 10,
    duration: 6,
    label: `Clip ${index}`,
    color: "#46b871",
  }));
  const state: PlaylistState = {
    ...base,
    clips,
    selection: { clipIds: [], automationPointIds: [] },
    snap: { mode: "none", lastActiveMode: "beat" },
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(WIDTH, HEIGHT);
  core.updateViewport({ pxPerBeat: PX, scrollX: 0, scrollY: 0 });
  core.setTool(tool);
  const listeners = new Map<string, Listener>();
  const host = {
    style: {} as Record<string, string>,
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatchEvent: () => true,
  } as unknown as HTMLElement;
  const edits: PlaylistEditEvent[] = [];
  const controller = createPlaylistInteractionController(
    host,
    core,
    rightButton ? { rightButton, onEdit: (edit) => edits.push(edit), toolCursors: { mute: "mute-cursor" } } : {},
  );
  const centre = (id: string) => {
    const view = core.getPresentation().clipViewsById.get(id)!;
    return { x: view.bodyRect.x + view.bodyRect.width / 2, y: view.bodyRect.y + view.bodyRect.height / 2 };
  };
  // A right-button press on the first clip that sweeps over the second.
  const rightSweep = () => {
    const from = centre("c0");
    const to = centre("c1");
    listeners.get("pointerdown")?.(pointer(from.x, from.y, 2));
    listeners.get("pointermove")?.(pointer(to.x, to.y, 2));
    listeners.get("pointerup")?.(pointer(to.x, to.y, 2));
  };
  // Three rows under the first clip: empty space (taken before any delete).
  const empty = (({ x, y }) => ({ x, y: y + M.trackHeight * 3 }))(centre("c0"));
  const rightClickEmpty = () => {
    listeners.get("pointerdown")?.(pointer(empty.x, empty.y, 2));
    listeners.get("pointerup")?.(pointer(empty.x, empty.y, 2));
  };
  // A right-button press on empty space that sweeps across both clips.
  const rightSweepFromEmpty = () => {
    const a = centre("c0");
    const b = centre("c1");
    listeners.get("pointerdown")?.(pointer(a.x - 3 * PX, a.y, 2));
    listeners.get("pointermove")?.(pointer(a.x, a.y, 2));
    expect(host.style.cursor).toBe("mute-cursor");
    listeners.get("pointermove")?.(pointer(b.x, b.y, 2));
    listeners.get("pointerup")?.(pointer(b.x, b.y, 2));
  };
  const press = (x: number, y: number) => listeners.get("pointerdown")?.(pointer(x, y, 2));
  const move = (x: number, y: number) => listeners.get("pointermove")?.(pointer(x, y, 2));
  const release = (x: number, y: number) => listeners.get("pointerup")?.(pointer(x, y, 2));
  return { core, controller, rightSweep, rightClickEmpty, rightSweepFromEmpty, edits, centre, press, move, release };
}

describe("rightButton 'menu': the context menu, whatever the tool", () => {
  for (const tool of ["select", "draw", "paint", "mute", "delete", "slice", "slip"] as const) {
    it(`${tool}: a clip's menu on a clip (nothing deleted or muted); the space's menu on empty space`, () => {
      const { core, controller, rightSweep, rightClickEmpty } = setup(tool, "menu");
      rightSweep();
      expect(core.getState().clips.map((clip) => clip.id)).toEqual(["c0", "c1"]);
      expect(core.getState().clips.some((clip) => clip.muted === true)).toBe(false);
      expect(core.getState().contextMenu).toMatchObject({ kind: "clip", clipId: "c0" });
      core.closeContextMenu();
      rightClickEmpty();
      expect(core.getState().contextMenu).toMatchObject({ kind: "background" });
      controller.destroy();
    });
  }

  it("zoom keeps 'right button zooms out'", () => {
    const { core, controller, rightClickEmpty } = setup("zoom", "menu");
    const before = core.getState().viewport.pxPerBeat;
    rightClickEmpty();
    expect(core.getState().viewport.pxPerBeat).toBeLessThan(before);
    expect(core.getState().contextMenu).toBeNull();
    controller.destroy();
  });

  it("the default keeps FL parity: a right-button sweep with Mute deletes, no menu on empty space", () => {
    const { core, controller, rightSweep, rightClickEmpty } = setup("mute");
    rightSweep();
    expect(core.getState().clips).toHaveLength(0);
    rightClickEmpty();
    expect(core.getState().contextMenu).toBeNull();
    controller.destroy();
  });
});

describe("rightButton 'mute': the silencer, whatever the tool", () => {
  for (const tool of ["select", "draw", "paint", "mute", "delete", "slice", "slip"] as const) {
    it(`${tool}: a sweep from empty space mutes what it crosses (one undo, reported); never a menu`, () => {
      const { core, controller, rightSweepFromEmpty, rightClickEmpty, edits } = setup(tool, "mute");
      rightSweepFromEmpty();
      expect(core.getState().clips.map((clip) => [clip.id, clip.muted === true])).toEqual([
        ["c0", true],
        ["c1", true],
      ]);
      expect(core.getState().contextMenu).toBeNull();
      expect(edits).toEqual([
        { kind: "mute", clipIds: ["c0", "c1"], labels: ["Clip 0", "Clip 1"], muted: [true, true] },
      ]);
      rightClickEmpty();
      expect(core.getState().contextMenu).toBeNull();
      core.undo();
      expect(core.getState().clips.some((clip) => clip.muted === true)).toBe(false);
      controller.destroy();
    });
  }

  it("each clip flips: a muted one counts again, a counted one is muted", () => {
    const { core, controller, rightSweep, edits } = setup("select", "mute");
    core.setClipsMuted(["c0"], true);
    rightSweep();
    expect(core.getState().clips.map((clip) => [clip.id, clip.muted === true])).toEqual([
      ["c0", false],
      ["c1", true],
    ]);
    expect(edits).toEqual([
      { kind: "mute", clipIds: ["c0", "c1"], labels: ["Clip 0", "Clip 1"], muted: [false, true] },
    ]);
    controller.destroy();
  });

  it("without letting go, entering it again flips it back; resting on it does not", () => {
    const { core, controller, edits, centre, press, move, release } = setup("select", "mute");
    const muted = () => core.getState().clips.find((clip) => clip.id === "c0")!.muted === true;
    const c0 = centre("c0");
    const outside = { x: c0.x - 4 * PX, y: c0.y };
    press(outside.x, outside.y);
    move(c0.x, c0.y);
    expect(muted()).toBe(true);
    move(c0.x + 5, c0.y);
    move(c0.x - 5, c0.y + 2);
    expect(muted()).toBe(true);
    move(outside.x, outside.y);
    move(c0.x, c0.y);
    expect(muted()).toBe(false);
    move(outside.x, outside.y);
    release(outside.x, outside.y);
    // Back to how it was: nothing to report.
    expect(edits).toEqual([]);
    controller.destroy();
  });

  it("zoom keeps 'right button zooms out'", () => {
    const { core, controller, rightClickEmpty } = setup("zoom", "mute");
    const before = core.getState().viewport.pxPerBeat;
    rightClickEmpty();
    expect(core.getState().viewport.pxPerBeat).toBeLessThan(before);
    controller.destroy();
  });
});
