// Stacked lanes inside a track (playlist-core/lanes.ts) — after the shift
// planner of postalhub-dashboard: clips that meet in time stack in lanes of
// their row instead of covering each other; a drag drops on the lane under
// the pointer (with a dashed "free lane" to stack); everything else keeps
// its lane; empty lanes go.
import { describe, expect, it } from "vitest";
import {
  assignLanes,
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getClipRect,
  type LaneRequest,
  type PlaylistClip,
  type PlaylistState,
} from "../src/playlist-core";
import {
  createPlaylistInteractionController,
  type PlaylistCreateRequest,
} from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const PX = 20; // px per beat in these tests
const LANE = M.trackHeight;

type ClipSeed = { id: string; trackId: string; start: number; duration: number; lane?: number };

function stateWith(clips: ClipSeed[], trackIds = ["t0", "t1", "t2"]): PlaylistState {
  const base = createDemoPlaylistState();
  return {
    ...base,
    tracks: trackIds.map((id) => ({ id, label: id, color: "#888888" })),
    clips: clips.map(
      (clip) => ({ type: "pattern", label: clip.id, color: "#888888", ...clip }) as PlaylistClip,
    ),
    markers: [],
    selection: { clipIds: [], automationPointIds: [] },
    viewport: { ...base.viewport, scrollX: 0, scrollY: 0, pxPerBeat: PX, width: 1200, height: 700 },
  };
}

const clipOf = (state: PlaylistState, id: string) => state.clips.find((clip) => clip.id === id)!;
const laneOf = (state: PlaylistState, id: string) => clipOf(state, id).lane ?? 0;
const lanesOf = (state: PlaylistState, trackId: string) =>
  state.tracks.find((track) => track.id === trackId)!.lanes ?? 1;

// Screen point at `beat`, in row `trackIndex` (no lanes above it unless
// `rowsAbove` says how many lanes the rows above have), lane `lane`.
const xAt = (beat: number) => M.trackHeaderWidth + beat * PX;
const yAt = (laneFromTop: number) => M.rulerHeight + laneFromTop * LANE + LANE / 2;

describe("assignLanes (one track)", () => {
  const fresh = (start: number, end: number): LaneRequest => ({ start, end, lane: 0, mode: "fresh" });

  it("fresh clips take the first free lane by start: as few lanes as the busiest moment", () => {
    const { lanes, laneCount } = assignLanes([fresh(0, 4), fresh(2, 6), fresh(5, 9), fresh(3, 8)]);
    expect(laneCount).toBe(3);
    expect(lanes).toEqual([0, 1, 0, 2]);
  });

  it("touching clips share a lane (an end is exclusive)", () => {
    expect(assignLanes([fresh(0, 4), fresh(4, 8)]).laneCount).toBe(1);
  });

  it("no empty lanes in between; at least one lane", () => {
    const remembered: LaneRequest[] = [
      { start: 0, end: 4, lane: 3, mode: "remembered" },
      { start: 10, end: 14, lane: 7, mode: "remembered" },
    ];
    expect(assignLanes(remembered)).toEqual({ lanes: [0, 1], laneCount: 2 });
    expect(assignLanes([]).laneCount).toBe(1);
  });

  it("a pinned clip keeps its lane; the one it lands on takes the vacated lane (swap)", () => {
    const { lanes } = assignLanes(
      [
        { start: 0, end: 4, lane: 0, mode: "remembered" }, // was on top
        { start: 1, end: 5, lane: 0, mode: "pinned" }, // dropped on top, came from lane 2
        { start: 0, end: 9, lane: 1, mode: "remembered" },
      ],
      2,
    );
    expect(lanes).toEqual([2, 0, 1].map((lane) => lane)); // compacted: 0,1,2 used
  });

  it("without a vacated lane, the displaced clip goes to the nearest free one (up first)", () => {
    const { lanes } = assignLanes([
      { start: 0, end: 4, lane: 1, mode: "remembered" },
      { start: 0, end: 4, lane: 1, mode: "pinned" },
      { start: 10, end: 12, lane: 0, mode: "remembered" },
    ]);
    // lane 0 is free at [0,4): the displaced clip moves up.
    expect(lanes).toEqual([0, 1, 0]);
  });

  it("settled lanes never overlap and fresh layouts are optimal (random check)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 50; round += 1) {
      const requests: LaneRequest[] = Array.from({ length: 30 }, () => {
        const start = Math.floor(rand() * 100);
        return fresh(start, start + 1 + Math.floor(rand() * 15));
      });
      const { lanes, laneCount } = assignLanes(requests);
      let busiest = 0;
      for (let t = 0; t < 120; t += 1) {
        busiest = Math.max(busiest, requests.filter((r) => r.start <= t && t < r.end).length);
      }
      expect(laneCount).toBe(busiest);
      for (let i = 0; i < requests.length; i += 1) {
        for (let j = i + 1; j < requests.length; j += 1) {
          if (lanes[i] !== lanes[j]) continue;
          const a = requests[i]!;
          const b = requests[j]!;
          expect(a.end <= b.start || b.end <= a.start).toBe(true);
        }
      }
    }
  });
});

