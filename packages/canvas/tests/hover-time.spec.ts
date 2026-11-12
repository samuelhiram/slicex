// Hover-time indicator (PlaylistInteractionOptions.hoverTimeIndicator):
// hovering the timeline columns (ruler, overview lane, rows) keeps the beat
// cell under the pointer in state.hoverTime; the renderer draws a faint
// line there and names the cell on the ruler. It replaces the floating
// time tooltip of the ruler / lane hover (it covered the curve).
import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  screenXToTime,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";
import { drawHoverTime } from "../src/playlist-renderer-pixi/layers/hover-time";

const M = { ...DEFAULT_PLAYLIST_METRICS, overviewLaneHeight: 60 };
const WIDTH = 1200;
const HEIGHT = 700;

type Listener = (event: PointerEvent) => void;

function setup(hoverTimeIndicator = true) {
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
  const core = createPlaylistCore(createDemoPlaylistState(), { metrics: M });
  core.setViewportSize(WIDTH, HEIGHT);
  core.setTool("select");
  createPlaylistInteractionController(host, core, { hoverTimeIndicator });
  const event = (x: number, y: number) =>
    ({
      pointerId: 1,
      button: 0,
      buttons: 0,
      detail: 0,
      timeStamp: 0,
      clientX: x,
      clientY: y,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: "mouse",
      preventDefault() {},
    }) as unknown as PointerEvent;
  const move = (x: number, y: number) => listeners.get("pointermove")!(event(x, y));
  const leave = () => listeners.get("pointerleave")!(event(-1, -1));
  return { core, move, leave };
}

const cellAt = (core: ReturnType<typeof setup>["core"], x: number) =>
  Math.floor(screenXToTime(core.getState(), x, M));

describe("hover-time indicator — the controller", () => {
  it("follows the pointer over the rows, the money lane and the ruler", () => {
    const { core, move } = setup();
    move(600, 400); // a row
    expect(core.getState().hoverTime).toBe(cellAt(core, 600));
    move(800, M.rulerHeight + 20); // the money lane
    expect(core.getState().hoverTime).toBe(cellAt(core, 800));
    move(300, 10); // the ruler
    expect(core.getState().hoverTime).toBe(cellAt(core, 300));
  });

  it("hides over the row names, the scrollbars and when the pointer leaves", () => {
    const { core, move, leave } = setup();
    move(600, 400);
    move(40, 400); // header column
    expect(core.getState().hoverTime).toBeNull();
    move(600, 400);
    move(600, HEIGHT - 4); // horizontal scrollbar
    expect(core.getState().hoverTime).toBeNull();
    move(600, 400);
    leave();
    expect(core.getState().hoverTime).toBeNull();
  });

  it("one notify per cell: moving inside the same cell changes nothing", () => {
    const { core, move } = setup();
    move(600, 400);
    move(599, 400);
    const before = core.getState();
    let notifies = 0;
    const sub = core.subscribe(() => {
      notifies += 1;
    });
    // 1 px to each side, same row, same cell (the demo's cells are wider).
    expect(cellAt(core, 599)).toBe(cellAt(core, 601));
    move(601, 400);
    move(599, 400);
    sub.unsubscribe();
    expect(notifies).toBe(0);
    expect(core.getState()).toBe(before);
  });

  it("with the indicator, hovering the ruler or the lane shows no floating tooltip", () => {
    const { core, move } = setup();
    move(300, 10);
    expect(core.getState().tooltip).toBeNull();
    move(800, M.rulerHeight + 20);
    expect(core.getState().tooltip).toBeNull();
  });

  it("without the option nothing changes: no hoverTime, the ruler tooltip stays", () => {
    const { core, move } = setup(false);
    move(600, 400);
    expect(core.getState().hoverTime ?? null).toBeNull();
    move(300, 10);
    expect(core.getState().tooltip?.kind).toBe("time");
  });

  it("survives unrelated dispatches (the state clone keeps it)", () => {
    const { core, move } = setup();
    move(600, 400);
    const cell = core.getState().hoverTime;
    core.setPlayPosition(3);
    core.setSelection({ clipIds: [], automationPointIds: [] });
    expect(core.getState().hoverTime).toBe(cell);
  });
});

describe("hover-time indicator — the renderer layer", () => {
  it("draws the ruler pill, the line (and the band when the cell is wide); nothing without hoverTime", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { metrics: M });
    core.setViewportSize(WIDTH, HEIGHT);
    const graphics = new Graphics();
    const text = new Container();

    drawHoverTime(graphics, text, core.getPresentation(), "jue 12 nov");
    expect(graphics.context.instructions.length).toBe(0);
    expect(text.children.length).toBe(0);

    core.setHoverTime(4);
    const pxPerBeat = core.getState().viewport.pxPerBeat;
    drawHoverTime(graphics, text, core.getPresentation(), "jue 12 nov");
    // pill + (band if wide) + line, one text
    expect(graphics.context.instructions.length).toBe(pxPerBeat >= 10 ? 3 : 2);
    expect(text.children.length).toBe(1);
  });

  it("a cell scrolled out of the timeline draws nothing", () => {
    const core = createPlaylistCore(createDemoPlaylistState(), { metrics: M });
    core.setViewportSize(WIDTH, HEIGHT);
    core.setHoverTime(100_000);
    const graphics = new Graphics();
    drawHoverTime(graphics, new Container(), core.getPresentation(), "x");
    expect(graphics.context.instructions.length).toBe(0);
  });
});
