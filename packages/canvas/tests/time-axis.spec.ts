// Pluggable time axis + clip detail line + FL left-crop parity.
//
//   1. PlaylistTimeAxis drives the ruler ticks (same visible range, x rounding
//      and header cull as the default grid) and every time tooltip via
//      core.formatTime. Without an axis the output is byte-identical to the
//      historical bar/beat grid.
//   2. Clip detail text / per-renderer sparkline provider in the clip node
//      registry (canon §3.8: created once per node, redrawn only on hash).
//   3. Cropping the LEFT edge of a non-automation clip keeps its content in
//      place (contentOffset shifts by the start delta × stretchRatio).
import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  DEFAULT_PLAYLIST_METRICS,
  formatBarBeat,
  playlistReducer,
  screenXToTime,
  type PlaylistClipPresentation,
  type PlaylistTimeAxis,
  type PlaylistTimeAxisTick,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";
import {
  CLIP_TEXT_RIGHT_PAD,
  DETAIL_CHAR_PX,
  DETAIL_PAD_X,
  clipVisualHash,
  createClipNodeRegistry,
  isClipDetailVisible,
  truncateClipDetail,
} from "../src/playlist-renderer-pixi/clip-node-registry";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = 28; // demo pxPerBeat

// Day-like axis: one tick per beat, major + label every 7 beats.
function createDayAxis(calls: Array<[number, number, number]> = []): PlaylistTimeAxis {
  return {
    ticks(fromBeat, toBeat, pxPerBeat) {
      calls.push([fromBeat, toBeat, pxPerBeat]);
      const out: PlaylistTimeAxisTick[] = [];
      for (let beat = Math.floor(fromBeat); beat <= toBeat; beat += 1) {
        const major = beat % 7 === 0;
        out.push({ beat, major, label: major ? `DAY ${beat}` : null });
      }
      return out;
    },
    formatTime(beat) {
      return `T+${beat.toFixed(2)}`;
    },
  };
}

type Listener = (event: PointerEvent) => void;

function createHost() {
  const listeners = new Map<string, Listener>();
  const host = {
    style: {},
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
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointerEvent(x: number, y: number): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
  } as unknown as PointerEvent;
}

function sizedDemoState() {
  const state = createDemoPlaylistState();
  return { ...state, viewport: { ...state.viewport, width: 1200, height: 700 } };
}

describe("time axis — ruler ticks", () => {
  it("without an axis the ruler ticks are identical to the default grid", () => {
    const state = sizedDemoState();
    const legacy = createPlaylistPresentation(state, M).rulerTicks;
    const explicitNull = createPlaylistPresentation(state, M, null).rulerTicks;
    const viaCore = createPlaylistCore(state).getPresentation().rulerTicks;
    expect(explicitNull).toEqual(legacy);
    expect(viaCore).toEqual(legacy);
    // Historical shape: 28 px/beat → half-beat step, bar labels 1-indexed.
    const plain = { centered: false, emphasis: false, dim: false };
    expect(legacy[0]).toEqual({ beat: 0, x: M.trackHeaderWidth + 0.5, isBar: true, label: "1", labelX: M.trackHeaderWidth + 0.5, ...plain });
    expect(legacy[1]).toEqual({ beat: 0.5, x: M.trackHeaderWidth + 14 + 0.5, isBar: false, label: null, labelX: M.trackHeaderWidth + 14 + 0.5, ...plain });
    expect(legacy.find((t) => t.beat === 4)?.label).toBe("2");
  });

  it("maps axis ticks with the same range, x rounding and header cull", () => {
    const base = sizedDemoState();
    // scrollX puts beat 10 just behind the track header (x = 143).
    const state = { ...base, viewport: { ...base.viewport, scrollX: 10 * PX + 5 } };
    const calls: Array<[number, number, number]> = [];
    const axis = createDayAxis(calls);
    const ticks = createPlaylistPresentation(state, M, axis).rulerTicks;

    expect(calls).toHaveLength(1);
    const [from, to, px] = calls[0]!;
    // Same visible range the default path computes (step 0.5 at 28 px/beat).
    expect(from).toBe(10);
    expect(to).toBeCloseTo(screenXToTime(state, state.viewport.width, M) + 0.5, 9);
    expect(px).toBe(PX);

    // Beat 10 sits at x = 148 + 280 - 285 = 143 < header → culled.
    expect(ticks.some((t) => t.beat === 10)).toBe(false);
    const first = ticks[0]!;
    expect(first.beat).toBe(11);
    expect(first.x).toBe(Math.round(M.trackHeaderWidth + 11 * PX - state.viewport.scrollX) + 0.5);
    const seventh = ticks.find((t) => t.beat === 14)!;
    expect(seventh.isBar).toBe(true);
    expect(seventh.label).toBe("DAY 14");
    const minor = ticks.find((t) => t.beat === 12)!;
    expect(minor.isBar).toBe(false);
    expect(minor.label).toBeNull();
    for (const tick of ticks) {
      expect(tick.x).toBeGreaterThanOrEqual(M.trackHeaderWidth);
    }
  });

  it("PlaylistCore passes its timeAxis to the presentation", () => {
    const axis = createDayAxis();
    const core = createPlaylistCore(sizedDemoState(), { timeAxis: axis });
    expect(core.timeAxis).toBe(axis);
    const ticks = core.getPresentation().rulerTicks;
    expect(ticks.find((t) => t.beat === 7)?.label).toBe("DAY 7");
    // One tick per beat → no half-beat ticks from the default grid.
    expect(ticks.some((t) => !Number.isInteger(t.beat))).toBe(false);
  });
});

