// Stacked lanes inside a track (a "slot" in product language).
//
// Clips of one track that overlap in time never cover each other: each sits
// in a lane (`clip.lane`, 0 = top) and the track is as tall as its lanes
// (`track.lanes` × the lane height). The rules come from the shift planner
// of postalhub-dashboard (ShiftPlanner/shiftCalendarLayout.ts), where they
// stack shifts inside a day:
//
//   - what you see while dragging is what stays: the clip just dropped
//     (pinned) keeps the lane it was dropped on;
//   - every other clip keeps the lane it already had (remembered). If the
//     dropped one lands on it, it takes the lane the dropped one left
//     (vacated: they swap) or, failing that, the nearest free lane (up
//     first); else a new lane at the bottom;
//   - clips new to the track (created, pasted, moved from another track
//     with no lane) take the first free lane from the top, by start;
//   - lanes left empty across the whole track are removed, order kept.
//
// While a pointer gesture is open nothing is re-laid out (provisional): the
// dragged clips sit on the lane under the pointer — even over another clip
// — and a track never loses lanes, so rows don't jump under the pointer.
// The row under a dragged clip opens one extra, empty lane (the "free
// lane", drawn dashed) to drop on and stack. The gesture's end settles.
//
// Drawn width (`footprint`, optional): a clip may be drawn wider than its
// time (a one-day tag as wide as its name). Lanes then keep the DRAWN cards
// apart: two that would touch cascade — the one that starts first keeps the
// lane, the next goes one lane down, and so on. A clip pushed down only by a
// drawn width remembers the lane it left (`homeLane`) and goes back to it
// when there is room again (zooming in); a real overlap in time moves it
// for good, as before.
//
// Costs: settle is O(n log n) and runs only when clips change outside a
// gesture, once when a gesture ends, or when the zoom crosses a footprint
// level (the core's buckets); provisional is O(n) per drag move (the move
// itself already re-normalises every clip). Arrays and objects keep their
// identity when no lane changes (canon §3.13).
import type { PlaylistClip, PlaylistState, PlaylistTrack } from "./types";

export type LaneMode = "pinned" | "remembered" | "fresh";

export interface LaneRequest {
  start: number;
  end: number;
  /** Where the drawn card ends (≥ end; default end): what may not touch. */
  visualEnd?: number;
  /** Preferred lane (pinned / remembered). Ignored for fresh. */
  lane: number;
  mode: LaneMode;
}

interface Occupant {
  start: number;
  /** Its time's end. */
  end: number;
  /** Its drawn card's end (≥ end). */
  visualEnd: number;
}

// Occupants of one lane never overlap (as drawn, hence in time too) and are
// kept sorted by start (hence by either end too): the only candidate to
// overlap [start, end) is the last one that starts before `end`.
function lastStartingBefore(lane: Occupant[], end: number): number {
  let lo = 0;
  let hi = lane.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lane[mid]!.start < end) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** The drawn card [start, visualEnd) touches no drawn card of the lane. */
function fits(lane: Occupant[] | undefined, start: number, visualEnd: number): boolean {
  if (!lane || lane.length === 0) return true;
  const index = lastStartingBefore(lane, visualEnd);
  return index < 0 || lane[index]!.visualEnd <= start;
}

/** [start, end) overlaps no occupant of the lane in TIME (drawn widths aside). */
function fitsInTime(lane: Occupant[] | undefined, start: number, end: number): boolean {
  if (!lane || lane.length === 0) return true;
  const index = lastStartingBefore(lane, end);
  return index < 0 || lane[index]!.end <= start;
}

function insert(lane: Occupant[], item: Occupant): void {
  let lo = 0;
  let hi = lane.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lane[mid]!.start < item.start) lo = mid + 1;
    else hi = mid;
  }
  lane.splice(lo, 0, item);
}

