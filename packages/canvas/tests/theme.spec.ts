// Light / dark theme + the two-tier ruler contract.
//
//   1. The live palette (COLORS) is switched in place: same reference, new
//      values; switching to the active theme is a no-op.
//   2. A theme switch repaints every cached layer exactly once: clip nodes
//      (registry.invalidate), the overview lane (all tiers) and the drag
//      pill. Steady frames afterwards repaint nothing (canon §3.8 / §3.10).
//   3. Axis bands + centred / emphasised / dimmed ticks reach the
//      presentation in screen coordinates; without bands nothing changes.
import { Container, Graphics, Text } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  DEFAULT_PLAYLIST_METRICS,
  timeToScreenX,
  type PlaylistOverviewData,
  type PlaylistTimeAxis,
} from "../src/playlist-core";
import {
  COLORS,
  DARK_PALETTE,
  LIGHT_PALETTE,
  applyPlaylistTheme,
  getPlaylistTheme,
  mixColor,
} from "../src/playlist-renderer-pixi/palette";
import { createClipNodeRegistry } from "../src/playlist-renderer-pixi/clip-node-registry";
import { createOverviewLaneLayer } from "../src/playlist-renderer-pixi/layers/overview-lane";
import { createDragAnnotationLayer } from "../src/playlist-renderer-pixi/layers/drag-annotation";
import { drawRulerChrome } from "../src/playlist-renderer-pixi/layers/ruler";
import { clearTextLayer } from "../src/playlist-renderer-pixi/text-pool";

const M = DEFAULT_PLAYLIST_METRICS;

function sizedDemoState() {
  const state = createDemoPlaylistState();
  return { ...state, viewport: { ...state.viewport, width: 1200, height: 700 } };
}

afterEach(() => {
  applyPlaylistTheme("light");
});

describe("theme — live palette", () => {
  it("switches COLORS in place; same theme is a no-op", () => {
    applyPlaylistTheme("light");
    const ref = COLORS;
    expect(COLORS.background).toBe(LIGHT_PALETTE.background);
    expect(applyPlaylistTheme("dark")).toBe(true);
    expect(COLORS).toBe(ref);
    expect(COLORS.background).toBe(DARK_PALETTE.background);
    expect(COLORS.text).toBe(DARK_PALETTE.text);
    expect(getPlaylistTheme()).toBe("dark");
    expect(applyPlaylistTheme("dark")).toBe(false);
  });

  it("both themes define every key", () => {
    expect(Object.keys(DARK_PALETTE).sort()).toEqual(Object.keys(LIGHT_PALETTE).sort());
  });

  it("mixColor blends channels linearly and clamps t", () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColor(0x000000, 0xff8000, 0.5)).toBe(0x804000);
    expect(mixColor(0x102030, 0xffffff, -1)).toBe(0x102030);
  });
});

// Counts body redraws (Graphics.clear) per node.
function countRedraws(parent: Container): () => number {
  let total = 0;
  for (const child of parent.children) {
    const body = (child as Container).children[0] as Graphics;
    const original = body.clear.bind(body);
    body.clear = () => {
      total += 1;
      return original();
    };
  }
  return () => total;
}