describe("time axis — formatTime + tooltips", () => {
  it("core.formatTime falls back to bar.beat.tick and delegates to the axis", () => {
    const plain = createPlaylistCore(createDemoPlaylistState());
    expect(plain.timeAxis).toBeNull();
    expect(plain.formatTime(5.5)).toBe(formatBarBeat(5.5, M.beatsPerBar));
    expect(plain.formatTime(5.5)).toBe("2.2.12");

    const withAxis = createPlaylistCore(createDemoPlaylistState(), {
      timeAxis: createDayAxis(),
    });
    expect(withAxis.formatTime(5.5)).toBe("T+5.50");
  });

  it("ruler hover tooltip uses the axis format", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { timeAxis: createDayAxis() });
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const x = M.trackHeaderWidth + 100;
    listeners.get("pointermove")?.(pointerEvent(x, 10));
    const expected = core.formatTime(screenXToTime(core.getState(), x, M));
    expect(core.getState().tooltip?.text).toBe(expected);
    expect(expected.startsWith("T+")).toBe(true);
    controller.destroy();
  });

  it("slice drag tooltip uses the axis format", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { timeAxis: createDayAxis() });
    core.setViewportSize(1200, 700);
    core.setTool("slice");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const y = M.rulerHeight + 10;
    listeners.get("pointerdown")?.(pointerEvent(M.trackHeaderWidth + 4 * PX, y));
    listeners.get("pointermove")?.(pointerEvent(M.trackHeaderWidth + 8 * PX, y));
    expect(core.getState().tooltip?.text).toBe("T+8.00");
    listeners.get("pointerup")?.(pointerEvent(M.trackHeaderWidth + 8 * PX, y));
    controller.destroy();
  });

  it("resize drag tooltip uses the axis format", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { timeAxis: createDayAxis() });
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // clip-drums-1: track 0, start 0, duration 16 → right handle at x = 148 + 448.
    const y = M.rulerHeight + M.clipPaddingY + 10;
    const rightEdgeX = M.trackHeaderWidth + 16 * PX - 2;
    listeners.get("pointerdown")?.(pointerEvent(rightEdgeX, y));
    listeners.get("pointermove")?.(pointerEvent(M.trackHeaderWidth + 20 * PX, y));
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.duration).toBe(20);
    expect(core.getState().tooltip?.text).toBe("T+20.00");
    listeners.get("pointerup")?.(pointerEvent(M.trackHeaderWidth + 20 * PX, y));
    controller.destroy();
  });
});

