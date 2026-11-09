// Extend grabber of the selected clip (PlaylistInteractionOptions.clipExtend):
//   - it sits at the CENTRE OF THE VISIBLE TIMELINE, clamped inside the
//     clip's on-screen part (never at the clip's own middle, which on a long
//     clip is off-screen);
//   - only for one selected, visible, unlocked, non-automation clip, with
//     Select / Draw, and when the host does not veto it;
//   - dragging it moves the clip's RIGHT end by the time the pointer
//     travels: left = shorter, right = longer, even when that end is
//     off-screen; the pill follows the pointer; one gesture = one undo entry.
import { describe, expect, it } from "vitest";
import {
  CLIP_EXTEND_HIT_PX,
  createClipExtendHandle,
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getClipExtendHandle,
  type PlaylistClip,
  type PlaylistState,
} from "../src/playlist-core";
import {
  createPlaylistInteractionController,
  hitTestPlaylist,
} from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const WIDTH = 1200;
const HEIGHT = 700;
const PX = 20; // px per beat
// Visible timeline: [header, width - scrollbar]; its centre.
const LEFT = M.trackHeaderWidth;
const RIGHT = WIDTH - M.scrollbarSize;
const CENTRE = Math.round((LEFT + RIGHT) / 2);

type Listener = (event: PointerEvent) => void;

function createHost() {
  const listeners = new Map<string, Listener>();
  const style: Record<string, string> = {};
  const host = {
    style,
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: WIDTH, height: HEIGHT };
    },
    addEventListener(type: string, listener: Listener) {
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
  return { host: host as unknown as HTMLElement, listeners, style };
}

function pointer(x: number, y: number, button = 0): PointerEvent {
  return {
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
  } as unknown as PointerEvent;
}

type ClipInput = { start?: number; duration?: number };

function setup(clip: ClipInput = {}, extra: ClipInput[] = []) {
  const base = createDemoPlaylistState();
  const trackId = base.tracks[0]!.id;
  const make = (partial: ClipInput, index: number): PlaylistClip => ({
    id: `c${index}`,
    type: "pattern",
    trackId,
    start: 0,
    duration: 4,
    label: "Clip",
    color: "#46b871",
    ...partial,
  });
  const state: PlaylistState = {
    ...base,
    clips: [make({ start: 2, duration: 200, ...clip }, 0), ...extra.map((c, i) => make(c, i + 1))],
    selection: { clipIds: ["c0"], automationPointIds: [] },
    snap: { mode: "none", lastActiveMode: "beat" },
    markers: [],
  };
  const core = createPlaylistCore(state, { metrics: M });
  core.setViewportSize(WIDTH, HEIGHT);
  core.updateViewport({ pxPerBeat: PX, scrollX: 0, scrollY: 0 });
  core.setTool("select");
  return core;
}

function handleOf(core: ReturnType<typeof setup>, veto?: (id: string) => boolean) {
  return getClipExtendHandle(core.getPresentation(), veto ?? (() => true));
}

const endOf = (core: ReturnType<typeof setup>, id = "c0") => {
  const clip = core.getState().clips.find((c) => c.id === id)!;
  return clip.start + clip.duration;
};