describe("the core keeps lanes settled", () => {
  it("clips that meet in time stack; the row grows by whole lanes", () => {
    const core = createPlaylistCore(
      stateWith([
        { id: "a", trackId: "t0", start: 0, duration: 4 },
        { id: "b", trackId: "t0", start: 2, duration: 4 },
        { id: "c", trackId: "t1", start: 0, duration: 4 },
      ]),
    );
    const state = core.getState();
    expect([laneOf(state, "a"), laneOf(state, "b")]).toEqual([0, 1]);
    expect(lanesOf(state, "t0")).toBe(2);
    expect(state.tracks[1]!.lanes).toBeUndefined();
    // Each clip takes one lane; row t1 starts below both lanes of t0.
    const tracksTop = M.rulerHeight;
    expect(getClipRect(state, clipOf(state, "b"), M).y).toBe(tracksTop + LANE + M.clipPaddingY);
    expect(getClipRect(state, clipOf(state, "b"), M).height).toBe(LANE - 2 * M.clipPaddingY);
    expect(getClipRect(state, clipOf(state, "c"), M).y).toBe(tracksTop + 2 * LANE + M.clipPaddingY);
    const views = core.getPresentation().clipViews;
    expect(views.find((view) => view.clip.id === "b")!.rect.y).toBe(
      tracksTop + LANE + M.clipPaddingY,
    );
  });

  it("deleting the clip that needed a lane shrinks the row back", () => {
    const core = createPlaylistCore(
      stateWith([
        { id: "a", trackId: "t0", start: 0, duration: 4 },
        { id: "b", trackId: "t0", start: 2, duration: 4 },
      ]),
    );
    core.deleteClip("a");
    expect(lanesOf(core.getState(), "t0")).toBe(1);
    expect(laneOf(core.getState(), "b")).toBe(0);
  });

  it("a new clip takes the first free lane; existing clips don't move", () => {
    const core = createPlaylistCore(
      stateWith([{ id: "a", trackId: "t0", start: 4, duration: 4 }]),
    );
    // Starts BEFORE a and meets it: it goes below, a stays on top.
    core.createClip({ trackIndex: 0, start: 2, duration: 4, type: "pattern", label: "n", color: "#888888", id: "n" });
    const state = core.getState();
    expect(laneOf(state, "a")).toBe(0);
    expect(laneOf(state, "n")).toBe(1);
  });

  it("an edit that stacks nothing keeps the tracks array (canon §3.13)", () => {
    const core = createPlaylistCore(
      stateWith([{ id: "a", trackId: "t0", start: 0, duration: 4 }]),
    );
    const tracks = core.getState().tracks;
    core.moveClips([{ id: "a", start: 10, trackIndex: 0 }]);
    expect(core.getState().tracks).toBe(tracks);
  });
});

