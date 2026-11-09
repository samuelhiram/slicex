// The right button opens a context menu wherever it is pressed: the thin
// track chrome (the full-width row divisor, the mute / solo / lock buttons,
// the reorder grip) never swallows it silently.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
} from "../src/playlist-core";
import {
  createPlaylistInteractionController,
  hitTestPlaylist,
} from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const WIDTH = 1200;
const HEIGHT = 700;

type Listener = (event: PointerEvent) => void;

function setup() {
  const listeners = new Map<string, Listener>();
  const host = {
    style: {},
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatchEvent: () => true,
  } as unknown as HTMLElement;
  const core = createPlaylistCore({ ...createDemoPlaylistState(), clips: [] }, { metrics: M });
  core.setViewportSize(WIDTH, HEIGHT);
  core.setTool("select");
  createPlaylistInteractionController(host, core);
  const press = (x: number, y: number, button: number) =>
    listeners.get("pointerdown")!({
      pointerId: 1,
      button,
      detail: 1,
      timeStamp: 0,
      clientX: x,
      clientY: y,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: "mouse",
      preventDefault() {},
    } as unknown as PointerEvent);
  return { core, press };
}

function divisorPoint(core: ReturnType<typeof setup>["core"], x: number) {
  const row = core.getPresentation().trackRows[1]!;
  const r = row.resizeHandleRect;
  return { x, y: r.y + r.height / 2 };
}

describe("right button on the track chrome", () => {
  it("the row divisor is still the resize handle for the left button", () => {
    const { core } = setup();
    const p = divisorPoint(core, 600);
    expect(hitTestPlaylist(core.getPresentation(), p, M).kind).toBe("track-resize-handle");
  });

  it("on the divisor over the timeline: the background menu opens", () => {
    const { core, press } = setup();
    const p = divisorPoint(core, 600);
    press(p.x, p.y, 2);
    expect(core.getState().contextMenu?.kind).toBe("background");
  });

  it("on the divisor over the row names: the track menu opens", () => {
    const { core, press } = setup();
    const p = divisorPoint(core, 40);
    press(p.x, p.y, 2);
    expect(core.getState().contextMenu?.kind).toBe("track");
  });

  it("on a row's mute button: the track menu opens", () => {
    const { core, press } = setup();
    const mute = core.getPresentation().trackRows[0]!.buttons.mute;
    press(mute.x + mute.width / 2, mute.y + mute.height / 2, 2);
    expect(core.getState().contextMenu).toMatchObject({ kind: "track", trackIndex: 0 });
  });
});
