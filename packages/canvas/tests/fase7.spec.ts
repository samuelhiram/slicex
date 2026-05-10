import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  getActiveLoopRegion,
  snapTime,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistState,
} from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

function bareState(): PlaylistState {
  return {
    ...createDemoPlaylistState(),
    markers: [],
    transport: { mode: "song", recording: false },
  };
}

describe("Fase 7 — marker reducer", () => {
  it("ADD_MARKER appends and keeps the list sorted by time", () => {
    const s0 = bareState();
    const s1 = playlistReducer(
      s0,
      {
        type: "ADD_MARKER",
        marker: { id: "m1", time: 8, kind: "label", label: "A" },
      },
      M,
    );
    const s2 = playlistReducer(
      s1,
      {
        type: "ADD_MARKER",
        marker: { id: "m2", time: 4, kind: "loop", label: "B" },
      },
      M,
    );
    expect(s2.markers.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("ADD_MARKER with duplicate id is a no-op", () => {
    const s0 = bareState();
    const s1 = playlistReducer(
      s0,
      { type: "ADD_MARKER", marker: { id: "m1", time: 8, kind: "label" } },
      M,
    );
    const s2 = playlistReducer(
      s1,
      { type: "ADD_MARKER", marker: { id: "m1", time: 99, kind: "loop" } },
      M,
    );
    expect(s2).toBe(s1);
  });

  it("REMOVE_MARKER drops the entry", () => {
    const s0 = playlistReducer(
      bareState(),
      { type: "ADD_MARKER", marker: { id: "m1", time: 8, kind: "label" } },
      M,
    );
    const s1 = playlistReducer(s0, { type: "REMOVE_MARKER", markerId: "m1" }, M);
    expect(s1.markers.length).toBe(0);
  });

  it("UPDATE_MARKER re-sorts when time changes and short-circuits when nothing changed", () => {
    let state = playlistReducer(
      bareState(),
      { type: "ADD_MARKER", marker: { id: "m1", time: 8, kind: "label" } },
      M,
    );
    state = playlistReducer(
      state,
      { type: "ADD_MARKER", marker: { id: "m2", time: 16, kind: "loop" } },
      M,
    );
    const moved = playlistReducer(
      state,
      { type: "UPDATE_MARKER", markerId: "m1", patch: { time: 20 } },
      M,
    );
    expect(moved.markers.map((m) => m.id)).toEqual(["m2", "m1"]);
    const idempotent = playlistReducer(
      moved,
      { type: "UPDATE_MARKER", markerId: "m1", patch: { time: 20 } },
      M,
    );
    expect(idempotent).toBe(moved);
  });

  it("TOGGLE_TRANSPORT_MODE and TOGGLE_TRANSPORT_RECORDING flip the flags", () => {
    let state = bareState();
    state = playlistReducer(state, { type: "TOGGLE_TRANSPORT_MODE" }, M);
    expect(state.transport.mode).toBe("pattern");
    state = playlistReducer(state, { type: "TOGGLE_TRANSPORT_RECORDING" }, M);
    expect(state.transport.recording).toBe(true);
  });
});

describe("Fase 7 — PlaylistCore wrappers", () => {
  it("addMarker / removeMarker / updateMarker round-trip", () => {
    const core = createPlaylistCore(bareState());
    const id = core.addMarker({ time: 10, label: "X" });
    expect(core.getState().markers.find((m) => m.id === id)?.label).toBe("X");
    core.updateMarker(id, { label: "Y", time: 12 });
    const after = core.getState().markers.find((m) => m.id === id)!;
    expect(after.label).toBe("Y");
    expect(after.time).toBe(12);
    core.removeMarker(id);
    expect(core.getState().markers.find((m) => m.id === id)).toBeUndefined();
  });

  it("addAutoNamedMarker numbers sequentially per kind", () => {
    const core = createPlaylistCore(bareState());
    const id1 = core.addAutoNamedMarker(4);
    const id2 = core.addAutoNamedMarker(8);
    const m1 = core.getState().markers.find((m) => m.id === id1)!;
    const m2 = core.getState().markers.find((m) => m.id === id2)!;
    expect(m1.label).toBe("Marker 1");
    expect(m2.label).toBe("Marker 2");
  });

  it("addTimeSignatureMarker stores numerator / denominator", () => {
    const core = createPlaylistCore(bareState());
    const id = core.addTimeSignatureMarker(0, 6, 8);
    const m = core.getState().markers.find((m) => m.id === id)!;
    expect(m.kind).toBe("time-signature");
    expect(m.timeSignatureNumerator).toBe(6);
    expect(m.timeSignatureDenominator).toBe(8);
  });

  it("marker add / remove / update are all undoable", () => {
    const core = createPlaylistCore(bareState());
    const id = core.addMarker({ time: 4 });
    core.updateMarker(id, { time: 8 });
    core.removeMarker(id);
    expect(core.getState().markers.length).toBe(0);
    core.undo(); // re-add via remove undo
    expect(core.getState().markers.length).toBe(1);
    core.undo(); // back to time=4
    expect(core.getState().markers[0]!.time).toBe(4);
    core.undo(); // back to empty
    expect(core.getState().markers.length).toBe(0);
  });

  it("transport toggles are not undoable", () => {
    const core = createPlaylistCore(bareState());
    core.toggleTransportMode();
    core.toggleTransportRecording();
    expect(core.canUndo()).toBe(false);
    expect(core.getState().transport.mode).toBe("pattern");
    expect(core.getState().transport.recording).toBe(true);
  });
});

describe("Fase 7 — loop region + events snap", () => {
  it("getActiveLoopRegion returns the range between the first two loop markers", () => {
    const core = createPlaylistCore(bareState());
    core.addMarker({ time: 4, kind: "loop", label: "L1" });
    core.addMarker({ time: 12, kind: "loop", label: "L2" });
    expect(getActiveLoopRegion(core.getState())).toEqual({
      start: 4,
      end: 12,
    });
  });

  it("getActiveLoopRegion is null with fewer than two loop markers", () => {
    const core = createPlaylistCore(bareState());
    core.addMarker({ time: 4, kind: "loop" });
    expect(getActiveLoopRegion(core.getState())).toBeNull();
  });

  it("events snap mode now snaps to markers as well as clip edges", () => {
    const core = createPlaylistCore(bareState());
    core.setSnapMode("events");
    core.addMarker({ time: 20, kind: "label" });
    // pxPerBeat from demo is 28 → tolerance ≈ 8/28 ≈ 0.286 beats.
    const state = core.getState();
    expect(snapTime(20.15, state)).toBe(20);
    expect(snapTime(50, state)).toBe(50);
  });
});

describe("Fase 7 — presentation", () => {
  it("markerViews populates one entry per marker with the right x", () => {
    const core = createPlaylistCore(bareState());
    core.setViewportSize(1200, 600);
    core.addMarker({ time: 4 });
    const pres = createPlaylistPresentation(core.getState(), M);
    expect(pres.markerViews.length).toBe(1);
    const expectedX =
      M.trackHeaderWidth + 4 * core.getState().viewport.pxPerBeat;
    expect(pres.markerViews[0]!.x).toBeCloseTo(expectedX, 1);
  });

  it("loopRegion is built when two loop markers exist", () => {
    const core = createPlaylistCore(bareState());
    core.setViewportSize(1200, 600);
    core.addMarker({ time: 4, kind: "loop" });
    core.addMarker({ time: 12, kind: "loop" });
    const pres = createPlaylistPresentation(core.getState(), M);
    expect(pres.loopRegion).not.toBeNull();
    expect(pres.loopRegion?.start).toBe(4);
    expect(pres.loopRegion?.end).toBe(12);
  });
});
