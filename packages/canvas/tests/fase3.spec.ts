import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  snapStepBeats,
  snapTime,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistSnapMode,
  type PlaylistState,
} from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

function withSnap(mode: PlaylistSnapMode): PlaylistState {
  return {
    ...createDemoPlaylistState(),
    snap: { mode, lastActiveMode: mode === "none" ? "beat" : mode },
  };
}

describe("Fase 3 — snapStepBeats mapping", () => {
  const cases: ReadonlyArray<{ mode: PlaylistSnapMode; step: number }> = [
    { mode: "main", step: 1 },
    { mode: "beat", step: 1 },
    { mode: "cell", step: 1 },
    { mode: "line", step: M.beatsPerBar },
    { mode: "bar", step: M.beatsPerBar },
    { mode: "step", step: 0.25 },
    { mode: "half-beat", step: 0.5 },
    { mode: "quarter-beat", step: 0.25 },
    { mode: "third-beat", step: 1 / 3 },
    { mode: "sixth-beat", step: 1 / 6 },
    { mode: "half-step", step: 0.125 },
    { mode: "quarter-step", step: 1 / 16 },
    { mode: "third-step", step: 1 / 12 },
    { mode: "sixth-step", step: 1 / 24 },
    { mode: "none", step: 0 },
    { mode: "events", step: 0 },
  ];

  for (const { mode, step } of cases) {
    it(`${mode} → ${step} beats`, () => {
      expect(snapStepBeats(mode, M)).toBeCloseTo(step, 6);
    });
  }
});

describe("Fase 3 — snapTime by mode", () => {
  it("none returns the raw value", () => {
    expect(snapTime(3.7, withSnap("none"))).toBe(3.7);
  });

  it("beat rounds to nearest beat", () => {
    expect(snapTime(3.4, withSnap("beat"))).toBe(3);
    expect(snapTime(3.6, withSnap("beat"))).toBe(4);
  });

  it("bar rounds to nearest bar (4 beats)", () => {
    expect(snapTime(5, withSnap("bar"))).toBe(4);
    expect(snapTime(7, withSnap("bar"))).toBe(8);
  });

  it("step rounds to 1/4 beat", () => {
    expect(snapTime(0.6, withSnap("step"))).toBe(0.5);
    expect(snapTime(0.8, withSnap("step"))).toBeCloseTo(0.75, 4);
  });

  it("half-beat rounds to nearest 0.5", () => {
    expect(snapTime(2.3, withSnap("half-beat"))).toBe(2.5);
  });

  it("ignoreSnap bypasses regardless of mode", () => {
    expect(snapTime(3.7, withSnap("beat"), true)).toBe(3.7);
  });

  it("never returns a negative time", () => {
    expect(snapTime(-3, withSnap("beat"))).toBe(0);
  });
});

describe("Fase 3 — snap to events", () => {
  it("snaps to a clip start within tolerance", () => {
    const state = { ...createDemoPlaylistState(), snap: { mode: "events" as const, lastActiveMode: "beat" as const } };
    // clip-drums-2 starts at beat 18. With pxPerBeat=28, tolerance ≈ 8/28 ≈ 0.286 beats.
    const result = snapTime(17.85, state);
    expect(result).toBe(18);
  });

  it("snaps to a clip end (start + duration)", () => {
    const state = { ...createDemoPlaylistState(), snap: { mode: "events" as const, lastActiveMode: "beat" as const } };
    // clip-drums-1: start=0, duration=16 → end at beat 16.
    const result = snapTime(15.9, state);
    expect(result).toBe(16);
  });

  it("returns the raw value when no event is within tolerance", () => {
    const state = { ...createDemoPlaylistState(), snap: { mode: "events" as const, lastActiveMode: "beat" as const } };
    const result = snapTime(50, state);
    expect(result).toBe(50);
  });
});

describe("Fase 3 — reducer SET_SNAP_MODE / TOGGLE_SNAP_NONE", () => {
  it("SET_SNAP_MODE updates mode and remembers it as last active", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(s0, { type: "SET_SNAP_MODE", mode: "bar" }, M);
    expect(s1.snap.mode).toBe("bar");
    expect(s1.snap.lastActiveMode).toBe("bar");
  });

  it("SET_SNAP_MODE 'none' keeps the previous lastActiveMode", () => {
    const s0 = playlistReducer(
      createDemoPlaylistState(),
      { type: "SET_SNAP_MODE", mode: "step" },
      M,
    );
    const s1 = playlistReducer(s0, { type: "SET_SNAP_MODE", mode: "none" }, M);
    expect(s1.snap.mode).toBe("none");
    expect(s1.snap.lastActiveMode).toBe("step");
  });

  it("TOGGLE_SNAP_NONE switches to none and back", () => {
    const s0 = playlistReducer(
      createDemoPlaylistState(),
      { type: "SET_SNAP_MODE", mode: "bar" },
      M,
    );
    const s1 = playlistReducer(s0, { type: "TOGGLE_SNAP_NONE" }, M);
    expect(s1.snap.mode).toBe("none");
    const s2 = playlistReducer(s1, { type: "TOGGLE_SNAP_NONE" }, M);
    expect(s2.snap.mode).toBe("bar");
  });

  it("setSnapMode + toggleSnapNone via PlaylistCore wrappers", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSnapMode("step");
    expect(core.getState().snap.mode).toBe("step");
    core.toggleSnapNone();
    expect(core.getState().snap.mode).toBe("none");
    core.toggleSnapNone();
    expect(core.getState().snap.mode).toBe("step");
    expect(core.canUndo()).toBe(false);
  });
});
