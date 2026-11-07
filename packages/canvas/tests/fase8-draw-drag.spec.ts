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
  timeStamp = 0,
): PointerEvent {
  return {
    timeStamp,
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
  // Modern Chromium reports PointerEvent.detail === 0 on pointerdown, so the
  // controller counts presses itself (time + distance window).
  it("double-click with detail 0 (Chromium) still opens the clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners, dispatched } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(pointerEvent(cx, cy, 0, 1000));
    listeners.get("pointerup")?.(pointerEvent(cx, cy, 0, 1060));
    listeners.get("pointerdown")?.(pointerEvent(cx + 2, cy, 0, 1200));
    controller.destroy();
    const opens = dispatched.filter((e) => e.type === "playlist-clip-open");
    expect(opens.length).toBe(1);
  });

  it("two slow presses with detail 0 are not a double-click", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners, dispatched } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(pointerEvent(cx, cy, 0, 1000));
    listeners.get("pointerup")?.(pointerEvent(cx, cy, 0, 1060));
    listeners.get("pointerdown")?.(pointerEvent(cx, cy, 0, 2000));
    controller.destroy();
    expect(dispatched.some((e) => e.type === "playlist-clip-open")).toBe(false);
  });

  it("draw tool: double-click with detail 0 on empty creates a clip", () => {
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
    listeners.get("pointerdown")?.(pointerEvent(x, y, 0, 1000));
    listeners.get("pointerup")?.(pointerEvent(x, y, 0, 1050));
    listeners.get("pointerdown")?.(pointerEvent(x, y, 0, 1150));
    listeners.get("pointerup")?.(pointerEvent(x, y, 0, 1200));
    controller.destroy();
    expect(core.getState().clips.length).toBe(before + 1);
  });
});

// canvas-dblclick-hijacks-tools: "open on double-click" belongs to Select,
// Draw and Paint only. Zoom / Mute / Slip act on every press, so the second
// press of a quick pair must reach the tool. Presses use detail 0 (Chromium)
// so the controller's own counter decides.
describe("double-click open is limited to select / draw / paint", () => {
  function setup(tool: Parameters<ReturnType<typeof createPlaylistCore>["setTool"]>[0]) {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool(tool);
    const { host, listeners, dispatched } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const centre = (clipId: string) => {
      const view = core.getPresentation().clipViewsById.get(clipId)!;
      return {
        x: view.bodyRect.x + view.bodyRect.width / 2,
        y: view.bodyRect.y + view.bodyRect.height / 2,
      };
    };
    const opens = () =>
      dispatched.filter((e) => e.type === "playlist-clip-open").length;
    return { core, listeners, controller, centre, opens };
  }

  it("zoom tool: three quick clicks on a clip zoom three times, no open", () => {
    const { core, listeners, controller, centre, opens } = setup("zoom");
    const start = core.getState().viewport.pxPerBeat;
    for (const t of [1000, 1200, 1400]) {
      // Zoom anchors at the cursor, so the pointer stays over the same clip.
      const p = centre("clip-drums-1");
      listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, t));
      listeners.get("pointerup")?.(pointerEvent(p.x, p.y, 0, t + 40));
    }
    controller.destroy();
    expect(core.getState().viewport.pxPerBeat).toBeCloseTo(start * 1.5 ** 3, 6);
    expect(opens()).toBe(0);
  });

  it("mute tool: two quick clicks mute then unmute, no open", () => {
    const { core, listeners, controller, centre, opens } = setup("mute");
    const p = centre("clip-drums-1");
    listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1000));
    listeners.get("pointerup")?.(pointerEvent(p.x, p.y, 0, 1040));
    const mutedAfterFirst = core
      .getState()
      .clips.find((c) => c.id === "clip-drums-1")!.muted;
    listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1250));
    listeners.get("pointerup")?.(pointerEvent(p.x, p.y, 0, 1290));
    controller.destroy();
    expect(mutedAfterFirst).toBe(true);
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")!.muted,
    ).not.toBe(true);
    expect(opens()).toBe(0);
  });

  it("slip tool: two quick 3px nudges both apply, no open", () => {
    const { core, listeners, controller, centre, opens } = setup("slip");
    const offset = () =>
      core.getState().clips.find((c) => c.id === "clip-chords-1")!
        .contentOffset ?? 0;
    const p = centre("clip-chords-1");
    listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1000));
    listeners.get("pointermove")?.(pointerEvent(p.x + 3, p.y, 0, 1050));
    listeners.get("pointerup")?.(pointerEvent(p.x + 3, p.y, 0, 1100));
    const afterFirst = offset();
    listeners.get("pointerdown")?.(pointerEvent(p.x + 3, p.y, 0, 1300));
    listeners.get("pointermove")?.(pointerEvent(p.x + 6, p.y, 0, 1350));
    listeners.get("pointerup")?.(pointerEvent(p.x + 6, p.y, 0, 1400));
    controller.destroy();
    expect(afterFirst).not.toBe(0);
    expect(offset()).toBeCloseTo(2 * afterFirst, 9);
    expect(opens()).toBe(0);
  });

  it("select tool: a press that dragged past the slop is not the first half of a double-click", () => {
    const { core, listeners, controller, centre, opens } = setup("select");
    core.setSnapMode("none");
    const p = centre("clip-drums-1");
    // Press, drag 20px away and back, release where it started.
    listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1000));
    listeners.get("pointermove")?.(pointerEvent(p.x + 20, p.y, 0, 1050));
    listeners.get("pointermove")?.(pointerEvent(p.x, p.y, 0, 1100));
    listeners.get("pointerup")?.(pointerEvent(p.x, p.y, 0, 1150));
    // Second press inside the time + distance window.
    listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1300));
    listeners.get("pointerup")?.(pointerEvent(p.x, p.y, 0, 1340));
    expect(opens()).toBe(0);
    // A genuine double-click right after still opens.
    listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1450));
    controller.destroy();
    expect(opens()).toBe(1);
  });

  it("draw and paint tools still open on a double-click", () => {
    for (const tool of ["draw", "paint"] as const) {
      const { listeners, controller, centre, opens } = setup(tool);
      const p = centre("clip-drums-1");
      listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1000));
      listeners.get("pointerup")?.(pointerEvent(p.x, p.y, 0, 1040));
      listeners.get("pointerdown")?.(pointerEvent(p.x, p.y, 0, 1200));
      controller.destroy();
      expect(opens()).toBe(1);
    }
  });
});
