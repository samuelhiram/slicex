// UX audit 2026-11-11 — group V (canvas, tools, visual language). Host
// semantics the finance shell declares on the generic canvas: every option
// is opt-in, so the FL defaults (and their parity specs) stay as they were.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container, Graphics } from "pixi.js";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistCore,
  type PlaylistOverviewData,
  type PlaylistState,
} from "../src/playlist-core";
import {
  createPlaylistInteractionController,
  hitTestPlaylist,
  type PlaylistEditEvent,
  type PlaylistInteractionOptions,
  type PlaylistPendingClips,
} from "../src/playlist-interaction";
import {
  contentExtentPx,
  createClipNodeRegistry,
  truncateClipTitle,
  truncateMiddle,
} from "../src/playlist-renderer-pixi/clip-node-registry";
import {
  computeOverviewScale,
  createOverviewLaneLayer,
} from "../src/playlist-renderer-pixi/layers/overview-lane";
import { drawTooltip } from "../src/playlist-renderer-pixi/layers/tooltip";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = 28; // demo zoom: 28 px per beat, scrollX 0
const xAt = (beat: number) => M.trackHeaderWidth + beat * PX;
// Middle of row `index` (rows are 72 px under the 38 px ruler).
const yRow = (index: number) => M.rulerHeight + index * M.trackHeight + M.trackHeight / 2;

type Listener = (event: never) => void;

function sizedState(): PlaylistState {
  const base = createDemoPlaylistState();
  return { ...base, viewport: { ...base.viewport, width: 1200, height: 700 } };
}