describe("getClipExtendHandle — where the grabber is", () => {
  it("sits at the centre of the visible timeline, inside the clip, even when the clip is far longer than the screen", () => {
    const core = setup({ start: 2, duration: 500 });
    const handle = handleOf(core)!;
    expect(handle).not.toBeNull();
    expect(handle.clipId).toBe("c0");
    expect(handle.x).toBe(CENTRE);
    const view = core.getPresentation().clipViewsById.get("c0")!;
    // Vertically centred in the clip, inside it.
    expect(handle.pillRect.y).toBeGreaterThan(view.rect.y);
    expect(handle.pillRect.y + handle.pillRect.height).toBeLessThan(view.rect.y + view.rect.height);
    expect(handle.hitRect.width).toBe(CLIP_EXTEND_HIT_PX);
    expect(handle.active).toBe(false);
  });

  it("is clamped into the clip's visible part when the clip doesn't reach the centre", () => {
    // Clip on screen from beat 2 to beat 12 (x 200+40 .. 200+240): left of centre.
    const core = setup({ start: 2, duration: 10 });
    const handle = handleOf(core)!;
    const view = core.getPresentation().clipViewsById.get("c0")!;
    const clipRight = view.rect.x + view.rect.width;
    expect(handle.x).toBeLessThan(CENTRE);
    expect(handle.x).toBeLessThan(clipRight);
    // Clear of the right resize handle.
    expect(handle.hitRect.x + handle.hitRect.width).toBeLessThanOrEqual(clipRight - M.resizeHandleWidth);
  });

  it("follows the scroll: the clip's start scrolled off-screen keeps it at the centre", () => {
    const core = setup({ start: 2, duration: 500 });
    core.updateViewport({ scrollX: 4000 });
    expect(handleOf(core)!.x).toBe(CENTRE);
  });

  it("is absent with no / several selected clips, other tools, a host veto, a locked track or too little clip on screen", () => {
    const core = setup({ start: 2, duration: 500 }, [{ start: 0, duration: 2 }]);
    expect(handleOf(core)).not.toBeNull();
    expect(handleOf(core, () => false)).toBeNull();

    core.setTool("paint");
    expect(handleOf(core)).toBeNull();
    core.setTool("draw");
    expect(handleOf(core)).not.toBeNull();

    core.setSelection({ clipIds: ["c0", "c1"] });
    expect(handleOf(core)).toBeNull();
    core.setSelection({ clipIds: [] });
    expect(handleOf(core)).toBeNull();

    const narrow = setup({ start: 2, duration: 2 }); // 40 px on screen
    expect(handleOf(narrow)).toBeNull();

    const locked = setup({ start: 2, duration: 500 });
    locked.toggleTrackLock(0);
    expect(handleOf(locked)).toBeNull();
  });

  it("fills a reusable `out` (no allocation per frame)", () => {
    const core = setup({ start: 2, duration: 500 });
    const out = createClipExtendHandle();
    const first = getClipExtendHandle(core.getPresentation(), undefined, out);
    expect(first).toBe(out);
    expect(out.x).toBe(CENTRE);
  });
});

describe("hit-test", () => {
  it("reports clip-extend over the grabber (before the clip), only when the host opted in", () => {
    const core = setup({ start: 2, duration: 500 });
    const handle = handleOf(core)!;
    const y = handle.pillRect.y + handle.pillRect.height / 2;
    const presentation = core.getPresentation();
    const hit = hitTestPlaylist(presentation, { x: CENTRE, y }, M, { clipExtend: () => true });
    expect(hit.kind).toBe("clip-extend");
    if (hit.kind === "clip-extend") {
      expect(hit.clipId).toBe("c0");
      expect(hit.x).toBe(CENTRE);
    }
    expect(hitTestPlaylist(presentation, { x: CENTRE, y }, M).kind).toBe("clip");
    expect(
      hitTestPlaylist(presentation, { x: CENTRE + 40, y }, M, { clipExtend: () => true }).kind,
    ).toBe("clip");
  });
});

describe("dragging the grabber", () => {
  function drag(core: ReturnType<typeof setup>, dx: number, steps = 4) {
    const { host, listeners, style } = createHost();
    const controller = createPlaylistInteractionController(host, core, { clipExtend: () => true });
    const handle = handleOf(core)!;
    const y = handle.pillRect.y + handle.pillRect.height / 2;
    listeners.get("pointerdown")!(pointer(CENTRE, y));
    const cursorWhileHeld = style.cursor;
    for (let i = 1; i <= steps; i += 1) {
      listeners.get("pointermove")!(pointer(CENTRE + (dx * i) / steps, y));
    }
    const during = getClipExtendHandle(core.getPresentation(), () => true);
    listeners.get("pointerup")!(pointer(CENTRE + dx, y));
    controller.destroy();
    return { cursorWhileHeld, during };
  }

  it("left shortens the clip from its right end by the pointer's travel, even with that end off-screen", () => {
    const core = setup({ start: 2, duration: 500 }); // end at beat 502, far off-screen
    const before = endOf(core);
    const { cursorWhileHeld, during } = drag(core, -100);
    expect(cursorWhileHeld).toBe("ew-resize");
    expect(endOf(core)).toBeCloseTo(before - 100 / PX, 6);
    // The start never moves.
    expect(core.getState().clips[0]!.start).toBe(2);
    // While held, the pill was under the pointer.
    expect(during?.active).toBe(true);
    expect(during?.x).toBe(CENTRE - 100);
  });

  it("right lengthens it", () => {
    const core = setup({ start: 2, duration: 30 });
    const before = endOf(core);
    const handle = handleOf(core)!;
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, { clipExtend: () => true });
    const y = handle.pillRect.y + handle.pillRect.height / 2;
    listeners.get("pointerdown")!(pointer(handle.x, y));
    listeners.get("pointermove")!(pointer(handle.x + 160, y));
    listeners.get("pointerup")!(pointer(handle.x + 160, y));
    controller.destroy();
    expect(endOf(core)).toBeCloseTo(before + 160 / PX, 6);
  });

  it("is one undo entry, and the grabber returns to the centre on release", () => {
    const core = setup({ start: 2, duration: 500 });
    const before = endOf(core);
    drag(core, -120, 6);
    expect(endOf(core)).not.toBe(before);
    expect(getClipExtendHandle(core.getPresentation(), () => true)?.active).toBe(false);
    core.undo();
    expect(endOf(core)).toBe(before);
  });

  it("never shrinks the clip below its minimum duration", () => {
    const core = setup({ start: 2, duration: 500 });
    drag(core, -5000);
    const clip = core.getState().clips[0]!;
    expect(clip.duration).toBeGreaterThanOrEqual(M.minClipDuration);
    expect(clip.start).toBe(2);
  });

  it("a right-button press on the grabber acts on the clip (context menu), not the grabber", () => {
    const core = setup({ start: 2, duration: 500 });
    const before = endOf(core);
    const handle = handleOf(core)!;
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, { clipExtend: () => true });
    const y = handle.pillRect.y + handle.pillRect.height / 2;
    listeners.get("pointerdown")!(pointer(handle.x, y, 2));
    listeners.get("pointermove")!(pointer(handle.x - 100, y));
    listeners.get("pointerup")!(pointer(handle.x - 100, y, 2));
    controller.destroy();
    expect(endOf(core)).toBe(before);
  });
});

