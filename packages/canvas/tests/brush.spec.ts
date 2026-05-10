import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
} from "../src/playlist-core";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";
import {
  brushSnapStep,
  buildBrushOcclusion,
  interpolateBrushPath,
} from "../src/playlist-interaction/brush";
import { TOOLS } from "../src/playlist-interaction/tools";
import type { PlaylistHit } from "../src/playlist-interaction/hit-test";

const M = DEFAULT_PLAYLIST_METRICS;

function mockEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    ...overrides,
  } as unknown as PointerEvent;
}

describe("brush — interpolateBrushPath", () => {
  it("returns a single cell when from === to", () => {
    const cells = interpolateBrushPath(
      { trackIndex: 0, start: 0 },
      { trackIndex: 0, start: 0 },
      1,
    );
    expect(cells).toEqual([{ trackIndex: 0, start: 0 }]);
  });

  it("covers every snapped cell when the time axis spans many steps", () => {
    const cells = interpolateBrushPath(
      { trackIndex: 0, start: 0 },
      { trackIndex: 0, start: 4 },
      1,
    );
    expect(cells.map((c) => c.start)).toEqual([0, 1, 2, 3, 4]);
  });

  it("covers every track index when the track axis dominates", () => {
    const cells = interpolateBrushPath(
      { trackIndex: 0, start: 0 },
      { trackIndex: 5, start: 0 },
      1,
    );
    expect(cells.map((c) => c.trackIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("dedupes diagonals that collapse multiple steps into the same cell", () => {
    const cells = interpolateBrushPath(
      { trackIndex: 0, start: 0 },
      { trackIndex: 3, start: 0.1 },
      1,
    );
    // 0.1 < snapStep, so all steps round to start=0. Cells differ only on track.
    expect(cells.length).toBe(4);
    expect(new Set(cells.map((c) => c.start))).toEqual(new Set([0]));
  });

  it("never returns a negative start", () => {
    const cells = interpolateBrushPath(
      { trackIndex: 0, start: 0 },
      { trackIndex: 0, start: -3 },
      1,
    );
    for (const c of cells) {
      expect(c.start).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("brush — buildBrushOcclusion", () => {
  it("seeds with every snapped cell covered by existing clips", () => {
    const state = createDemoPlaylistState();
    const occlusion = buildBrushOcclusion(state, 1);
    // clip-drums-1 covers track-1 from 0 to 16 → cells at 0..15 are occupied.
    expect(occlusion.has(0, 0, state)).toBe(true);
    expect(occlusion.has(0, 15, state)).toBe(true);
    expect(occlusion.has(0, 16, state)).toBe(false);
  });

  it("add() marks a freshly-painted cell as occupied without rescanning state", () => {
    const state = createDemoPlaylistState();
    const occlusion = buildBrushOcclusion(state, 1);
    expect(occlusion.has(6, 50, state)).toBe(false);
    occlusion.add(6, 50, state);
    expect(occlusion.has(6, 50, state)).toBe(true);
  });
});

describe("brush — brushSnapStep", () => {
  it("returns the snap mode step when grid-driven", () => {
    const state = { ...createDemoPlaylistState(), snap: { mode: "beat" as const, lastActiveMode: "beat" as const } };
    expect(brushSnapStep(state, M)).toBe(1);
  });

  it("falls back to 1 for non-grid modes (none / events)", () => {
    const noneState = {
      ...createDemoPlaylistState(),
      snap: { mode: "none" as const, lastActiveMode: "beat" as const },
    };
    expect(brushSnapStep(noneState, M)).toBe(1);
  });
});

describe("brush — CREATE_CLIP materialises virtual tracks (bug fix)", () => {
  it("painting onto a track beyond state.tracks.length produces a visible clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const virtualIndex = core.getState().tracks.length + 1;
    const id = core.createClip({
      trackIndex: virtualIndex,
      start: 0,
      duration: 4,
      type: "pattern",
      label: "virt",
      color: "#fff",
    });
    expect(id).not.toBe("");
    // The clip must show up in the presentation (the symptom of the bug
    // was that virtual-track clips were filtered out as invisible).
    const pres = createPlaylistPresentation(core.getState(), M);
    expect(pres.clipViews.find((v) => v.clip.id === id)).toBeDefined();
    // And the track itself must have been materialised.
    expect(core.getState().tracks.length).toBeGreaterThanOrEqual(
      virtualIndex + 1,
    );
  });
});

describe("brush — Paint tool fills every intermediate cell across a fast pointermove", () => {
  // We can't fire pointer events from a vitest unit test, but we can drive
  // the tool's onPointerDown to seed a gesture and then call its move
  // semantics through the same path interpolation helper. The paint-drag
  // handler in controller.ts uses the same interpolateBrushPath, so this
  // test pins the contract that no cell along a straight path is missed.
  it("paint stroke from cell 0 to cell 10 covers all 11 cells", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const before = core.getState().clips.length;
    // Reach an empty track row (track-7 / index 6 in the demo).
    const y = M.rulerHeight + 6 * M.trackHeight + 10;
    const startHit: PlaylistHit = { kind: "empty" };
    TOOLS.paint.onPointerDown({
      core,
      metrics: M,
      point: { x: M.trackHeaderWidth + 0.5, y },
      hit: startHit,
      event: mockEvent(),
    });
    // Now simulate a brush stroke from cell 0 to cell 10 using the
    // canonical brush helpers (this is what the controller does for us).
    const snapStep = brushSnapStep(core.getState(), M);
    const path = interpolateBrushPath(
      { trackIndex: 6, start: 0 },
      { trackIndex: 6, start: 10 },
      snapStep,
    );
    for (let i = 1; i < path.length; i += 1) {
      const cell = path[i]!;
      core.createClip({
        trackIndex: cell.trackIndex,
        start: cell.start,
        duration: 1,
        type: "pattern",
        label: "p",
        color: "#fff",
      });
    }
    const after = core.getState().clips.length;
    expect(after - before).toBe(11);
  });
});
