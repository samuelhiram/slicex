// What the mouse wheel scrolls (PlaylistInteractionOptions.mouseWheel):
// "time" (default, FL parity) or "rows" (like any document).
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getHorizontalScrollbarRect,
  getVerticalScrollbarRect,
  type PlaylistMetrics,
} from "../src/playlist-core";
import {
  createPlaylistInteractionController,
  type PlaylistInteractionOptions,
} from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

function setup(options: PlaylistInteractionOptions = {}, metrics: PlaylistMetrics = M) {
  const listeners = new Map<string, (event: WheelEvent) => void>();
  const host = {
    style: { cursor: "" } as Record<string, string>,
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    },
    addEventListener(type: string, listener: (event: WheelEvent) => void) {
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
  } as unknown as HTMLElement;
  const core = createPlaylistCore(createDemoPlaylistState(), { metrics });
  core.setViewportSize(1200, 700);
  core.updateViewport({ scrollX: 0, scrollY: 0 });
  const controller = createPlaylistInteractionController(host, core, options);
  // One notch of a Windows mouse wheel (120 px, pixel mode).
  const wheel = (x: number, y: number, mods: { shiftKey?: boolean; deltaX?: number } = {}) =>
    listeners.get("wheel")!({
      clientX: x,
      clientY: y,
      deltaX: mods.deltaX ?? 0,
      deltaY: mods.deltaX ? 0 : 120,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: mods.shiftKey ?? false,
      altKey: false,
      timeStamp: 0,
      preventDefault() {},
    } as unknown as WheelEvent);
  const scroll = () => {
    const { scrollX, scrollY } = core.getState().viewport;
    return { x: scrollX, y: scrollY };
  };
  return { core, controller, wheel, scroll };
}

const overRows = { x: M.trackHeaderWidth + 300, y: M.rulerHeight + 200 };

describe('mouseWheel: "rows" — the wheel scrolls the rows, like any document', () => {
  it("a plain notch over the rows moves them, not time", () => {
    const { controller, wheel, scroll } = setup({ mouseWheel: "rows" });
    wheel(overRows.x, overRows.y);
    controller.destroy();
    expect(scroll().y).toBeGreaterThan(0);
    expect(scroll().x).toBe(0);
  });

  it("Shift + wheel moves time (whether it arrives as deltaY or as deltaX)", () => {
    const a = setup({ mouseWheel: "rows" });
    a.wheel(overRows.x, overRows.y, { shiftKey: true });
    a.controller.destroy();
    expect(a.scroll().x).toBeGreaterThan(0);
    expect(a.scroll().y).toBe(0);
    const b = setup({ mouseWheel: "rows" });
    b.wheel(overRows.x, overRows.y, { shiftKey: true, deltaX: 120 });
    b.controller.destroy();
    expect(b.scroll().x).toBeGreaterThan(0);
    expect(b.scroll().y).toBe(0);
  });

  it("over the ruler (which never scrolls vertically) the wheel moves time", () => {
    const { controller, wheel, scroll } = setup({ mouseWheel: "rows" });
    wheel(overRows.x, M.rulerHeight / 2);
    controller.destroy();
    expect(scroll().x).toBeGreaterThan(0);
    expect(scroll().y).toBe(0);
  });
});

describe("the horizontal scrollbar (the navigator): thicker, and the wheel over it moves time", () => {
  const THICK: PlaylistMetrics = { ...M, horizontalScrollbarHeight: 28 };

  it("horizontalScrollbarHeight thickens only the horizontal bar", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { metrics: THICK });
    core.setViewportSize(1200, 700);
    const state = core.getState();
    expect(getHorizontalScrollbarRect(state, THICK)).toMatchObject({ y: 700 - 28, height: 28 });
    expect(getVerticalScrollbarRect(state, THICK).width).toBe(M.scrollbarSize);
    // Without it, both are scrollbarSize (as before).
    expect(getHorizontalScrollbarRect(state, M).height).toBe(M.scrollbarSize);
  });

  it('"rows": a notch over the horizontal bar moves time, not the rows', () => {
    const { controller, wheel, scroll } = setup({ mouseWheel: "rows" }, THICK);
    wheel(overRows.x, 700 - 14);
    controller.destroy();
    expect(scroll().x).toBeGreaterThan(0);
    expect(scroll().y).toBe(0);
  });
});

describe('mouseWheel: "time" (default, FL parity)', () => {
  it("a plain notch moves time", () => {
    const { controller, wheel, scroll } = setup();
    wheel(overRows.x, overRows.y);
    controller.destroy();
    expect(scroll().x).toBeGreaterThan(0);
    expect(scroll().y).toBe(0);
  });
});