describe("gestures: provisional while dragging, settled on release", () => {
  it("during a gesture a clip may sit over another and rows never lose lanes; one undo entry", () => {
    const core = createPlaylistCore(
      stateWith([
        { id: "a", trackId: "t0", start: 0, duration: 4 },
        { id: "b", trackId: "t0", start: 2, duration: 4 },
        { id: "c", trackId: "t1", start: 0, duration: 4 },
      ]),
    );
    const before = core.getState();
    core.beginGesture();
    // b leaves t0 for t1, dropped on c's lane (0) over c.
    core.moveClips([{ id: "b", start: 1, trackIndex: 1, lane: 0 }]);
    const mid = core.getState();
    expect(laneOf(mid, "b")).toBe(0);
    expect(laneOf(mid, "c")).toBe(0); // provisional: nothing re-laid out yet
    expect(lanesOf(mid, "t0")).toBe(2); // the origin row keeps its lanes
    core.endGesture();
    const done = core.getState();
    expect(laneOf(done, "b")).toBe(0); // pinned where it was dropped
    expect(laneOf(done, "c")).toBe(1); // displaced to the nearest free lane
    expect(lanesOf(done, "t0")).toBe(1); // empty lane gone
    expect(lanesOf(done, "t1")).toBe(2);
    core.undo();
    expect(core.getState().clips).toEqual(before.clips);
    expect(core.getState().tracks).toEqual(before.tracks);
  });
});

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
    dispatchEvent() {
      return true;
    },
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointer(x: number, y: number, detail = 1, timeStamp = 0): PointerEvent {
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

function setupDrag(clips: ClipSeed[], options = {}) {
  const core = createPlaylistCore(stateWith(clips));
  core.setViewportSize(1200, 700);
  core.setSnapMode("none");
  const { host, listeners } = createHost();
  const controller = createPlaylistInteractionController(host, core, options);
  const down = (x: number, y: number, detail = 1) => listeners.get("pointerdown")!(pointer(x, y, detail));
  const move = (x: number, y: number) => listeners.get("pointermove")!(pointer(x, y));
  const up = (x: number, y: number) => listeners.get("pointerup")!(pointer(x, y));
  return { core, controller, down, move, up };
}

describe("dragging a clip: the dashed free lane (stack at the same time)", () => {
  it("a row with other clips opens a free lane under the drag; dropping there stacks", () => {
    const { core, controller, down, move, up } = setupDrag([
      { id: "a", trackId: "t0", start: 0, duration: 4 },
      { id: "b", trackId: "t1", start: 10, duration: 4 },
    ]);
    // Grab b (row t1 = 2nd lane from the top) and bring it over a in row t0.
    down(xAt(12), yAt(1));
    move(xAt(2), yAt(0));
    let state = core.getState();
    const preview = state.dragPreview;
    expect(preview?.kind).toBe("clip-move");
    expect(preview && preview.kind === "clip-move" ? preview.freeLane : null).toEqual({
      trackIndex: 0,
      lane: 1,
    });
    expect(lanesOf(state, "t0")).toBe(2); // the free lane is open
    expect(core.getPresentation().dragPreviewView?.freeLaneRect).not.toBeNull();
    // Down into the free lane (2nd lane of t0, which is open now).
    move(xAt(2), yAt(1));
    expect(laneOf(core.getState(), "b")).toBe(1);
    up(xAt(2), yAt(1));
    state = core.getState();
    controller.destroy();
    expect(clipOf(state, "b").trackId).toBe("t0");
    expect(clipOf(state, "b").start).toBe(0);
    expect([laneOf(state, "a"), laneOf(state, "b")]).toEqual([0, 1]);
    expect(lanesOf(state, "t0")).toBe(2);
    expect(state.dragPreview).toBeNull();
    core.undo();
    expect(clipOf(core.getState(), "b").trackId).toBe("t1");
    expect(lanesOf(core.getState(), "t0")).toBe(1);
  });

  it("dropping on an occupied lane swaps: the other clip takes the lane it left", () => {
    const { core, controller, down, move, up } = setupDrag([
      { id: "a", trackId: "t0", start: 0, duration: 4 },
      { id: "b", trackId: "t0", start: 2, duration: 4 },
    ]);
    expect(laneOf(core.getState(), "b")).toBe(1);
    // b (lane 1) up onto lane 0, same time.
    down(xAt(4), yAt(1));
    move(xAt(4), yAt(0));
    up(xAt(4), yAt(0));
    controller.destroy();
    const state = core.getState();
    expect(laneOf(state, "b")).toBe(0);
    expect(laneOf(state, "a")).toBe(1);
    expect(lanesOf(state, "t0")).toBe(2);
  });

  it("a free lane opened before the first move never sticks to the origin row (nor to undo)", () => {
    const { core, controller, down, move, up } = setupDrag([
      { id: "a", trackId: "t0", start: 0, duration: 4 },
      { id: "b", trackId: "t0", start: 2, duration: 4 },
      { id: "c", trackId: "t1", start: 20, duration: 4 },
    ]);
    const before = core.getState();
    // Press b (lane 1 of t0) and wiggle in place: no move yet, but the row
    // (it has a) opens its free lane — a non-undoable preview change.
    down(xAt(4), yAt(1));
    move(xAt(4), yAt(1));
    expect(lanesOf(core.getState(), "t0")).toBe(3);
    // Now over row t1 (below t0's 3 lanes): t0 is back to the 2 lanes it
    // had, t1 opens its own free lane.
    move(xAt(4), yAt(3));
    expect(clipOf(core.getState(), "b").trackId).toBe("t1");
    expect(lanesOf(core.getState(), "t0")).toBe(2);
    expect(lanesOf(core.getState(), "t1")).toBe(2);
    up(xAt(4), yAt(3));
    controller.destroy();
    expect(lanesOf(core.getState(), "t0")).toBe(1);
    core.undo();
    expect(core.getState().tracks).toEqual(before.tracks);
    expect(core.getState().clips).toEqual(before.clips);
  });

  it("an empty row opens no free lane", () => {
    const { core, controller, down, move, up } = setupDrag([
      { id: "a", trackId: "t0", start: 0, duration: 4 },
    ]);
    down(xAt(2), yAt(0));
    move(xAt(2), yAt(1)); // row t1, empty
    const preview = core.getState().dragPreview;
    expect(preview && preview.kind === "clip-move" ? preview.freeLane : "none").toBeNull();
    up(xAt(2), yAt(1));
    controller.destroy();
    expect(clipOf(core.getState(), "a").trackId).toBe("t1");
  });
});

describe("Draw tool with a host create flow (onCreateRequest)", () => {
  it("a double-click asks the host and creates nothing", () => {
    const requests: PlaylistCreateRequest[] = [];
    const { core, controller, down, up } = setupDrag(
      [{ id: "a", trackId: "t0", start: 0, duration: 4 }],
      { onCreateRequest: (request: PlaylistCreateRequest) => requests.push(request) },
    );
    core.setTool("draw");
    down(xAt(20), yAt(2), 1);
    up(xAt(20), yAt(2));
    down(xAt(20), yAt(2), 2);
    up(xAt(20), yAt(2));
    controller.destroy();
    expect(core.getState().clips.map((clip) => clip.id)).toEqual(["a"]);
    expect(requests).toEqual([{ trackIndex: 2, start: 20, duration: null, templateClipId: null }]);
  });

  it("a drag previews the range on the lane it would take and asks on release", () => {
    const requests: PlaylistCreateRequest[] = [];
    const { core, controller, down, move, up } = setupDrag(
      [{ id: "a", trackId: "t0", start: 3, duration: 4 }],
      { onCreateRequest: (request: PlaylistCreateRequest) => requests.push(request) },
    );
    core.setTool("draw");
    // From empty space before a, dragged over a: the range meets a, so it
    // previews on a new lane below it.
    down(xAt(0.5), yAt(0));
    move(xAt(5), yAt(0));
    const preview = core.getState().dragPreview;
    expect(preview).toMatchObject({ kind: "clip-create", trackIndex: 0, lane: 1, previewStart: 0.5 });
    expect(core.getPresentation().dragPreviewView?.creating).toBe(true);
    expect(lanesOf(core.getState(), "t0")).toBe(2); // opened for the preview
    up(xAt(5), yAt(0));
    controller.destroy();
    expect(core.getState().clips.length).toBe(1);
    expect(lanesOf(core.getState(), "t0")).toBe(1); // closed again
    expect(requests).toEqual([{ trackIndex: 0, start: 0.5, duration: 4.5, templateClipId: null }]);
  });

  it("a plain click asks nothing", () => {
    const requests: PlaylistCreateRequest[] = [];
    const { core, controller, down, up } = setupDrag([], {
      onCreateRequest: (request: PlaylistCreateRequest) => requests.push(request),
    });
    core.setTool("draw");
    down(xAt(5), yAt(0));
    up(xAt(5), yAt(0));
    controller.destroy();
    expect(requests).toEqual([]);
    expect(core.getState().clips).toEqual([]);
  });
});
