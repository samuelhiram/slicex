// Sticky clip titles: a clip that starts left of the visible timeline keeps
// its title (and detail line) at the timeline's left edge while scrolling,
// never past its own right end. Transform-only per frame.
import { Container, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistState,
} from "../src/playlist-core";
import { createClipNodeRegistry } from "../src/playlist-renderer-pixi/clip-node-registry";
import { COLORS } from "../src/playlist-renderer-pixi/palette";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = 20;

function setup(start: number, duration: number) {
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
        label: "beca",
        color: "#46b871",
      },
    ],
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(1200, 700);
  core.updateViewport({ pxPerBeat: PX, scrollX: 0, scrollY: 0 });
  return core;
}

function titleX(core: ReturnType<typeof setup>, sticky: boolean): { x: number; rectX: number } {
  const registry = createClipNodeRegistry(COLORS, { getClipDetail: () => "+$16,000 /mes" });
  const parent = new Container();
  const views = core.getPresentation().visibleClipViews;
  registry.syncFrame(parent, views, sticky ? M.trackHeaderWidth : undefined);
  const node = parent.children[0] as Container;
  const label = node.children.find((child) => child instanceof Text && child.text === "beca") as Text;
  return { x: node.x + label.x, rectX: views[0]!.rect.x };
}

describe("sticky clip titles", () => {
  it("a clip starting off-screen keeps its title at the timeline's left edge", () => {
    const core = setup(0, 200);
    core.updateViewport({ scrollX: 50 * PX }); // the start is 50 beats to the left
    const { x, rectX } = titleX(core, true);
    expect(rectX).toBeLessThan(M.trackHeaderWidth);
    expect(x).toBeGreaterThanOrEqual(M.trackHeaderWidth);
    expect(x).toBeLessThan(M.trackHeaderWidth + 20);
    // Without sticking it would be off-screen with the clip's start.
    expect(titleX(core, false).x).toBeLessThan(M.trackHeaderWidth);
  });

  it("never slides past the clip's own end (it leaves with the clip)", () => {
    const core = setup(0, 10); // 200 px wide
    core.updateViewport({ scrollX: 9.5 * PX }); // only ~10 px of the clip left on screen
    const { x, rectX } = titleX(core, true);
    expect(x + "beca".length * 7.2).toBeLessThanOrEqual(rectX + 10 * PX);
  });

  it("a clip that starts on screen is untouched", () => {
    const core = setup(5, 50);
    const sticky = titleX(core, true);
    expect(sticky.x).toBe(titleX(core, false).x);
  });
});
