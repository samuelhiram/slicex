import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationPoint,
  type PlaylistClip,
  type PlaylistMarker,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistRect,
  type PlaylistState,
  type PlaylistTrack,
} from "./types";
import {
  getActiveLoopRegion,
  getAutomationPointPosition,
  getClipTitleRect,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getTrackByIndex,
  getTrackHeight,
  getTrackIdByIndex,
  getVerticalScrollbarRect,
  getVerticalScrollbarThumbRect,
  isAutomationClip,
  isTrackEffectivelyMuted,
  normalizeRect,
  pointInRect,
  rectsIntersect,
  screenXToTime,
  timeToScreenX,
} from "./geometry";

// Per-presentation caches that turn the inner loops from O(clips × tracks)
// into roughly O(visible clips). Built once per createPlaylistPresentation.
interface TrackLayoutCache {
  trackIndexById: Map<string, number>;
  trackTops: number[];
  trackHeights: number[];
}

function buildTrackLayoutCache(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): TrackLayoutCache {
  const trackIndexById = new Map<string, number>();
  const trackTops: number[] = new Array(state.tracks.length);
  const trackHeights: number[] = new Array(state.tracks.length);
  let acc = 0;
  for (let i = 0; i < state.tracks.length; i += 1) {
    const track = state.tracks[i]!;
    trackIndexById.set(track.id, i);
    const h = getTrackHeight(track, metrics);
    trackTops[i] = acc;
    trackHeights[i] = h;
    acc += h;
  }
  return { trackIndexById, trackTops, trackHeights };
}

function trackTopAt(
  index: number,
  cache: TrackLayoutCache,
  metrics: PlaylistMetrics,
): number {
  if (index < cache.trackTops.length) {
    return cache.trackTops[index]!;
  }
  const lastTop =
    cache.trackTops.length > 0
      ? cache.trackTops[cache.trackTops.length - 1]! +
        cache.trackHeights[cache.trackHeights.length - 1]!
      : 0;
  return lastTop + (index - cache.trackTops.length) * metrics.trackHeight;
}

function trackHeightAt(
  index: number,
  cache: TrackLayoutCache,
  metrics: PlaylistMetrics,
): number {
  return cache.trackHeights[index] ?? metrics.trackHeight;
}

export type PlaylistTrackMenuAction =
  | "clear-track"
  | "delete-selected"
  | "rename-track"
  | "recolor-track"
  | "insert-track-below"
  | "delete-empty-track";

export interface PlaylistTrackMenuDefinition {
  action: PlaylistTrackMenuAction;
  label: string;
}

export const PLAYLIST_TRACK_MENU_ITEMS: readonly PlaylistTrackMenuDefinition[] =
  [
    { action: "clear-track", label: "Delete track content" },
    { action: "delete-selected", label: "Delete selected clips on track" },
    { action: "rename-track", label: "Rename track" },
    { action: "recolor-track", label: "Recolor track" },
    { action: "insert-track-below", label: "Insert track below" },
    { action: "delete-empty-track", label: "Delete empty track" },
  ] as const;

export interface PlaylistLayoutPresentation {
  sceneRect: PlaylistRect;
  trackHeaderRect: PlaylistRect;
  rulerRect: PlaylistRect;
  timelineRect: PlaylistRect;
  trackBodyRect: PlaylistRect;
  scrollbarCornerRect: PlaylistRect;
}

export interface PlaylistTrackHeaderButtons {
  mute: PlaylistRect;
  solo: PlaylistRect;
  lock: PlaylistRect;
}

export interface PlaylistTrackRowPresentation {
  index: number;
  track: PlaylistTrack;
  rowRect: PlaylistRect;
  headerRect: PlaylistRect;
  stripRect: PlaylistRect;
  buttons: PlaylistTrackHeaderButtons;
  resizeHandleRect: PlaylistRect;
  reorderHandleRect: PlaylistRect;
  isVirtual: boolean;
  hasClips: boolean;
  hasSelectedClips: boolean;
}

export interface PlaylistAutomationPointPresentation {
  point: PlaylistAutomationPoint;
  position: PlaylistPoint;
  selected: boolean;
}

