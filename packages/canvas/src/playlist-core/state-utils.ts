import {
  clamp,
  getMaxScrollX,
  getMaxScrollY,
  isAutomationClip,
} from "./geometry";
import type {
  PlaylistAutomationClip,
  PlaylistAutomationPoint,
  PlaylistClip,
  PlaylistMetrics,
  PlaylistSelection,
  PlaylistState,
} from "./types";

const POINT_EPSILON = 1e-6;

// Linear value of an automation envelope at a clip-local time. Points are
// sorted before reading; outside the point range the envelope holds its
// endpoint, which matches how the renderer draws the leading/trailing legs.
//
// An empty envelope has no value to report, so callers get `null` and decide
// what that means. Returning 0 here would let "no data" masquerade as "the
// minimum", which is how a slice used to invent a flat line out of nothing.
//
// On a vertical step (two points sharing a time) the value is ambiguous by
// definition; this returns the value *approaching from the left*, so reading
// exactly at the step gives the pre-step level, deterministically.
export function automationValueAtTime(
  points: PlaylistAutomationPoint[],
  time: number,
): number | null {
  if (points.length === 0) return null;
  const sorted = sortAutomationPoints(points.map((point) => ({ ...point })));

  const exact = sorted.find(
    (point) => Math.abs(point.time - time) <= POINT_EPSILON,
  );
  if (exact) return exact.value;

  const first = sorted[0]!;
  if (time <= first.time) return first.value;
  const last = sorted[sorted.length - 1]!;
  if (time >= last.time) return last.value;

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    if (time <= next.time) {
      const span = next.time - prev.time;
      if (span <= POINT_EPSILON) return next.value;
      const ratio = (time - prev.time) / span;
      return prev.value + (next.value - prev.value) * ratio;
    }
  }
  return last.value;
}

// Mint an id that cannot collide with any already present in `taken`.
// Point ids derive from their owning clip id (see `makePointId`), so a half
// that changes clip must re-mint, and a half that keeps its clip must NOT —
// renumbering ids in place silently repoints a live selection at a different
// point.
function mintPointId(clipId: string, taken: Set<string>): string {
  let index = taken.size + 1;
  let id = `${clipId}-pt-${index}`;
  while (taken.has(id)) {
    index += 1;
    id = `${clipId}-pt-${index}`;
  }
  taken.add(id);
  return id;
}

// Split an automation envelope at a clip-local cut time.
//
// Both halves keep the ORIGINAL SHAPE: the cut is materialised on each side
// with the interpolated value, and the right half is rebased so it starts at
// 0. Without this, slicing left every point past the cut to be flattened
// against the new edge.
//
// Points sitting exactly ON the cut go to BOTH halves, which is what keeps a
// vertical step (two points sharing a time) intact instead of dropping the
// post-step point.
//
// The LEFT half keeps its clip id, so its surviving points keep their ids and
// any live selection stays pointing at the same point. Only the cut point is
// minted. The RIGHT half is a new clip, so all of its ids are re-minted.
export function splitAutomationPoints(
  points: PlaylistAutomationPoint[],
  cutLocal: number,
  leftClipId: string,
  rightClipId: string,
  // Only used to place the trailing point when a half would otherwise be left
  // with a single one. Times are never clamped against it — the clip is a
  // window, and points may legitimately sit outside it.
  rightDuration = 0,
): { left: PlaylistAutomationPoint[]; right: PlaylistAutomationPoint[] } {
  // Nothing to split: an empty envelope stays empty on both sides rather than
  // conjuring a flat line.
  if (points.length === 0) return { left: [], right: [] };

  const sorted = sortAutomationPoints(points.map((point) => ({ ...point })));
  const cutValue = automationValueAtTime(sorted, cutLocal) ?? 0;
  const hasPointOnCut = sorted.some(
    (point) => Math.abs(point.time - cutLocal) <= POINT_EPSILON,
  );

  const leftIds = new Set(sorted.map((point) => point.id));
  const left: PlaylistAutomationPoint[] = sorted
    .filter((point) => point.time <= cutLocal + POINT_EPSILON)
    .map((point) => ({ ...point, value: clamp(point.value, 0, 1) }));
  if (!hasPointOnCut) {
    left.push({
      id: mintPointId(leftClipId, leftIds),
      time: cutLocal,
      value: clamp(cutValue, 0, 1),
    });
  }

  const rightIds = new Set<string>();
  const right: PlaylistAutomationPoint[] = [];
  if (!hasPointOnCut) {
    right.push({
      id: mintPointId(rightClipId, rightIds),
      time: 0,
      value: clamp(cutValue, 0, 1),
    });
  }
  for (const point of sorted) {
    if (point.time < cutLocal - POINT_EPSILON) continue;
    right.push({
      id: mintPointId(rightClipId, rightIds),
      time: Math.max(0, point.time - cutLocal),
      value: clamp(point.value, 0, 1),
    });
  }

  // An envelope describes segments, so a half needs two points. When a cut
  // lands before the first point (or after the last), one side ends up with a
  // single one. The filler is the level the envelope actually HOLDS there —
  // read from the real data, not invented — so the shape is unchanged.
  if (left.length === 1) {
    const held = automationValueAtTime(sorted, 0) ?? left[0]!.value;
    left.unshift({
      id: mintPointId(leftClipId, leftIds),
      time: 0,
      value: clamp(held, 0, 1),
    });
  }
  if (right.length === 1) {
    const tail = Math.max(rightDuration, POINT_EPSILON);
    right.push({
      id: mintPointId(rightClipId, rightIds),
      time: tail,
      value: right[0]!.value,
    });
  }

  return { left, right };
}

