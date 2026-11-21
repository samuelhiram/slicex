// Generic host extensions used by the financial "waves":
//   1. Sessions — save / load a document with its own undo history.
//   2. Clip level handle — the top edge of a clip, dragged vertically, is
//      reported to the host; one gesture = one undo entry; tooltip text
//      comes from the host. Only when the host opted in, only for Select /
//      Draw.
//   3. Overview hover — the beat under the pointer over the lane, deduped.
//   4. Content marks — dashed guides inside a clip body.
import { Container, Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getTracksTop,
  type PlaylistClipContent,
} from "../src/playlist-core";
import {
  CLIP_LEVEL_HANDLE_PX,
  createPlaylistInteractionController,
  hitTestPlaylist,
} from "../src/playlist-interaction";
import { createClipNodeRegistry } from "../src/playlist-renderer-pixi/clip-node-registry";
import { COLORS } from "../src/playlist-renderer-pixi/palette";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = 28;

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
    dispatchEvent() {
      return true;
    },
  };
  return { host: host as unknown as HTMLElement, listeners };
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

function sizedCore(metrics = M) {
  const core = createPlaylistCore(createDemoPlaylistState(), { metrics });
  core.setViewportSize(1200, 700);
  return core;
}

describe("sessions", () => {
  it("each document keeps its own undo history", () => {
    const core = sizedCore();
    const a = core.saveSession();
    const clip = core.getState().clips[0]!;
    core.setClipLabel(clip.id, "A-edit");
    const aEdited = core.saveSession();

    // Load the original session (its own history) and edit differently.
    core.loadSession(a);
    expect(core.getState().clips[0]!.label).toBe(clip.label);
    core.setClipLabel(clip.id, "B-edit");

    // Back to A: its edit and its undo stack are intact.
    core.loadSession(aEdited);
    expect(core.getState().clips[0]!.label).toBe("A-edit");
    expect(core.undo()).toBe(true);
    expect(core.getState().clips[0]!.label).toBe(clip.label);
  });

  it("loading a plain state starts a fresh history and notifies once", () => {
    const core = sizedCore();
    core.setClipLabel(core.getState().clips[0]!.id, "x");
    const listener = vi.fn();
    core.subscribe(listener);
    const fresh = createDemoPlaylistState();
    core.loadSession(fresh);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(core.canUndo()).toBe(false);
    expect(core.getState().clips.length).toBe(fresh.clips.length);
  });
});

