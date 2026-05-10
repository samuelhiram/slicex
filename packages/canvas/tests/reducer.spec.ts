import { describe, expect, it } from "vitest";
import { playlistReducer } from "../src/playlist-core/reducer";
import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationClip,
  type PlaylistRegularClip,
  type PlaylistState,
} from "../src/playlist-core/types";

function createBaseState(): PlaylistState {
  return {
    tracks: [
      { id: "t1", label: "Track 1", color: "#aaa" },
      { id: "t2", label: "Track 2", color: "#bbb" },
    ],
    clips: [
      {
        id: "c1",
        type: "audio",
        trackId: "t1",
        start: 0,
        duration: 4,
        label: "C1",
        color: "#f00",
      } satisfies PlaylistRegularClip,
      {
        id: "c-auto",
        type: "automation",
        trackId: "t2",
        start: 0,
        duration: 8,
        label: "auto",
        color: "#0f0",
        points: [
          { id: "p1", time: 0, value: 0.2 },
          { id: "p2", time: 4, value: 0.8 },
          { id: "p3", time: 8, value: 0.5 },
        ],
      } satisfies PlaylistAutomationClip,
    ],
    viewport: {
      scrollX: 0,
      scrollY: 0,
      pxPerBeat: 28,
      width: 1000,
      height: 600,
    },
    snap: { mode: "beat", lastActiveMode: "beat" },
    selection: { clipIds: [], automationPointIds: [] },
    marquee: null,
    contextMenu: null,
    hover: null,
    playPosition: { time: 0, isRunning: false },
    tool: "select",
    clipboard: null,
  };
}

const M = DEFAULT_PLAYLIST_METRICS;

describe("playlistReducer", () => {
  it("MOVE_CLIPS updates start and trackId", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      {
        type: "MOVE_CLIPS",
        updates: [{ id: "c1", start: 5, trackIndex: 1 }],
      },
      M,
    );
    const c = s1.clips.find((cl) => cl.id === "c1")!;
    expect(c.start).toBe(5);
    expect(c.trackId).toBe("t2");
  });

  it("MOVE_CLIPS materializes virtual tracks beyond current count", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      {
        type: "MOVE_CLIPS",
        updates: [{ id: "c1", start: 0, trackIndex: 5 }],
      },
      M,
    );
    expect(s1.tracks.length).toBeGreaterThanOrEqual(6);
  });

  it("RESIZE_CLIP right edge respects minClipDuration", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      { type: "RESIZE_CLIP", clipId: "c1", edge: "right", time: 0 },
      M,
    );
    const c = s1.clips.find((cl) => cl.id === "c1")!;
    expect(c.duration).toBeGreaterThanOrEqual(M.minClipDuration);
  });

  it("RESIZE_CLIP left edge clamps and keeps end fixed", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      { type: "RESIZE_CLIP", clipId: "c1", edge: "left", time: 2 },
      M,
    );
    const c = s1.clips.find((cl) => cl.id === "c1")!;
    expect(c.start).toBe(2);
    expect(c.start + c.duration).toBe(4);
  });

  it("ADD_AUTOMATION_POINT inserts and selects it", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      {
        type: "ADD_AUTOMATION_POINT",
        clipId: "c-auto",
        pointId: "p-new",
        time: 2,
        value: 0.5,
      },
      M,
    );
    const c = s1.clips.find((cl) => cl.id === "c-auto") as PlaylistAutomationClip;
    expect(c.points.map((p) => p.id)).toContain("p-new");
    expect(s1.selection.automationPointIds).toEqual(["p-new"]);
  });

  it("MOVE_AUTOMATION_POINT clamps value to [0,1] and time to [0,duration]", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      {
        type: "MOVE_AUTOMATION_POINT",
        clipId: "c-auto",
        pointId: "p1",
        time: 999,
        value: 5,
      },
      M,
    );
    const c = s1.clips.find((cl) => cl.id === "c-auto") as PlaylistAutomationClip;
    const moved = c.points.find((p) => p.id === "p1")!;
    expect(moved.time).toBe(c.duration);
    expect(moved.value).toBe(1);
  });

  it("REMOVE_AUTOMATION_POINT keeps minimum 2 points", () => {
    const s0 = createBaseState();
    let s = playlistReducer(
      s0,
      { type: "REMOVE_AUTOMATION_POINT", clipId: "c-auto", pointId: "p1" },
      M,
    );
    s = playlistReducer(
      s,
      { type: "REMOVE_AUTOMATION_POINT", clipId: "c-auto", pointId: "p2" },
      M,
    );
    const c = s.clips.find((cl) => cl.id === "c-auto") as PlaylistAutomationClip;
    expect(c.points.length).toBe(2);
  });

  it("REMOVE_SELECTED removes selected clips and points", () => {
    const s0 = createBaseState();
    const s1: PlaylistState = {
      ...s0,
      selection: { clipIds: ["c1"], automationPointIds: ["p2"] },
    };
    const s2 = playlistReducer(s1, { type: "REMOVE_SELECTED" }, M);
    expect(s2.clips.find((c) => c.id === "c1")).toBeUndefined();
    const c = s2.clips.find((cl) => cl.id === "c-auto") as PlaylistAutomationClip;
    expect(c.points.find((p) => p.id === "p2")).toBeUndefined();
    expect(s2.selection.clipIds).toEqual([]);
  });

  it("INSERT_TRACK_BELOW grows tracks by one", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      { type: "INSERT_TRACK_BELOW", trackIndex: 0 },
      M,
    );
    expect(s1.tracks.length).toBe(s0.tracks.length + 1);
  });

  it("DELETE_EMPTY_TRACK refuses last track", () => {
    const s0: PlaylistState = {
      ...createBaseState(),
      tracks: [{ id: "only", label: "only", color: "#fff" }],
      clips: [],
    };
    const s1 = playlistReducer(
      s0,
      { type: "DELETE_EMPTY_TRACK", trackIndex: 0 },
      M,
    );
    expect(s1.tracks.length).toBe(1);
  });

  it("DELETE_EMPTY_TRACK refuses non-empty track", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      { type: "DELETE_EMPTY_TRACK", trackIndex: 0 },
      M,
    );
    expect(s1.tracks.length).toBe(s0.tracks.length);
  });

  it("RENAME_TRACK sets label", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      { type: "RENAME_TRACK", trackIndex: 0, label: "new" },
      M,
    );
    expect(s1.tracks[0]!.label).toBe("new");
  });

  it("UI actions do not touch clips", () => {
    const s0 = createBaseState();
    const s1 = playlistReducer(
      s0,
      {
        type: "SET_SELECTION",
        selection: { clipIds: ["c1"] },
      },
      M,
    );
    expect(s1.clips).toBe(s0.clips);
    expect(s1.selection.clipIds).toEqual(["c1"]);
  });
});
