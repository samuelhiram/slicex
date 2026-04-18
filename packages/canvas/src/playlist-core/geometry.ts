import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationClip,
  type PlaylistAutomationPoint,
  type PlaylistClip,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistRect,
  type PlaylistState,
} from "./types";

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

export function getTrackIndexById(
  state: PlaylistState,
  trackId: string,
): number {
  return Math.max(
    0,
    state.tracks.findIndex((track) => track.id === trackId),
  );
}

export function getTrackIdByIndex(
  state: PlaylistState,
  trackIndex: number,
): string {
  const index = clamp(trackIndex, 0, Math.max(0, state.tracks.length - 1));
  return state.tracks[index]?.id ?? state.tracks[0]?.id ?? "track-1";
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

  return clamp(Math.floor(raw), 0, Math.max(0, state.tracks.length - 1));
}

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
): number {
  if (ignoreSnap || !state.snap.enabled || state.snap.step <= 0) {
    return Math.max(0, value);
  }

  const snapped = Math.round(value / state.snap.step) * state.snap.step;
  return Math.max(0, Number(snapped.toFixed(4)));
}

export function getContentEndBeat(state: PlaylistState): number {
  return state.clips.reduce(
    (end, clip) => Math.max(end, clip.start + clip.duration),
    metricsDefaultEnd(state),
  );
}

function metricsDefaultEnd(state: PlaylistState): number {
  return Math.max(32, state.playhead + 16);
}

export function getMaxScrollY(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const visibleTrackHeight = Math.max(
    0,
    state.viewport.height - metrics.rulerHeight,
  );
  const contentHeight = state.tracks.length * metrics.trackHeight;

  return Math.max(0, contentHeight - visibleTrackHeight);
}

export function getMaxScrollX(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): number {
  const visibleTimelineWidth = Math.max(
    0,
    state.viewport.width - metrics.trackHeaderWidth,
  );
  const contentWidth = (getContentEndBeat(state) + 16) * state.viewport.pxPerBeat;

  return Math.max(0, contentWidth - visibleTimelineWidth);
}