describe("theme — cached layers repaint exactly once", () => {
  it("clip nodes: invalidate() → one redraw per visible node, then none", () => {
    const core = createPlaylistCore(sizedDemoState());
    const registry = createClipNodeRegistry(COLORS);
    const parent = new Container();
    const views = core.getPresentation().visibleClipViews;
    registry.syncFrame(parent, views);
    const redraws = countRedraws(parent);
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(redraws()).toBe(0);

    applyPlaylistTheme("dark");
    registry.invalidate();
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(redraws()).toBe(views.length);
    for (let i = 0; i < 50; i += 1) {
      if (i % 2) core.setPlayPosition(i);
      registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    }
    expect(redraws()).toBe(views.length);
    registry.destroy();
  });

  it("clip card is opaque and tinted from the theme surface", () => {
    const core = createPlaylistCore(sizedDemoState());
    const registry = createClipNodeRegistry(COLORS);
    const parent = new Container();
    const view = core.getPresentation().visibleClipViews[0]!;
    registry.syncFrame(parent, [view]);
    const body = (parent.children[0] as Container).children[0] as Graphics;
    const first = body.context.instructions[0] as unknown as {
      action: string;
      data: { style: { color: number; alpha: number } };
    };
    expect(first.action).toBe("fill");
    expect(first.data.style.alpha).toBe(1);
    const clipColor = Number.parseInt(view.clip.color.slice(1), 16);
    expect(first.data.style.color).toBe(
      mixColor(COLORS.background, clipColor, COLORS.clipTint),
    );
    registry.destroy();
  });

  it("overview lane: invalidate() rebuilds frame + curves once", () => {
    const core = createPlaylistCore(sizedDemoState(), {
      metrics: { ...M, overviewLaneHeight: 96 },
    });
    const parts = {
      container: new Container(),
      frameGraphics: new Graphics(),
      frameText: new Container(),
      curveGraphics: new Graphics(),
      curveText: new Container(),
      dynamicGraphics: new Graphics(),
    };
    const layer = createOverviewLaneLayer(parts);
    const data: PlaylistOverviewData = {
      title: "Cash",
      primary: { initial: 100, beats: [4, 9], values: [40, -10] },
      thresholds: [{ value: 50, tone: "warning", label: "reserve" }],
      annotations: [],
    };
    layer.sync(core.getPresentation(), data);
    const frames = layer.stats.frameRebuilds;
    const curves = layer.stats.rebuilds;
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.frameRebuilds).toBe(frames);
    layer.invalidate();
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.frameRebuilds).toBe(frames + 1);
    expect(layer.stats.rebuilds).toBe(curves + 1);
    layer.sync(core.getPresentation(), data);
    expect(layer.stats.frameRebuilds).toBe(frames + 1);
    layer.dispose();
  });

  it("drag pill: invalidate() repaints the same annotation once", () => {
    const core = createPlaylistCore(sizedDemoState());
    const layer = createDragAnnotationLayer({
      container: new Container(),
      background: new Graphics(),
      textLayer: new Container(),
    });
    const presentation = {
      ...core.getPresentation(),
      tooltipView: { kind: "time" as const, text: "x", time: null, x: 300, y: 200 },
    };
    const annotation = { text: "Mín $1 → $2", tone: "positive" as const };
    layer.sync(presentation, annotation);
    layer.sync(presentation, annotation);
    expect(layer.stats.repaints).toBe(1);
    layer.invalidate();
    layer.sync(presentation, annotation);
    layer.sync(presentation, annotation);
    expect(layer.stats.repaints).toBe(2);
    layer.dispose();
  });
});

describe("two-tier ruler — axis bands and rich ticks", () => {
  const PX = 28;
  const axis: PlaylistTimeAxis = {
    ticks(fromBeat, toBeat) {
      const out = [];
      for (let beat = Math.max(0, Math.floor(fromBeat)); beat <= Math.ceil(toBeat); beat += 1) {
        out.push({
          beat,
          major: beat % 7 === 0,
          label: String(beat),
          centered: true,
          emphasis: beat === 0,
          dim: beat % 7 === 5 || beat % 7 === 6,
        });
      }
      return out;
    },
    bands(fromBeat, toBeat) {
      const out = [];
      for (let start = Math.floor(fromBeat / 7) * 7; start <= toBeat; start += 7) {
        out.push({ kind: "group" as const, start, end: start + 7, label: `W${start / 7}` });
        out.push({ kind: "shade" as const, start: start + 5, end: start + 7 });
      }
      return out;
    },
    formatTime: (beat) => `day ${beat}`,
  };

  it("centred labels sit in the middle of their cell; flags pass through", () => {
    const state = sizedDemoState();
    const ticks = createPlaylistPresentation(state, M, axis).rulerTicks;
    const today = ticks.find((t) => t.beat === 0)!;
    expect(today.emphasis).toBe(true);
    expect(today.centered).toBe(true);
    expect(today.labelX).toBe(today.x + PX / 2);
    expect(ticks.find((t) => t.beat === 5)?.dim).toBe(true);
    expect(ticks.find((t) => t.beat === 3)?.dim).toBe(false);
  });

  it("bands are projected to screen x; groups and shades both kept", () => {
    const state = sizedDemoState();
    const bands = createPlaylistPresentation(state, M, axis).rulerBands;
    const first = bands.find((b) => b.kind === "group")!;
    expect(first.label).toBe("W0");
    expect(first.x0).toBe(timeToScreenX(state, 0, M));
    expect(first.x1).toBe(timeToScreenX(state, 7, M));
    const shade = bands.find((b) => b.kind === "shade")!;
    expect(shade.x1 - shade.x0).toBe(2 * PX);
  });

  it("no axis (or an axis without bands) → no bands, shared empty list", () => {
    const state = sizedDemoState();
    const a = createPlaylistPresentation(state, M).rulerBands;
    const b = createPlaylistPresentation(state, M).rulerBands;
    expect(a).toEqual([]);
    expect(a).toBe(b);
    const plain: PlaylistTimeAxis = { ticks: axis.ticks, formatTime: axis.formatTime };
    expect(createPlaylistPresentation(state, M, plain).rulerBands).toEqual([]);
  });
});

// --- Review fixes ------------------------------------------------------------

