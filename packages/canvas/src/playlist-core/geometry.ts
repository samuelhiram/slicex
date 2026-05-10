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
  type PlaylistTrack,
} from "./types";

const SNAP_EVENTS_TOLERANCE_PX = 8;
const SNAP_EVENTS_FALLBACK_TOLERANCE_BEATS = 0.5;

// Resolve the step (in beats) used by mode-driven snap. Returns 0 for
// non-grid modes ("none" and "events") so callers can branch.
export function snapStepBeats(
  mode: PlaylistSnapMode,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  switch (mode) {
    case "none":
    case "events":
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

export function getHorizontalScrollbarRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  return {
    x: metrics.trackHeaderWidth,
    y: Math.max(metrics.rulerHeight, state.viewport.height - metrics.scrollbarSize),
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
  return {
    x: Math.max(metrics.trackHeaderWidth, state.viewport.width - metrics.scrollbarSize),
    y: metrics.rulerHeight,
    width: metrics.scrollbarSize,
    height: Math.max(
      metrics.scrollbarThumbMin,
      state.viewport.height - metrics.rulerHeight - metrics.scrollbarSize,
    ),
  };
}

export function getHorizontalScrollbarThumbRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  const track = getHorizontalScrollbarRect(state, metrics);
  const width = clamp(track.width * 0.24, metrics.scrollbarThumbMin, track.width);
  const travel = Math.max(1, track.width - width);
  const local =
    ((state.viewport.scrollX % metrics.scrollbarVirtualRangePx) /
      metrics.scrollbarVirtualRangePx) *
    travel;

  return {
    x: track.x + local,
    y: track.y + 2,
    width,
    height: Math.max(1, track.height - 4),
  };
}

export function getVerticalScrollbarThumbRect(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistRect {
  const track = getVerticalScrollbarRect(state, metrics);
  const height = clamp(track.height * 0.24, metrics.scrollbarThumbMin, track.height);
  const travel = Math.max(1, track.height - height);
  const local =
    ((state.viewport.scrollY % metrics.scrollbarVirtualRangePx) /
      metrics.scrollbarVirtualRangePx) *
    travel;

  return {
    x: track.x + 2,
    y: track.y + local,
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

export function trackIndexToScreenY(
  state: PlaylistState,
  trackIndex: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  return (
    metrics.rulerHeight +
    trackIndex * metrics.trackHeight -
    state.viewport.scrollY
  );
}

export function screenYToTrackIndex(
  state: PlaylistState,
  screenY: number,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const raw =
    (screenY - metrics.rulerHeight + state.viewport.scrollY) /
    metrics.trackHeight;

  return Math.max(0, Math.floor(raw));
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

  return {
    x: timeToScreenX(state, clip.start, metrics),
    y: rowTop + metrics.clipPaddingY,
    width: clip.duration * state.viewport.pxPerBeat,
    height: metrics.trackHeight - metrics.clipPaddingY * 2,
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

export function snapTime(
  value: number,
  state: PlaylistState,
  ignoreSnap = false,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
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
  const step = snapStepBeats(state.snap.mode, metrics);
  if (step <= 0) {
    return Math.max(0, value);
  }
  const snapped = Math.round(value / step) * step;
  return Math.max(0, Number(snapped.toFixed(4)));
}

// Snap to the nearest clip edge (start or end). Falls back to the raw value
// when no candidate is within the tolerance window. Tolerance is derived
// from the viewport's pxPerBeat so it stays visually consistent across zoom.
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
  return Math.max(0, Number(bestPoint.toFixed(4)));
}

export function getContentEndBeat(state: PlaylistState): number {
  return state.clips.reduce(
    (end, clip) => Math.max(end, clip.start + clip.duration),
    metricsDefaultEnd(state),
  );
}

function metricsDefaultEnd(state: PlaylistState): number {
  return Math.max(32, state.playPosition.time + 16);
}

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