export interface LaneLayout {
  lanes: number[];
  laneCount: number;
  /**
   * For a clip cascaded down only by a drawn width, the lane its time alone
   * gives it (its home); undefined otherwise.
   */
  homes: Array<number | undefined>;
}

/**
 * Lanes for the clips of ONE track (same order as `requests`) and how many
 * lanes the track needs (≥ 1). `vacatedLane`: the lane a pinned clip left in
 * this track — a clip it lands on moves there first (they swap).
 *
 * Two passes when some card is drawn wider than its time: first the lanes
 * by time alone (remembered lanes kept, new clips first-fit by start, the
 * drop rules) — each clip's home; then, lane by lane in order of start, the
 * drawn cards: the one that starts first keeps the lane, the ones it would
 * touch cascade down. Without drawn widths the second pass changes nothing,
 * so it is skipped.
 */
export function assignLanes(requests: readonly LaneRequest[], vacatedLane?: number): LaneLayout {
  let drawnWider = false;
  for (const request of requests) {
    if ((request.visualEnd ?? request.end) > request.end) {
      drawnWider = true;
      break;
    }
  }
  const byTime = layLanes(
    drawnWider ? requests.map((request) => ({ ...request, visualEnd: request.end })) : requests,
    vacatedLane,
  );
  if (!drawnWider) return byTime;
  // Every clip asks for its time lane (pinned ones keep theirs, from there down).
  return layLanes(
    requests.map((request, index) => ({
      ...request,
      lane: byTime.lanes[index]!,
      mode: request.mode === "pinned" ? ("pinned" as const) : ("remembered" as const),
    })),
  );
}

function layLanes(requests: readonly LaneRequest[], vacatedLane?: number): LaneLayout {
  const count = requests.length;
  const out = new Array<number>(count);
  const homes = new Array<number | undefined>(count);
  if (count === 0) return { lanes: out, laneCount: 1, homes };

  const lanes: Occupant[][] = [];
  const visualEndOf = (request: LaneRequest) => Math.max(request.end, request.visualEnd ?? request.end);
  const put = (index: number, lane: number) => {
    const request = requests[index]!;
    insert((lanes[lane] ??= []), {
      start: request.start,
      end: request.end,
      visualEnd: visualEndOf(request),
    });
    out[index] = lane;
  };
  const placeFrom = (index: number, firstLane: number) => {
    const request = requests[index]!;
    const visualEnd = visualEndOf(request);
    let lane = Math.max(0, firstLane);
    while (!fits(lanes[lane], request.start, visualEnd)) lane += 1;
    put(index, lane);
  };
  // Its lane; else the one the dropped clip left; else the nearest free
  // (at equal distance, the one above); else a new one at the bottom. When
  // only a drawn width is in the way (the times fit), it cascades DOWN
  // (the one that starts first keeps the lane) and remembers its home.
  const placeNear = (index: number, wanted: number) => {
    const request = requests[index]!;
    const { start, end } = request;
    const visualEnd = visualEndOf(request);
    const lane = Math.max(0, wanted);
    if (fits(lanes[lane], start, visualEnd)) return put(index, lane);
    if (fitsInTime(lanes[lane], start, end)) {
      homes[index] = lane;
      let below = lane + 1;
      while (!fits(lanes[below], start, visualEnd)) below += 1;
      return put(index, below);
    }
    if (vacatedLane !== undefined && fits(lanes[vacatedLane], start, visualEnd)) {
      return put(index, vacatedLane);
    }
    for (let d = 1; d <= lanes.length + 1; d += 1) {
      if (lane - d >= 0 && fits(lanes[lane - d], start, visualEnd)) return put(index, lane - d);
      if (fits(lanes[lane + d], start, visualEnd)) return put(index, lane + d);
    }
    return put(index, lanes.length);
  };

  const pinned: number[] = [];
  const remembered: number[] = [];
  const fresh: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const mode = requests[i]!.mode;
    if (mode === "pinned") pinned.push(i);
    else if (mode === "remembered") remembered.push(i);
    else fresh.push(i);
  }
  const byLaneThenStart = (a: number, b: number) =>
    requests[a]!.lane - requests[b]!.lane || requests[a]!.start - requests[b]!.start;
  pinned.sort(byLaneThenStart).forEach((i) => placeFrom(i, requests[i]!.lane));
  remembered.sort(byLaneThenStart).forEach((i) => placeNear(i, requests[i]!.lane));
  fresh
    .sort((a, b) => requests[a]!.start - requests[b]!.start || requests[b]!.end - requests[a]!.end)
    .forEach((i) => placeFrom(i, 0));

  // No empty lanes in between.
  const rank = new Array<number>(lanes.length);
  let used = 0;
  for (let lane = 0; lane < lanes.length; lane += 1) {
    if (lanes[lane] && lanes[lane]!.length > 0) {
      rank[lane] = used;
      used += 1;
    }
  }
  for (let i = 0; i < count; i += 1) {
    out[i] = rank[out[i]!]!;
    // A home lane past the compaction: the nearest lane that is left.
    const home = homes[i];
    if (home !== undefined) {
      let ranked = -1;
      for (let lane = Math.min(home, lanes.length - 1); lane >= 0 && ranked < 0; lane -= 1) {
        if (rank[lane] !== undefined) ranked = rank[lane]!;
      }
      homes[i] = ranked >= 0 && ranked !== out[i] ? ranked : undefined;
    }
  }
  return { lanes: out, laneCount: Math.max(1, used), homes };
}

