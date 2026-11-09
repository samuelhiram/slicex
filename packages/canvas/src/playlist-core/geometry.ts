import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationClip,
  type PlaylistAutomationPoint,
  type PlaylistClip,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistRect,
  type PlaylistSnapMode,
  type PlaylistState,
  type PlaylistStepSeries,
  type PlaylistTimeAxis,
  type PlaylistTrack,
} from "./types";

const SNAP_EVENTS_TOLERANCE_PX = 8;
const SNAP_EVENTS_FALLBACK_TOLERANCE_BEATS = 0.5;
// "axis" snap: targets are requested on a window of ±AXIS_SNAP_WINDOW beats
// around the raw time (quantized so consecutive pointermoves reuse the same
// request), widened ×8 up to AXIS_SNAP_ATTEMPTS times while empty.
const AXIS_SNAP_WINDOW = 64;
const AXIS_SNAP_ATTEMPTS = 4;

// Layout switches that live on the core (PlaylistCoreOptions), not in the
// metrics. Absent = the historical layout.
export interface PlaylistLayoutOptions {
  // false: no virtual "Track N" rows below the real tracks, and the vertical
  // extent / scroll stop at the last real track (see PlaylistCoreOptions).
  virtualTracks?: boolean;
}

// Height of the overview lane (0 when the metrics have none). Defensive
// against metrics objects built before the field existed.
export function getOverviewLaneHeight(
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const height = metrics.overviewLaneHeight;
  return height > 0 ? height : 0;
}

// Screen Y where the track area starts: ruler + overview lane. Every
// consumer that used to start the tracks at `rulerHeight` goes through this
// (with no lane it IS rulerHeight, so the layout is unchanged).
export function getTracksTop(
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return metrics.rulerHeight + getOverviewLaneHeight(metrics);
}

