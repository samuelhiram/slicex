import {
  getTrackIdByIndex,
  snapStepBeats,
  type PlaylistMetrics,
  type PlaylistState,
} from "../playlist-core";

// Canonical brush-stroke primitives shared by the Paint tool (and any
// future "drag-paint" gesture, e.g. delete-drag-by-cell).
//
// Two guarantees:
//
// 1. Interpolation: a single move event between two distant cells fills
//    every snapped cell along the path. No skipped cells when the mouse
//    moves faster than the rAF tick (canon §3.6 — stable in steady state).
//
// 2. O(1) occlusion query: the gesture seeds an "occupied" set with every
//    snapped cell currently covered by an existing clip, and adds to it as
//    new clips are painted. The Paint handler never walks state.clips per
//    move — canon §2.3 (no O(N) in hot path).

export interface BrushCell {
  trackIndex: number;
  start: number; // beats, already snapped
}

export interface BrushOcclusion {
  has(trackIndex: number, start: number, state: PlaylistState): boolean;
  add(trackIndex: number, start: number, state: PlaylistState): void;
}

// Compose a stable string key from (trackId, snapped time). Both inputs
// are pre-normalised so the key matches between seed and probe.
function cellKey(trackId: string, start: number): string {
  return `${trackId}|${start.toFixed(4)}`;
}

/**
 * Seed an occupied-cells set from the current state. Each existing clip
 * marks every snapped cell its body covers as occupied. The result has
 * O(1) `has` and `add`.
 *
 * `snapStep` should be the value the brush will use to step the path —
 * typically `snapStepBeats(state.snap.mode)`. If the snap mode is `none`
 * or `events`, falls back to a 1-beat step so the helper still produces
 * stable keys.
 */
export function buildBrushOcclusion(
  state: PlaylistState,
  snapStep: number,
): BrushOcclusion {
  const set = new Set<string>();
  const step = snapStep > 0 ? snapStep : 1;
  for (const clip of state.clips) {
    const clipStart = Math.round(clip.start / step) * step;
    const clipEnd = clip.start + clip.duration;
    for (
      let t = clipStart;
      t < clipEnd - 1e-9;
      t = Number((t + step).toFixed(6))
    ) {
      set.add(cellKey(clip.trackId, t));
    }
  }
  return {
    has(trackIndex: number, start: number, currentState: PlaylistState) {
      const trackId = getTrackIdByIndex(currentState, trackIndex);
      return set.has(cellKey(trackId, start));
    },
    add(trackIndex: number, start: number, currentState: PlaylistState) {
      const trackId = getTrackIdByIndex(currentState, trackIndex);
      set.add(cellKey(trackId, start));
    },
  };
}

/**
 * Compute the snapped cells along a brush stroke from `from` to `to`.
 *
 * Step count is `max(|trackDelta|, ceil(|timeDelta| / snapStep))` so we
 * never miss a cell when one axis dominates. Cells are deduplicated, so a
 * shallow diagonal that snaps several steps to the same cell only emits
 * one entry.
 */
export function interpolateBrushPath(
  from: BrushCell,
  to: BrushCell,
  snapStep: number,
): BrushCell[] {
  const step = snapStep > 0 ? snapStep : 1;
  const trackDelta = to.trackIndex - from.trackIndex;
  const timeDelta = to.start - from.start;
  const stepCount = Math.max(
    Math.abs(trackDelta),
    Math.ceil(Math.abs(timeDelta) / step),
  );
  if (stepCount === 0) {
    return [{ trackIndex: to.trackIndex, start: Math.max(0, to.start) }];
  }
  const cells: BrushCell[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= stepCount; i += 1) {
    const t = i / stepCount;
    const ti = Math.round(from.trackIndex + trackDelta * t);
    const rawTime = from.start + timeDelta * t;
    const snappedTime = Math.max(0, Math.round(rawTime / step) * step);
    const key = `${ti}|${snappedTime.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ trackIndex: ti, start: snappedTime });
  }
  return cells;
}

/**
 * Convenience helper: returns the snap step the brush should use for the
 * current state. Reads the active snap mode and falls back to 1 beat for
 * non-grid modes (none / events).
 */
export function brushSnapStep(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): number {
  const step = snapStepBeats(state.snap.mode, metrics);
  return step > 0 ? step : 1;
}
