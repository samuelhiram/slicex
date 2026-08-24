// F7 (Fase 8) — Eyedropper, rebound in F13 to "hover a clip + press I".
//
// Hovering a clip and pressing I recolours the current selection to that
// clip's color. With nothing selected, the hovered clip recolors to itself
// (a visual no-op, but the intent stays).
//
// F13: the trigger used to be Alt+click, then briefly Alt+Shift+click. Both
// were wrong. Any pointer-modifier binding here returns before the tool
// dispatch, so it swallows an FL drag gesture whole:
//   Alt+drag       = move without snap
//   Shift+drag     = clone
//   Alt+Shift+drag = clone without snap
// Hover+key collides with none of them and is stable in every browser.
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
  extra: { altKey?: boolean; shiftKey?: boolean } = {},
): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    altKey: extra.altKey ?? false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: extra.shiftKey ?? false,
    detail: 1,
    preventDefault() {},
  } as unknown as PointerEvent;
}

function keyEvent(key: string): KeyboardEvent {
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
  } as unknown as KeyboardEvent;
}

function centerOf(core: ReturnType<typeof createPlaylistCore>, clipId: string) {
  const view = core.getPresentation().clipViewsById.get(clipId)!;
  return {
    x: view.bodyRect.x + view.bodyRect.width / 2,
    y: view.bodyRect.y + view.bodyRect.height / 2,
  };
}

describe("F7 — eyedropper (hover + I)", () => {
  it("recolours the whole selection to the hovered clip's colour", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const bassColor = core
      .getState()
      .clips.find((c) => c.id === "clip-bass-1")!.color;
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });

    const { x, y } = centerOf(core, "clip-bass-1");
    listeners.get("pointermove")?.(pointerEvent(x, y));
    listeners.get("keydown")?.(keyEvent("i"));

    const after = core.getState();
    expect(after.clips.find((c) => c.id === "clip-drums-1")!.color).toBe(bassColor);
    expect(after.clips.find((c) => c.id === "clip-drums-2")!.color).toBe(bassColor);
    controller.destroy();
  });

  it("is one undo entry", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const originals = new Map(
      core.getState().clips.map((c) => [c.id, c.color] as const),
    );
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });

    const { x, y } = centerOf(core, "clip-bass-1");
    listeners.get("pointermove")?.(pointerEvent(x, y));
    listeners.get("keydown")?.(keyEvent("i"));
    core.undo();

    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.color).toBe(
      originals.get("clip-drums-1"),
    );
    expect(core.getState().clips.find((c) => c.id === "clip-drums-2")!.color).toBe(
      originals.get("clip-drums-2"),
    );
    controller.destroy();
  });

  it("does nothing when the cursor is not over a clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const before = core.getState().clips.map((c) => c.color);
    core.setSelection({
      clipIds: ["clip-drums-1"],
      automationPointIds: [],
    });

    // Far below the last demo clip: empty canvas.
    listeners.get("pointermove")?.(pointerEvent(900, 640));
    listeners.get("keydown")?.(keyEvent("i"));

    expect(core.getState().clips.map((c) => c.color)).toEqual(before);
    controller.destroy();
  });

  // F13 regressions: the three drag gestures the old bindings used to eat.
  it("bare Alt+drag moves the clip without snapping and keeps its colour", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setSnapMode("beat");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const before = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    const startBeats = before.start;
    const originalColor = before.color;
    const { x, y } = centerOf(core, "clip-drums-1");
    const px = core.getState().viewport.pxPerBeat;

    listeners.get("pointerdown")?.(pointerEvent(x, y, { altKey: true }));
    listeners.get("pointermove")?.(pointerEvent(x + 2.5 * px, y, { altKey: true }));
    listeners.get("pointerup")?.(pointerEvent(x + 2.5 * px, y, { altKey: true }));

    const after = core.getState().clips.find((c) => c.id === "clip-drums-1")!;
    expect(after.start).toBeCloseTo(startBeats + 2.5, 4);
    expect(after.color).toBe(originalColor);
    controller.destroy();
  });

  it("Alt+Shift+drag still clones (clone without snap), it is not swallowed", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setSnapMode("beat");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    core.setSelection({
      clipIds: ["clip-drums-1"],
      automationPointIds: [],
    });
    const clipCountBefore = core.getState().clips.length;
    const { x, y } = centerOf(core, "clip-drums-1");
    const px = core.getState().viewport.pxPerBeat;
    const mods = { altKey: true, shiftKey: true };

    listeners.get("pointerdown")?.(pointerEvent(x, y, mods));
    listeners.get("pointermove")?.(pointerEvent(x + 3 * px, y, mods));
    listeners.get("pointerup")?.(pointerEvent(x + 3 * px, y, mods));

    expect(core.getState().clips.length).toBe(clipCountBefore + 1);
    controller.destroy();
    void M;
  });
});