function setup(options: PlaylistInteractionOptions = {}) {
  const core = createPlaylistCore(sizedState());
  const listeners = new Map<string, Listener>();
  const dispatched: Event[] = [];
  const host = {
    style: {} as Record<string, string>,
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
    dispatchEvent(event: Event) {
      dispatched.push(event);
      return true;
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const controller = createPlaylistInteractionController(
    host as unknown as HTMLElement,
    core,
    options,
  );
  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    extra: Partial<PointerEvent> = {},
  ) => {
    const listener = listeners.get(type);
    if (!listener) throw new Error(`no ${type} listener`);
    (listener as (event: PointerEvent) => void)({
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      detail: 1,
      timeStamp: performance.now(),
      clientX: x,
      clientY: y,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
      ...extra,
    } as unknown as PointerEvent);
  };
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => {
    const listener = listeners.get("keydown");
    if (!listener) throw new Error("no keydown listener");
    (listener as (event: KeyboardEvent) => void)({
      key: k,
      code: k,
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
      ...extra,
    } as unknown as KeyboardEvent);
  };
  const leave = () => {
    const listener = listeners.get("pointerleave");
    if (!listener) throw new Error("no pointerleave listener");
    (listener as () => void)();
  };
  return { core, host, controller, pointer, key, leave, dispatched };
}

const has = (core: PlaylistCore, id: string) => core.getState().clips.some((clip) => clip.id === id);

afterEach(() => {
  vi.useRealTimers();
});

describe("UX-09 — Dividir cuts the clip under the pointer (host sliceScope)", () => {
  // At beat 12: drums-1 (0–16), bass-1 (4–22), chords-1 (8–24) and the
  // automation clip (4–36) all cross the cut.
  it("FL default: one press cuts every clip crossing the time (parity kept)", () => {
    const { core, pointer } = setup();
    core.setTool("slice");
    const before = core.getState().clips.length;
    pointer("pointerdown", xAt(12), yRow(0));
    pointer("pointerup", xAt(12), yRow(0));
    expect(core.getState().clips.length).toBeGreaterThanOrEqual(before + 3);
  });

  it("target: exactly one new clip, named in the guide and announced", () => {
    const edits: PlaylistEditEvent[] = [];
    const pending: Array<PlaylistPendingClips | null> = [];
    const describeSlice = vi.fn((ids: readonly string[], time: number) => `Partir ${ids.join(",")} @${time}`);
    const { core, pointer } = setup({
      sliceScope: "target",
      describeSlice,
      onEdit: (event) => edits.push(event),
      onPendingChange: (p) => pending.push(p),
    });
    core.setTool("slice");
    const before = core.getState().clips.length;
    pointer("pointerdown", xAt(12), yRow(0));
    pointer("pointermove", xAt(12) + 2, yRow(0));
    // The tooltip names what will be split; only drums-1 is pending.
    expect(core.getState().tooltip?.text).toBe("Partir clip-drums-1 @12");
    expect([...(pending.at(-1)?.clipIds ?? [])]).toEqual(["clip-drums-1"]);
    // Re-described only when the time / scope change, not per move.
    pointer("pointermove", xAt(12) + 4, yRow(0));
    expect(describeSlice).toHaveBeenCalledTimes(1);
    pointer("pointerup", xAt(12) + 4, yRow(0));
    expect(core.getState().clips.length).toBe(before + 1);
    expect(pending.at(-1)).toBeNull();
    expect(edits).toHaveLength(1);
    const edit = edits[0]!;
    if (edit.kind !== "slice") throw new Error("expected slice");
    expect(edit.clipIds).toEqual(["clip-drums-1"]);
    expect(edit.newClipIds).toHaveLength(1);
    expect(edit.time).toBe(12);
    // One undo entry.
    core.undo();
    expect(core.getState().clips.length).toBe(before);
  });

  it("target + Shift on release: every clip of that day (capability kept)", () => {
    const { core, pointer } = setup({ sliceScope: "target" });
    core.setTool("slice");
    const before = core.getState().clips.length;
    pointer("pointerdown", xAt(12), yRow(0));
    pointer("pointerup", xAt(12), yRow(0), { shiftKey: true });
    expect(core.getState().clips.length).toBeGreaterThanOrEqual(before + 3);
  });

  it("target: Insert cuts the selection at the playhead; Shift+Insert all", () => {
    const { core, key } = setup({ sliceScope: "target" });
    core.setPlayPosition(10);
    const before = core.getState().clips.length;
    key("Insert");
    expect(core.getState().clips.length).toBe(before); // nothing selected
    core.setClipSelection(["clip-bass-1"]);
    key("Insert");
    expect(core.getState().clips.length).toBe(before + 1);
    key("Insert", { shiftKey: true });
    expect(core.getState().clips.length).toBeGreaterThan(before + 2);
  });
});

describe("UX-16 — Borrar marks, deletes on release, and says so", () => {
  it("deferDelete: a sweep highlights then deletes everything in ONE undo step", () => {
    const edits: PlaylistEditEvent[] = [];
    const pending: Array<PlaylistPendingClips | null> = [];
    const { core, pointer } = setup({
      deferDelete: true,
      onEdit: (event) => edits.push(event),
      onPendingChange: (p) => pending.push(p),
    });
    core.setTool("delete");
    pointer("pointerdown", xAt(6), yRow(0));
    // Marked, not deleted yet.
    expect(has(core, "clip-drums-1")).toBe(true);
    expect([...pending.at(-1)!.clipIds]).toEqual(["clip-drums-1"]);
    expect(pending.at(-1)!.kind).toBe("delete");
    pointer("pointermove", xAt(6), yRow(1));
    expect(has(core, "clip-bass-1")).toBe(true);
    expect([...pending.at(-1)!.clipIds].sort()).toEqual(["clip-bass-1", "clip-drums-1"]);
    pointer("pointerup", xAt(6), yRow(1));
    expect(has(core, "clip-drums-1")).toBe(false);
    expect(has(core, "clip-bass-1")).toBe(false);
    expect(pending.at(-1)).toBeNull();
    // ONE commit, named with the clips' labels.
    expect(edits).toEqual([
      expect.objectContaining({ kind: "delete", clipIds: ["clip-drums-1", "clip-bass-1"] }),
    ]);
    expect((edits[0] as { labels: string[] }).labels).toHaveLength(2);
    core.undo();
    expect(has(core, "clip-drums-1")).toBe(true);
    expect(has(core, "clip-bass-1")).toBe(true);
  });

  it("Supr reports what it removed", () => {
    const edits: PlaylistEditEvent[] = [];
    const { core, key } = setup({ onEdit: (event) => edits.push(event) });
    core.setClipSelection(["clip-lead-1"]);
    key("Delete");
    expect(has(core, "clip-lead-1")).toBe(false);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ kind: "delete", clipIds: ["clip-lead-1"] });
  });

  it("Esc puts any tool back to Select (escapeSelectsTool); without it, nothing", () => {
    const withEsc = setup({ escapeSelectsTool: true });
    withEsc.core.setTool("delete");
    withEsc.key("Escape");
    expect(withEsc.core.getState().tool).toBe("select");
    const plain = setup();
    plain.core.setTool("delete");
    plain.key("Escape");
    expect(plain.core.getState().tool).toBe("delete");
  });

  it("each tool can have the host's own cursor (never not-allowed for Borrar)", () => {
    const { core, host, pointer } = setup({ toolCursors: { delete: "url(x.svg) 4 15, pointer" } });
    core.setTool("delete");
    pointer("pointermove", xAt(6), yRow(0));
    expect(host.style.cursor).toBe("url(x.svg) 4 15, pointer");
  });
});