// Pure state transforms live here so the mutable PlaylistCore facade stays small and easy to scan.
export function cloneSelection(
  selection: PlaylistSelection,
): PlaylistSelection {
  return {
    clipIds: [...selection.clipIds],
    automationPointIds: [...selection.automationPointIds],
  };
}

export function cloneClip(clip: PlaylistClip): PlaylistClip {
  if (isAutomationClip(clip)) {
    return {
      ...clip,
      points: clip.points.map((point) => ({ ...point })),
    };
  }

  return { ...clip };
}

export function cloneState(state: PlaylistState): PlaylistState {
  return {
    tracks: state.tracks.map((track) => ({ ...track })),
    clips: state.clips.map(cloneClip),
    viewport: { ...state.viewport },
    snap: { ...state.snap },
    selection: cloneSelection(state.selection),
    marquee: state.marquee
      ? {
          start: { ...state.marquee.start },
          current: { ...state.marquee.current },
        }
      : null,
    contextMenu: state.contextMenu
      ? {
          ...state.contextMenu,
          position: { ...state.contextMenu.position },
        }
      : null,
    hover: state.hover ? { ...state.hover } : null,
    playPosition: { ...state.playPosition },
    tool: state.tool ?? "select",
    clipboard: state.clipboard
      ? {
          entries: state.clipboard.entries.map((entry) => ({
            clip: cloneClip(entry.clip),
            startOffset: entry.startOffset,
            trackOffset: entry.trackOffset,
          })),
          span: state.clipboard.span,
        }
      : null,
    stretchMode: state.stretchMode ?? false,
    markers: state.markers ? state.markers.map((m) => ({ ...m })) : [],
    transport: state.transport
      ? { ...state.transport }
      : { mode: "song", recording: false },
    dragPreview: cloneDragPreview(state.dragPreview ?? null),
    snapHint: state.snapHint ? { ...state.snapHint } : null,
    tooltip: state.tooltip
      ? { ...state.tooltip, anchor: { ...state.tooltip.anchor } }
      : null,
  };
}

function cloneDragPreview(
  preview: PlaylistState["dragPreview"],
): PlaylistState["dragPreview"] {
  if (!preview) return null;
  if (preview.kind === "clip-move") {
    return {
      ...preview,
      allMoves: preview.allMoves.map((m) => ({ ...m })),
    };
  }
  return { ...preview };
}

export function sortAutomationPoints(
  points: PlaylistAutomationClip["points"],
): PlaylistAutomationClip["points"] {
  return [...points].sort((left, right) => left.time - right.time);
}

export function normalizeState(
  input: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistState {
  const state = cloneState(input);

  state.viewport.pxPerBeat = clamp(
    state.viewport.pxPerBeat,
    metrics.minPxPerBeat,
    metrics.maxPxPerBeat,
  );
  state.viewport.scrollX = clamp(
    state.viewport.scrollX,
    0,
    getMaxScrollX(state, metrics),
  );
  state.viewport.scrollY = clamp(
    state.viewport.scrollY,
    0,
    getMaxScrollY(state, metrics),
  );
  state.playPosition.time = Math.max(0, state.playPosition.time);
  state.clips = state.clips.map((clip) => {
    const duration = Math.max(metrics.minClipDuration, clip.duration);
    const start = Math.max(0, clip.start);

    if (isAutomationClip(clip)) {
      return {
        ...clip,
        start,
        duration,
        // `point.time` is NOT clamped to `duration`. It used to be, and that
        // was destructive: normalizeState runs on every dispatch and its
        // output is what lands in history, so shrinking an automation clip by
        // a couple of pixels permanently stacked every point past the new edge
        // against it — growing the clip back did not restore them. The clip is
        // a WINDOW over its envelope; points outside the window stay in the
        // model and the presentation layer decides what is visible.
        // Values stay clamped: 0..1 is the range of the envelope itself, not
        // of the window.
        points: sortAutomationPoints(
          clip.points.map((point) => ({
            ...point,
            time: Math.max(0, point.time),
            value: clamp(point.value, 0, 1),
          })),
        ),
      };
    }

    return { ...clip, start, duration };
  });

  return state;
}