export interface PlaylistClipPresentation {
  clip: PlaylistClip;
  trackIndex: number;
  rect: PlaylistRect;
  titleRect: PlaylistRect;
  bodyRect: PlaylistRect;
  resizeLeftRect: PlaylistRect;
  resizeRightRect: PlaylistRect;
  automationPoints: PlaylistAutomationPointPresentation[];
  isVisible: boolean;
  isAutomation: boolean;
  selected: boolean;
  hovered: boolean;
  // True when the clip OR its track should render as muted (clip.muted OR
  // track.muted OR another track is soloed).
  effectivelyMuted: boolean;
  trackLocked: boolean;
  // Group membership pass-through, copied verbatim from clip.groupId. The
  // renderer reads this to draw a small hover dot indicating that the clip
  // belongs to a group; the controller never reads from here.
  groupId: string | null;
}

export interface PlaylistRulerTickPresentation {
  beat: number;
  x: number;
  isBar: boolean;
  label: string | null;
}

export interface PlaylistScrollbarPresentation {
  trackRect: PlaylistRect;
  thumbRect: PlaylistRect;
}

// Context menus are rendered as HTML overlays in the React shell, so the
// presentation layer no longer pre-computes their layout.

export interface PlaylistPlayPositionPresentation {
  time: number;
  x: number;
  isVisible: boolean;
  isRunning: boolean;
}

export interface PlaylistMarkerPresentation {
  marker: PlaylistMarker;
  x: number;
  hitRect: PlaylistRect; // clickable triangle area on the ruler
  isVisible: boolean;
}

export interface PlaylistLoopRegionPresentation {
  start: number; // beats
  end: number; // beats
  startX: number;
  endX: number;
  rect: PlaylistRect;
  isVisible: boolean;
}

export interface PlaylistMarqueePresentation {
  rect: PlaylistRect;
}

// Drag preview rects in screen coordinates. Computed once per presentation
// from state.dragPreview + cache lookups so the overlay renderer can paint
// the ghost outline without touching state.clips again.
export interface PlaylistDragPreviewView {
  rects: PlaylistRect[];
  primaryRect: PlaylistRect | null;
}

// Floating tooltip in screen coords. The renderer pill consumes this verbatim.
export interface PlaylistTooltipView {
  kind: "time" | "ratio" | "offset";
  text: string;
  x: number;
  y: number;
}

export interface PlaylistPresentation {
  state: PlaylistState;
  metrics: PlaylistMetrics;
  layout: PlaylistLayoutPresentation;
  trackRows: PlaylistTrackRowPresentation[];
  trackRowsByIndex: Map<number, PlaylistTrackRowPresentation>;
  clipViews: PlaylistClipPresentation[];
  visibleClipViews: PlaylistClipPresentation[];
  clipViewsById: Map<string, PlaylistClipPresentation>;
  rulerTicks: PlaylistRulerTickPresentation[];
  scrollbars: {
    horizontal: PlaylistScrollbarPresentation;
    vertical: PlaylistScrollbarPresentation;
  };
  playPosition: PlaylistPlayPositionPresentation;
  marquee: PlaylistMarqueePresentation | null;
  markerViews: PlaylistMarkerPresentation[];
  loopRegion: PlaylistLoopRegionPresentation | null;
  // Drag/resize overlay rects (Fase 8 / F3). Null when no gesture is active.
  dragPreviewView: PlaylistDragPreviewView | null;
  // Snap indicator vertical line position in screen X (Fase 8 / F3). Null
  // when no gesture is active, or when snap is off / Alt is held.
  snapIndicatorX: number | null;
  // Floating tooltip near the cursor (Fase 8 / F3). Null when not visible.
  tooltipView: PlaylistTooltipView | null;
  timeToScreenX: (time: number) => number;
  screenXToTime: (screenX: number) => number;
  trackIndexToScreenY: (trackIndex: number) => number;
  screenYToTrackIndex: (screenY: number) => number;
}

function pickGridStep(pxPerBeat: number): number {
  if (pxPerBeat >= 52) {
    return 0.25;
  }

  if (pxPerBeat >= 28) {
    return 0.5;
  }

  if (pxPerBeat >= 14) {
    return 1;
  }

  if (pxPerBeat >= 9) {
    return 2;
  }

  return 4;
}

