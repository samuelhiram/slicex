// Cell labels (PlaylistClipContent.cells): each payment's amount written at
// the top of its cell (in the middle of a short labelled card's bar), right
// of its mark — only the cells inside the visible
// span, only where the label fits, emphasised ones bold and in the clip's
// colour made readable on its card, their cell outlined with dashes; pooled
// Text, nothing redone on a frame where nothing moved.
import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistClipContent,
  type PlaylistState,
} from "../src/playlist-core";
import { cellIndexAt, createClipNodeRegistry } from "../src/playlist-renderer-pixi/clip-node-registry";
import {
  applyPlaylistTheme,
  COLORS,
  contrastRatio,
  legibleInk,
  mixColor,
  PLAYLIST_THEMES,
} from "../src/playlist-renderer-pixi/palette";

const M = DEFAULT_PLAYLIST_METRICS;

function scene(
  content: PlaylistClipContent,
  pxPerBeat = 20,
  visibleRight = Number.POSITIVE_INFINITY,
  // A labelled card (its name above its bar, the host's lock button) in a row of `rowHeight`.
  labelled: { rowHeight: number } | null = null,
) {
  const base = createDemoPlaylistState();
  const state: PlaylistState = {
    ...base,
    clips: [
      {
        id: "gas",
        type: "pattern" as const,
        trackId: base.tracks[0]!.id,
        start: 0,
        duration: 60,
        label: "Gas",
        color: "#e5484d",
      },
    ],
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(1200, 700);
  core.updateViewport({ pxPerBeat, scrollX: 0, scrollY: 0 });
  core.setTrackHeight(0, labelled?.rowHeight ?? 84);
  const registry = createClipNodeRegistry(COLORS, {
    getClipContent: () => content,
    ...(labelled ? { timeLock: true, getClipDetail: () => "−$550 /semana" } : {}),
  });
  const parent = new Container();
  const hover = { time: null as number | null };
  const sync = () =>
    registry.syncFrame(
      parent,
      core.getPresentation().visibleClipViews,
      M.trackHeaderWidth,
      visibleRight,
      hover.time === null ? null : "gas",
      hover.time,
    );
  sync();
  const cells = () =>
    (parent.children[0] as Container).children.filter(
      (child): child is Text => child instanceof Text && child.label === "clip-cell" && child.visible,
    );
  const boxes = () =>
    (parent.children[0] as Container).children.find(
      (child): child is Graphics => child instanceof Graphics && child.label === "clip-cell-boxes",
    ) ?? null;
  const glow = () =>
    (parent.children[0] as Container).children.find(
      (child): child is Graphics => child instanceof Graphics && child.label === "clip-cell-glow",
    ) ?? null;
  const hoverAt = (time: number | null) => {
    hover.time = time;
    sync();
  };
  return { core, registry, sync, cells, boxes, glow, hoverAt };
}

// Counts the redraws of a Graphics from now on.
function countClears(graphics: Graphics): () => number {
  let cleared = 0;
  const clear = graphics.clear.bind(graphics);
  graphics.clear = () => {
    cleared += 1;
    return clear();
  };
  return () => cleared;
}

// Hue of a colour in degrees.
function hueOf(color: number): number {
  const [r, g, b] = [16, 8, 0].map((shift) => ((color >> shift) & 0xff) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

const weekly = (strong?: boolean[]): PlaylistClipContent => ({
  kind: "events",
  beats: [7, 14, 21, 28],
  values: [-1, -1, -1, -1],
  cells: { beats: [7, 14, 21, 28], labels: ["−$550", "−$700", "−$550", "−$300"], ...(strong ? { strong } : {}) },
});

describe("cell labels on a labelled card", () => {
  // Pixi puts the baseline halo/2 + 1.0 em under a Text's y; the digits'
  // middle is 0.36 em above the baseline.
  const digitsMiddle = (text: Text) => text.y + 2 + Number(text.style.fontSize) * 0.64;
  // The compact label row is 16 px; the bar is the rest of the card.
  const LABEL_ROW = 16;

  it("a short card (its lock in the label): each amount in the middle of its bar, 12 px from a 20 px bar", () => {
    // Default metrics pad a card 7 px above and below: cards of 32, 36 and 46 px.
    for (const [rowHeight, size] of [
      [46, 11],
      [50, 12],
      [60, 12],
    ] as const) {
      const { core, cells } = scene(weekly(), 20, Number.POSITIVE_INFINITY, { rowHeight });
      const bar = core.getPresentation().visibleClipViews[0]!.rect.height - LABEL_ROW;
      expect(cells().map((t) => t.text), `row ${rowHeight}`).toEqual(["−$550", "−$700", "−$550", "−$300"]);
      for (const text of cells()) {
        expect(Number(text.style.fontSize), `row ${rowHeight}`).toBe(size);
        expect(Math.abs(digitsMiddle(text) - (LABEL_ROW + bar / 2)), `row ${rowHeight}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a bar under 16 px writes no amount", () => {
    // A 30 px card: a 14 px bar.
    expect(scene(weekly(), 20, Number.POSITIVE_INFINITY, { rowHeight: 44 }).cells()).toEqual([]);
  });

  it("a tall card keeps them at the top of its bar: its lock is in the bar's bottom-left corner", () => {
    const { core, cells } = scene(weekly(), 20, Number.POSITIVE_INFINITY, { rowHeight: 84 });
    const card = core.getPresentation().visibleClipViews[0]!.rect.height;
    expect(cells()).toHaveLength(4);
    // 26 px label, the bar's 4 px inset, 1 px: well above the bar's middle.
    for (const text of cells()) expect(text.y).toBe(31);
    expect(digitsMiddle(cells()[0]!)).toBeLessThan(26 + (card - 26) / 2);
  });
});

describe("cell labels", () => {
  it("writes each payment's amount right of its mark", () => {
    const { cells } = scene(weekly());
    expect(cells().map((t) => t.text)).toEqual(["−$550", "−$700", "−$550", "−$300"]);
    // 7 days × 20 px + 4 px of padding.
    expect(cells()[0]!.x).toBe(144);
    expect(cells()[1]!.x).toBe(284);
  });

  it("emphasised cells are bold, in the clip's colour made readable on its card", () => {
    const { cells } = scene(weekly([false, true, false, true]));
    const [plain, strong] = cells();
    const card = mixColor(COLORS.background, 0xe5484d, COLORS.clipTint);
    const ink = strong!.style.fill as number;
    expect(Math.abs(hueOf(ink) - hueOf(0xe5484d))).toBeLessThan(3);
    expect(contrastRatio(ink, card)).toBeGreaterThan(contrastRatio(0xe5484d, card));
    expect(contrastRatio(ink, card)).toBeGreaterThanOrEqual(4.5);
    expect(strong!.style.fontWeight).toBe("700");
    expect(plain!.style.fill).toBe(COLORS.text);
    expect(plain!.style.fontWeight).toBe("500");
    expect(plain!.alpha).toBeLessThan(strong!.alpha);
  });

  it("a theme switch re-mixes the emphasised colour: lighter on dark, deeper on light", () => {
    const { registry, cells, sync } = scene(weekly([false, true, false, true]));
    const onLight = cells()[1]!.style.fill as number;
    expect(contrastRatio(onLight, 0xffffff)).toBeGreaterThan(contrastRatio(0xe5484d, 0xffffff));
    try {
      applyPlaylistTheme("dark");
      registry.invalidate();
      sync();
      const onDark = cells()[1]!.style.fill as number;
      expect(contrastRatio(onDark, 0x000000)).toBeGreaterThan(contrastRatio(0xe5484d, 0x000000));
    } finally {
      applyPlaylistTheme("light");
    }
  });

  it("legibleInk: every hue reads on its own tinted card, in both themes", () => {
    const hues = [0x18864a, 0xd93d42, 0x8e4ec6, 0x3e63dd, 0xc2520a, 0x2f74b5, 0x888888, 0x000000, 0xffffff];
    for (const theme of Object.values(PLAYLIST_THEMES)) {
      for (const hue of hues) {
        const card = mixColor(theme.background, hue, theme.clipTint);
        expect(contrastRatio(legibleInk(hue, card, theme.inkContrast), card)).toBeGreaterThanOrEqual(
          theme.inkContrast,
        );
      }
    }
    // Readable already: kept as it is.
    expect(legibleInk(0xffffff, 0x000000, 6)).toBe(0xffffff);
  });

  it("an emphasised cell is outlined with dashes, clear of the marks at its sides", () => {
    const { boxes } = scene(weekly([false, true, false, false]));
    const bounds = boxes()!.getLocalBounds();
    // Cell 2: 280 → 420 px, 3 px in at each side.
    expect(bounds.x).toBeCloseTo(283, 0);
    expect(bounds.x + bounds.width).toBeCloseTo(417, 0);
    // Under the labels, over the body.
    const container = boxes()!.parent!;
    const index = container.getChildIndex(boxes()!);
    expect(index).toBeGreaterThan(0);
    for (const child of container.children) {
      if (child instanceof Text) expect(container.getChildIndex(child)).toBeGreaterThan(index);
    }
  });

  it("no emphasised cell, no outline; one too narrow shows none", () => {
    expect(scene(weekly()).boxes()).toBeNull();
    // Daily cells of 8 px: no room between the marks.
    const daily: PlaylistClipContent = {
      kind: "events",
      beats: [7, 8, 9, 10],
      values: [-1, -1, -1, -1],
      cells: {
        beats: [7, 8, 9, 10],
        labels: ["−$550", "−$700", "−$550", "−$300"],
        strong: [false, true, false, false],
      },
    };
    expect(scene(daily, 8).boxes()!.getLocalBounds().width).toBe(0);
    // The same cells with room: outlined.
    expect(scene(daily, 40).boxes()!.getLocalBounds().width).toBeGreaterThan(30);
  });

  it("the outline is redrawn only when it changes: not on a steady frame, a short pan or a hover", () => {
    const { core, boxes, sync, hoverAt } = scene(weekly([false, true, false, true]), 20, 1200);
    const cleared = countClears(boxes()!);
    sync();
    core.updateViewport({ pxPerBeat: 20, scrollX: 40, scrollY: 0 });
    sync();
    hoverAt(16);
    hoverAt(null);
    expect(cleared()).toBe(0);
    core.updateViewport({ pxPerBeat: 24, scrollX: 40, scrollY: 0 });
    sync();
    expect(cleared()).toBe(1);
  });

  it("a very wide cell draws only the part around the view", () => {
    // Cell 1 is 48 days wide: 4 608 px at 96 px a day.
    const wide: PlaylistClipContent = {
      kind: "events",
      beats: [2, 50],
      values: [-1, -1],
      cells: { beats: [2, 50], labels: ["−$550", "−$700"], strong: [true, false] },
    };
    const { core, boxes, sync } = scene(wide, 96, 1200);
    core.updateViewport({ pxPerBeat: 96, scrollX: 20 * 96, scrollY: 0 });
    sync();
    const view = 1200 - M.trackHeaderWidth;
    const bounds = boxes()!.getLocalBounds();
    // All of the view (from beat 20), rounded out to 512 px steps: no more.
    expect(bounds.x).toBeLessThanOrEqual(20 * 96);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(20 * 96 + view);
    expect(bounds.width).toBeLessThanOrEqual(view + 2 * 512);
  });

  it("a theme switch repaints the outline", () => {
    const { registry, boxes, sync } = scene(weekly([false, true, false, false]));
    const cleared = countClears(boxes()!);
    try {
      applyPlaylistTheme("dark");
      registry.invalidate();
      sync();
      expect(cleared()).toBe(1);
    } finally {
      applyPlaylistTheme("light");
    }
  });

  it("cells too narrow for their labels write none — not even the last one, which has room", () => {
    // Daily cells of 20 px: "−$550" needs ~36 px at 12 px type. The last
    // cell (it runs to the clip's end) would have room: one format for the
    // whole card, so it stays empty like its neighbours.
    const daily: PlaylistClipContent = {
      kind: "events",
      beats: [7, 8, 9, 10],
      values: [-1, -1, -1, -1],
      cells: { beats: [7, 8, 9, 10], labels: ["−$550", "−$550", "−$550", "−$300"] },
    };
    const { cells } = scene(daily);
    expect(cells()).toEqual([]);
  });

  it("cells of 14 and 16 days never take turns: whole when the narrowest fits, else all short, else none", () => {
    // Cells of 5 and 8 days, alternating (then the last one, to the card's end).
    const uneven: PlaylistClipContent = {
      kind: "events",
      beats: [2, 7, 15, 20, 28],
      values: [1, 1, 1, 1, 1],
      cells: {
        beats: [2, 7, 15, 20, 28],
        labels: Array(5).fill("+$11,000"),
        shortLabels: Array(5).fill("+$11k"),
      },
    };
    // "+$11,000" needs ~58 px at 12 px type, "+$11k" ~36, plus 8 px of pads.
    // 14 px a day: the 5-day cells (70 px) hold it.
    expect(scene(uneven, 14).cells().map((t) => t.text)).toEqual(Array(5).fill("+$11,000"));
    // 10 px a day: the 8-day cells (80 px) would hold it, the 5-day ones
    // (50 px) not — they used to take turns. Now every cell is short.
    expect(scene(uneven, 10).cells().map((t) => t.text)).toEqual(Array(5).fill("+$11k"));
    // 8 px a day: not even "+$11k" fits a 5-day cell (40 px): none.
    expect(scene(uneven, 8).cells()).toEqual([]);
  });

  it("without short labels a card goes from whole straight to none", () => {
    const uneven: PlaylistClipContent = {
      kind: "events",
      beats: [2, 7, 15, 20, 28],
      values: [1, 1, 1, 1, 1],
      cells: { beats: [2, 7, 15, 20, 28], labels: Array(5).fill("+$11,000") },
    };
    expect(scene(uneven, 14).cells()).toHaveLength(5);
    expect(scene(uneven, 10).cells()).toEqual([]);
  });

  it("only the cells inside the visible span are laid out", () => {
    // The clip starts at the header's right edge: beat 14 is at x = 148 + 280.
    const { cells } = scene(weekly(), 20, M.trackHeaderWidth + 14 * 20 - 1);
    expect(cells().map((t) => t.text)).toEqual(["−$550"]);
  });

  it("a frame where nothing moved reuses the same Text objects", () => {
    const { cells, sync } = scene(weekly());
    const before = cells();
    sync();
    const after = cells();
    expect(after).toHaveLength(before.length);
    after.forEach((text, i) => expect(text).toBe(before[i]));
  });

  it("the cell under the pointer glows over its span; its label at full strength", () => {
    const { cells, glow, hoverAt } = scene(weekly());
    expect(glow()).toBeNull();
    hoverAt(16);
    const lit = glow()!;
    expect(lit.visible).toBe(true);
    // Cell 2 runs from beat 14 to beat 21: 280 → 420 px.
    const bounds = lit.getLocalBounds();
    expect(bounds.x).toBeCloseTo(279, 0);
    expect(bounds.x + bounds.width).toBeCloseTo(420, 0);
    expect(cells()[1]!.alpha).toBe(1);
    expect(cells()[0]!.alpha).toBeLessThan(1);
  });

  it("the glow follows the pointer, and goes out when it leaves", () => {
    const { glow, hoverAt, cells } = scene(weekly());
    hoverAt(8);
    const lit = glow()!;
    hoverAt(23);
    // The same Graphics, redrawn.
    expect(glow()).toBe(lit);
    expect(lit.getLocalBounds().x).toBeCloseTo(419, 0);
    // Before the first payment: no cell.
    hoverAt(3);
    expect(lit.visible).toBe(false);
    hoverAt(null);
    expect(lit.visible).toBe(false);
    expect(cells().every((text) => text.alpha < 1)).toBe(true);
  });

  it("a frame with the same hover redraws nothing", () => {
    const { glow, hoverAt, sync } = scene(weekly());
    hoverAt(16);
    const lit = glow()!;
    let cleared = 0;
    const clear = lit.clear.bind(lit);
    lit.clear = () => {
      cleared += 1;
      return clear();
    };
    sync();
    sync();
    expect(cleared).toBe(0);
  });

  it("cellIndexAt: the cell holding a beat, inside the clip only", () => {
    const beats = [7, 14, 21, 28];
    expect(cellIndexAt(beats, 7, 0, 60)).toBe(0);
    expect(cellIndexAt(beats, 13, 0, 60)).toBe(0);
    expect(cellIndexAt(beats, 14, 0, 60)).toBe(1);
    expect(cellIndexAt(beats, 59, 0, 60)).toBe(3);
    expect(cellIndexAt(beats, 60, 0, 60)).toBe(-1);
    expect(cellIndexAt(beats, 6, 0, 60)).toBe(-1);
    expect(cellIndexAt(beats, null, 0, 60)).toBe(-1);
  });
});
