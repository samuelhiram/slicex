// The marquee is anchored to the TIMELINE, not the screen (2026-11-20): its
// corner stays on the day and row where the press was while the view
// scrolls (the wheel with the button held, a glide, the edge auto-scroll),
// so one drag can select from the top of the year to the bottom, side to
// side. Clips scrolled out of view stay selected while the rect covers them.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getTracksTop,
  type PlaylistClip,
  type PlaylistState,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

type Listener = (event: PointerEvent & WheelEvent) => void;

function setup() {
  const base = createDemoPlaylistState();
  const tracks = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, label: `T${i}`, color: "#888888" }));
  const clip = (id: string, trackId: string, start: number): PlaylistClip => ({
    id,
    type: "pattern",
    trackId,
    start,
    duration: 4,
    label: id,
    color: "#46b871",
  });
  const state: PlaylistState = {
    ...base,
    tracks,
    // "top" near the press, "deep" far below it, "late" past the rect's days.
    clips: [clip("top", "t1", 6), clip("deep", "t30", 6), clip("late", "t20", 60)],
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(1200, 700);
  core.updateViewport({ scrollX: 0, scrollY: 0 });
  const listeners = new Map<string, Listener>();
  const host = {
    style: { cursor: "" } as Record<string, string>,
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
    dispatchEvent() {
      return true;
    },
  } as unknown as HTMLElement;
  const controller = createPlaylistInteractionController(host, core, { mouseWheel: "rows" });
  const pointer = (type: string, x: number, y: number) =>
    listeners.get(type)!({
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      detail: 1,
      timeStamp: 0,
      clientX: x,
      clientY: y,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
    } as unknown as PointerEvent & WheelEvent);
  const wheel = (x: number, y: number) =>
    listeners.get("wheel")!({
      clientX: x,
      clientY: y,
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      timeStamp: 0,
      preventDefault() {},
    } as unknown as PointerEvent & WheelEvent);
  return { core, controller, pointer, wheel };
}

describe("the marquee keeps its corner on the timeline while the view scrolls", () => {
  it("the wheel with the button held: the corner rides up with its row; it selects what it swept, in view or not", () => {
    const { core, controller, pointer, wheel } = setup();
    const px = core.getState().viewport.pxPerBeat;
    const top = getTracksTop(M);
    // Press on the empty first row, 2 beats in; drag down-right.
    const press = { x: M.trackHeaderWidth + 2 * px, y: top + 5 };
    const at = { x: M.trackHeaderWidth + 12 * px, y: 600 };
    pointer("pointerdown", press.x, press.y);
    pointer("pointermove", at.x, at.y);
    expect(core.getState().marquee!.start).toEqual(press);
    expect(core.getState().selection.clipIds).toEqual(["top"]);

    // Scroll the rows down, the button still held, the pointer still.
    for (let i = 0; i < 40 && core.getState().viewport.scrollY < 1900; i += 1) wheel(at.x, at.y);
    const scrollY = core.getState().viewport.scrollY;
    expect(scrollY).toBeGreaterThan(1500);
    // The corner went up with its row (off screen now); the other corner
    // stays under the pointer.
    expect(core.getState().marquee!.start).toEqual({ x: press.x, y: press.y - scrollY });
    expect(core.getState().marquee!.current).toEqual(at);
    // "top" is out of view (not even in the overscan) yet still selected;
    // "deep" came in; "late" lies past the rect's days.
    expect(core.getPresentation().clipViewsById.has("top")).toBe(false);
    expect([...core.getState().selection.clipIds].sort()).toEqual(["deep", "top"]);

    pointer("pointerup", at.x, at.y);
    expect(core.getState().marquee).toBeNull();
    expect([...core.getState().selection.clipIds].sort()).toEqual(["deep", "top"]);
    controller.destroy();
  });

  it("a zoom during the drag keeps the corner on its day", () => {
    const { core, controller, pointer } = setup();
    const px = core.getState().viewport.pxPerBeat;
    const top = getTracksTop(M);
    pointer("pointerdown", M.trackHeaderWidth + 2 * px, top + 5);
    pointer("pointermove", M.trackHeaderWidth + 12 * px, 400);
    core.updateViewport({ pxPerBeat: px * 2 });
    pointer("pointermove", M.trackHeaderWidth + 12 * px, 400);
    // Beat 2 at the doubled zoom.
    expect(core.getState().marquee!.start.x).toBeCloseTo(M.trackHeaderWidth + 2 * px * 2, 6);
    pointer("pointerup", M.trackHeaderWidth + 12 * px, 400);
    controller.destroy();
  });
});
