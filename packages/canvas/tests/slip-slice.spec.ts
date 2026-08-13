import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistCore,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";
import { TOOLS } from "../src/playlist-interaction/tools";
import type { PlaylistHit } from "../src/playlist-interaction/hit-test";

const M = DEFAULT_PLAYLIST_METRICS;
// Demo geometry: clip-drums-1 lives on track 0, start 0, duration 16, and the
// demo viewport renders at 28 px/beat with snap = "beat".
const PX = 28;

function createMockEvent(button = 0, detail = 1): PointerEvent {
  return {
    pointerId: 1,
    button,
    detail,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
  } as unknown as PointerEvent;
}

function clipHit(core: PlaylistCore, clipId: string): PlaylistHit {
  const clip = core.getState().clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`clip ${clipId} not found`);
  return { kind: "clip", clip, clipId: clip.id };
}

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

function pointerEvent(x: number, y: number): PointerEvent {
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

describe("Slip tool", () => {
  it("captures the clip's offset + stretch into the slip-drag gesture", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const gesture = TOOLS.slip.onPointerDown({
      core,
      metrics: M,
      point: { x: M.trackHeaderWidth + 4 * PX, y: M.rulerHeight + 10 },
      hit: clipHit(core, "clip-drums-1"),
      event: createMockEvent(),
    });
    expect(gesture?.kind).toBe("slip-drag");
    if (gesture?.kind === "slip-drag") {
      expect(gesture.clipId).toBe("clip-drums-1");
      expect(gesture.startContentOffset).toBe(0);
      expect(gesture.startStretchRatio).toBe(1);
    }
  });

  it("drag slides contentOffset by -deltaScreen*stretch, shows a tooltip, and is one undo", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("slip");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const y = M.rulerHeight + 10;
    const downX = M.trackHeaderWidth + 4 * PX; // beat 4
    const moveX = M.trackHeaderWidth + 7 * PX; // beat 7 → deltaScreen = +3

    listeners.get("pointerdown")?.(pointerEvent(downX, y));
    listeners.get("pointermove")?.(pointerEvent(moveX, y));

    // Mid-drag: offset moved opposite to the cursor, live tooltip is shown.
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.contentOffset,
    ).toBe(-3);
    expect(core.getState().tooltip?.kind).toBe("offset");

    listeners.get("pointerup")?.(pointerEvent(moveX, y));
    controller.destroy();

    // Committed value persists; the drag overlays are cleared on release.
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.contentOffset,
    ).toBe(-3);
    expect(core.getState().tooltip).toBeNull();

    // The whole drag collapses into a single undo entry.
    expect(core.canUndo()).toBe(true);
    core.undo();
    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1")?.contentOffset,
    ).toBeUndefined();
    expect(core.canUndo()).toBe(false);
  });
});

describe("Slice tool", () => {
  it("splits a clip into a truncated left half + a fresh contiguous right half", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    const drums = before.clips.find((c) => c.id === "clip-drums-1")!;
    const cut = 8;

    const newIds = core.sliceClipsAtTime(cut);

    const after = core.getState();
    const left = after.clips.find((c) => c.id === "clip-drums-1")!;
    expect(left.start).toBe(0);
    expect(left.duration).toBe(cut);

    // Right half: fresh id, inherits the source, contentOffset = cut point.
    const right = after.clips.find(
      (c) =>
        newIds.includes(c.id) &&
        c.start === cut &&
        (c.sourceId ?? c.id) === (drums.sourceId ?? drums.id),
    );
    expect(right).toBeTruthy();
    expect(right!.duration).toBe(drums.duration - cut);
    expect(right!.contentOffset).toBe(cut); // baseOffset 0 + (8-0)*stretch 1
    expect(after.clips.length).toBe(before.clips.length + newIds.length);
  });

  it("slices every clip crossing the cut (drums, bass, automation at beat 8)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    // chords starts exactly at 8, so the cut is at its edge → not sliced.
    const newIds = core.sliceClipsAtTime(8);
    expect(newIds.length).toBe(3);
  });

  it("is a single undo entry that restores the original clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState();
    core.sliceClipsAtTime(8);
    expect(core.canUndo()).toBe(true);
    core.undo();
    const restored = core.getState();
    expect(restored.clips.length).toBe(before.clips.length);
    expect(restored.clips.find((c) => c.id === "clip-drums-1")!.duration).toBe(16);
    expect(core.canUndo()).toBe(false);
  });

  it("is a no-op at t<=0 or beyond every clip (no dispatch, nothing to undo)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    expect(core.sliceClipsAtTime(0)).toEqual([]);
    expect(core.sliceClipsAtTime(1000)).toEqual([]);
    expect(core.canUndo()).toBe(false);
  });

  it("drag shows a vertical guide + B.B.T tooltip (not a marquee box) and cuts on release", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("slice");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const y = M.rulerHeight + 10;

    listeners.get("pointerdown")?.(pointerEvent(M.trackHeaderWidth + 4 * PX, y));
    listeners.get("pointermove")?.(pointerEvent(M.trackHeaderWidth + 8 * PX, y));

    // Mid-drag overlays: snap-indicator guide at the cut, time tooltip, and
    // crucially no marquee rectangle.
    const mid = core.getState();
    expect(mid.snapHint?.visible).toBe(true);
    expect(mid.snapHint?.time).toBe(8);
    expect(mid.tooltip?.kind).toBe("time");
    expect(mid.marquee).toBeNull();

    listeners.get("pointerup")?.(pointerEvent(M.trackHeaderWidth + 8 * PX, y));
    controller.destroy();

    // Cut landed at the release x; overlays cleared.
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.duration).toBe(8);
    expect(core.getState().snapHint).toBeNull();
    expect(core.getState().tooltip).toBeNull();
  });
});