describe("UX-04 — objects by keyboard", () => {
  it("Alt+→ / Alt+← walk the objects in date order and report the focus", () => {
    const focused: string[] = [];
    const { core, key } = setup({ onClipFocus: (id) => focused.push(id) });
    key("ArrowRight", { altKey: true });
    expect(core.getState().selection.clipIds).toEqual(["clip-drums-1"]);
    key("ArrowRight", { altKey: true });
    // Same day (4): the upper row first.
    expect(core.getState().selection.clipIds).toEqual(["clip-bass-1"]);
    key("ArrowLeft", { altKey: true });
    expect(core.getState().selection.clipIds).toEqual(["clip-drums-1"]);
    expect(focused).toEqual(["clip-drums-1", "clip-bass-1", "clip-drums-1"]);
    // Alt+arrow never nudges the object.
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(0);
  });

  it("Enter opens the selected object (like a double-click); Shift+F10 its menu", () => {
    const { core, key, dispatched } = setup();
    core.setClipSelection(["clip-chords-1"]);
    key("Enter");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.type).toBe("playlist-clip-open");
    expect((dispatched[0] as CustomEvent).detail).toEqual({ clipId: "clip-chords-1" });
    key("F10", { shiftKey: true });
    expect(core.getState().contextMenu).toMatchObject({ kind: "clip", clipId: "clip-chords-1" });
    core.closeContextMenu();
    core.deselectAll();
    key("ContextMenu");
    expect(core.getState().contextMenu?.kind).toBe("background");
  });
});

describe("UX-38 — a keyboard move says what it did", () => {
  it("a burst of arrows is one undo entry with a tooltip, reported once it settles", () => {
    vi.useFakeTimers();
    const edits: PlaylistEditEvent[] = [];
    const { core, key } = setup({ nudgeFeedbackMs: 1500, onEdit: (event) => edits.push(event) });
    core.setClipSelection(["clip-lead-1"]); // start 24
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowRight");
    const tooltip = core.getState().tooltip;
    expect(tooltip?.kind).toBe("hint");
    expect(tooltip?.text).toContain("→");
    expect(core.getGestureBase()).not.toBeNull(); // the host's effect pill shows
    expect(edits).toHaveLength(0); // not per key
    vi.advanceTimersByTime(1500);
    expect(core.getState().tooltip).toBeNull();
    expect(core.getGestureBase()).toBeNull();
    expect(edits).toEqual([
      expect.objectContaining({ kind: "nudge", fromStart: 24, toStart: 27, deltaTracks: 0 }),
    ]);
    core.undo();
    expect(core.getState().clips.find((c) => c.id === "clip-lead-1")!.start).toBe(24);
  });

  it("another key settles the burst first", () => {
    vi.useFakeTimers();
    const edits: PlaylistEditEvent[] = [];
    const { core, key } = setup({ nudgeFeedbackMs: 1500, onEdit: (event) => edits.push(event) });
    core.setClipSelection(["clip-lead-1"]);
    key("ArrowLeft");
    key("ArrowDown");
    key("Escape");
    expect(edits).toEqual([expect.objectContaining({ kind: "nudge", toStart: 23, deltaTracks: 1 })]);
  });
});

