// PlaylistClip.timeLocked + the lock button (controller / renderer
// clipTimeLock): a time-locked clip only moves between rows — a drag never
// shifts it in time, its edges and the extend grabber don't resize it, Slip
// leaves it, ←/→ move the playhead. A free clip keeps FL parity. The button
// is drawn in the card's bottom-left corner, translucent, and slides with
// the title (sticky) without taking its room; the controller asks
// the renderer where it is (rectOf), so a click lands where it is drawn; a
// click (Select / Draw) toggles the flag in one undo entry and tells the host.
import { Container, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getClipExtendHandle,
  type PlaylistClip,
  type PlaylistRect,
  type PlaylistState,
} from "../src/playlist-core";
import { createPlaylistInteractionController, hitTestPlaylist } from "../src/playlist-interaction";
import { clipCardWidthPx, createClipNodeRegistry } from "../src/playlist-renderer-pixi/clip-node-registry";
import { COLORS } from "../src/playlist-renderer-pixi/palette";

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

function pointer(x: number, y: number, button = 0): PointerEvent {
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

function setup(timeLocked: boolean) {
  const base = createDemoPlaylistState();
  const clip: PlaylistClip = {
    id: "c0",
    type: "pattern",
    trackId: base.tracks[0]!.id,
    start: 10,
    duration: 8,
    label: "Préstamo",
    color: "#8e4ec6",
    ...(timeLocked ? { timeLocked: true } : {}),
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
  const toggles: Array<[string, boolean]> = [];
  // Where a renderer would draw it: the card's bottom-left corner.
  const rectOf = (clipId: string, out: PlaylistRect): PlaylistRect | null => {
    const view = core.getPresentation().clipViewsById.get(clipId);
    if (!view) return null;
    out.x = view.rect.x + 8;
    out.y = view.rect.y + view.rect.height - 25;
    out.width = 22;
    out.height = 22;
    return out;
  };
  const controller = createPlaylistInteractionController(host, core, {
    clipTimeLock: {
      rectOf,
      hints: ["Fechas libres", "Fechas fijas"],
      onToggle: (clipId, locked) => toggles.push([clipId, locked]),
    },
  });
  const view = () => core.getPresentation().clipViewsById.get("c0")!;
  const clipOf = () => core.getState().clips.find((c) => c.id === "c0")!;
  const trackIndex = () => core.getState().tracks.findIndex((t) => t.id === clipOf().trackId);
  const centre = () => ({
    x: view().bodyRect.x + view().bodyRect.width / 2,
    y: view().bodyRect.y + view().bodyRect.height / 2,
  });
  const gesture = (from: { x: number; y: number }, dx: number, dy: number) => {
    listeners.get("pointerdown")?.(pointer(from.x, from.y));
    listeners.get("pointermove")?.(pointer(from.x + dx / 2, from.y + dy / 2));
    listeners.get("pointermove")?.(pointer(from.x + dx, from.y + dy));
    listeners.get("pointerup")?.(pointer(from.x + dx, from.y + dy));
  };
  const lockCentre = () => {
    const rect = rectOf("c0", { x: 0, y: 0, width: 0, height: 0 })!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  return { core, controller, listeners, view, clipOf, trackIndex, centre, gesture, lockCentre, toggles, rectOf };
}

describe("core: the flag", () => {
  it("setClipTimeLocked is undoable and idempotent; false drops the key", () => {
    const { core, clipOf } = setup(false);
    const before = core.getState();
    core.setClipTimeLocked("c0", false);
    expect(core.getState()).toBe(before);
    core.setClipTimeLocked("c0", true);
    expect(clipOf().timeLocked).toBe(true);
    core.setClipTimeLocked("c0", false);
    expect("timeLocked" in clipOf()).toBe(false);
    core.undo();
    expect(clipOf().timeLocked).toBe(true);
  });
});

describe("a time-locked clip only moves between rows", () => {
  it("a sideways drag leaves its time; a vertical one changes its row", () => {
    const { clipOf, trackIndex, gesture, centre, controller } = setup(true);
    gesture(centre(), 6 * PX, 0);
    expect(clipOf().start).toBe(10);
    gesture(centre(), 5 * PX, M.trackHeight);
    expect(clipOf().start).toBe(10);
    expect(trackIndex()).toBe(1);
    controller.destroy();
  });

  it("a free clip keeps FL parity (moves in time)", () => {
    const { clipOf, gesture, centre, controller } = setup(false);
    gesture(centre(), 6 * PX, 0);
    expect(clipOf().start).toBe(16);
    controller.destroy();
  });

  it("its edges are the clip (no resize); no extend grabber; Slip leaves it", () => {
    const { core, view, clipOf, gesture, controller } = setup(true);
    const rect = view().resizeRightRect;
    const edge = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(hitTestPlaylist(core.getPresentation(), edge, M).kind).toBe("clip");
    gesture(edge, 4 * PX, 0);
    expect(clipOf().duration).toBe(8);
    expect(clipOf().start).toBe(10);

    core.setClipSelection(["c0"]);
    expect(getClipExtendHandle(core.getPresentation(), () => true)).toBeNull();

    core.setTool("slip");
    const mid = { x: view().bodyRect.x + 40, y: view().bodyRect.y + 10 };
    gesture(mid, 3 * PX, 0);
    expect(clipOf().contentOffset ?? 0).toBe(0);
    controller.destroy();
  });

  it("free, the same edge resizes", () => {
    const { core, view, clipOf, gesture, controller } = setup(false);
    const rect = view().resizeRightRect;
    const edge = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(hitTestPlaylist(core.getPresentation(), edge, M).kind).toBe("resize-right");
    gesture(edge, 4 * PX, 0);
    expect(clipOf().duration).toBeGreaterThan(11);
    controller.destroy();
  });

  it("←/→ move the playhead with a locked selection, the clip when free", () => {
    const locked = setup(true);
    locked.core.setClipSelection(["c0"]);
    const playhead = locked.core.getState().playPosition.time;
    locked.listeners.get("keydown")?.(key("ArrowRight"));
    expect(locked.clipOf().start).toBe(10);
    expect(locked.core.getState().playPosition.time).toBe(playhead + 1);
    locked.controller.destroy();

    const free = setup(false);
    free.core.setClipSelection(["c0"]);
    free.listeners.get("keydown")?.(key("ArrowRight"));
    expect(free.clipOf().start).toBe(11);
    free.controller.destroy();
  });
});

describe("the lock button", () => {
  it("a click toggles the flag (one undo entry), tells the host, never moves or selects the clip", () => {
    const { core, clipOf, lockCentre, listeners, toggles, controller, rectOf } = setup(false);
    const at = lockCentre();
    expect(hitTestPlaylist(core.getPresentation(), at, M, { clipLockRect: rectOf }).kind).toBe("clip-lock");
    listeners.get("pointerdown")?.(pointer(at.x, at.y));
    listeners.get("pointerup")?.(pointer(at.x, at.y));
    expect(clipOf().timeLocked).toBe(true);
    expect(clipOf().start).toBe(10);
    expect(core.getState().selection.clipIds).toEqual([]);
    expect(toggles).toEqual([["c0", true]]);
    // The hint under it says what a click does now.
    expect(core.getState().tooltip).toMatchObject({ kind: "hint", text: "Fechas fijas" });
    core.undo();
    expect(clipOf().timeLocked).toBeUndefined();
    controller.destroy();
  });

  it("hovering it: pointer cursor, the lock hovered, its hint", () => {
    const { core, view, lockCentre, listeners, controller } = setup(true);
    const at = lockCentre();
    listeners.get("pointermove")?.(pointer(at.x, at.y));
    expect(view().lockHovered).toBe(true);
    expect(view().hovered).toBe(true);
    expect(core.getState().tooltip).toMatchObject({ kind: "hint", text: "Fechas fijas" });
    controller.destroy();
  });

  it("other tools and buttons see the clip", () => {
    const { core, clipOf, lockCentre, listeners, controller } = setup(false);
    core.setTool("mute");
    const at = lockCentre();
    listeners.get("pointerdown")?.(pointer(at.x, at.y));
    listeners.get("pointerup")?.(pointer(at.x, at.y));
    expect(clipOf().timeLocked).toBeUndefined();
    controller.destroy();
  });
});

// --- Drawn before the title, sliding with it ----------------------------------

function drawn(start: number, duration: number, scrollBeats: number, timeLocked = true, rowHeight?: number) {
  const base = createDemoPlaylistState();
  const state: PlaylistState = {
    ...base,
    clips: [
      {
        id: "c0",
        type: "pattern",
        trackId: base.tracks[0]!.id,
        start,
        duration,
        label: "Préstamo",
        color: "#8e4ec6",
        ...(timeLocked ? { timeLocked: true } : {}),
      },
    ],
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(WIDTH, HEIGHT);
  core.updateViewport({ pxPerBeat: PX, scrollX: scrollBeats * PX, scrollY: 0 });
  if (rowHeight !== undefined) core.setTrackHeight(0, rowHeight);
  const registry = createClipNodeRegistry(COLORS, {
    timeLock: true,
    getClipDetail: () => "-$7,500 /mes",
    getClipPeriod: () => "10 nov 2026 – 10 abr 2027",
  });
  const parent = new Container();
  const views = core.getPresentation().visibleClipViews;
  registry.syncFrame(parent, views, M.trackHeaderWidth);
  const node = parent.children[0] as Container;
  // The title (truncated on a narrow card): the first Text of the node.
  const title = node.children.find((child) => child instanceof Text) as Text | undefined;
  const lock = registry.lockRectOf("c0", { x: 0, y: 0, width: 0, height: 0 });
  const period = node.children.find((child) => child instanceof Text && child.text.includes("nov 2026")) as
    | Text
    | undefined;
  return {
    periodX: period && period.visible ? node.x + period.x : Number.NaN,
    periodY: period && period.visible ? node.y + period.y : Number.NaN,
    periodText: period && period.visible ? period.text : null,
    rect: views[0]!.rect,
    lock,
    titleX: title ? node.x + title.x : Number.NaN,
    // A short card shows the title only: 11 px pad + "Préstamo" at 7.2 px.
    textEnd: views[0]!.rect.x + 11 + "Préstamo".length * 7.2,
  };
}

describe("the lock sits in the bottom-left corner", () => {
  it("under the text, at the card's left; the title keeps its place", () => {
    const { rect, lock, titleX } = drawn(5, 50, 0);
    expect(lock).not.toBeNull();
    expect(lock!.x).toBeGreaterThanOrEqual(rect.x + 4);
    expect(lock!.x).toBeLessThan(rect.x + 12);
    expect(lock!.y + lock!.height).toBeLessThanOrEqual(rect.y + rect.height);
    expect(lock!.y).toBeGreaterThan(rect.y + 30);
    expect(titleX).toBe(rect.x + 11);
  });

  it("slides with the title to the timeline's left edge (sticky)", () => {
    const { rect, lock, titleX } = drawn(0, 200, 50);
    expect(rect.x).toBeLessThan(M.trackHeaderWidth);
    expect(lock!.x).toBeGreaterThanOrEqual(M.trackHeaderWidth);
    expect(lock!.x).toBeLessThan(M.trackHeaderWidth + 12);
    expect(lock!.x).toBeLessThanOrEqual(titleX);
  });

  it("a card too short for the corner keeps it, beside the name and amount, centred", () => {
    const { rect, lock, textEnd } = drawn(5, 50, 0, true, 44);
    expect(rect.height).toBeLessThan(50);
    expect(lock).not.toBeNull();
    expect(lock!.x).toBeGreaterThanOrEqual(textEnd);
    expect(lock!.x - textEnd).toBeLessThan(10);
    expect(Math.abs(lock!.y + lock!.height / 2 - (rect.y + rect.height / 2))).toBeLessThanOrEqual(1);
  });

  it("a free clip shows it too (open); a card too narrow shows none", () => {
    expect(drawn(5, 50, 0, false).lock).not.toBeNull();
    // 2 beats = 40 px.
    expect(drawn(5, 2, 0).lock).toBeNull();
  });
});

describe("the dates it covers, right after the lock", () => {
  it("on the lock's row, whole on a long card", () => {
    const { lock, periodX, periodY, periodText } = drawn(5, 50, 0);
    expect(periodText).toBe("10 nov 2026 – 10 abr 2027");
    expect(periodX).toBeGreaterThanOrEqual(lock!.x + lock!.width);
    expect(periodX - (lock!.x + lock!.width)).toBeLessThan(6);
    expect(periodY).toBeGreaterThanOrEqual(lock!.y);
    expect(periodY).toBeLessThan(lock!.y + lock!.height);
  });

  it("beside the text on a short card too; cut to fit a narrow one", () => {
    const short = drawn(5, 50, 0, true, 44);
    expect(short.periodText).toBe("10 nov 2026 – 10 abr 2027");
    expect(short.periodX).toBeGreaterThan(short.lock!.x);
    // 7 beats = 140 px: the dates are cut, never past the card.
    const narrow = drawn(5, 7, 0);
    expect(narrow.periodText!.endsWith("…")).toBe(true);
  });

  it("clipCardWidthPx fits what the card draws", () => {
    const tall = clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 58, 20);
    expect(tall).toBeGreaterThanOrEqual(8 + 22 + 2 + "9 dic 2026".length * 6.7);
    expect(clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 40, 20)).toBeGreaterThan(tall);
  });
});