const NO_PINNED: ReadonlySet<string> = new Set();

export interface SettleLanesOptions {
  /** Clips that keep the lane they ask for (just dropped by a drag). */
  pinned?: ReadonlySet<string>;
  /**
   * The state the change started from (the previous dispatch, or the
   * state before a gesture). A clip that was not in its current track there
   * is new to it (first free lane); a pinned clip's lane there is the lane
   * it vacated. null: every clip keeps the lane it carries.
   */
  previous?: PlaylistState | null;
  /**
   * Where each clip's DRAWN card ends, in beats (≥ its time's end): cards
   * drawn wider than their time keep apart too (they cascade). Absent: the
   * time alone.
   */
  footprint?: (clip: PlaylistClip) => number;
}

export function laneOf(clip: PlaylistClip): number {
  return clip.lane ?? 0;
}

export function laneCountOf(track: PlaylistTrack): number {
  return Math.max(1, Math.floor(track.lanes ?? 1));
}

function withLane(clip: PlaylistClip, lane: number, home: number | undefined): PlaylistClip {
  const next = { ...clip };
  if (lane > 0) next.lane = lane;
  else delete next.lane;
  if (home !== undefined) next.homeLane = home;
  else delete next.homeLane;
  return next;
}

function withLaneCount(track: PlaylistTrack, lanes: number): PlaylistTrack {
  const next = { ...track };
  if (lanes > 1) next.lanes = lanes;
  else delete next.lanes;
  return next;
}

// Copy-on-write of the tracks whose lane count differs from `counts`
// (tracks missing from it need one lane). Same array when none changes.
function applyLaneCounts(
  tracks: PlaylistTrack[],
  counts: ReadonlyMap<string, number>,
): PlaylistTrack[] {
  let next: PlaylistTrack[] | null = null;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i]!;
    const lanes = counts.get(track.id) ?? 1;
    // Stored only when > 1 (absent = one lane).
    if (track.lanes === (lanes > 1 ? lanes : undefined)) continue;
    next ??= tracks.slice();
    next[i] = withLaneCount(track, lanes);
  }
  return next ?? tracks;
}

/**
 * Settled lanes: no two clips of a track overlap in one lane, no empty
 * lanes, every track as many lanes as it needs. Same state when nothing
 * changes.
 */