describe("UX-25 — the info card of a clip", () => {
  it("shows after the hover delay, stays over its clip, Esc / leaving close it", () => {
    vi.useFakeTimers();
    const { core, key, pointer } = setup({ hoverCardDelayMs: 350 });
    pointer("pointermove", xAt(6), yRow(0));
    expect(core.getState().tooltip).toBeNull();
    vi.advanceTimersByTime(350);
    expect(core.getState().tooltip).toMatchObject({ kind: "clip", clipId: "clip-drums-1" });
    pointer("pointermove", xAt(7), yRow(0));
    expect(core.getState().tooltip).toMatchObject({ kind: "clip", clipId: "clip-drums-1" });
    key("Escape");
    expect(core.getState().tooltip).toBeNull();
    // Another clip: a new card after the delay; empty space clears it.
    pointer("pointermove", xAt(10), yRow(1));
    vi.advanceTimersByTime(350);
    expect(core.getState().tooltip).toMatchObject({ clipId: "clip-bass-1" });
    pointer("pointermove", xAt(40), yRow(0));
    expect(core.getState().tooltip).toBeNull();
  });

  it("leaving the canvas (e.g. onto a portal menu over it) clears any hover tooltip and the hover", () => {
    vi.useFakeTimers();
    const { core, pointer, leave } = setup({ hoverCardDelayMs: 350 });
    // Ruler hover: a date tooltip.
    pointer("pointermove", xAt(6), 10);
    expect(core.getState().tooltip?.kind).toBe("time");
    leave();
    expect(core.getState().tooltip).toBeNull();
    // A card armed on a clip never shows after leaving.
    pointer("pointermove", xAt(6), yRow(0));
    leave();
    vi.advanceTimersByTime(400);
    expect(core.getState().tooltip).toBeNull();
    expect(core.getState().hover).toBeNull();
  });

  it("a touch tap shows it at once", () => {
    const { core, pointer } = setup({ hoverCardDelayMs: 350 });
    pointer("pointerdown", xAt(6), yRow(0), { pointerType: "touch" });
    pointer("pointerup", xAt(6), yRow(0), { pointerType: "touch" });
    expect(core.getState().tooltip).toMatchObject({ kind: "clip", clipId: "clip-drums-1" });
  });
});

describe("UX-42 — row header buttons", () => {
  // Row 0 (72 px, "full" layout): the eye at x 16..32, y 88..104.
  it("hovering a button keeps its row hovered (the icons stay) and names it", () => {
    const { core, pointer } = setup({
      trackButtonHints: {
        mute: ["Excluir de tus cifras", "Incluir"],
        solo: ["Ver solo esta línea", "Ver todas"],
        lock: ["Bloquear", "Desbloquear"],
      },
      trackButtonSlop: 4,
    });
    pointer("pointermove", 24, 96);
    expect(core.getState().hover).toEqual({ kind: "track", trackId: "track-1" });
    expect(core.getState().tooltip).toMatchObject({ kind: "hint", text: "Excluir de tus cifras" });
  });

  it("the hit area grows to ≥ 24 px without changing the drawing", () => {
    const core = createPlaylistCore(sizedState());
    const presentation = core.getPresentation();
    const point = { x: 13, y: 86 }; // 3 px outside the 16 px eye
    expect(hitTestPlaylist(presentation, point, M).kind).not.toBe("track-mute-button");
    expect(hitTestPlaylist(presentation, point, M, { trackButtonSlop: 4 }).kind).toBe(
      "track-mute-button",
    );
  });
});

