// The clip's icon (providers.getClipIcon): first in the name's pill, in the
// clip's colour — the name moves right by its room, the pill grows by it,
// and a host that sizes tags to their text (clipCardWidthPx) gets the same
// room. One GraphicsContext per glyph for the registry, shared by every
// node; a node only rebuilds when the glyph's reference changes.
import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistState,
} from "../src/playlist-core";
import {
  clipCardWidthPx,
  createClipNodeRegistry,
  type PlaylistClipIcon,
} from "../src/playlist-renderer-pixi/clip-node-registry";
import { COLORS } from "../src/playlist-renderer-pixi/palette";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = 20;
const HOUSE: PlaylistClipIcon = ["M3 10.5 12 3l9 7.5", "M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"];
const CART: PlaylistClipIcon = ["M2.5 3h2.2l2.4 11.2h10L21 7H5.6"];

function scene(icons: Record<string, PlaylistClipIcon | null>, muted = false) {
  const base = createDemoPlaylistState();
  const ids = Object.keys(icons);
  const state: PlaylistState = {
    ...base,
    clips: ids.map((id, index) => ({
      id,
      type: "pattern" as const,
      trackId: base.tracks[index]!.id,
      start: 5,
      duration: 50,
      label: "Renta",
      color: "#8e4ec6",
      timeLocked: true,
      ...(muted ? { muted: true } : {}),
    })),
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(1200, 700);
  core.updateViewport({ pxPerBeat: PX, scrollX: 0, scrollY: 0 });
  ids.forEach((_, index) => core.setTrackHeight(index, 84));
  const current = { ...icons };
  const registry = createClipNodeRegistry(COLORS, {
    timeLock: true,
    getClipDetail: () => "-$8,000 /mes",
    getClipPeriod: () => "1 dic 2026",
    getClipIcon: (clipId) => current[clipId] ?? null,
  });
  const parent = new Container();
  const sync = () => registry.syncFrame(parent, core.getPresentation().visibleClipViews, M.trackHeaderWidth);
  sync();
  const nodeOf = (id: string) => {
    const views = core.getPresentation().visibleClipViews;
    return parent.children[views.findIndex((view) => view.clip.id === id)] as Container;
  };
  const viewOf = (id: string) => core.getPresentation().visibleClipViews.find((view) => view.clip.id === id)!;
  // The icon: the node's Graphics scaled down from the 24-unit grid.
  const iconOf = (id: string) =>
    nodeOf(id).children.find((child) => child instanceof Graphics && child.scale.x < 1) as Graphics | undefined;
  const titleOf = (id: string) => nodeOf(id).children.find((child) => child instanceof Text) as Text;
  return { core, registry, sync, nodeOf, viewOf, iconOf, titleOf, current };
}

describe("the clip's icon", () => {
  it("sits first in the pill (11 px in, 14 px, in the clip's colour); the name moves 20 px right", () => {
    const { iconOf, titleOf, viewOf } = scene({ a: HOUSE, b: null });
    const icon = iconOf("a")!;
    expect(icon.visible).toBe(true);
    expect(icon.x).toBe(11);
    expect(icon.scale.x).toBeCloseTo(14 / 24, 6);
    expect(icon.tint).toBe(0x8e4ec6);
    // The pill is 22 px tall: the 14 px icon centred in it.
    const pillTop = titleOf("a").y + 1 - Math.round((22 - 17) / 2);
    expect(icon.y).toBe(pillTop + 4);
    // 11 px pad + 14 px icon + 6 px gap, the text 1 px left (its outline).
    expect(titleOf("a").x).toBe(11 + 20 - 1);
    // Without an icon: no Graphics for it, the name at 11.
    expect(iconOf("b")).toBeUndefined();
    expect(titleOf("b").x).toBe(11 - 1);
    expect(viewOf("a").rect.width).toBe(viewOf("b").rect.width);
  });

  it("the pill grows by the icon's room", () => {
    const { nodeOf } = scene({ a: HOUSE, b: null });
    // The pill: the Graphics added under the card's outline, after the lock.
    const pillWidth = (id: string) => {
      const pill = nodeOf(id).children.find(
        (child) => child instanceof Graphics && child.scale.x === 1 && child.height === 22,
      ) as Graphics;
      return pill.width;
    };
    expect(pillWidth("a") - pillWidth("b")).toBeCloseTo(20, 0);
  });

  it("one context per glyph, shared by every node; a new glyph swaps it, the same one never rebuilds", () => {
    const { iconOf, sync, current } = scene({ a: HOUSE, b: HOUSE });
    const a = iconOf("a")!;
    expect(a.context).toBe(iconOf("b")!.context);
    const houseContext = a.context;
    sync();
    expect(iconOf("a")!.context).toBe(houseContext);
    current.a = CART;
    sync();
    expect(iconOf("a")!.context).not.toBe(houseContext);
    expect(iconOf("b")!.context).toBe(houseContext);
    // Removed: hidden, and the name goes back to the pad.
    current.a = null;
    sync();
    expect(iconOf("a")!.visible).toBe(false);
  });

  it("a muted clip's icon is grey, like its name", () => {
    const { iconOf } = scene({ a: HOUSE }, true);
    expect(iconOf("a")!.tint).toBe(COLORS.textMuted);
  });

  it("clipCardWidthPx counts the icon's room", () => {
    // Two lines: as wide as the wider of the pill and the dates row — the
    // icon widens the pill (a long name: the pill is the wider one).
    const plain = clipCardWidthPx("Bono de fin de año", "+$4,000", "9 dic 2026", 70, 20);
    expect(clipCardWidthPx("Bono de fin de año", "+$4,000", "9 dic 2026", 70, 20, true)).toBe(plain + 20);
    // A short name: the dates row still decides.
    const row = clipCardWidthPx("Bono", null, "9 dic 2026", 70, 20);
    expect(clipCardWidthPx("Bono", null, "9 dic 2026", 70, 20, true)).toBe(row);
    // One line: pill, lock and dates side by side — always 20 px more.
    const short = clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 38, 20);
    expect(clipCardWidthPx("Bono", "+$4,000", "9 dic 2026", 38, 20, true)).toBe(short + 20);
  });

  it("the registry's teardown destroys the shared contexts", () => {
    const { iconOf, registry } = scene({ a: HOUSE });
    const context = iconOf("a")!.context;
    registry.destroy();
    expect(context.destroyed).toBe(true);
  });
});