describe("time axis — low zoom (minPxPerBeat 1.5)", () => {
  const LOW = { ...M, beatsPerBar: 7, minPxPerBeat: 1.5 };

  it("zooms down to 1.5 px/beat and still builds a sane presentation", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), {
      metrics: LOW,
      timeAxis: createDayAxis(),
    });
    core.setViewportSize(1200, 700);
    core.updateViewport({ pxPerBeat: 0.5 });
    expect(core.getState().viewport.pxPerBeat).toBe(1.5);
    const presentation = core.getPresentation();
    // ~700 days visible at 1.5 px/day; one tick per day from the stub axis.
    expect(presentation.rulerTicks.length).toBeGreaterThan(600);
    expect(presentation.rulerTicks.length).toBeLessThan(800);
    for (const tick of presentation.rulerTicks) {
      expect(Number.isFinite(tick.x)).toBe(true);
    }
    // Clips still project with positive widths.
    for (const view of presentation.clipViews) {
      expect(view.rect.width).toBeGreaterThan(0);
    }
  });

  it("ctrl+wheel zoom-out clamps at the metrics override", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { metrics: LOW });
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const wheel = listeners.get("wheel") as unknown as ((e: WheelEvent) => void) | undefined;
    expect(wheel).toBeTruthy();
    for (let i = 0; i < 40; i += 1) {
      wheel!({
        clientX: M.trackHeaderWidth + 200,
        clientY: 200,
        deltaX: 0,
        deltaY: 400,
        deltaMode: 0,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() {},
      } as unknown as WheelEvent);
    }
    expect(core.getState().viewport.pxPerBeat).toBe(1.5);
    expect(core.getState().viewport.scrollX).toBeGreaterThanOrEqual(0);
    controller.destroy();
  });
});

