// Cell labels (PlaylistClipContent.cells): each payment's amount written at
// the top of its cell, right of its mark — only the cells inside the visible
// span, only where the label fits, emphasised ones in the clip's colour and
// bold; pooled Text, nothing redone on a frame where nothing moved.
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
import { COLORS } from "../src/playlist-renderer-pixi/palette";

const M = DEFAULT_PLAYLIST_METRICS;

function scene(content: PlaylistClipContent, pxPerBeat = 20, visibleRight = Number.POSITIVE_INFINITY) {
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
  core.setTrackHeight(0, 84);
  const registry = createClipNodeRegistry(COLORS, { getClipContent: () => content });
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
  const glow = () =>
    (parent.children[0] as Container).children.find(
      (child): child is Graphics => child instanceof Graphics && child.label === "clip-cell-glow",
    ) ?? null;
  const hoverAt = (time: number | null) => {
    hover.time = time;
    sync();
  };
  return { core, sync, cells, glow, hoverAt };
}

const weekly = (strong?: boolean[]): PlaylistClipContent => ({
  kind: "events",
  beats: [7, 14, 21, 28],
  values: [-1, -1, -1, -1],
  cells: { beats: [7, 14, 21, 28], labels: ["−$550", "−$700", "−$550", "−$300"], ...(strong ? { strong } : {}) },
});

describe("cell labels", () => {
  it("writes each payment's amount right of its mark", () => {
    const { cells } = scene(weekly());
    expect(cells().map((t) => t.text)).toEqual(["−$550", "−$700", "−$550", "−$300"]);
    // 7 days × 20 px + 4 px of padding.
    expect(cells()[0]!.x).toBe(144);
    expect(cells()[1]!.x).toBe(284);
  });

  it("emphasised cells take the clip's colour and bold", () => {
    const { cells } = scene(weekly([false, true, false, true]));
    const [plain, strong] = cells();
    expect(strong!.style.fill).toBe(0xe5484d);
    expect(strong!.style.fontWeight).toBe("700");
    expect(plain!.style.fontWeight).toBe("500");
    expect(plain!.alpha).toBeLessThan(strong!.alpha);
  });

  it("a cell too narrow for its label writes nothing", () => {
    // Daily cells of 20 px: "−$550" needs ~36 px at 12 px type; only the
    // last cell (it runs to the clip's end) has room.
    const daily: PlaylistClipContent = {
      kind: "events",
      beats: [7, 8, 9, 10],
      values: [-1, -1, -1, -1],
      cells: { beats: [7, 8, 9, 10], labels: ["−$550", "−$550", "−$550", "−$300"] },
    };
    const { cells } = scene(daily);
    expect(cells().map((t) => t.text)).toEqual(["−$300"]);
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