function visibleTexts(layer: Container): string[] {
  return layer.children
    .filter((c): c is Text => c instanceof Text && c.visible)
    .map((t) => t.text);
}

describe("ruler — labels never collide with the pill or the header corner", () => {
  // One centred label per beat; beat 0 is the emphasised "today" pill with
  // a wide label so it covers its neighbours at 28 px/beat.
  const axis: PlaylistTimeAxis = {
    ticks(fromBeat, toBeat) {
      const out = [];
      for (let beat = Math.max(0, Math.floor(fromBeat)); beat <= Math.ceil(toBeat); beat += 1) {
        out.push({
          beat,
          major: false,
          label: beat === 0 ? "Hoy mismo" : `d${beat}`,
          centered: true,
          emphasis: beat === 0,
        });
      }
      return out;
    },
    bands: () => [{ kind: "group" as const, start: 0, end: 400, label: "Mes" }],
    formatTime: (beat) => `day ${beat}`,
  };

  function draw(scrollX: number): string[] {
    const base = sizedDemoState();
    const state = { ...base, viewport: { ...base.viewport, scrollX } };
    const presentation = createPlaylistPresentation(state, M, axis);
    const graphics = new Graphics();
    const layer = new Container();
    clearTextLayer(layer);
    drawRulerChrome(graphics, layer, presentation);
    return visibleTexts(layer);
  }

  it("the pill wins: labels it would touch are skipped, the rest are drawn", () => {
    const texts = draw(0);
    expect(texts).toContain("Hoy mismo");
    expect(texts).toContain("Mes");
    // "Hoy mismo" pill ≈ 73px centred on beat 0's cell (x ≈ 14): d1 (x ≈ 42)
    // collides, d3 (x ≈ 98) is clear.
    expect(texts).not.toContain("d1");
    expect(texts).toContain("d3");
  });

  it("a centred label whose cell straddles the header edge is not drawn", () => {
    // Scrolled so one day's tick line is left of the header edge while its
    // cell centre is right of it: the presentation keeps the tick (for a
    // sticky pill), but its plain label would start inside the header.
    const texts = draw(20 + 28 * 0.6);
    const presentation = createPlaylistPresentation(
      { ...sizedDemoState(), viewport: { ...sizedDemoState().viewport, scrollX: 20 + 28 * 0.6 } },
      M,
      axis,
    );
    const straddling = presentation.rulerTicks.find(
      (t) => t.x < M.trackHeaderWidth && t.labelX > M.trackHeaderWidth,
    );
    expect(straddling).toBeDefined();
    expect(texts).not.toContain(straddling!.label);
  });
});

describe("fonts — refreshText re-rasterises labels once", () => {
  it("bumps every node label's style key; nothing else changes", () => {
    const core = createPlaylistCore(sizedDemoState());
    const registry = createClipNodeRegistry(COLORS, { getClipDetail: () => "$1,000" });
    const parent = new Container();
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    const labels = parent.children.flatMap((node) =>
      (node as Container).children.filter((c): c is Text => c instanceof Text),
    );
    expect(labels.length).toBeGreaterThan(0);
    const before = labels.map((t) => t.styleKey);
    registry.refreshText();
    const after = labels.map((t) => t.styleKey);
    for (let i = 0; i < labels.length; i += 1) {
      expect(after[i]).not.toBe(before[i]);
      expect(labels[i]!.text.length).toBeGreaterThan(0);
    }
    registry.destroy();
  });
});

describe("overview lane — labels sit above the series and the horizon shade", () => {
  it("threshold + scale labels are in the curve tier; the frame keeps the title", () => {
    const core = createPlaylistCore(sizedDemoState(), {
      metrics: { ...M, overviewLaneHeight: 96 },
    });
    const parts = {
      container: new Container(),
      frameGraphics: new Graphics(),
      frameText: new Container(),
      curveGraphics: new Graphics(),
      curveText: new Container(),
      dynamicGraphics: new Graphics(),
    };
    const layer = createOverviewLaneLayer(parts);
    layer.sync(core.getPresentation(), {
      title: "Cash",
      primary: { initial: 100, beats: [4, 9], values: [40, -10] },
      thresholds: [{ value: 50, tone: "warning", label: "reserve" }],
      annotations: [{ beat: 9, value: -10, label: "low", tone: "danger" }],
      endBeat: 12,
    });
    expect(visibleTexts(parts.frameText)).toEqual(["Cash"]);
    const curveTexts = visibleTexts(parts.curveText);
    expect(curveTexts).toContain("reserve");
    expect(curveTexts).toContain("100");
    expect(curveTexts).toContain("-10");
    expect(curveTexts).toContain("low");
    layer.dispose();
  });
});