describe("clip detail line + per-renderer sparkline", () => {
  const PALETTE = {
    text: 0xffffff,
    textMuted: 0x999999,
    selected: 0x00ff00,
    hover: 0x0000ff,
    rowLine: 0x333333,
    panel: 0x111111,
    panelStrong: 0x222222,
    automationLine: 0xff00ff,
  };

  function visibleViews(): PlaylistClipPresentation[] {
    const core = createPlaylistCore(sizedDemoState());
    return core.getPresentation().visibleClipViews;
  }

  function texts(node: Container): string[] {
    return node.children
      .filter((c): c is Text => c instanceof Text && c.visible)
      .map((t) => t.text);
  }

  it("clipVisualHash changes when the detail changes", () => {
    const view = visibleViews().find((v) => v.clip.id === "clip-drums-1")!;
    expect(clipVisualHash(view)).toBe(clipVisualHash(view, null));
    expect(clipVisualHash(view, "$100")).not.toBe(clipVisualHash(view, null));
    expect(clipVisualHash(view, "$100")).not.toBe(clipVisualHash(view, "$200"));
  });

  it("visibility needs room in the body and a non-empty detail", () => {
    const view = visibleViews().find((v) => v.clip.id === "clip-drums-1")!;
    expect(isClipDetailVisible(view, "$100")).toBe(true);
    expect(isClipDetailVisible(view, null)).toBe(false);
    expect(isClipDetailVisible(view, "")).toBe(false);
    const narrow = { ...view, rect: { ...view.rect, width: 30 } };
    expect(isClipDetailVisible(narrow, "$100")).toBe(false);
    const short = { ...view, rect: { ...view.rect, height: view.titleRect.height + 10 } };
    expect(isClipDetailVisible(short, "$100")).toBe(false);
  });

  it("truncateClipDetail ellipsizes to the clip width", () => {
    expect(truncateClipDetail("$1,000", 200)).toBe("$1,000");
    const cut = truncateClipDetail("A very long financial detail line", 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBe(
      Math.floor((60 - DETAIL_PAD_X - CLIP_TEXT_RIGHT_PAD) / DETAIL_CHAR_PX),
    );
    expect(truncateClipDetail("abc", 10)).toBe("");
    // A one-time event card (7 days at the default 10 px/day) shows its
    // whole amount.
    expect(truncateClipDetail("−$5,792", 70)).toBe("−$5,792");
  });

  // Wraps each node's body Graphics.clear so a test can count redraws.
  function countBodyRedraws(parent: Container): Map<Container, number> {
    const counts = new Map<Container, number>();
    for (const child of parent.children) {
      const node = child as Container;
      const body = node.children[0] as Graphics;
      if ((body as unknown as { __counted?: boolean }).__counted) continue;
      (body as unknown as { __counted?: boolean }).__counted = true;
      const original = body.clear.bind(body);
      counts.set(node, 0);
      body.clear = () => {
        counts.set(node, (counts.get(node) ?? 0) + 1);
        return original();
      };
    }
    return counts;
  }

  it("draws the detail Text once per node and re-renders only on hash change", () => {
    let detailValue = "$1,250 · monthly";
    const sparkCalls: string[] = [];
    const detailCalls: string[] = [];
    // Contract: one stable array per clip while the bars are unchanged.
    const EMPTY: number[] = [];
    const registry = createClipNodeRegistry(PALETTE, {
      getClipDetail: (id) => {
        detailCalls.push(id);
        return id === "clip-drums-1" ? detailValue : null;
      },
      getClipSparkline: (id) => {
        sparkCalls.push(id);
        return id === "clip-drums-1" ? EMPTY : null;
      },
    });
    const parent = new Container();
    const views = visibleViews();
    registry.syncFrame(parent, views);

    const drumsIndex = views.findIndex((v) => v.clip.id === "clip-drums-1");
    const drumsNode = parent.children[drumsIndex] as Container;
    expect(texts(drumsNode)).toContain("$1,250 · monthly");
    // Other clips: no detail line.
    const bassIndex = views.findIndex((v) => v.clip.id === "clip-bass-1");
    expect(texts(parent.children[bassIndex] as Container)).toEqual([views[bassIndex]!.clip.label]);

    // Both providers are queried once per visible clip per frame (sparkline:
    // pattern clips only). That is the O(1) contract; redraws are separate.
    const patternCount = views.filter((v) => v.clip.type === "pattern").length;
    expect(sparkCalls.length).toBe(patternCount);
    expect(detailCalls.length).toBe(views.length);

    const redraws = countBodyRedraws(parent);
    const childCount = drumsNode.children.length;
    registry.syncFrame(parent, views);
    expect(sparkCalls.length).toBe(2 * patternCount);
    // Hash unchanged + same bars reference → nothing redrew.
    expect([...redraws.values()].every((n) => n === 0)).toBe(true);
    expect(drumsNode.children.length).toBe(childCount); // no new Text

    detailValue = "$1,300 · monthly";
    registry.syncFrame(parent, views);
    // Only drums redrew.
    expect(redraws.get(drumsNode)).toBe(1);
    expect([...redraws.values()].reduce((a, b) => a + b, 0)).toBe(1);
    expect(texts(drumsNode)).toContain("$1,300 · monthly");
    expect(drumsNode.children.length).toBe(childCount);
    registry.destroy();
  });

  // canvas-sparkline-hash-ignores-position: the host's bars may depend on the
  // clip's position (a calendar projection), which is deliberately NOT in
  // clipVisualHash. A pure move must still repaint the bars the provider now
  // returns, signalled by a new array reference.
  it("repaints the body when the provider returns a new bars array, even with an unchanged hash", () => {
    const core = createPlaylistCore(sizedDemoState());
    const BEFORE = [0.2, 0.4, 0.6, 0.8, 0.5, 0.3];
    const AFTER = [0.9, 0.1, 0.9];
    let drumsBars = BEFORE;
    // Stable per-clip arrays for everything else.
    const others = new Map<string, number[]>();
    const registry = createClipNodeRegistry(PALETTE, {
      getClipSparkline: (id) => {
        if (id === "clip-drums-1") return drumsBars;
        let bars = others.get(id);
        if (!bars) {
          bars = [0.5, 0.5];
          others.set(id, bars);
        }
        return bars;
      },
    });
    const parent = new Container();
    const firstViews = core.getPresentation().visibleClipViews;
    registry.syncFrame(parent, firstViews);
    const redraws = countBodyRedraws(parent);
    const drumsView = () =>
      core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const drumsNode = parent.children[
      firstViews.findIndex((v) => v.clip.id === "clip-drums-1")
    ] as Container;
    const drumsBody = drumsNode.children[0] as Graphics;
    // One fill instruction per drawn bar on top of the body + title fills.
    const instructionCount = () => drumsBody.context.instructions.length;
    const drawnBefore = instructionCount();

    // Pure move: same size, colour, label, offset, detail → same hash.
    const hashBefore = clipVisualHash(drumsView());
    const clip = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    core.moveClips([{ id: clip.id, start: clip.start + 2, trackIndex: 0 }]);
    expect(clipVisualHash(drumsView())).toBe(hashBefore);

    // The host's projection now yields different bars (new reference).
    drumsBars = AFTER;
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(drumsNode.x).toBe(Math.round(drumsView().rect.x));
    expect(redraws.get(drumsNode)).toBe(1);
    // The body now carries the AFTER bars (3 fewer than BEFORE).
    expect(instructionCount()).toBe(
      drawnBefore - (BEFORE.length - AFTER.length),
    );
    // Every other clip kept its bars reference → no redraw.
    expect([...redraws.values()].reduce((a, b) => a + b, 0)).toBe(1);

    // Same reference next frame → steady state, no redraw.
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(redraws.get(drumsNode)).toBe(1);
    registry.destroy();
  });

  it("default path (no providers) adds no detail Text", () => {
    const registry = createClipNodeRegistry(PALETTE);
    const parent = new Container();
    const views = visibleViews();
    registry.syncFrame(parent, views);
    const drumsIndex = views.findIndex((v) => v.clip.id === "clip-drums-1");
    expect(texts(parent.children[drumsIndex] as Container)).toEqual([views[drumsIndex]!.clip.label]);
    registry.destroy();
  });
});

describe("FL parity — left crop keeps content in place", () => {
  function clip(core: ReturnType<typeof createPlaylistCore>, id: string) {
    return core.getState().clips.find((c) => c.id === id)!;
  }

  it("left crop shifts contentOffset by the start delta", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    // clip-chords-1: pattern, start 8, duration 16.
    core.resizeClip("clip-chords-1", "left", 11);
    const after = clip(core, "clip-chords-1");
    expect(after.start).toBe(11);
    expect(after.duration).toBe(13);
    expect(after.contentOffset).toBe(3);
    // Extending back left past the original start goes negative.
    core.resizeClip("clip-chords-1", "left", 6);
    expect(clip(core, "clip-chords-1").contentOffset).toBe(-2);
  });

  it("scales the delta by stretchRatio and adds to an existing offset", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setClipStretchRatio("clip-chords-1", 2);
    core.setClipContentOffset("clip-chords-1", 1);
    core.resizeClip("clip-chords-1", "left", 10);
    expect(clip(core, "clip-chords-1").contentOffset).toBe(1 + 2 * 2);
  });

  it("is one undo entry that restores the original start + offset", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.resizeClip("clip-chords-1", "left", 12);
    expect(clip(core, "clip-chords-1").contentOffset).toBe(4);
    core.undo();
    const restored = clip(core, "clip-chords-1");
    expect(restored.start).toBe(8);
    expect(restored.duration).toBe(16);
    expect(restored.contentOffset).toBeUndefined();
  });

  it("zero delta keeps contentOffset undefined; right edge and automation untouched", () => {
    const state = createDemoPlaylistState();
    const same = playlistReducer(
      state,
      { type: "RESIZE_CLIP", clipId: "clip-chords-1", edge: "left", time: 8 },
      M,
    );
    expect(same.clips.find((c) => c.id === "clip-chords-1")!.contentOffset).toBeUndefined();

    const right = playlistReducer(
      state,
      { type: "RESIZE_CLIP", clipId: "clip-chords-1", edge: "right", time: 30 },
      M,
    );
    expect(right.clips.find((c) => c.id === "clip-chords-1")!.contentOffset).toBeUndefined();

    const auto = playlistReducer(
      state,
      { type: "RESIZE_CLIP", clipId: "clip-auto-1", edge: "left", time: 8 },
      M,
    );
    const autoClip = auto.clips.find((c) => c.id === "clip-auto-1")!;
    expect(autoClip.start).toBe(8);
    expect(autoClip.contentOffset).toBeUndefined();
  });

  it("stretch-mode left resize changes stretchRatio, not contentOffset", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.stretchResizeClip("clip-chords-1", "left", 16);
    const after = clip(core, "clip-chords-1");
    expect(after.stretchRatio).toBeCloseTo(0.5);
    expect(after.contentOffset).toBeUndefined();
  });

  it("controller left-edge drag accumulates the offset across moves", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // clip-chords-1 is on track index 2 (rows 72 px tall).
    const y = M.rulerHeight + 2 * M.trackHeight + M.clipPaddingY + 10;
    const leftEdgeX = M.trackHeaderWidth + 8 * PX + 2;
    listeners.get("pointerdown")?.(pointerEvent(leftEdgeX, y));
    listeners.get("pointermove")?.(pointerEvent(M.trackHeaderWidth + 10 * PX, y));
    listeners.get("pointermove")?.(pointerEvent(M.trackHeaderWidth + 13 * PX, y));
    listeners.get("pointermove")?.(pointerEvent(M.trackHeaderWidth + 12 * PX, y));
    listeners.get("pointerup")?.(pointerEvent(M.trackHeaderWidth + 12 * PX, y));
    controller.destroy();
    const after = clip(core, "clip-chords-1");
    expect(after.start).toBe(12);
    expect(after.start + after.duration).toBe(24);
    expect(after.contentOffset).toBe(4);
    core.undo();
    expect(clip(core, "clip-chords-1").contentOffset).toBeUndefined();
  });
});