function createLayout(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistLayoutPresentation {
  const sceneRect = {
    x: 0,
    y: 0,
    width: state.viewport.width,
    height: state.viewport.height,
  };
  const trackHeaderRect = {
    x: 0,
    y: 0,
    width: metrics.trackHeaderWidth,
    height: state.viewport.height,
  };
  const rulerRect = {
    x: metrics.trackHeaderWidth,
    y: 0,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height: metrics.rulerHeight,
  };
  const timelineRect = {
    x: metrics.trackHeaderWidth,
    y: metrics.rulerHeight,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height: Math.max(0, state.viewport.height - metrics.rulerHeight),
  };
  const trackBodyRect = {
    x: metrics.trackHeaderWidth,
    y: metrics.rulerHeight,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height: Math.max(0, state.viewport.height - metrics.rulerHeight),
  };
  const scrollbarCornerRect = {
    x: Math.max(
      metrics.trackHeaderWidth,
      state.viewport.width - metrics.scrollbarSize,
    ),
    y: Math.max(
      metrics.rulerHeight,
      state.viewport.height - metrics.scrollbarSize,
    ),
    width: metrics.scrollbarSize,
    height: metrics.scrollbarSize,
  };

  return {
    sceneRect,
    trackHeaderRect,
    rulerRect,
    timelineRect,
    trackBodyRect,
    scrollbarCornerRect,
  };
}

function getTrackFlags(
  state: PlaylistState,
): Map<string, { hasClips: boolean; hasSelectedClips: boolean }> {
  const selectedClipIds = new Set(state.selection.clipIds);
  const flagsByTrackId = new Map<
    string,
    { hasClips: boolean; hasSelectedClips: boolean }
  >();

  for (const clip of state.clips) {
    const existing = flagsByTrackId.get(clip.trackId) ?? {
      hasClips: false,
      hasSelectedClips: false,
    };

    existing.hasClips = true;

    if (selectedClipIds.has(clip.id)) {
      existing.hasSelectedClips = true;
    }

    flagsByTrackId.set(clip.trackId, existing);
  }

  return flagsByTrackId;
}

function createTrackRows(
  state: PlaylistState,
  metrics: PlaylistMetrics,
  flagsByTrackId: Map<string, { hasClips: boolean; hasSelectedClips: boolean }>,
  cache: TrackLayoutCache,
): PlaylistTrackRowPresentation[] {
  const top =
    state.viewport.scrollY - metrics.trackOverscan * metrics.trackHeight;
  const bottom =
    state.viewport.scrollY +
    state.viewport.height -
    metrics.rulerHeight +
    metrics.trackOverscan * metrics.trackHeight;
  const rows: PlaylistTrackRowPresentation[] = [];

  // Real tracks: read from the cache instead of recomputing per-track height.
  for (let index = 0; index < state.tracks.length; index += 1) {
    const acc = cache.trackTops[index]!;
    const height = cache.trackHeights[index]!;
    if (acc > bottom) break;
    if (acc + height >= top) {
      rows.push(
        buildTrackRow(
          state,
          metrics,
          state.tracks[index]!,
          index,
          acc,
          height,
          flagsByTrackId,
        ),
      );
    }
  }

  // Virtual tracks past the materialised range, using the metric default
  // height. Jump directly to the first virtual that overlaps the visible
  // band so the loop is O(visible rows) instead of O(scrollY/trackHeight) —
  // critical because the timeline scroll is unbounded by design.
  const realCount = state.tracks.length;
  const realEnd =
    realCount > 0
      ? cache.trackTops[realCount - 1]! + cache.trackHeights[realCount - 1]!
      : 0;
  const virtualHeight = Math.max(1, metrics.trackHeight);
  const visibleStartLocal = Math.max(top, realEnd);
  const skipCount = Math.max(
    0,
    Math.floor((visibleStartLocal - realEnd) / virtualHeight),
  );
  let acc = realEnd + skipCount * virtualHeight;
  let virtIndex = realCount + skipCount;
  while (acc <= bottom) {
    if (acc + virtualHeight >= top) {
      rows.push(
        buildTrackRow(
          state,
          metrics,
          getTrackByIndex(state, virtIndex),
          virtIndex,
          acc,
          virtualHeight,
          flagsByTrackId,
        ),
      );
    }
    acc += virtualHeight;
    virtIndex += 1;
  }

  return rows;
}

function buildTrackRow(
  state: PlaylistState,
  metrics: PlaylistMetrics,
  track: PlaylistTrack,
  index: number,
  topInScene: number,
  height: number,
  flagsByTrackId: Map<string, { hasClips: boolean; hasSelectedClips: boolean }>,
): PlaylistTrackRowPresentation {
  const rowTop = metrics.rulerHeight + topInScene - state.viewport.scrollY;
  const rowRect = {
    x: metrics.trackHeaderWidth,
    y: rowTop,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height,
  };
  const headerRect = {
    x: 0,
    y: rowTop,
    width: metrics.trackHeaderWidth,
    height,
  };
  const stripRect = {
    x: 0,
    y: rowTop,
    width: 5,
    height,
  };
  const buttonSize = metrics.trackButtonSize;
  const buttonGap = 4;
  const buttonRow = rowTop + Math.max(2, height - buttonSize - 6);
  const buttonsLeft = headerRect.x + 16;
  const buttons: PlaylistTrackHeaderButtons = {
    mute: {
      x: buttonsLeft,
      y: buttonRow,
      width: buttonSize,
      height: buttonSize,
    },
    solo: {
      x: buttonsLeft + buttonSize + buttonGap,
      y: buttonRow,
      width: buttonSize,
      height: buttonSize,
    },
    lock: {
      x: buttonsLeft + (buttonSize + buttonGap) * 2,
      y: buttonRow,
      width: buttonSize,
      height: buttonSize,
    },
  };
  const reorderHandleRect = {
    x: headerRect.x + headerRect.width - buttonSize - 6,
    y: buttonRow,
    width: buttonSize,
    height: buttonSize,
  };
  const resizeHandleRect = {
    x: 0,
    y: rowTop + height - metrics.trackResizeHandleSize,
    width: state.viewport.width,
    height: metrics.trackResizeHandleSize * 2,
  };
  const flags = flagsByTrackId.get(track.id) ?? {
    hasClips: false,
    hasSelectedClips: false,
  };

  return {
    index,
    track,
    rowRect,
    headerRect,
    stripRect,
    buttons,
    resizeHandleRect,
    reorderHandleRect,
    isVirtual: index >= state.tracks.length,
    hasClips: flags.hasClips,
    hasSelectedClips: flags.hasSelectedClips,
  };
}

function createClipViews(
  state: PlaylistState,
  metrics: PlaylistMetrics,
  cache: TrackLayoutCache,
): PlaylistClipPresentation[] {
  const selectedClipIds = new Set(state.selection.clipIds);
  const hoveredClipId =
    state.hover != null && "clipId" in state.hover ? state.hover.clipId : null;
  const clipVisibilityBounds = normalizeRect({
    x: Math.max(0, metrics.trackHeaderWidth - metrics.timelineOverscanPx),
    y: Math.max(
      0,
      metrics.rulerHeight - metrics.trackOverscan * metrics.trackHeight,
    ),
    width: Math.max(
      0,
      state.viewport.width -
        metrics.trackHeaderWidth +
        metrics.timelineOverscanPx * 2,
    ),
    height: Math.max(
      0,
      state.viewport.height -
        metrics.rulerHeight +
        metrics.trackOverscan * metrics.trackHeight * 2,
    ),
  });

  // Pre-filter: only build presentations for clips that overlap the
  // overscanned viewport. Avoids the previous O(clips) allocation regardless
  // of position. trackIndexById lookups are O(1) via the layout cache.
  const visibleStartTime = screenXToTime(
    state,
    clipVisibilityBounds.x,
    metrics,
  );
  const visibleEndTime = screenXToTime(
    state,
    clipVisibilityBounds.x + clipVisibilityBounds.width,
    metrics,
  );
  const visibleStartLocalY =
    clipVisibilityBounds.y - metrics.rulerHeight + state.viewport.scrollY;
  const visibleEndLocalY =
    clipVisibilityBounds.y +
    clipVisibilityBounds.height -
    metrics.rulerHeight +
    state.viewport.scrollY;

  const views: PlaylistClipPresentation[] = [];
  const pxPerBeat = state.viewport.pxPerBeat;
  const headerOffset = metrics.trackHeaderWidth - state.viewport.scrollX;
  const rulerOffset = metrics.rulerHeight - state.viewport.scrollY;

  for (const clip of state.clips) {
    const clipEnd = clip.start + clip.duration;
    if (clipEnd < visibleStartTime || clip.start > visibleEndTime) {
      continue;
    }
    const trackIndex = cache.trackIndexById.get(clip.trackId);
    if (trackIndex === undefined) {
      continue;
    }
    const trackTop = cache.trackTops[trackIndex]!;
    const trackHeight = cache.trackHeights[trackIndex]!;
    if (trackTop + trackHeight < visibleStartLocalY) continue;
    if (trackTop > visibleEndLocalY) continue;

    const rect = {
      x: headerOffset + clip.start * pxPerBeat,
      y: rulerOffset + trackTop + metrics.clipPaddingY,
      width: clip.duration * pxPerBeat,
      height: trackHeight - metrics.clipPaddingY * 2,
    };
    const titleRect = getClipTitleRect(state, clip, metrics);
    const handleHeight =
      clip.type === "automation" ? titleRect.height : rect.height;
    const bodyRect =
      clip.type === "automation"
        ? {
            x: rect.x,
            y: rect.y + titleRect.height,
            width: rect.width,
            height: Math.max(0, rect.height - titleRect.height),
          }
        : rect;
    const automationPoints = isAutomationClip(clip)
      ? clip.points.map((point) => ({
          point,
          position: getAutomationPointPosition(state, clip, point, metrics),
          selected: state.selection.automationPointIds.includes(point.id),
        }))
      : [];
    const track = state.tracks[trackIndex];
    const trackMuted = track ? isTrackEffectivelyMuted(state, track) : false;
    const effectivelyMuted = clip.muted === true || trackMuted;
    const trackLocked = track?.locked === true;

    views.push({
      clip,
      trackIndex,
      rect,
      titleRect,
      bodyRect,
      resizeLeftRect: {
        x: rect.x,
        y: rect.y,
        width: metrics.resizeHandleWidth,
        height: handleHeight,
      },
      resizeRightRect: {
        x: rect.x + rect.width - metrics.resizeHandleWidth,
        y: rect.y,
        width: metrics.resizeHandleWidth,
        height: handleHeight,
      },
      automationPoints,
      isVisible: rectsIntersect(rect, clipVisibilityBounds),
      isAutomation: isAutomationClip(clip),
      selected: selectedClipIds.has(clip.id),
      hovered:
        hoveredClipId != null &&
        hoveredClipId === clip.id &&
        state.hover?.kind !== "automation-point",
      effectivelyMuted,
      trackLocked,
      groupId: clip.groupId ?? null,
    });
  }

  return views;
}

function createDragPreviewView(
  state: PlaylistState,
  metrics: PlaylistMetrics,
  cache: TrackLayoutCache,
): PlaylistDragPreviewView | null {
  const preview = state.dragPreview;
  if (!preview) return null;
  const pxPerBeat = state.viewport.pxPerBeat;
  const headerOffset = metrics.trackHeaderWidth - state.viewport.scrollX;
  const rulerOffset = metrics.rulerHeight - state.viewport.scrollY;
  const clipById = new Map(state.clips.map((c) => [c.id, c] as const));
  const buildRect = (
    start: number,
    duration: number,
    trackIndex: number,
  ): PlaylistRect | null => {
    const top =
      trackIndex < cache.trackTops.length
        ? cache.trackTops[trackIndex]!
        : cache.trackTops.length > 0
          ? cache.trackTops[cache.trackTops.length - 1]! +
            cache.trackHeights[cache.trackHeights.length - 1]! +
            (trackIndex - cache.trackTops.length) * metrics.trackHeight
          : trackIndex * metrics.trackHeight;
    const height =
      trackIndex < cache.trackHeights.length
        ? cache.trackHeights[trackIndex]!
        : metrics.trackHeight;
    return {
      x: headerOffset + start * pxPerBeat,
      y: rulerOffset + top + metrics.clipPaddingY,
      width: Math.max(0, duration * pxPerBeat),
      height: Math.max(0, height - metrics.clipPaddingY * 2),
    };
  };
  if (preview.kind === "clip-move") {
    const rects: PlaylistRect[] = [];
    let primary: PlaylistRect | null = null;
    for (const move of preview.allMoves) {
      const clip = clipById.get(move.id);
      if (!clip) continue;
      const rect = buildRect(move.start, clip.duration, move.trackIndex);
      if (!rect) continue;
      rects.push(rect);
      if (move.id === preview.primaryClipId) {
        primary = rect;
      }
    }
    return { rects, primaryRect: primary };
  }
  if (preview.kind === "clip-resize") {
    const clip = clipById.get(preview.clipId);
    if (!clip) return { rects: [], primaryRect: null };
    const trackIndex = cache.trackIndexById.get(clip.trackId);
    if (trackIndex === undefined) return { rects: [], primaryRect: null };
    const rect = buildRect(
      preview.previewStart,
      preview.previewDuration,
      trackIndex,
    );
    return { rects: rect ? [rect] : [], primaryRect: rect };
  }
  // Marker preview is a 1-d line on the ruler; renderer reads x directly
  // from snapIndicatorX, so we return an empty rect bundle here.
  return { rects: [], primaryRect: null };
}

function createTooltipView(state: PlaylistState): PlaylistTooltipView | null {
  if (!state.tooltip) return null;
  return {
    kind: state.tooltip.kind,
    text: state.tooltip.text,
    // Renderer applies the +12/-22 offset itself so the anchor here stays a
    // raw cursor coordinate, easy to compare against in tests.
    x: state.tooltip.anchor.x,
    y: state.tooltip.anchor.y,
  };
}

function createSnapIndicatorX(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): number | null {
  const hint = state.snapHint;
  if (!hint || !hint.visible) return null;
  const x = timeToScreenX(state, hint.time, metrics);
  // Cull when the snap line would fall outside the timeline panel; the
  // renderer just skips the draw call rather than clamp / clip.
  if (x < metrics.trackHeaderWidth || x > state.viewport.width) {
    return null;
  }
  return x;
}

function createRulerTicks(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistRulerTickPresentation[] {
  const step = pickGridStep(state.viewport.pxPerBeat);
  const startBeat = Math.max(
    0,
    Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) *
      step,
  );
  const endBeat = screenXToTime(state, state.viewport.width, metrics) + step;
  const ticks: PlaylistRulerTickPresentation[] = [];

  for (let beat = startBeat; beat <= endBeat; beat += step) {
    const x = Math.round(timeToScreenX(state, beat, metrics)) + 0.5;
    const isBar = Math.abs(beat % metrics.beatsPerBar) < 0.001;

    if (x < metrics.trackHeaderWidth) {
      continue;
    }

    ticks.push({
      beat,
      x,
      isBar,
      label: isBar ? String(Math.floor(beat / metrics.beatsPerBar) + 1) : null,
    });
  }

  return ticks;
}

function createScrollbars(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistPresentation["scrollbars"] {
  return {
    horizontal: {
      trackRect: getHorizontalScrollbarRect(state, metrics),
      thumbRect: getHorizontalScrollbarThumbRect(state, metrics),
    },
    vertical: {
      trackRect: getVerticalScrollbarRect(state, metrics),
      thumbRect: getVerticalScrollbarThumbRect(state, metrics),
    },
  };
}

function createPlayPosition(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistPlayPositionPresentation {
  const x = timeToScreenX(state, state.playPosition.time, metrics);

  return {
    time: state.playPosition.time,
    x,
    isVisible: x >= metrics.trackHeaderWidth && x <= state.viewport.width,
    isRunning: state.playPosition.isRunning,
  };
}

function createMarkerViews(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistMarkerPresentation[] {
  const views: PlaylistMarkerPresentation[] = [];
  const hitHalfWidth = 8;
  for (const marker of state.markers ?? []) {
    const x = timeToScreenX(state, marker.time, metrics);
    const hitRect = {
      x: x - hitHalfWidth,
      y: 0,
      width: hitHalfWidth * 2,
      height: metrics.rulerHeight,
    };
    views.push({
      marker,
      x,
      hitRect,
      isVisible:
        x + hitHalfWidth >= metrics.trackHeaderWidth &&
        x - hitHalfWidth <= state.viewport.width,
    });
  }
  return views;
}

function createLoopRegion(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistLoopRegionPresentation | null {
  const region = getActiveLoopRegion(state);
  if (!region) return null;
  const startX = timeToScreenX(state, region.start, metrics);
  const endX = timeToScreenX(state, region.end, metrics);
  const left = Math.max(metrics.trackHeaderWidth, Math.min(startX, endX));
  const right = Math.max(left, Math.min(state.viewport.width, Math.max(startX, endX)));
  return {
    start: region.start,
    end: region.end,
    startX,
    endX,
    rect: {
      x: left,
      y: 0,
      width: Math.max(0, right - left),
      height: metrics.rulerHeight,
    },
    isVisible: right > metrics.trackHeaderWidth && left < state.viewport.width,
  };
}

function createMarquee(
  state: PlaylistState,
): PlaylistMarqueePresentation | null {
  if (!state.marquee) {
    return null;
  }

  return {
    rect: normalizeRect({
      x: state.marquee.start.x,
      y: state.marquee.start.y,
      width: state.marquee.current.x - state.marquee.start.x,
      height: state.marquee.current.y - state.marquee.start.y,
    }),
  };
}

export function createPlaylistPresentation(
  state: PlaylistState,
  metrics: PlaylistMetrics = DEFAULT_PLAYLIST_METRICS,
): PlaylistPresentation {
  const cache = buildTrackLayoutCache(state, metrics);
  const flagsByTrackId = getTrackFlags(state);
  const layout = createLayout(state, metrics);
  const trackRows = createTrackRows(state, metrics, flagsByTrackId, cache);
  const trackRowsByIndex = new Map(
    trackRows.map((row) => [row.index, row] as const),
  );
  const clipViews = createClipViews(state, metrics, cache);
  const clipViewsById = new Map(
    clipViews.map((view) => [view.clip.id, view] as const),
  );
  // Every entry in clipViews is already inside the overscanned bounds; the
  // visibility flag remains a strict-intersect filter for the renderer.
  const visibleClipViews = clipViews.filter((view) => view.isVisible);
  const rulerTicks = createRulerTicks(state, metrics);
  const scrollbars = createScrollbars(state, metrics);

  return {
    state,
    metrics,
    layout,
    trackRows,
    trackRowsByIndex,
    clipViews,
    visibleClipViews,
    clipViewsById,
    rulerTicks,
    scrollbars,
    playPosition: createPlayPosition(state, metrics),
    marquee: createMarquee(state),
    markerViews: createMarkerViews(state, metrics),
    loopRegion: createLoopRegion(state, metrics),
    dragPreviewView: createDragPreviewView(state, metrics, cache),
    snapIndicatorX: createSnapIndicatorX(state, metrics),
    tooltipView: createTooltipView(state),
    timeToScreenX: (time: number) => timeToScreenX(state, time, metrics),
    screenXToTime: (screenX: number) => screenXToTime(state, screenX, metrics),
    trackIndexToScreenY: (trackIndex: number) =>
      metrics.rulerHeight +
      trackTopAt(trackIndex, cache, metrics) -
      state.viewport.scrollY,
    screenYToTrackIndex: (screenY: number) => {
      const localY = screenY - metrics.rulerHeight + state.viewport.scrollY;
      if (localY <= 0) return 0;
      for (let i = 0; i < cache.trackTops.length; i += 1) {
        const top = cache.trackTops[i]!;
        const h = cache.trackHeights[i]!;
        if (localY < top + h) return i;
      }
      const realCount = cache.trackTops.length;
      const lastEnd =
        realCount > 0
          ? cache.trackTops[realCount - 1]! +
            cache.trackHeights[realCount - 1]!
          : 0;
      return (
        realCount +
        Math.max(0, Math.floor((localY - lastEnd) / metrics.trackHeight))
      );
    },
  };
}

// Re-export so external callers (controller, tools) can use the same fast
// path that the presentation closure uses internally.
export { trackTopAt as presentationTrackTopAt, trackHeightAt as presentationTrackHeightAt };
