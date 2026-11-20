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
  // The finance shell's roomy rows (84 px: a 70 px card) unless told.
  core.setTrackHeight(0, rowHeight ?? 84);
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
  // The badge behind the dates: the Graphics right before their Text.
  const periodIndex = period ? node.children.indexOf(period) : -1;
  const badge = periodIndex > 0 ? node.children[periodIndex - 1] : undefined;
  // The amount line ("-$7,500 /mes").
  const amount = node.children.find((child) => child instanceof Text && child.text.includes("7,500")) as
    | Text
    | undefined;
  return {
    amountX: amount && amount.visible ? node.x + amount.x : Number.NaN,
    amountY: amount && amount.visible ? node.y + amount.y : Number.NaN,
    amountText: amount && amount.visible ? amount.text : null,
    badgeX: badge && badge.visible ? node.x + badge.x : Number.NaN,
    badgeY: badge && badge.visible ? node.y + badge.y : Number.NaN,
    badgeRight: badge && badge.visible ? node.x + badge.x + badge.width : Number.NaN,
    titleY: title ? node.y + title.y : Number.NaN,
    periodX: period && period.visible ? node.x + period.x : Number.NaN,
    periodY: period && period.visible ? node.y + period.y : Number.NaN,
    periodText: period && period.visible ? period.text : null,
    rect: views[0]!.rect,
    lock,
    titleX: title ? node.x + title.x : Number.NaN,
    // A short card shows the title only: 11 px pad + "Préstamo" at 7.8 px.
    textEnd: views[0]!.rect.x + 11 + "Préstamo".length * 7.8,
  };
}

describe("the lock sits in the bottom-left corner", () => {
  it("a tab flush with the card's left and bottom edges, under the text; the title keeps its place", () => {
    const { rect, lock, titleX } = drawn(5, 50, 0);
    expect(lock).not.toBeNull();
    expect(lock!.x).toBe(rect.x);
    expect(lock!.y + lock!.height).toBe(rect.y + rect.height);
    expect(lock!.y).toBeGreaterThan(rect.y + 30);
    // 11 px in; the Text 1 px left of it: its outline (half of 2 px) draws
    // the letters that far right.
    expect(titleX).toBe(rect.x + 11 - 1);
  });

  it("slides with the title to the timeline's left edge (sticky)", () => {
    const { rect, lock, titleX } = drawn(0, 200, 50);
    expect(rect.x).toBeLessThan(M.trackHeaderWidth);
    expect(lock!.x).toBeGreaterThanOrEqual(M.trackHeaderWidth);
    expect(lock!.x).toBeLessThan(M.trackHeaderWidth + 12);
    expect(lock!.x).toBeLessThanOrEqual(titleX);
  });

  it("a card too short for a third row keeps it, after the name and amount, centred", () => {
    const { rect, lock, textEnd } = drawn(5, 50, 0, true, 44);
    expect(rect.height).toBeLessThan(50);
    expect(lock).not.toBeNull();
    expect(lock!.x).toBeGreaterThanOrEqual(textEnd);
    expect(lock!.x - textEnd).toBeLessThan(10);
    expect(Math.abs(lock!.y + lock!.height / 2 - (rect.y + rect.height / 2))).toBeLessThanOrEqual(1);
  });

  it("the row stays under the amount unless the card is really short; the room left is air above it", () => {
    // 72 px row: a 58 px card — the row at the bottom, clear of the amount
    // (20 + 2 + 15 = 37), 2 px off the bottom edge.
    const tight = drawn(5, 50, 0, true, 72);
    expect(tight.rect.height).toBe(58);
    expect(tight.lock!.x).toBe(tight.rect.x);
    expect(tight.badgeY - (tight.rect.y + 37)).toBeGreaterThanOrEqual(3);
    expect(tight.badgeY + 16).toBe(tight.rect.y + tight.rect.height - 2);
    // The 84 px row (a 70 px card): more air above it.
    const roomy = drawn(5, 50, 0);
    expect(roomy.badgeY - (roomy.rect.y + 37)).toBeGreaterThanOrEqual(12);
    // On the tight card the name (and the amount) ride higher, so the air
    // shows between the amount and the row.
    expect(tight.titleY - tight.rect.y).toBe(roomy.titleY - roomy.rect.y - 2);
    // A slim row (60 px: a 46 px card): two lines — see "a short card".
    const slim = drawn(5, 50, 0, true, 60);
    expect(slim.lock!.x).toBe(slim.rect.x);
  });

  it("a short card: the amount moves up beside the name; the lock + dates take its line", () => {
    // 60 px row: a 46 px card — no room for three lines.
    const short = drawn(5, 50, 0, true, 60);
    expect(short.rect.height).toBe(46);
    // The amount: on the name's line, after it ("Préstamo" ≈ 8 × 7.2 px).
    expect(short.amountText).toBe("-$7,500 /mes");
    expect(Math.abs(short.amountY - short.titleY)).toBeLessThanOrEqual(1);
    expect(short.amountX).toBeGreaterThan(short.titleX + "Préstamo".length * 6);
    // The lock in the corner, the dates after it, on the bottom line.
    expect(short.lock!.x).toBe(short.rect.x);
    expect(short.lock!.y + short.lock!.height).toBe(short.rect.y + short.rect.height);
    expect(short.badgeX).toBeGreaterThan(short.lock!.x + short.lock!.width);
    expect(short.badgeY).toBeGreaterThanOrEqual(short.rect.y + 20);
  });

  it("a card too short for two lines (38 px) keeps everything beside the name", () => {
    const tiny = drawn(5, 50, 0, true, 52);
    expect(tiny.rect.height).toBe(38);
    expect(tiny.lock!.x).toBeGreaterThanOrEqual(tiny.textEnd);
  });

  it("a free clip shows it too (open); a card too narrow shows none", () => {
    expect(drawn(5, 50, 0, false).lock).not.toBeNull();
    // 2 beats = 40 px.
    expect(drawn(5, 2, 0).lock).toBeNull();
  });
});

