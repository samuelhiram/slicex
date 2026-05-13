// F4 (Fase 8) — Draw tool: drag-to-create and double-click bridge.
//
// Validates:
//   - Draw tool single click + drag past minClipDuration creates one clip
//     whose right edge tracks the cursor.
//   - Draw tool double-click on empty creates a default-duration clip
//     without starting a gesture.
//   - Double-click on an existing clip dispatches `playlist-clip-open`
//     instead of starting a drag.
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
  const dispatched: CustomEvent[] = [];
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
    dispatchEvent(event: Event) {
      dispatched.push(event as CustomEvent);
      return true;
    },
  };
  return { host: host as unknown as HTMLElement, listeners, dispatched };
}

function pointerEvent(
  x: number,
  y: number,
  detail = 1,
): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    detail,
    preventDefault() {},
  } as unknown as PointerEvent;
}

describe("F4 — draw tool drag-to-create", () => {
  it("micro-drag below minClipDuration creates no clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("draw");
    core.setSnapMode("none");
    const before = core.getState().clips.length;
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // Drop pointer in an empty area far below existing demo clips, x in
    // the timeline panel.
    const x0 = M.trackHeaderWidth + 200;
    const y = M.rulerHeight + 14 * M.trackHeight; // virtual track far down
    listeners.get("pointerdown")?.(pointerEvent(x0, y));
    // Move just 1 pixel — well below minClipDuration's screen width.
    listeners.get("pointermove")?.(pointerEvent(x0 + 1, y));
    listeners.get("pointerup")?.(pointerEvent(x0 + 1, y));
    controller.destroy();
    expect(core.getState().clips.length).toBe(before);
  });

  it("drag past minClipDuration creates exactly one clip sized to the drag", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("draw");
    core.setSnapMode("none");
    const before = core.getState().clips.length;
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const px = core.getState().viewport.pxPerBeat;
    const x0 = M.trackHeaderWidth + 8 * px;
    const x1 = M.trackHeaderWidth + 14 * px; // +6 beats
    const y = M.rulerHeight + 14 * M.trackHeight;
    listeners.get("pointerdown")?.(pointerEvent(x0, y));
    listeners.get("pointermove")?.(pointerEvent(x1, y));
    listeners.get("pointerup")?.(pointerEvent(x1, y));
    controller.destroy();
    const created = core.getState().clips.length - before;
    expect(created).toBe(1);
    const newClip = core
      .getState()
      .clips[core.getState().clips.length - 1]!;
    expect(newClip.start).toBeCloseTo(8, 6);
    expect(newClip.duration).toBeCloseTo(6, 1);
  });

  it("double-click on empty creates a default-sized clip and no gesture", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("draw");
    core.setSnapMode("none");
    const before = core.getState().clips.length;
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const px = core.getState().viewport.pxPerBeat;
    const x = M.trackHeaderWidth + 8 * px;
    const y = M.rulerHeight + 14 * M.trackHeight;
    listeners.get("pointerdown")?.(pointerEvent(x, y, 2));
    controller.destroy();
    expect(core.getState().clips.length).toBe(before + 1);
  });

  it("double-click on an existing clip dispatches playlist-clip-open", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners, dispatched } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(pointerEvent(cx, cy, 2));
    controller.destroy();
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]!.type).toBe("playlist-clip-open");
    expect(
      (dispatched[0] as CustomEvent<{ clipId: string }>).detail.clipId,
    ).toBe("clip-drums-1");
  });
});