describe("clip level handle", () => {
  function clipTop(core: ReturnType<typeof sizedCore>, id: string) {
    const view = core.getPresentation().clipViewsById.get(id)!;
    return { x: view.rect.x + view.rect.width / 2, y: view.rect.y + 1, view };
  }

  it("is hit only when the host opted in, on the top edge, never on automation", () => {
    const core = sizedCore();
    const { x, y, view } = clipTop(core, "clip-drums-1");
    const p = core.getPresentation();
    expect(hitTestPlaylist(p, { x, y }, M).kind).toBe("clip");
    expect(hitTestPlaylist(p, { x, y }, M, { clipLevel: true }).kind).toBe("clip-level");
    expect(
      hitTestPlaylist(p, { x, y: view.rect.y + CLIP_LEVEL_HANDLE_PX + 2 }, M, { clipLevel: true })
        .kind,
    ).toBe("clip");
    const automation = core.getState().clips.find((c) => c.type === "automation");
    if (automation) {
      const av = p.clipViewsById.get(automation.id);
      if (av && av.isVisible) {
        expect(
          hitTestPlaylist(p, { x: av.rect.x + av.rect.width / 2, y: av.rect.y + 1 }, M, {
            clipLevel: true,
          }).kind,
        ).not.toBe("clip-level");
      }
    }
  });

  it("drag reports start / move / end with upward travel; host edits = ONE undo entry", () => {
    const core = sizedCore();
    const calls: Array<[string, number]> = [];
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, {
      onClipLevelDrag: ({ phase, deltaY, clipId }) => {
        calls.push([phase, deltaY]);
        // A host that changes something undoable per move (e.g. an amount
        // mirrored in the label).
        if (phase === "move") core.setClipLabel(clipId, `level ${Math.round(deltaY)}`);
        return phase === "end" ? null : `+${Math.round(deltaY)}`;
      },
    });
    const { x, y } = clipTop(core, "clip-drums-1");
    const before = core.getState();
    listeners.get("pointerdown")?.(pointer(x, y));
    expect(core.getState().selection.clipIds).toEqual(["clip-drums-1"]);
    listeners.get("pointermove")?.(pointer(x, y - 20));
    expect(core.getState().tooltip?.text).toBe("+20");
    listeners.get("pointermove")?.(pointer(x, y - 50));
    listeners.get("pointerup")?.(pointer(x, y - 50));
    expect(calls).toEqual([
      ["start", 0],
      ["move", 20],
      ["move", 50],
      ["end", 50],
    ]);
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.label).toBe("level 50");
    expect(core.getState().tooltip).toBeNull();
    core.undo();
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.label).toBe(
      before.clips.find((c) => c.id === "clip-drums-1")!.label,
    );
    controller.destroy();
  });

  it("other tools treat the top edge as the clip itself", () => {
    const core = sizedCore();
    core.setTool("mute");
    const onClipLevelDrag = vi.fn(() => null);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, { onClipLevelDrag });
    const { x, y } = clipTop(core, "clip-drums-1");
    listeners.get("pointerdown")?.(pointer(x, y));
    listeners.get("pointerup")?.(pointer(x, y));
    expect(onClipLevelDrag).not.toHaveBeenCalled();
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.muted).toBe(true);
    controller.destroy();
  });
});

describe("overview hover", () => {
  it("reports the beat under the pointer over the lane, deduped, null on leave", () => {
    const metrics = { ...M, overviewLaneHeight: 80 };
    const core = sizedCore(metrics);
    const beats: Array<number | null> = [];
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core, {
      onOverviewHover: (beat) => beats.push(beat),
    });
    const laneY = metrics.rulerHeight + 40;
    listeners.get("pointermove")?.(pointer(M.trackHeaderWidth + 3 * PX + 2, laneY));
    listeners.get("pointermove")?.(pointer(M.trackHeaderWidth + 3 * PX + 9, laneY));
    listeners.get("pointermove")?.(pointer(M.trackHeaderWidth + 5 * PX + 2, laneY));
    // Into the tracks: left the lane.
    listeners.get("pointermove")?.(pointer(M.trackHeaderWidth + 5 * PX, getTracksTop(metrics) + 30));
    listeners.get("pointermove")?.(pointer(M.trackHeaderWidth + 6 * PX, laneY));
    (listeners.get("pointerleave") as unknown as () => void)?.();
    expect(beats).toEqual([3, 5, null, 6, null]);
    controller.destroy();
  });
});

describe("content marks", () => {
  it("draws dashed guides inside the clip window only", () => {
    const core = sizedCore();
    const list = core.getPresentation().visibleClipViews;
    const view = list.find((v) => v.clip.id === "clip-bass-1")!;
    const start = view.clip.start;
    const end = start + view.clip.duration;
    const content: PlaylistClipContent = {
      kind: "events",
      beats: [],
      values: [],
      marks: [start - 3, start + 2, start + 6, end + 4],
    };
    const registry = createClipNodeRegistry(COLORS, {
      getClipContent: (id) => (id === "clip-bass-1" ? content : null),
    });
    const parent = new Container();
    registry.syncFrame(parent, list);
    const node = parent.children.find(
      (child) => (child as Container).x === Math.round(view.rect.x) &&
        (child as Container).y === Math.round(view.rect.y),
    ) as Container;
    const body = node.children[0] as Graphics;
    const actions = body.context.instructions.map((i) => i.action);
    // card fill + accent bar + ONE stroke for both in-window marks.
    expect(actions).toEqual(["fill", "fill", "stroke"]);
    registry.destroy();
  });
});