describe("the third row: the lock button, then the dates tag (two things)", () => {
  it("under the name and the amount: the corner tab (30 px, the row's height), the dates tag 8 px after it", () => {
    const { rect, titleY, lock, badgeX, badgeY, periodX, periodText } = drawn(5, 50, 0);
    expect(periodText).toBe("10 nov 2026 – 10 abr 2027");
    // The lock's hit area is the tab alone: the third row's band, bounded.
    expect(lock!.width).toBe(30);
    expect(lock!.height).toBeGreaterThanOrEqual(18);
    expect(lock!.height).toBeLessThanOrEqual(26);
    // A gap, then the tag: padding, calendar glyph, its gap, the text.
    expect(badgeX - (lock!.x + lock!.width)).toBe(8);
    expect(periodX - badgeX).toBe(6 + 10 + 5);
    // The tag sits within the tab's band.
    expect(badgeY).toBeGreaterThanOrEqual(lock!.y);
    expect(badgeY + 16).toBeLessThanOrEqual(lock!.y + lock!.height);
    // The third row: under the title (20) + the amount line (2 + 15), inside the card.
    expect(lock!.y).toBeGreaterThanOrEqual(titleY - 5 + 37 - 1);
    expect(lock!.y + lock!.height).toBeLessThanOrEqual(rect.y + rect.height);
  });

  it("beside the text on a short card; cut to fit a narrow one", () => {
    const short = drawn(5, 50, 0, true, 44);
    expect(short.periodText).toBe("10 nov 2026 – 10 abr 2027");
    expect(short.lock!.x).toBeGreaterThanOrEqual(short.textEnd);
    expect(short.badgeX).toBeGreaterThanOrEqual(short.lock!.x + short.lock!.width);
    // 10 beats = 200 px: the dates are cut, never past the card.
    const narrow = drawn(5, 10, 0);
    expect(narrow.periodText!.endsWith("…")).toBe(true);
    expect(narrow.badgeRight).toBeLessThanOrEqual(narrow.rect.x + narrow.rect.width);
  });

  it("clipCardWidthPx fits what the card draws", () => {
    const tall = clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 70, 20);
    // The row: the corner tab + gap + tag (padding, glyph, gap, text).
    expect(tall).toBeGreaterThanOrEqual(30 + 8 + 6 * 2 + 10 + 5 + "9 dic 2026".length * 6.7);
    // Too short for two lines (36 px): all beside the name — wider.
    expect(clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 36, 20)).toBeGreaterThan(tall);
    // Two lines (46 px): the wider of "name + amount" and "lock + dates".
    const name = "Un nombre bastante largo";
    expect(clipCardWidthPx(name, "+$4,000", "9 dic 2026", 46, 20)).toBeGreaterThanOrEqual(
      11 + name.length * 7.2 + 10 + "+$4,000".length * 6.7,
    );
  });
});
