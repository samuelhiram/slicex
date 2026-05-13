// F8 (Fase 8) — Touch refinement.
//
// Validates pinch zoom, long-press → context menu, scroll inertia. We
// drive the controller directly via its registered event listeners and
// fake `performance.now()` advances inside vitest using fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function touchEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  x: number,
  y: number,
  button = 0,
): PointerEvent {
  void type;
  return {
    pointerId,
    pointerType: "touch",
    button,
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    detail: 1,
    preventDefault() {},
  } as unknown as PointerEvent;
}

describe("F8 — pinch zoom", () => {
  it("two-finger pinch out increases pxPerBeat and rescrolls to keep the anchor stable", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const initialPx = core.getState().viewport.pxPerBeat;
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // Two fingers 100px apart, centred around x=600.
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 1, 550, 300));
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 2, 650, 300));
    // Spread them to 200px apart — distance doubles, expected pxPerBeat × 2
    // (clamped to maxPxPerBeat).
    listeners.get("pointermove")?.(touchEvent("pointermove", 1, 500, 300));
    listeners.get("pointermove")?.(touchEvent("pointermove", 2, 700, 300));
    const after = core.getState().viewport;
    const expected = Math.min(M.maxPxPerBeat, initialPx * 2);
    expect(after.pxPerBeat).toBeCloseTo(expected, 4);
    // Release both fingers.
    listeners.get("pointerup")?.(touchEvent("pointerup", 1, 500, 300));
    listeners.get("pointerup")?.(touchEvent("pointerup", 2, 700, 300));
    controller.destroy();
  });

  it("two-finger pinch in clamps at minPxPerBeat", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 1, 500, 300));
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 2, 700, 300));
    // Collapse to nearly zero — pxPerBeat should clamp at the floor.
    listeners.get("pointermove")?.(touchEvent("pointermove", 1, 599, 300));
    listeners.get("pointermove")?.(touchEvent("pointermove", 2, 601, 300));
    expect(core.getState().viewport.pxPerBeat).toBe(M.minPxPerBeat);
    listeners.get("pointerup")?.(touchEvent("pointerup", 1, 599, 300));
    listeners.get("pointerup")?.(touchEvent("pointerup", 2, 601, 300));
    controller.destroy();
  });
});

describe("F8 — long-press → context menu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holding a touch on a clip for 500ms opens the clip context menu", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 1, cx, cy));
    expect(core.getState().contextMenu).toBeNull();
    vi.advanceTimersByTime(550);
    const menu = core.getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.kind).toBe("clip");
    listeners.get("pointerup")?.(touchEvent("pointerup", 1, cx, cy));
    controller.destroy();
  });

  it("moving the touch beyond the threshold cancels the long-press", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 1, cx, cy));
    listeners.get("pointermove")?.(touchEvent("pointermove", 1, cx + 20, cy));
    vi.advanceTimersByTime(700);
    expect(core.getState().contextMenu).toBeNull();
    listeners.get("pointerup")?.(touchEvent("pointerup", 1, cx + 20, cy));
    controller.destroy();
  });
});

describe("F8 — pointercancel hygiene", () => {
  it("pointercancel cleans the tracker without throwing", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    listeners.get("pointerdown")?.(touchEvent("pointerdown", 1, 600, 300));
    expect(() => {
      listeners.get("pointercancel")?.(touchEvent("pointercancel", 1, 600, 300));
    }).not.toThrow();
    controller.destroy();
  });
});