describe("sensitivity follows the zoom (clipExtendMinBeatsPerPx)", () => {
  function dragWith(core: ReturnType<typeof setup>, dx: number, minBeatsPerPx: number) {
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, {
      clipExtend: () => true,
      clipExtendMinBeatsPerPx: minBeatsPerPx,
    });
    const handle = getClipExtendHandle(core.getPresentation(), () => true)!;
    const y = handle.pillRect.y + handle.pillRect.height / 2;
    listeners.get("pointerdown")!(pointer(handle.x, y));
    listeners.get("pointermove")!(pointer(handle.x + dx / 2, y));
    listeners.get("pointermove")!(pointer(handle.x + dx, y));
    listeners.get("pointerup")!(pointer(handle.x + dx, y));
    controller.destroy();
  }

  it("zoomed in, the end moves at least minBeatsPerPx per px", () => {
    const core = setup({ start: 2, duration: 500 }); // 20 px per beat
    const before = endOf(core);
    dragWith(core, -90, 1 / 3);
    expect(endOf(core)).toBeCloseTo(before - 30, 6);
  });

  it("zoomed out past that rate, it stays 1:1 (the end follows the hand)", () => {
    const core = setup({ start: 2, duration: 500 });
    core.updateViewport({ pxPerBeat: 8 }); // 1/8 beat per px > the 0.1 floor
    const before = endOf(core);
    dragWith(core, -90, 0.1);
    expect(endOf(core)).toBeCloseTo(before - 90 / 8, 6);
  });
});

describe("the end tooltip names the last covered unit (axis.formatEnd)", () => {
  it("dragging a right end shows formatEnd / lastCoveredBeat, not the boundary", () => {
    const base = createDemoPlaylistState();
    const trackId = base.tracks[0]!.id;
    const core = createPlaylistCore(
      {
        ...base,
        clips: [{ id: "c0", type: "pattern", trackId, start: 2, duration: 500, label: "Clip", color: "#46b871" }],
        selection: { clipIds: ["c0"], automationPointIds: [] },
        snap: { mode: "none", lastActiveMode: "beat" },
        markers: [],
      },
      {
        metrics: M,
        timeAxis: {
          ticks: () => [],
          formatTime: (beat) => `t${beat}`,
          formatEnd: (beat) => `hasta t${Math.ceil(beat) - 1}`,
          lastCoveredBeat: (beat) => Math.ceil(beat) - 1,
        },
      },
    );
    core.setViewportSize(WIDTH, HEIGHT);
    core.updateViewport({ pxPerBeat: PX, scrollX: 0, scrollY: 0 });
    core.setTool("select");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, { clipExtend: () => true });
    const handle = getClipExtendHandle(core.getPresentation(), () => true)!;
    const y = handle.pillRect.y + handle.pillRect.height / 2;
    listeners.get("pointerdown")!(pointer(handle.x, y));
    expect(core.getState().tooltip?.text).toBe("hasta t501");
    expect(core.getState().tooltip?.time).toBe(501);
    listeners.get("pointermove")!(pointer(handle.x - 40, y)); // -2 beats
    expect(core.getState().tooltip?.text).toBe("hasta t499");
    expect(core.getState().tooltip?.time).toBe(499);
    listeners.get("pointerup")!(pointer(handle.x - 40, y));
    controller.destroy();
  });
});
