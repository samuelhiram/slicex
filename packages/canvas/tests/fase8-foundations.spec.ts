// F1 (Fase 8 — FL Studio Playlist parity) — Foundations.
//
// Validates the new state surface added by F1:
//   - UI-overlay actions (SET_DRAG_PREVIEW / SET_SNAP_HINT / SET_TOOLTIP)
//     are idempotent in the reducer (canon §4).
//   - Group membership actions (SET_CLIP_GROUP / GROUP_SELECTION /
//     UNGROUP_SELECTION) read/write `clip.groupId` and short-circuit when
//     nothing changes.
//   - MOVE_CLIPS auto-expands to drag every sibling of a moved clip's group
//     via the PlaylistCore.moveClips wrapper.
//   - geometry.formatBarBeat is the canonical "bar.beat.tick" formatter
//     shared by the tooltip and the inspector.
//   - The presentation projects the new fields (groupId pass-through,
//     dragPreviewView, snapIndicatorX, tooltipView) for the renderer.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  formatBarBeat,
  playlistReducer,
  type PlaylistRegularClip,
  type PlaylistState,
} from "../src/playlist-core";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

function baseState(): PlaylistState {
  // demo state already initialises dragPreview/snapHint/tooltip to null.
  return createDemoPlaylistState();
}

describe("F1 — UI overlay actions are idempotent", () => {
  it("SET_DRAG_PREVIEW with the same null preview returns the same state", () => {
    const s0 = baseState();
    const s1 = playlistReducer(s0, { type: "SET_DRAG_PREVIEW", preview: null }, M);
    expect(s1).toBe(s0);
  });

  it("SET_DRAG_PREVIEW with the same clip-move preview returns the same state", () => {
    const s0: PlaylistState = {
      ...baseState(),
      dragPreview: {
        kind: "clip-move",
        primaryClipId: "clip-drums-1",
        previewTrackIndex: 0,
        previewStart: 4,
        allMoves: [{ id: "clip-drums-1", start: 4, trackIndex: 0 }],
      },
    };
    const s1 = playlistReducer(
      s0,
      {
        type: "SET_DRAG_PREVIEW",
        preview: {
          kind: "clip-move",
          primaryClipId: "clip-drums-1",
          previewTrackIndex: 0,
          previewStart: 4,
          allMoves: [{ id: "clip-drums-1", start: 4, trackIndex: 0 }],
        },
      },
      M,
    );
    expect(s1).toBe(s0);
  });

  it("SET_SNAP_HINT idempotent on equal hint", () => {
    const core = createPlaylistCore(baseState());
    core.setSnapHint({ time: 3, visible: true });
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 200; i += 1) {
      core.setSnapHint({ time: 3, visible: true });
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_TOOLTIP idempotent on equal tooltip", () => {
    const core = createPlaylistCore(baseState());
    core.setTooltip({ kind: "time", text: "3.2.0", anchor: { x: 100, y: 200 } });
    let count = 0;
    const sub = core.subscribe(() => {
      count += 1;
    });
    for (let i = 0; i < 200; i += 1) {
      core.setTooltip({
        kind: "time",
        text: "3.2.0",
        anchor: { x: 100, y: 200 },
      });
    }
    sub.unsubscribe();
    expect(count).toBe(0);
  });

  it("SET_DRAG_PREVIEW updates state when contents change", () => {
    const core = createPlaylistCore(baseState());
    expect(core.getState().dragPreview).toBeNull();
    core.setDragPreview({
      kind: "clip-resize",
      clipId: "clip-drums-1",
      edge: "right",
      previewStart: 0,
      previewDuration: 8,
    });
    const preview = core.getState().dragPreview;
    expect(preview).not.toBeNull();
    expect(preview!.kind).toBe("clip-resize");
    core.clearDragPreview();
    expect(core.getState().dragPreview).toBeNull();
  });
});

