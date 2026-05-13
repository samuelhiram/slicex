// F7 (Fase 8) — Eyedropper (Alt+click on a clip).
//
// Alt+click on a clip recolours the current selection to the clicked
// clip's color. When nothing is selected, the clicked clip recolors to
// itself (a no-op visually, but the intent stays — and the implementation
// keeps the modifier paths cleanly separated from snap-bypass).
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

function createHost() {
  const listeners = new Map<string, (event: Event) => void>();
  const host = {
    style: { cursor: "" } as Record<string, string>,
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    },
    addEventListener(type: string, listener: (event: Event) => void) {
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

function pointerEvent(
  x: number,
  y: number,
  extra: { altKey?: boolean } = {},
): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    altKey: extra.altKey ?? false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    detail: 1,
    preventDefault() {},
  } as unknown as PointerEvent;
}

describe("F7 — eyedropper", () => {
  it("Alt+click on a clip with a multi-clip selection recolours all of them", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // Target clip (the one being clicked) — we'll use the bass clip's
    // colour. Selected clips are the drum clips.
    const bassColor = core
      .getState()
      .clips.find((c) => c.id === "clip-bass-1")!.color;
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    const view = core.getPresentation().clipViewsById.get("clip-bass-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(pointerEvent(cx, cy, { altKey: true }));
    const after = core.getState();
    expect(after.clips.find((c) => c.id === "clip-drums-1")!.color).toBe(bassColor);
    expect(after.clips.find((c) => c.id === "clip-drums-2")!.color).toBe(bassColor);
    controller.destroy();
  });

  it("Alt+click does not start a drag on the clicked clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    const startBeats = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    listeners.get("pointerdown")?.(pointerEvent(cx, cy, { altKey: true }));
    listeners.get("pointermove")?.(pointerEvent(cx + 200, cy, { altKey: true }));
    listeners.get("pointerup")?.(pointerEvent(cx + 200, cy, { altKey: true }));
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(
      startBeats,
    );
    controller.destroy();
    void M;
  });

  it("Alt+click on ruler still bypasses snap (no eyedropper interference)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setSnapMode("beat");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // Click on the ruler with Alt at a non-integer beat. Snap is "beat",
    // so without Alt the playhead would land at the nearest integer; with
    // Alt it should land exactly where clicked.
    const px = core.getState().viewport.pxPerBeat;
    const rulerY = 6;
    const x = M.trackHeaderWidth + 3.75 * px;
    listeners.get("pointerdown")?.(pointerEvent(x, rulerY, { altKey: true }));
    listeners.get("pointerup")?.(pointerEvent(x, rulerY, { altKey: true }));
    expect(core.getState().playPosition.time).toBeCloseTo(3.75, 4);
    controller.destroy();
  });
});