// Resolve the step (in beats) used by mode-driven snap. Returns 0 for
// non-grid modes ("none", "events" and "axis") so callers can branch.
export function snapStepBeats(
  mode: PlaylistSnapMode,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  switch (mode) {
    case "none":
    case "events":
    case "axis":
      return 0;
    case "main":
    case "beat":
    case "cell":
      return 1;
    case "line":
    case "bar":
      return metrics.beatsPerBar;
    case "sixth-step":
      return 1 / 24;
    case "quarter-step":
      return 1 / 16;
    case "third-step":
      return 1 / 12;
    case "half-step":
      return 1 / 8;
    case "step":
      return 1 / 4;
    case "sixth-beat":
      return 1 / 6;
    case "quarter-beat":
      return 1 / 4;
    case "third-beat":
      return 1 / 3;
    case "half-beat":
      return 1 / 2;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function isAutomationClip(
  clip: PlaylistClip,
): clip is PlaylistAutomationClip {
  return clip.type === "automation";
}

// FL Studio: a track is effectively muted when its mute flag is on, or when
// any other track is soloed and this one is not.
export function isTrackEffectivelyMuted(
  state: PlaylistState,
  track: PlaylistTrack,
): boolean {
  if (track.muted) {
    return true;
  }
  if (track.soloed) {
    return false;
  }
  return state.tracks.some((candidate) => candidate.soloed);
}

export function normalizeRect(rect: PlaylistRect): PlaylistRect {
  const x = Math.min(rect.x, rect.x + rect.width);
  const y = Math.min(rect.y, rect.y + rect.height);

  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export function rectsIntersect(
  left: PlaylistRect,
  right: PlaylistRect,
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function pointInRect(point: PlaylistPoint, rect: PlaylistRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// Half-width (px) of the zoom handles at the ends of the horizontal
// scrollbar's thumb (the timeline navigator), and the thumb width below
// which it has none.
export const SCROLLBAR_EDGE_PX = 6;
export const SCROLLBAR_EDGE_MIN_THUMB = 36;

export function getHorizontalScrollbarRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  return {
    x: metrics.trackHeaderWidth,
    y: Math.max(getTracksTop(metrics), state.viewport.height - metrics.scrollbarSize),
    width: Math.max(
      metrics.scrollbarThumbMin,
      state.viewport.width - metrics.trackHeaderWidth - metrics.scrollbarSize,
    ),
    height: metrics.scrollbarSize,
  };
}

export function getVerticalScrollbarRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  const tracksTop = getTracksTop(metrics);
  return {
    x: Math.max(metrics.trackHeaderWidth, state.viewport.width - metrics.scrollbarSize),
    y: tracksTop,
    width: metrics.scrollbarSize,
    height: Math.max(
      metrics.scrollbarThumbMin,
      state.viewport.height - tracksTop - metrics.scrollbarSize,
    ),
  };
}

// Total horizontal extent (in pixels) the timeline considers "addressable"
// for scrollbar purposes. Grows with the content end and with however far
// the user has already scrolled, so the timeline stays effectively infinite
// but the thumb always represents an absolute position in [0, extent].
export function getHorizontalContentExtent(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const contentEndPx = getContentEndBeat(state) * state.viewport.pxPerBeat;
  const viewportWidth = Math.max(
    0,
    state.viewport.width - metrics.trackHeaderWidth,
  );
  return Math.max(
    contentEndPx + viewportWidth,
    state.viewport.scrollX + viewportWidth,
    viewportWidth,
  );
}

export function getHorizontalScrollableRange(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const viewportWidth = Math.max(
    0,
    state.viewport.width - metrics.trackHeaderWidth,
  );
  return Math.max(1, getHorizontalContentExtent(state, metrics) - viewportWidth);
}

// Height of the track area: viewport minus ruler and overview lane.
function getTrackAreaHeight(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): number {
  return Math.max(0, state.viewport.height - getTracksTop(metrics));
}

// Sum of the real (materialised) track heights.
export function getRealTracksHeight(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  let totalHeight = 0;
  for (const track of state.tracks) {
    totalHeight += getTrackHeight(track, metrics);
  }
  return totalHeight;
}

// Vertical scroll limit with virtual tracks OFF: the last real track's
// bottom rests right above the horizontal scrollbar. Below it there is
// nothing to reveal, so scrolling further only shows empty background.
// getMaxScrollY stays infinite (canon §2.5: the infinite axis is X, and the
// cost is bounded by the presentation cull, not by this limit); the core
// applies this limit only when created with virtualTracks: false.
export function getRealTracksScrollLimit(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return Math.max(
    0,
    getRealTracksHeight(state, metrics) +
      metrics.scrollbarSize -
      getTrackAreaHeight(state, metrics),
  );
}

export function getVerticalContentExtent(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
  layout: PlaylistLayoutOptions = {},
): number {
  const totalHeight = getRealTracksHeight(state, metrics);
  const viewportHeight = getTrackAreaHeight(state, metrics);
  if (layout.virtualTracks === false) {
    // No virtual rows: the content is the real tracks plus room for the
    // horizontal scrollbar (consistent with getRealTracksScrollLimit).
    return Math.max(
      totalHeight + metrics.scrollbarSize,
      state.viewport.scrollY + viewportHeight,
      viewportHeight,
    );
  }
  // Buffer a few virtual tracks beyond materialised content so the thumb has
  // somewhere to go for placing brand-new tracks.
  const buffer = 4 * metrics.trackHeight;
  return Math.max(
    totalHeight + buffer,
    state.viewport.scrollY + viewportHeight,
    viewportHeight,
  );
}

export function getVerticalScrollableRange(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
  layout: PlaylistLayoutOptions = {},
): number {
  const viewportHeight = getTrackAreaHeight(state, metrics);
  return Math.max(
    1,
    getVerticalContentExtent(state, metrics, layout) - viewportHeight,
  );
}

export function getHorizontalScrollbarThumbRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  const track = getHorizontalScrollbarRect(state, metrics);
  const extent = getHorizontalContentExtent(state, metrics);
  const viewportWidth = Math.max(
    0,
    state.viewport.width - metrics.trackHeaderWidth,
  );
  const ratio = extent > 0 ? viewportWidth / extent : 1;
  const width = clamp(
    track.width * ratio,
    metrics.scrollbarThumbMin,
    track.width,
  );
  const travel = Math.max(1, track.width - width);
  const scrollable = Math.max(1, extent - viewportWidth);
  const positionRatio = clamp(state.viewport.scrollX / scrollable, 0, 1);

  return {
    x: track.x + positionRatio * travel,
    y: track.y + 2,
    width,
    height: Math.max(1, track.height - 4),
  };
}

export function getVerticalScrollbarThumbRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
  layout: PlaylistLayoutOptions = {},
): PlaylistRect {
  const track = getVerticalScrollbarRect(state, metrics);
  const extent = getVerticalContentExtent(state, metrics, layout);
  const viewportHeight = getTrackAreaHeight(state, metrics);
  const ratio = extent > 0 ? viewportHeight / extent : 1;
  const height = clamp(
    track.height * ratio,
    metrics.scrollbarThumbMin,
    track.height,
  );
  const travel = Math.max(1, track.height - height);
  const scrollable = Math.max(1, extent - viewportHeight);
  const positionRatio = clamp(state.viewport.scrollY / scrollable, 0, 1);

  return {
    x: track.x + 2,
    y: track.y + positionRatio * travel,
    width: Math.max(1, track.width - 4),
    height,
  };
}

export function getContextMenuRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect | null {
  if (!state.contextMenu) {
    return null;
  }

  const itemCount = 6;
  const width = metrics.contextMenuWidth;
  const height = itemCount * metrics.contextMenuItemHeight + 8;

  return {
    x: clamp(state.contextMenu.position.x, 0, Math.max(0, state.viewport.width - width)),
    y: clamp(state.contextMenu.position.y, 0, Math.max(0, state.viewport.height - height)),
    width,
    height,
  };
}

export function getTrackIndexById(
  state: PlaylistState,
  trackId: string,
): number {
  const realIndex = state.tracks.findIndex((track) => track.id === trackId);

  if (realIndex >= 0) {
    return realIndex;
  }

  const virtualIndex = /^track-(\d+)$/.exec(trackId)?.[1];

  if (virtualIndex) {
    return Math.max(0, Number.parseInt(virtualIndex, 10) - 1);
  }

  return 0;
}

export function getTrackIdByIndex(
  state: PlaylistState,
  trackIndex: number,
): string {
  const index = Math.max(0, Math.floor(trackIndex));
  return state.tracks[index]?.id ?? `track-${index + 1}`;
}

const VIRTUAL_TRACK_COLORS = [
  "#e85d75",
  "#46b871",
  "#d9a441",
  "#39a8c9",
  "#c970d8",
  "#b7d957",
  "#f0703f",
  "#8fd3a8",
];

export function createVirtualTrack(trackIndex: number): PlaylistTrack {
  const index = Math.max(0, Math.floor(trackIndex));

  return {
    id: `track-${index + 1}`,
    label: `Track ${index + 1}`,
    color: VIRTUAL_TRACK_COLORS[index % VIRTUAL_TRACK_COLORS.length],
  };
}

export function getTrackByIndex(
  state: PlaylistState,
  trackIndex: number,
): PlaylistTrack {
  const index = Math.max(0, Math.floor(trackIndex));
  return state.tracks[index] ?? createVirtualTrack(index);
}

export function timeToScreenX(
  state: PlaylistState,
  time: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return (
    metrics.trackHeaderWidth +
    time * state.viewport.pxPerBeat -
    state.viewport.scrollX
  );
}

export function screenXToTime(
  state: PlaylistState,
  screenX: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return (
    (screenX - metrics.trackHeaderWidth + state.viewport.scrollX) /
    state.viewport.pxPerBeat
  );
}

export function getTrackHeight(
  track: PlaylistTrack,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const raw = track.height ?? metrics.trackHeight;
  return Math.max(
    metrics.trackMinHeight,
    Math.min(metrics.trackMaxHeight, raw),
  );
}

// Top of the track row in scene coordinates (without ruler offset and without
// viewport scroll). Real tracks accumulate their per-track heights; virtual
// tracks beyond the materialised list use metrics.trackHeight.
export function getTrackTopByIndex(
  state: PlaylistState,
  trackIndex: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const idx = Math.max(0, Math.floor(trackIndex));
  let y = 0;
  const cap = Math.min(idx, state.tracks.length);
  for (let i = 0; i < cap; i += 1) {
    y += getTrackHeight(state.tracks[i]!, metrics);
  }
  if (idx > state.tracks.length) {
    y += (idx - state.tracks.length) * metrics.trackHeight;
  }
  return y;
}

export function getTrackHeightByIndex(
  state: PlaylistState,
  trackIndex: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const idx = Math.max(0, Math.floor(trackIndex));
  const track = state.tracks[idx];
  if (!track) {
    return metrics.trackHeight;
  }
  return getTrackHeight(track, metrics);
}

export function trackIndexToScreenY(
  state: PlaylistState,
  trackIndex: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return (
    getTracksTop(metrics) +
    getTrackTopByIndex(state, trackIndex, metrics) -
    state.viewport.scrollY
  );
}

export function screenYToTrackIndex(
  state: PlaylistState,
  screenY: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const localY = screenY - getTracksTop(metrics) + state.viewport.scrollY;
  if (localY <= 0) {
    return 0;
  }
  let acc = 0;
  for (let i = 0; i < state.tracks.length; i += 1) {
    const h = getTrackHeight(state.tracks[i]!, metrics);
    if (localY < acc + h) {
      return i;
    }
    acc += h;
  }
  return (
    state.tracks.length +
    Math.max(0, Math.floor((localY - acc) / metrics.trackHeight))
  );
}

export const worldToScreenX = timeToScreenX;
export const screenToWorldX = screenXToTime;
export const trackToY = trackIndexToScreenY;
export const yToTrack = screenYToTrackIndex;

export function getClipRect(
  state: PlaylistState,
  clip: PlaylistClip,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  const trackIndex = getTrackIndexById(state, clip.trackId);
  const rowTop = trackIndexToScreenY(state, trackIndex, metrics);
  const rowHeight = getTrackHeightByIndex(state, trackIndex, metrics);

  return {
    x: timeToScreenX(state, clip.start, metrics),
    y: rowTop + metrics.clipPaddingY,
    width: clip.duration * state.viewport.pxPerBeat,
    height: rowHeight - metrics.clipPaddingY * 2,
  };
}

export function getClipTitleRect(
  state: PlaylistState,
  clip: PlaylistClip,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  const rect = getClipRect(state, clip, metrics);

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.min(metrics.clipTitleHeight, rect.height),
  };
}

