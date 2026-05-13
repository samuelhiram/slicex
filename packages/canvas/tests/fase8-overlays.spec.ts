// F3 (Fase 8) — Overlay drawers + controller wiring.
//
// Validates:
//   - The presentation correctly projects state.snapHint/dragPreview/tooltip
//     into snapIndicatorX / dragPreviewView / tooltipView for the renderer.
//   - The controller emits SET_SNAP_HINT / SET_DRAG_PREVIEW / SET_TOOLTIP
//     during clip-drag / clip-resize / play-position-drag / marker-drag,
//     and clears all three on pointer release.
//   - Hovering the ruler emits a B.B.T tooltip; hovering elsewhere clears it.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  formatBarBeat,
  type PlaylistState,
} from "../src/playlist-core";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

function viewportState(overrides: Partial<PlaylistState["viewport"]> = {}): PlaylistState {
  const base = createDemoPlaylistState();
  return {
    ...base,
    viewport: {
      ...base.viewport,
      width: 1200,
      height: 700,
      ...overrides,
    },
  };
}

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
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  extra: { altKey?: boolean; button?: number } = {},
): PointerEvent {
  void type;
  return {
    pointerId: 1,
    button: extra.button ?? 0,
    clientX: x,
    clientY: y,
    altKey: extra.altKey ?? false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
  } as unknown as PointerEvent;
}

describe("F3 — presentation projects overlay views", () => {
  it("snapIndicatorX is null when snap is off / hint hidden", () => {
    const p = createPlaylistPresentation(
      {
        ...viewportState(),
        snapHint: { time: 10, visible: false },
      },
      M,
    );
    expect(p.snapIndicatorX).toBeNull();
  });

  it("snapIndicatorX projects beat to screen X when visible", () => {
    const p = createPlaylistPresentation(
      {
        ...viewportState({ pxPerBeat: 25 }),
        snapHint: { time: 4, visible: true },
      },
      M,
    );
    expect(p.snapIndicatorX).toBeCloseTo(M.trackHeaderWidth + 4 * 25, 6);
  });

  it("snapIndicatorX clamps to null when beyond viewport", () => {
    // beat 200 at pxPerBeat=25 = 5000 px — way past viewport.width=1200.
    const p = createPlaylistPresentation(
      {
        ...viewportState({ pxPerBeat: 25 }),
        snapHint: { time: 200, visible: true },
      },
      M,
    );
    expect(p.snapIndicatorX).toBeNull();
  });

  it("dragPreviewView yields per-move rects for clip-move", () => {
    const base = viewportState();
    const state: PlaylistState = {
      ...base,
      dragPreview: {
        kind: "clip-move",
        primaryClipId: "clip-drums-1",
        previewTrackIndex: 1,
        previewStart: 8,
        allMoves: [
          { id: "clip-drums-1", start: 8, trackIndex: 1 },
          { id: "clip-bass-1", start: 12, trackIndex: 2 },
        ],
      },
    };
    const p = createPlaylistPresentation(state, M);
    expect(p.dragPreviewView).not.toBeNull();
    expect(p.dragPreviewView!.rects.length).toBe(2);
    expect(p.dragPreviewView!.primaryRect).not.toBeNull();
  });

  it("dragPreviewView yields one rect for clip-resize", () => {
    const base = viewportState();
    const state: PlaylistState = {
      ...base,
      dragPreview: {
        kind: "clip-resize",
        clipId: "clip-drums-1",
        edge: "right",
        previewStart: 0,
        previewDuration: 24,
      },
    };
    const p = createPlaylistPresentation(state, M);
    expect(p.dragPreviewView!.rects.length).toBe(1);
  });

  it("tooltipView mirrors state.tooltip verbatim", () => {
    const p = createPlaylistPresentation(
      {
        ...viewportState(),
        tooltip: {
          kind: "time",
          text: "3.2.0",
          anchor: { x: 240, y: 90 },
        },
      },
      M,
    );
    expect(p.tooltipView).toEqual({
      kind: "time",
      text: "3.2.0",
      x: 240,
      y: 90,
    });
  });
});

describe("F3 — controller wiring", () => {
  it("clip drag emits dragPreview + snapHint + tooltip; release clears them", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(pointerEvent("pointerdown", cx, cy));
    listeners.get("pointermove")?.(pointerEvent("pointermove", cx + 60, cy));
    const mid = core.getState();
    expect(mid.dragPreview).not.toBeNull();
    expect(mid.dragPreview!.kind).toBe("clip-move");
    expect(mid.snapHint).not.toBeNull();
    expect(mid.tooltip).not.toBeNull();
    expect(mid.tooltip!.text).toMatch(/^\d+\.\d+\.\d+$/);
    listeners.get("pointerup")?.(pointerEvent("pointerup", cx + 60, cy));
    const after = core.getState();
    expect(after.dragPreview).toBeNull();
    expect(after.snapHint).toBeNull();
    expect(after.tooltip).toBeNull();
    controller.destroy();
  });

  it("Alt held during drag suppresses snapHint visibility", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    listeners.get("pointerdown")?.(pointerEvent("pointerdown", cx, cy));
    listeners
      .get("pointermove")
      ?.(pointerEvent("pointermove", cx + 40, cy, { altKey: true }));
    expect(core.getState().snapHint!.visible).toBe(false);
    listeners.get("pointerup")?.(pointerEvent("pointerup", cx + 40, cy));
    controller.destroy();
  });

  it("ruler hover sets a B.B.T tooltip; leaving the ruler clears it", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    // y < rulerHeight → ruler hit; x in the timeline area.
    listeners
      .get("pointermove")
      ?.(pointerEvent("pointermove", M.trackHeaderWidth + 100, 10));
    const t1 = core.getState().tooltip;
    expect(t1).not.toBeNull();
    expect(t1!.text).toMatch(/^\d+\.\d+\.\d+$/);
    // Move to empty timeline area (y well below the ruler) — tooltip clears.
    listeners
      .get("pointermove")
      ?.(pointerEvent("pointermove", M.trackHeaderWidth + 100, 500));
    expect(core.getState().tooltip).toBeNull();
    controller.destroy();
  });
});

describe("F3 — formatBarBeat sanity for tooltip text", () => {
  it("renders integer beats as N.1.0", () => {
    expect(formatBarBeat(0, 4)).toBe("1.1.0");
    expect(formatBarBeat(4, 4)).toBe("2.1.0");
    expect(formatBarBeat(12, 4)).toBe("4.1.0");
  });
});