describe("UX-39 — amount by hand only from the grip, with an axis lock", () => {
  // drums-1: x 148..596, top edge y 45; its grip sits 40 px into the
  // visible part (x 188), reachable even when the clip outgrows the screen.
  it("the level handle is the grip, not the whole top edge", () => {
    const core = createPlaylistCore(sizedState());
    const presentation = core.getPresentation();
    const options = { clipLevel: true, clipLevelGrip: { height: 7 } };
    expect(hitTestPlaylist(presentation, { x: 188, y: 47 }, M, options).kind).toBe("clip-level");
    expect(hitTestPlaylist(presentation, { x: 400, y: 47 }, M, options).kind).toBe("clip");
    // FL default: the whole edge.
    expect(hitTestPlaylist(presentation, { x: 400, y: 47 }, M, { clipLevel: true }).kind).toBe(
      "clip-level",
    );
    // Scrolled so the clip starts off-screen: the grip follows its visible part.
    core.updateViewport({ scrollX: 6 * PX });
    const scrolled = core.getPresentation();
    expect(hitTestPlaylist(scrolled, { x: M.trackHeaderWidth + 40, y: 47 }, M, options).kind).toBe(
      "clip-level",
    );
  });

  it("a mostly horizontal drag from the grip moves the date, never the amount", () => {
    const level = vi.fn(() => "x");
    const { core, pointer } = setup({ onClipLevelDrag: level, clipLevelGrip: true });
    pointer("pointerdown", 188, 47);
    pointer("pointermove", 196, 48);
    pointer("pointermove", 188 + 2 * PX, 49);
    pointer("pointerup", 188 + 2 * PX, 49);
    expect(level).not.toHaveBeenCalled();
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(2);
  });

  it("a vertical drag is the level drag (Shift = fine)", () => {
    const level = vi.fn(() => "x");
    const { pointer } = setup({ onClipLevelDrag: level, clipLevelGrip: true });
    pointer("pointerdown", 188, 47);
    pointer("pointermove", 189, 30, { shiftKey: true });
    pointer("pointerup", 189, 30);
    expect(level.mock.calls.map((call) => (call as unknown as [{ phase: string }])[0].phase)).toEqual([
      "start",
      "move",
      "end",
    ]);
    expect((level.mock.calls[1] as unknown as [{ fine: boolean }])[0].fine).toBe(true);
  });
});