describe("F1 — clip groups", () => {
  it("groupSelection assigns the same groupId to every selected clip", () => {
    const core = createPlaylistCore(baseState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    const groupId = core.groupSelection();
    expect(groupId).not.toBeNull();
    const s = core.getState();
    const a = s.clips.find((c) => c.id === "clip-drums-1")!;
    const b = s.clips.find((c) => c.id === "clip-drums-2")!;
    expect(a.groupId).toBe(groupId);
    expect(b.groupId).toBe(groupId);
  });

  it("ungroupSelection clears groupId on the selected clips", () => {
    const core = createPlaylistCore(baseState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    core.groupSelection();
    core.ungroupSelection();
    const s = core.getState();
    const a = s.clips.find((c) => c.id === "clip-drums-1")!;
    const b = s.clips.find((c) => c.id === "clip-drums-2")!;
    expect(a.groupId).toBeUndefined();
    expect(b.groupId).toBeUndefined();
  });

  it("expandSelectionToGroups returns every clip sharing a groupId with the seeds", () => {
    const core = createPlaylistCore(baseState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    core.groupSelection();
    const expanded = core.expandSelectionToGroups(["clip-drums-1"]);
    expect(expanded.sort()).toEqual(["clip-drums-1", "clip-drums-2"]);
  });

  it("moveClips drags every sibling in the same group with the same delta", () => {
    const core = createPlaylistCore(baseState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    core.groupSelection();
    const before = core.getState();
    const primary = before.clips.find(
      (c) => c.id === "clip-drums-1",
    ) as PlaylistRegularClip;
    const sibling = before.clips.find(
      (c) => c.id === "clip-drums-2",
    ) as PlaylistRegularClip;
    const startDelta = 5;
    core.moveClips([
      {
        id: "clip-drums-1",
        start: primary.start + startDelta,
        trackIndex: 0,
      },
    ]);
    const after = core.getState();
    const movedPrimary = after.clips.find((c) => c.id === "clip-drums-1")!;
    const movedSibling = after.clips.find((c) => c.id === "clip-drums-2")!;
    expect(movedPrimary.start).toBe(primary.start + startDelta);
    expect(movedSibling.start).toBe(sibling.start + startDelta);
  });

  it("SET_CLIP_GROUP with same value returns same state reference", () => {
    const s0: PlaylistState = {
      ...baseState(),
      clips: baseState().clips.map((c) =>
        c.id === "clip-drums-1" ? { ...c, groupId: "g-7" } : c,
      ),
    };
    const s1 = playlistReducer(
      s0,
      { type: "SET_CLIP_GROUP", clipId: "clip-drums-1", groupId: "g-7" },
      M,
    );
    expect(s1).toBe(s0);
  });

  it("paste of a grouped pair preserves group siblings dragging together", () => {
    // Sanity check: paste copies the groupId field as-is (regenerateGroupIds
    // is a Fase F6 concern; F1 establishes the field plumbing).
    const core = createPlaylistCore(baseState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    core.groupSelection();
    core.copyToClipboard();
    const ids = core.pasteClipboard({ atTime: 100, atTrackIndex: 0 });
    expect(ids.length).toBe(2);
    const s = core.getState();
    const a = s.clips.find((c) => c.id === ids[0])!;
    const b = s.clips.find((c) => c.id === ids[1])!;
    // In F1 paste leaves groupId untouched (F6 will regenerate it).
    expect(a.groupId).toBeDefined();
    expect(b.groupId).toBe(a.groupId);
  });
});

describe("F1 — formatBarBeat", () => {
  it("returns 1.1.0 at the origin", () => {
    expect(formatBarBeat(0, 4)).toBe("1.1.0");
  });

  it("computes bar / beat / tick at a fractional beat", () => {
    // 5.5 beats with 4 beats per bar:
    //   bar = floor(5/4) = 1 → display 2
    //   beat = 5 - 4 = 1 → display 2
    //   tick = round(5.5 * 24) - 5 * 24 = 132 - 120 = 12
    expect(formatBarBeat(5.5, 4)).toBe("2.2.12");
  });

  it("clamps negative times to the origin", () => {
    expect(formatBarBeat(-3, 4)).toBe("1.1.0");
  });

  it("respects custom beats-per-bar", () => {
    // 7 beats with 3 beats per bar:
    //   bar = floor(7/3) = 2 → display 3
    //   beat = 7 - 6 = 1 → display 2
    expect(formatBarBeat(7, 3)).toBe("3.2.0");
  });
});

describe("F1 — presentation projects the new fields", () => {
  it("clip presentation copies groupId through", () => {
    const s0: PlaylistState = {
      ...baseState(),
      viewport: { ...baseState().viewport, width: 1200, height: 700 },
      clips: baseState().clips.map((c) =>
        c.id === "clip-drums-1" ? { ...c, groupId: "g-77" } : c,
      ),
    };
    const p = createPlaylistPresentation(s0, M);
    const view = p.clipViewsById.get("clip-drums-1");
    expect(view).toBeDefined();
    expect(view!.groupId).toBe("g-77");
  });

  it("dragPreviewView is null when no preview is active", () => {
    const p = createPlaylistPresentation(
      { ...baseState(), viewport: { ...baseState().viewport, width: 1200, height: 700 } },
      M,
    );
    expect(p.dragPreviewView).toBeNull();
  });

  it("dragPreviewView builds a rect for clip-move preview", () => {
    const s0: PlaylistState = {
      ...baseState(),
      viewport: { ...baseState().viewport, width: 1200, height: 700 },
      dragPreview: {
        kind: "clip-move",
        primaryClipId: "clip-drums-1",
        previewTrackIndex: 0,
        previewStart: 8,
        allMoves: [{ id: "clip-drums-1", start: 8, trackIndex: 0 }],
      },
    };
    const p = createPlaylistPresentation(s0, M);
    expect(p.dragPreviewView).not.toBeNull();
    expect(p.dragPreviewView!.primaryRect).not.toBeNull();
    expect(p.dragPreviewView!.rects.length).toBe(1);
  });

  it("snapIndicatorX is null when snapHint.visible is false", () => {
    const s0: PlaylistState = {
      ...baseState(),
      viewport: { ...baseState().viewport, width: 1200, height: 700 },
      snapHint: { time: 4, visible: false },
    };
    const p = createPlaylistPresentation(s0, M);
    expect(p.snapIndicatorX).toBeNull();
  });

  it("snapIndicatorX projects to screen X when visible", () => {
    const s0: PlaylistState = {
      ...baseState(),
      viewport: {
        ...baseState().viewport,
        width: 1200,
        height: 700,
        scrollX: 0,
        pxPerBeat: 30,
      },
      snapHint: { time: 4, visible: true },
    };
    const p = createPlaylistPresentation(s0, M);
    // beat 4 * 30 px = 120 + header width
    expect(p.snapIndicatorX).toBeCloseTo(M.trackHeaderWidth + 120, 6);
  });

  it("tooltipView mirrors state.tooltip", () => {
    const s0: PlaylistState = {
      ...baseState(),
      viewport: { ...baseState().viewport, width: 1200, height: 700 },
      tooltip: {
        kind: "time",
        text: "3.2.0",
        anchor: { x: 300, y: 80 },
      },
    };
    const p = createPlaylistPresentation(s0, M);
    expect(p.tooltipView).toEqual({
      kind: "time",
      text: "3.2.0",
      x: 300,
      y: 80,
    });
  });
});