export function settleLanes(
  state: PlaylistState,
  options: SettleLanesOptions = {},
): PlaylistState {
  const pinned = options.pinned ?? NO_PINNED;
  const previous = options.previous ?? null;
  const footprint = options.footprint;
  const clips = state.clips;

  const byTrack = new Map<string, number[]>();
  for (let i = 0; i < clips.length; i += 1) {
    const trackId = clips[i]!.trackId;
    let list = byTrack.get(trackId);
    if (!list) byTrack.set(trackId, (list = []));
    list.push(i);
  }

  let before: Map<string, PlaylistClip> | null = null;
  const vacated = new Map<string, number>();
  if (previous && previous.clips !== clips) {
    before = new Map();
    for (const clip of previous.clips) before.set(clip.id, clip);
    for (const id of pinned) {
      const origin = before.get(id);
      if (origin && !vacated.has(origin.trackId)) vacated.set(origin.trackId, laneOf(origin));
    }
  }

  let nextClips: PlaylistClip[] | null = null;
  const counts = new Map<string, number>();
  for (const [trackId, indices] of byTrack) {
    const requests: LaneRequest[] = indices.map((i) => {
      const clip = clips[i]!;
      let mode: LaneMode = "remembered";
      if (pinned.has(clip.id)) mode = "pinned";
      else if (before) {
        const origin = before.get(clip.id);
        if (!origin || origin.trackId !== trackId) mode = "fresh";
      }
      const end = clip.start + clip.duration;
      return {
        start: clip.start,
        end,
        visualEnd: footprint ? footprint(clip) : end,
        // A clip cascaded by a drawn width asks for its home lane back.
        lane: mode === "remembered" ? (clip.homeLane ?? laneOf(clip)) : laneOf(clip),
        mode,
      };
    });
    const { lanes, laneCount, homes } = assignLanes(requests, vacated.get(trackId));
    counts.set(trackId, laneCount);
    for (let k = 0; k < indices.length; k += 1) {
      const i = indices[k]!;
      const clip = clips[i]!;
      if (laneOf(clip) === lanes[k] && clip.homeLane === homes[k]) continue;
      nextClips ??= clips.slice();
      nextClips[i] = withLane(clip, lanes[k]!, homes[k]);
    }
  }

  const nextTracks = applyLaneCounts(state.tracks, counts);
  if (nextClips === null && nextTracks === state.tracks) return state;
  return { ...state, clips: nextClips ?? clips, tracks: nextTracks };
}

/**
 * Lanes while a pointer gesture is open: clips stay on the lanes they carry
 * (a dragged one on the lane under the pointer, even over another clip); a
 * track keeps at least the lanes it had when the gesture started, plus the
 * free lane of the row under a dragged clip (`dragPreview.freeLane`).
 */
export function provisionalLanes(state: PlaylistState, base: PlaylistState): PlaylistState {
  const counts = new Map<string, number>();
  for (const track of base.tracks) {
    if (track.lanes !== undefined) counts.set(track.id, laneCountOf(track));
  }
  for (const clip of state.clips) {
    const needed = laneOf(clip) + 1;
    if (needed > (counts.get(clip.trackId) ?? 1)) counts.set(clip.trackId, needed);
  }
  // The row under the drag opens the lane it previews: the free lane of a
  // move, or the lane a clip about to be created takes when none of the
  // row's lanes is free at those times.
  const preview = state.dragPreview;
  const opened =
    preview && preview.kind === "clip-move"
      ? preview.freeLane ?? null
      : preview && preview.kind === "clip-create"
        ? { trackIndex: preview.trackIndex, lane: preview.lane }
        : null;
  if (opened) {
    const track = state.tracks[opened.trackIndex];
    if (track) {
      const needed = opened.lane + 1;
      if (needed > (counts.get(track.id) ?? 1)) counts.set(track.id, needed);
    }
  }
  const tracks = applyLaneCounts(state.tracks, counts);
  return tracks === state.tracks ? state : { ...state, tracks };
}
