import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

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

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): PointerEvent {
  void type;
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

describe("PlaylistInteractionController", () => {
  it("Slice drag cuts at the release/current x, not the initial x", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("slice");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const y = M.rulerHeight + 6 * M.trackHeight + 10;
    const x4 = M.trackHeaderWidth + 4 * core.getState().viewport.pxPerBeat;
    const x8 = M.trackHeaderWidth + 8 * core.getState().viewport.pxPerBeat;

    listeners.get("pointerdown")?.(pointerEvent("pointerdown", x4, y));
    listeners.get("pointermove")?.(pointerEvent("pointermove", x8, y));
    listeners.get("pointerup")?.(pointerEvent("pointerup", x8, y));
    controller.destroy();

    const drums = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    expect(drums.duration).toBe(8);
  });

  it("Delete drag sweeps every clip crossed by a fast move", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("delete");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const px = core.getState().viewport.pxPerBeat;
    const xDrums = M.trackHeaderWidth + 1 * px;
    const yDrums = M.rulerHeight + 10;
    const xBass = M.trackHeaderWidth + 6 * px;
    const yBass = M.rulerHeight + M.trackHeight + 10;

    listeners.get("pointerdown")?.(pointerEvent("pointerdown", xDrums, yDrums));
    listeners.get("pointermove")?.(pointerEvent("pointermove", xBass, yBass));
    listeners.get("pointerup")?.(pointerEvent("pointerup", xBass, yBass));
    controller.destroy();

    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")).toBeUndefined();
    expect(core.getState().clips.find((c) => c.id === "clip-bass-1")).toBeUndefined();
  });

  it("Mute drag applies one target mute state to every crossed clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("mute");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const px = core.getState().viewport.pxPerBeat;
    const xDrums = M.trackHeaderWidth + 1 * px;
    const yDrums = M.rulerHeight + 10;
    const xBass = M.trackHeaderWidth + 6 * px;
    const yBass = M.rulerHeight + M.trackHeight + 10;

    listeners.get("pointerdown")?.(pointerEvent("pointerdown", xDrums, yDrums));
    listeners.get("pointermove")?.(pointerEvent("pointermove", xBass, yBass));
    listeners.get("pointerup")?.(pointerEvent("pointerup", xBass, yBass));
    controller.destroy();

    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")?.muted).toBe(true);
    expect(core.getState().clips.find((c) => c.id === "clip-bass-1")?.muted).toBe(true);
  });
});
