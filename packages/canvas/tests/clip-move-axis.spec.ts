// PlaylistInteractionOptions.clipMoveAxis: "rows" — a host whose clips'
// times come from elsewhere (dates set in a form) lets a drag move clips
// between rows only: the time never shifts, however far sideways the
// pointer goes. ←/→ move the playhead even with a selection; ↑/↓ still
// move the selection between rows. The default ("free") keeps FL parity.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistClip,
  type PlaylistState,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const WIDTH = 1200;
const HEIGHT = 700;
const PX = 20;

type Listener = (event: Event) => void;

function createHost() {
  const listeners = new Map<string, Listener>();
  const host = {
    style: {} as Record<string, string>,
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: WIDTH, height: HEIGHT };
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
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointer(x: number, y: number): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
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

function key(name: string): KeyboardEvent {
  return {
    key: name,
    code: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault() {},
  } as unknown as KeyboardEvent;
}

function setup(clipMoveAxis?: "free" | "rows") {
  const base = createDemoPlaylistState();
  const clip: PlaylistClip = {
    id: "c0",
    type: "pattern",
    trackId: base.tracks[0]!.id,
    start: 10,
    duration: 8,
    label: "Préstamo",
    color: "#8e4ec6",
  };
  const state: PlaylistState = {
    ...base,
    clips: [clip],
    selection: { clipIds: [], automationPointIds: [] },
    snap: { mode: "none", lastActiveMode: "beat" },
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(WIDTH, HEIGHT);
  core.updateViewport({ pxPerBeat: PX, scrollX: 0, scrollY: 0 });
  core.setTool("select");
  const { host, listeners } = createHost();
  const controller = createPlaylistInteractionController(host, core, clipMoveAxis ? { clipMoveAxis } : {});
  const clipOf = () => core.getState().clips.find((c) => c.id === "c0")!;
  const trackIndex = () => core.getState().tracks.findIndex((t) => t.id === clipOf().trackId);
  const centre = () => {
    const view = core.getPresentation().clipViewsById.get("c0")!;
    return { x: view.bodyRect.x + view.bodyRect.width / 2, y: view.bodyRect.y + view.bodyRect.height / 2 };
  };
  const drag = (dx: number, dy: number) => {
    const from = centre();
    listeners.get("pointerdown")?.(pointer(from.x, from.y));
    listeners.get("pointermove")?.(pointer(from.x + dx / 2, from.y + dy / 2));
    listeners.get("pointermove")?.(pointer(from.x + dx, from.y + dy));
    listeners.get("pointerup")?.(pointer(from.x + dx, from.y + dy));
  };
  return { core, controller, listeners, clipOf, trackIndex, drag };
}

describe("clipMoveAxis 'rows': a drag never moves a clip in time", () => {
  it("a sideways drag leaves the dates alone; a vertical one changes the row", () => {
    const { clipOf, trackIndex, drag, controller } = setup("rows");
    drag(6 * PX, 0);
    expect(clipOf().start).toBe(10);
    drag(9 * PX, M.trackHeight * 2);
    expect(clipOf().start).toBe(10);
    expect(clipOf().duration).toBe(8);
    expect(trackIndex()).toBe(2);
    controller.destroy();
  });

  it("←/→ walk the day even with a selection; ↑/↓ move the selection between rows", () => {
    const { core, listeners, clipOf, trackIndex, controller } = setup("rows");
    core.setClipSelection(["c0"]);
    const before = core.getState().playPosition.time;
    listeners.get("keydown")?.(key("ArrowRight"));
    expect(clipOf().start).toBe(10);
    expect(core.getState().playPosition.time).toBe(before + 1);
    listeners.get("keydown")?.(key("ArrowDown"));
    expect(trackIndex()).toBe(1);
    expect(clipOf().start).toBe(10);
    controller.destroy();
  });

  it("the default keeps FL parity: a sideways drag moves the clip in time", () => {
    const { clipOf, drag, controller } = setup();
    drag(6 * PX, 0);
    expect(clipOf().start).toBe(16);
    controller.destroy();
  });
});
