// onClipTap — a quick click on a clip (press + release, no travel, no
// modifier, ≤ CLIP_TAP_MAX_MS) is reported to the host with the beat under
// the pointer; press-and-drag still moves the clip and reports nothing.
import { describe, expect, it } from "vitest";
import { createDemoPlaylistState, createPlaylistCore, screenXToTime, type PlaylistCore } from "../src/playlist-core";
import {
  CLIP_TAP_MAX_MS,
  createPlaylistInteractionController,
  hitTestPlaylist,
  type PlaylistClipTapEvent,
} from "../src/playlist-interaction";

const screenXToTimeForTest = (core: PlaylistCore, x: number): number =>
  screenXToTime(core.getState(), x, core.metrics);

type Listener = (event: PointerEvent) => void;

function createHost() {
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
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointer(x: number, y: number, timeStamp: number, extra: Partial<PointerEvent> = {}): PointerEvent {
  return {
    timeStamp,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    detail: 1,
    preventDefault() {},
    ...extra,
  } as unknown as PointerEvent;
}

function setup() {
  const core = createPlaylistCore(createDemoPlaylistState());
  core.setViewportSize(1200, 700);
  const { host, listeners } = createHost();
  const taps: PlaylistClipTapEvent[] = [];
  const controller = createPlaylistInteractionController(host, core, { onClipTap: (e) => taps.push(e) });
  const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
  const x = view.bodyRect.x + view.bodyRect.width / 3;
  const y = view.bodyRect.y + view.bodyRect.height / 2;
  return { core, listeners, taps, controller, x, y };
}

describe("onClipTap", () => {
  it("a quick click reports the clip and the beat under the pointer, and selects it", () => {
    const { core, listeners, taps, controller, x, y } = setup();
    const before = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    listeners.get("pointerdown")?.(pointer(x, y, 1000));
    listeners.get("pointerup")?.(pointer(x + 1, y, 1100));
    controller.destroy();
    expect(taps).toHaveLength(1);
    expect(taps[0]!.clipId).toBe("clip-drums-1");
    expect(taps[0]!.time).toBeCloseTo(screenXToTimeForTest(core, x + 1), 6);
    expect(core.getState().selection.clipIds).toEqual(["clip-drums-1"]);
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(before);
  });

  it("a drag moves the clip and is not a tap", () => {
    const { core, listeners, taps, controller, x, y } = setup();
    const before = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    listeners.get("pointerdown")?.(pointer(x, y, 1000));
    listeners.get("pointermove")?.(pointer(x + 80, y, 1050));
    listeners.get("pointerup")?.(pointer(x + 80, y, 1100));
    controller.destroy();
    expect(taps).toHaveLength(0);
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).not.toBe(before);
  });

  it("press and hold (longer than the tap window) is not a tap", () => {
    const { listeners, taps, controller, x, y } = setup();
    listeners.get("pointerdown")?.(pointer(x, y, 1000));
    listeners.get("pointerup")?.(pointer(x, y, 1000 + CLIP_TAP_MAX_MS + 50));
    controller.destroy();
    expect(taps).toHaveLength(0);
  });

  it("a click with a modifier is not a tap", () => {
    const { listeners, taps, controller, x, y } = setup();
    listeners.get("pointerdown")?.(pointer(x, y, 1000, { altKey: true }));
    listeners.get("pointerup")?.(pointer(x, y, 1050, { altKey: true }));
    controller.destroy();
    expect(taps).toHaveLength(0);
  });
});

describe("the view moving under a resting pointer", () => {
  it("a wheel scroll re-reads what the pointer is over: the hovered clip and the hover day follow the content", () => {
    const base = createDemoPlaylistState();
    const trackId = base.tracks[0]!.id;
    const clip = (id: string, start: number) => ({
      id,
      type: "pattern" as const,
      trackId,
      start,
      duration: 4,
      label: id,
      color: "#46b871",
    });
    const core = createPlaylistCore({ ...base, clips: [clip("a", 0), clip("b", 20)], markers: [] });
    core.setViewportSize(1200, 700);
    core.updateViewport({ pxPerBeat: 20, scrollX: 0, scrollY: 0 });
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, { hoverTimeIndicator: true });
    const view = core.getPresentation().clipViewsById.get("a")!;
    const x = view.bodyRect.x + view.bodyRect.width / 2;
    const y = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointermove")?.(pointer(x, y, 1000));
    expect(core.getState().hover).toEqual({ kind: "clip", clipId: "a" });
    expect(core.getState().hoverTime).toBe(2);
    // A trackpad swipe (fractional delta, applied at once): 20 beats right.
    listeners.get("wheel")?.({
      ...pointer(x, y, 1100),
      deltaX: 399.5,
      deltaY: 0,
      deltaMode: 0,
    } as unknown as PointerEvent);
    controller.destroy();
    expect(core.getState().viewport.scrollX).toBeCloseTo(399.5, 6);
    expect(core.getState().hover).toEqual({ kind: "clip", clipId: "b" });
    expect(core.getState().hoverTime).toBe(21);
  });
});