describe("renderer — host options read once", () => {
  const palette = {
    text: 0x111111,
    textMuted: 0x666666,
    selected: 0x3366ff,
    hover: 0x111111,
    rowLine: 0xeeeeee,
    panel: 0xffffff,
    panelStrong: 0xffffff,
    automationLine: 0x999999,
  };

  function syncOne(badges: boolean | undefined, highlight?: boolean | "danger") {
    const core = createPlaylistCore(sizedState());
    core.setClipContentOffset("clip-drums-1", 42);
    const registry = createClipNodeRegistry(palette, {
      badges,
      isClipHighlighted: highlight === undefined ? undefined : () => highlight,
    });
    const parent = new Container();
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    const texts = (parent.children as Container[]).flatMap((node) =>
      node.children.filter((child) => "text" in child && (child as { visible: boolean }).visible),
    ) as unknown as Array<{ text: string }>;
    registry.destroy();
    return texts.map((t) => t.text);
  }

  it("UX-09: clipBadges false hides the FL '↻ offset' badge", () => {
    expect(syncOne(undefined).some((text) => text.startsWith("↻"))).toBe(true);
    expect(syncOne(false).some((text) => text.startsWith("↻"))).toBe(false);
  });

  it("UX-25: titles truncate in the middle (both ends stay)", () => {
    expect(truncateMiddle("Pago Tarjeta Plata", 12)).toBe("Pago T…Plata");
    expect(truncateMiddle("Sueldo", 12)).toBe("Sueldo");
    const title = truncateClipTitle("Pago Tarjeta Plata", 100);
    expect(title.startsWith("Pago")).toBe(true);
    expect(title.endsWith("ata")).toBe(true);
  });

  it("UX-41: a one-day extent is the card; the rest of the block a tag", () => {
    const core = createPlaylistCore(sizedState());
    const view = core.getPresentation().clipViewsById.get("clip-drums-2")!; // 10 days
    expect(contentExtentPx(view, null)).toBe(view.rect.width);
    const extent = contentExtentPx(view, { kind: "events", beats: [18], values: [1], extent: 1 });
    expect(extent).toBe(PX);
  });

  it("the tooltip stays inside the canvas near the right / bottom edges", () => {
    const core = createPlaylistCore(sizedState());
    core.setTooltip({ kind: "hint", text: "Un texto bastante largo", anchor: { x: 1190, y: 690 } });
    const background = new Graphics();
    const ctx = { container: new Container(), background, textLayer: new Container() };
    drawTooltip(ctx, core.getPresentation(), "línea 1\nlínea 2");
    const bounds = background.getLocalBounds();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1200);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  });
});

describe("UX-11 — the money lane: fixed round domain + labelled guides", () => {
  const series = (values: number[]) => ({
    initial: values[0]!,
    beats: values.map((_, i) => i),
    values,
  });
  const lane = (values: number[], extra: Partial<PlaylistOverviewData> = {}): PlaylistOverviewData => ({
    title: "Caja",
    primary: series(values),
    thresholds: [{ value: 0, tone: "danger" }],
    annotations: [],
    ...extra,
  });

  it("a host domain fixes the scale (an edit inside it moves nothing)", () => {
    const a = computeOverviewScale(lane([1000, 47_000], { domain: { min: 0, max: 100_000 } }));
    const b = computeOverviewScale(lane([1000, 96_000], { domain: { min: 0, max: 100_000 } }));
    expect(a.max).toBe(b.max);
    expect(a.min).toBe(b.min);
    // Without a domain the scale follows the data (the old behaviour).
    expect(computeOverviewScale(lane([1000, 47_000])).max).not.toBe(
      computeOverviewScale(lane([1000, 96_000])).max,
    );
  });

  it("guides are drawn with the frame and labelled, never per frame", () => {
    const core = createPlaylistCore(sizedState(), { metrics: { ...M, overviewLaneHeight: 96 } });
    const parts = {
      container: new Container(),
      frameGraphics: new Graphics(),
      frameText: new Container(),
      curveGraphics: new Graphics(),
      curveText: new Container(),
      dynamicGraphics: new Graphics(),
    };
    const layer = createOverviewLaneLayer(parts);
    const data = lane([1000, 20_000, 80_000], {
      // The host's scale: symlog (detail near zero), so round guides spread.
      scale: { kind: "symlog", constant: 5000 },
      domain: { min: 0, max: 100_000 },
      guides: [10_000, 50_000],
      formatValue: (v) => `$${Math.round(v / 1000)}k`,
    });
    layer.sync(core.getPresentation(), data);
    const labels = (parts.curveText.children as unknown as Array<{ text: string; visible: boolean }>)
      .filter((child) => child.visible)
      .map((child) => child.text);
    expect(labels).toEqual(expect.arrayContaining(["$10k", "$50k"]));
    const frames = layer.stats.frameRebuilds;
    for (let i = 0; i < 20; i += 1) {
      core.setHover({ kind: "clip", clipId: "clip-drums-1" });
      core.setPlayPosition(i);
      layer.sync(core.getPresentation(), data);
    }
    expect(layer.stats.frameRebuilds).toBe(frames);
  });
});
