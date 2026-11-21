// PlaylistClip.timeLocked + the lock button (controller / renderer
// clipTimeLock): a time-locked clip only moves between rows — a drag never
// shifts it in time, its edges and the extend grabber don't resize it, Slip
// leaves it, ←/→ move the playhead. A free clip keeps FL parity. The button
// is drawn in the card's bottom-left corner, translucent, and slides with
// the title (sticky) without taking its room; the controller asks
// the renderer where it is (rectOf), so a click lands where it is drawn; a
// click (Select / Draw) toggles the flag in one undo entry and tells the host.
import { Container, Graphics, Text, type GraphicsPath } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getClipExtendHandle,
  type PlaylistClip,
  type PlaylistClipContent,
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

function drawn(
  start: number,
  duration: number,
  scrollBeats: number,
  timeLocked = true,
  rowHeight?: number,
  content: PlaylistClipContent | null = null,
) {
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
    ...(content ? { getClipContent: () => content } : {}),
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
  // The tab (a notch in the card's corner) and the body's event bars.
  const tab = node.children.find((child) => child.label === "clip-tab") as Graphics | undefined;
  const body = node.children[0] as Graphics;
  const bars = body.context.instructions
    .filter((instruction) => instruction.action === "fill")
    .map((instruction) => (instruction.data as { path: GraphicsPath }).path.bounds)
    .filter((bounds) => bounds.width <= 2)
    .map((bounds) => ({ x: node.x + bounds.minX, top: bounds.minY, bottom: bounds.maxY }));
  return {
    tab: tab && tab.visible ? { x: node.x + tab.x, width: tab.width } : null,
    bars,
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

// The card is its LABEL above its BAR at every height (2026-11-20): the
// label (name, amount; the dates on a tall card, the lock on a short one)
// always outside the bar, above it; the bar under it runs the whole card
// with one thickness — all the height the label row leaves (26 px on a tall
// card, ≥ 62 px; the compact 16 on a shorter one).
const tabHeightOf = (card: number): number => (card >= 62 ? 26 : 16);

describe("the label above the bar", () => {
  it("a tall card: the tab holds the name, the amount and the dates; the lock is the body's corner tab", () => {
    const d = drawn(5, 50, 0);
    expect(d.rect.height).toBe(70);
    // The tab's band: 26 px from the card's top; the name centred in it.
    expect(d.titleY - d.rect.y).toBe(Math.round((26 - 17) / 2) - 1);
    // 11 px in; the Text 1 px left of it (its outline).
    expect(d.titleX).toBe(d.rect.x + 11 - 1);
    // The amount on the name's line, after it.
    expect(d.amountText).toBe("-$7,500 /mes");
    expect(Math.abs(d.amountY - d.titleY)).toBeLessThanOrEqual(1);
    expect(d.amountX).toBeGreaterThan(d.titleX + "Préstamo".length * 6);
    // The dates tag on the same band, after the amount.
    expect(d.periodText).toBe("10 nov 2026 – 10 abr 2027");
    expect(d.badgeY - d.rect.y).toBe(Math.round((26 - 16) / 2));
    expect(d.badgeX).toBeGreaterThan(d.amountX + "-$7,500 /mes".length * 6);
    expect(d.periodX - d.badgeX).toBe(6 + 10 + 5);
    // The label: from the card's left edge to past the dates; right of it
    // the timeline shows through (the bar runs on under it).
    expect(d.tab!.x).toBe(d.rect.x);
    expect(d.tab!.x + d.tab!.width).toBeGreaterThan(d.badgeRight);
    expect(d.tab!.x + d.tab!.width).toBeLessThan(d.rect.x + d.rect.width - 100);
    // The lock: the corner tab (30 px), flush with the body's left and
    // bottom edges, under the tab.
    expect(d.lock!.x).toBe(d.rect.x);
    expect(d.lock!.width).toBe(30);
    expect(d.lock!.y + d.lock!.height).toBe(d.rect.y + d.rect.height);
    expect(d.lock!.y).toBeGreaterThanOrEqual(d.rect.y + 26 + 4);
  });

  it("at every height the text stays in the tab; a short card's tab carries no dates", () => {
    for (const [row, card] of [
      [84, 70],
      [72, 58],
      [68, 54],
      [60, 46],
      [52, 38],
      [42, 28],
    ] as const) {
      const d = drawn(5, 50, 0, true, row);
      expect(d.rect.height).toBe(card);
      const tabBottom = d.rect.y + tabHeightOf(card);
      // The name and the amount within the tab's band.
      expect(d.titleY).toBeGreaterThanOrEqual(d.rect.y - 1);
      expect(d.titleY + 17).toBeLessThanOrEqual(tabBottom + 1);
      expect(d.amountText).toBe("-$7,500 /mes");
      if (card >= 62) {
        // Tall: the dates in the tab; the lock in the body's corner.
        expect(d.badgeY).toBeGreaterThanOrEqual(d.rect.y);
        expect(d.badgeY + 16).toBeLessThanOrEqual(tabBottom);
        expect(d.lock!.x).toBe(d.rect.x);
        expect(d.lock!.y).toBeGreaterThanOrEqual(tabBottom);
        expect(d.lock!.y + d.lock!.height).toBe(d.rect.y + d.rect.height);
      } else {
        // Short: no dates (the hover card and the inspector say them); a
        // lock badge in the tab, after the amount; the tab ends after it.
        expect(d.periodText).toBeNull();
        expect(d.lock!.width).toBe(24);
        expect(d.lock!.y).toBeGreaterThanOrEqual(d.rect.y);
        expect(d.lock!.y + d.lock!.height).toBeLessThanOrEqual(tabBottom);
        expect(d.lock!.x).toBeGreaterThan(d.amountX + "-$7,500 /mes".length * 6);
        expect(d.tab!.x + d.tab!.width).toBeLessThan(d.lock!.x + d.lock!.width + 20);
      }
    }
  });

  it("the bar: one thickness end to end, under the label; the payment marks fill it", () => {
    // 52 px rows: a 38 px card — the compact 16 px label row, a 22 px bar.
    const content: PlaylistClipContent = {
      kind: "events",
      beats: [10, 15, 20, 25, 30, 35, 40, 45, 50],
      values: [-1, -1, -1, -1, -1, -1, -1, -1, -1],
    };
    const d = drawn(5, 50, 0, true, 52, content);
    expect(d.rect.height).toBe(38);
    expect(d.bars.length).toBe(9);
    // Every mark the same: the bar's height less the accent's 4 px inset
    // each side — under the label and right of it alike.
    for (const bar of d.bars) {
      expect(bar.top).toBe(16 + 4);
      expect(bar.bottom).toBe(38 - 4);
    }
    const tabEnd = d.tab!.x + d.tab!.width;
    expect(d.bars.some((bar) => bar.x < tabEnd)).toBe(true);
    expect(d.bars.some((bar) => bar.x > tabEnd)).toBe(true);
    // A tall card (70 px): the 26 px row, a 44 px bar.
    const tall = drawn(5, 50, 0, true, 84, content);
    for (const bar of tall.bars) {
      expect(bar.top).toBe(26 + 4);
      expect(bar.bottom).toBe(70 - 4);
    }
  });

  it("slides with the title to the timeline's left edge (sticky)", () => {
    const { rect, lock, titleX } = drawn(0, 200, 50);
    expect(rect.x).toBeLessThan(M.trackHeaderWidth);
    expect(lock!.x).toBeGreaterThanOrEqual(M.trackHeaderWidth);
    expect(lock!.x).toBeLessThan(M.trackHeaderWidth + 12);
    expect(lock!.x).toBeLessThanOrEqual(titleX);
  });

  it("a free clip shows it too (open); a card too narrow shows none", () => {
    expect(drawn(5, 50, 0, false).lock).not.toBeNull();
    // 2 beats = 40 px.
    expect(drawn(5, 2, 0).lock).toBeNull();
  });

  it("the dates are cut to fit a narrow card, never past it", () => {
    // 20 beats = 400 px: room for part of the dates after the amount.
    const narrow = drawn(5, 20, 0);
    expect(narrow.periodText!.endsWith("…")).toBe(true);
    expect(narrow.badgeRight).toBeLessThanOrEqual(narrow.rect.x + narrow.rect.width);
    // 15 beats = 300 px: no room after the amount — no dates rather than
    // past the card.
    const tight = drawn(5, 15, 0);
    if (tight.periodText !== null) {
      expect(tight.badgeRight).toBeLessThanOrEqual(tight.rect.x + tight.rect.width);
    }
  });

  it("clipCardWidthPx fits the tab: name, amount, dates (a short card: the lock badge, no dates)", () => {
    const tall = clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 70, 20);
    // pad + name, gap + amount, gap + tag (padding, glyph, gap, text), pad.
    const tab = 11 + 4 * 7.8 + 10 + 7 * 7.3 + 12 + (6 * 2 + 10 + 5 + 10 * 7.3) + 10;
    expect(tall).toBeGreaterThanOrEqual(tab);
    // A short card: pad + name, gap + amount, gap + the lock badge, pad.
    const short = clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 36, 20);
    expect(short).toBeGreaterThanOrEqual(11 + 4 * 7.8 + 10 + 7 * 7.3 + 8 + 24 + 10);
    expect(short).toBeLessThan(tall);
  });
});