export function getAutomationPointPosition(
  state: PlaylistState,
  clip: PlaylistAutomationClip,
  point: PlaylistAutomationPoint,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistPoint {
  const rect = getClipRect(state, clip, metrics);
  const bodyTop = rect.y + metrics.clipTitleHeight + 4;
  const bodyHeight = Math.max(1, rect.height - metrics.clipTitleHeight - 8);

  return {
    x: rect.x + (point.time / Math.max(clip.duration, 0.001)) * rect.width,
    y: bodyTop + (1 - clamp(point.value, 0, 1)) * bodyHeight,
  };
}

export function automationPointFromScreen(
  state: PlaylistState,
  clip: PlaylistAutomationClip,
  point: PlaylistPoint,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): { time: number; value: number } {
  const rect = getClipRect(state, clip, metrics);
  const bodyTop = rect.y + metrics.clipTitleHeight + 4;
  const bodyHeight = Math.max(1, rect.height - metrics.clipTitleHeight - 8);
  const localTime =
    ((point.x - rect.x) / Math.max(rect.width, 1)) * clip.duration;

  return {
    time: clamp(localTime, 0, clip.duration),
    value: clamp(1 - (point.y - bodyTop) / bodyHeight, 0, 1),
  };
}

// `timeAxis` feeds the "axis" mode (PlaylistTimeAxis.snapTargets). Without an
// axis, or an axis without targets near the value, "axis" snaps like "beat".
// Prefer PlaylistCore.snapTime, which passes the core's metrics + axis.
export function snapTime(
  value: number,
  state: PlaylistState,
  ignoreSnap = false,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
  timeAxis: PlaylistTimeAxis | null = null,
): number {
  if (ignoreSnap) {
    return Math.max(0, value);
  }
  if (state.snap.mode === "none") {
    return Math.max(0, value);
  }
  if (state.snap.mode === "events") {
    return snapTimeToEvents(value, state);
  }
  if (state.snap.mode === "axis") {
    const target = snapTimeToAxis(value, timeAxis);
    if (target !== null) {
      return Math.max(0, Number(target.toFixed(4)));
    }
    const snappedBeat = Math.round(value);
    return Math.max(0, snappedBeat);
  }
  const step = snapStepBeats(state.snap.mode, metrics);
  if (step <= 0) {
    return Math.max(0, value);
  }
  const snapped = Math.round(value / step) * step;
  return Math.max(0, Number(snapped.toFixed(4)));
}

// One-entry cache per axis: consecutive pointermoves of a drag ask for the
// same quantized window, so the host's snapTargets runs once per window, not
// once per move. Safe because snapTargets is a pure function (contract).
const axisTargetsCache = new WeakMap<
  PlaylistTimeAxis,
  { from: number; to: number; targets: readonly number[] }
>();

function axisTargets(
  timeAxis: PlaylistTimeAxis,
  from: number,
  to: number,
): readonly number[] {
  const cached = axisTargetsCache.get(timeAxis);
  if (cached && cached.from === from && cached.to === to) {
    return cached.targets;
  }
  const targets = timeAxis.snapTargets?.(from, to) ?? [];
  axisTargetsCache.set(timeAxis, { from, to, targets });
  return targets;
}

// Index of the first element > value in an ascending array (binary search,
// O(log n), no allocation).
export function sortedUpperBound(
  sorted: readonly number[],
  value: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Value of a step series at `beat`: values[i] holds on [beats[i],
// beats[i+1]), `initial` before beats[0]. O(log n), no allocation — safe to
// call per frame (e.g. the playhead dot of the overview lane).
export function stepSeriesValueAt(
  series: PlaylistStepSeries,
  beat: number,
): number {
  const index = sortedUpperBound(series.beats, beat);
  return index === 0 ? series.initial : series.values[index - 1]!;
}

// Nearest axis target to `value`, or null when the axis has none near it.
// The window [from, to] keeps at least `span` beats on each side of the
// value, so a target found within `span` is the global nearest; a farther
// one may not be, and the search widens (×8) to confirm it.
function snapTimeToAxis(
  value: number,
  timeAxis: PlaylistTimeAxis | null,
): number | null {
  if (!timeAxis || !timeAxis.snapTargets || !Number.isFinite(value)) {
    return null;
  }
  let span = AXIS_SNAP_WINDOW;
  for (let attempt = 0; attempt < AXIS_SNAP_ATTEMPTS; attempt += 1) {
    const from = Math.floor(value / span) * span - span;
    const to = from + span * 3;
    const targets = axisTargets(timeAxis, from, to);
    const index = sortedUpperBound(targets, value);
    let best: number | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    if (index < targets.length) {
      bestDelta = targets[index]! - value;
      best = targets[index]!;
    }
    if (index > 0 && value - targets[index - 1]! <= bestDelta) {
      bestDelta = value - targets[index - 1]!;
      best = targets[index - 1]!;
    }
    if (best !== null && bestDelta <= span) {
      return best;
    }
    span *= 8;
  }
  return null;
}

// Snap to the nearest clip edge or marker. Falls back to the raw value when
// no candidate is within the tolerance window. Tolerance is derived from
// the viewport's pxPerBeat so it stays visually consistent across zoom.
function snapTimeToEvents(value: number, state: PlaylistState): number {
  const tolerance =
    state.viewport.pxPerBeat > 0
      ? SNAP_EVENTS_TOLERANCE_PX / state.viewport.pxPerBeat
      : SNAP_EVENTS_FALLBACK_TOLERANCE_BEATS;
  let bestPoint = value;
  let bestDelta = tolerance;
  // Always include 0 (timeline origin) as a candidate.
  if (Math.abs(value) < bestDelta) {
    bestPoint = 0;
    bestDelta = Math.abs(value);
  }
  for (const clip of state.clips) {
    const startDelta = Math.abs(clip.start - value);
    if (startDelta < bestDelta) {
      bestDelta = startDelta;
      bestPoint = clip.start;
    }
    const end = clip.start + clip.duration;
    const endDelta = Math.abs(end - value);
    if (endDelta < bestDelta) {
      bestDelta = endDelta;
      bestPoint = end;
    }
  }
  for (const marker of state.markers ?? []) {
    const delta = Math.abs(marker.time - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestPoint = marker.time;
    }
  }
  return Math.max(0, Number(bestPoint.toFixed(4)));
}

// Returns the active loop region (between the two earliest "loop" markers).
// FL Studio uses this for jump-back during playback; we also render a band
// on the ruler. Null when fewer than two loop markers exist.
export function getActiveLoopRegion(
  state: PlaylistState,
): { start: number; end: number } | null {
  const loopMarkers = (state.markers ?? [])
    .filter((m) => m.kind === "loop")
    .sort((a, b) => a.time - b.time);
  if (loopMarkers.length < 2) return null;
  const start = loopMarkers[0]!.time;
  const end = loopMarkers[1]!.time;
  if (end <= start) return null;
  return { start, end };
}

export function getContentEndBeat(state: PlaylistState): number {
  return state.clips.reduce(
    (end, clip) => Math.max(end, clip.start + clip.duration),
    metricsDefaultEnd(state),
  );
}

// FL Studio displays time as "bar.beat.tick" where tick = 1/24 of a beat
// (independent of the snap mode). Bars and beats are 1-indexed so beat 0
// of bar 0 reads as "1.1.0". Used by the time tooltip and the inspector.
export function formatBarBeat(
  timeBeats: number,
  beatsPerBar: number,
  ticksPerBeat = 24,
): string {
  const safe = Math.max(0, timeBeats);
  const totalTicks = Math.round(safe * ticksPerBeat);
  const beatsPerBarRounded = Math.max(1, Math.round(beatsPerBar));
  const totalBeats = Math.floor(totalTicks / ticksPerBeat);
  const tick = totalTicks - totalBeats * ticksPerBeat;
  const bar = Math.floor(totalBeats / beatsPerBarRounded);
  const beat = totalBeats - bar * beatsPerBarRounded;
  return `${bar + 1}.${beat + 1}.${tick}`;
}

function metricsDefaultEnd(state: PlaylistState): number {
  return Math.max(32, state.playPosition.time + 16);
}

// Timeline is intentionally infinite (matches the spec). The presentation
// layer is responsible for emitting only the rows / ticks visible inside the
// viewport, so wandering far from the origin shouldn't cost extra frames.
export function getMaxScrollY(
  _state: PlaylistState,
  _metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return Number.POSITIVE_INFINITY;
}

export function getMaxScrollX(
  _state: PlaylistState,
  _metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return Number.POSITIVE_INFINITY;
}
