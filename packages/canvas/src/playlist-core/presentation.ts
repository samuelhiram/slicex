import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationPoint,
  type PlaylistClip,
  type PlaylistDragPreview,
  type PlaylistMarker,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistRect,
  type PlaylistState,
  type PlaylistTimeAxis,
  type PlaylistTrack,
} from "./types";
import {
  getActiveLoopRegion,
  getAutomationPointPosition,
  getClipTitleRect,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getOverviewLaneHeight,
  getTrackByIndex,
  getTrackHeight,
  getTrackIdByIndex,
  getTrackLaneHeight,
  getTracksTop,
  getVerticalScrollbarRect,
  getVerticalScrollbarThumbRect,
  isAutomationClip,
  isTrackEffectivelyMuted,
  normalizeRect,
  pointInRect,
  rectsIntersect,
  screenXToTime,
  timeToScreenX,
  type PlaylistLayoutOptions,
} from "./geometry";

// Per-presentation caches that turn the inner loops from O(clips × tracks)
// into roughly O(visible clips). Built once per createPlaylistPresentation.
interface TrackLayoutCache {
  trackIndexById: Map<string, number>;
  trackTops: number[];
  trackHeights: number[];
  // Height of one lane per track (rows are lanes x this; lanes.ts).
  laneHeights: number[];
}

function buildTrackLayoutCache(
  state: PlaylistState,
  metrics: PlaylistMetrics,
): TrackLayoutCache {
  const trackIndexById = new Map<string, number>();
  const trackTops: number[] = new Array(state.tracks.length);
  const trackHeights: number[] = new Array(state.tracks.length);
  const laneHeights: number[] = new Array(state.tracks.length);
  let acc = 0;
  for (let i = 0; i < state.tracks.length; i += 1) {
    const track = state.tracks[i]!;
    trackIndexById.set(track.id, i);
    const h = getTrackHeight(track, metrics);
    trackTops[i] = acc;
    trackHeights[i] = h;
    laneHeights[i] = getTrackLaneHeight(track, metrics);
    acc += h;
  }
  return { trackIndexById, trackTops, trackHeights, laneHeights };
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
  // Track area (below ruler + overview lane). The renderer masks clips,
  // grid and timeline overlays to it.
  timelineRect: PlaylistRect;
  trackBodyRect: PlaylistRect;
  scrollbarCornerRect: PlaylistRect;
  // Overview lane band between the ruler and the first track (timeline
  // part) and its cell in the header column. Height 0 = no lane.
  overviewRect: PlaylistRect;
  overviewHeaderRect: PlaylistRect;
}

export interface PlaylistTrackHeaderButtons {
  mute: PlaylistRect;
  solo: PlaylistRect;
  lock: PlaylistRect;
}

// How the row header arranges itself for the row's height (one source of
// truth for the renderer and the hit-test, so what is drawn is what is hit):
//   - "full" (>= 64 px): name, subtitle, and a bottom row with the toggles,
//     a meter and the grip;
//   - "compact" (44-63 px): toggles + grip move up to the name's line (right
//     side), the subtitle keeps its own line, the meter goes under it when
//     there is room;
//   - "mini" (< 44 px): the name alone, centred, toggles on its line.
// Before this the toggles always sat 22 px above the bottom and covered the
// subtitle on any row under ~66 px (the default row on short windows is 60).
export type PlaylistTrackHeaderLayout = "full" | "compact" | "mini";

export const TRACK_HEADER_FULL_MIN_HEIGHT = 64;
export const TRACK_HEADER_COMPACT_MIN_HEIGHT = 44;

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
  headerLayout: PlaylistTrackHeaderLayout;
  // Offset of the name's top from the row's top (the dot and, in compact /
  // mini rows, the toggles centre on that line).
  titleY: number;
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
  // Screen x of the label anchor: the tick x, or the cell centre when the
  // axis asked for a centred label (PlaylistTimeAxisTick.centered).
  labelX: number;
  centered: boolean;
  emphasis: boolean;
  dim: boolean;
}

// PlaylistTimeAxisBand projected to screen x (unclipped; the renderer clips
// to the timeline area).
export interface PlaylistRulerBandPresentation {
  kind: "group" | "shade";
  x0: number;
  x1: number;
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
  // The empty lane the row under a dragged clip opens (drawn dashed: drop
  // there to stack at the same time as another clip). null otherwise.
  freeLaneRect: PlaylistRect | null;
  // The rects are a clip about to be created (draw tool with a host
  // create flow), not clips being moved.
  creating: boolean;
}

const EMPTY_DRAG_PREVIEW_VIEW: PlaylistDragPreviewView = {
  rects: [],
  primaryRect: null,
  freeLaneRect: null,
  creating: false,
};

// Floating tooltip in screen coords. The renderer pill consumes this verbatim.
export interface PlaylistTooltipView {
  kind: "time" | "ratio" | "offset" | "clip" | "hint";
  text: string;
  // Beat of a "time" tooltip (null when it has none).
  time: number | null;
  // Clip of a "clip" tooltip (null / absent otherwise).
  clipId?: string | null;
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
  // Axis bands (PlaylistTimeAxis.bands) in the visible range; [] without an
  // axis or when it provides none. Any "group" band = two-tier ruler.
  rulerBands: PlaylistRulerBandPresentation[];
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
  const tracksTop = getTracksTop(metrics);
  const laneHeight = getOverviewLaneHeight(metrics);
  const timelineRect = {
    x: metrics.trackHeaderWidth,
    y: tracksTop,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height: Math.max(0, state.viewport.height - tracksTop),
  };
  const trackBodyRect = {
    x: metrics.trackHeaderWidth,
    y: tracksTop,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height: Math.max(0, state.viewport.height - tracksTop),
  };
  const scrollbarCornerRect = {
    x: Math.max(
      metrics.trackHeaderWidth,
      state.viewport.width - metrics.scrollbarSize,
    ),
    y: Math.max(tracksTop, state.viewport.height - metrics.scrollbarSize),
    width: metrics.scrollbarSize,
    height: metrics.scrollbarSize,
  };
  const overviewRect = {
    x: metrics.trackHeaderWidth,
    y: metrics.rulerHeight,
    width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
    height: laneHeight,
  };
  const overviewHeaderRect = {
    x: 0,
    y: metrics.rulerHeight,
    width: metrics.trackHeaderWidth,
    height: laneHeight,
  };

  return {
    sceneRect,
    trackHeaderRect,
    rulerRect,
    timelineRect,
    trackBodyRect,
    scrollbarCornerRect,
    overviewRect,
    overviewHeaderRect,
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
  virtualTracks: boolean,
): PlaylistTrackRowPresentation[] {
  const top =
    state.viewport.scrollY - metrics.trackOverscan * metrics.trackHeight;
  const bottom =
    state.viewport.scrollY +
    state.viewport.height -
    getTracksTop(metrics) +
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

  // virtualTracks: false — nothing below the real tracks but background.
  if (!virtualTracks) {
    return rows;
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
  const rowTop = getTracksTop(metrics) + topInScene - state.viewport.scrollY;
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
  const headerLayout: PlaylistTrackHeaderLayout =
    height >= TRACK_HEADER_FULL_MIN_HEIGHT
      ? "full"
      : height >= TRACK_HEADER_COMPACT_MIN_HEIGHT
        ? "compact"
        : "mini";
  // The name's line: 9 px from the top, centred in a mini row.
  const titleY = headerLayout === "mini" ? Math.max(2, Math.round((height - 16) / 2)) : 9;
  const gripX = headerRect.x + headerRect.width - buttonSize - 6;
  // Full: toggles bottom-left; else on the name's line, right-aligned
  // before the grip (the name is truncated to make room when they show).
  const buttonRow =
    headerLayout === "full"
      ? rowTop + Math.max(2, height - buttonSize - 6)
      : rowTop + titleY + 8 - buttonSize / 2;
  const buttonsLeft =
    headerLayout === "full"
      ? headerRect.x + 16
      : gripX - buttonGap - 3 * buttonSize - 2 * buttonGap;
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
    x: gripX,
    y: buttonRow,
    width: buttonSize,
    height: buttonSize,
  };
  // Only the header column's divisor resizes the row: the horizontal grid
  // lines over the timeline are not handles (they would steal presses on the
  // clips' bottom edge and the background).
  const resizeHandleRect = {
    x: 0,
    y: rowTop + height - metrics.trackResizeHandleSize,
    width: metrics.trackHeaderWidth,
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
    headerLayout,
    titleY,
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
      getTracksTop(metrics) - metrics.trackOverscan * metrics.trackHeight,
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
        getTracksTop(metrics) +
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
    clipVisibilityBounds.y - getTracksTop(metrics) + state.viewport.scrollY;
  const visibleEndLocalY =
    clipVisibilityBounds.y +
    clipVisibilityBounds.height -
    getTracksTop(metrics) +
    state.viewport.scrollY;

  const views: PlaylistClipPresentation[] = [];
  const pxPerBeat = state.viewport.pxPerBeat;
  const headerOffset = metrics.trackHeaderWidth - state.viewport.scrollX;
  const rulerOffset = getTracksTop(metrics) - state.viewport.scrollY;

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
    // Stacked lanes: the clip takes one lane of the row (lanes.ts).
    const laneHeight = cache.laneHeights[trackIndex]!;

    const rect = {
      x: headerOffset + clip.start * pxPerBeat,
      y: rulerOffset + trackTop + (clip.lane ?? 0) * laneHeight + metrics.clipPaddingY,
      width: clip.duration * pxPerBeat,
      height: laneHeight - metrics.clipPaddingY * 2,
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
    // The clip is a window over its envelope: the model keeps points past the
    // right edge (so resizing is non-destructive) and the window decides what
    // is drawn. Points outside are culled here rather than deleted there.
    const automationPoints = isAutomationClip(clip)
      ? clip.points
          .filter((point) => point.time <= clip.duration + 1e-6)
          .map((point) => ({
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
  // The "what goes here?" menu shows the spot it would fill as a ghost.
  const menu = state.contextMenu;
  const preview: PlaylistDragPreview | null =
    state.dragPreview ??
    (menu && menu.kind === "create"
      ? {
          kind: "clip-create",
          trackIndex: menu.trackIndex,
          lane: menu.lane,
          previewStart: menu.time,
          previewDuration: Math.max(menu.duration ?? 1, metrics.minClipDuration),
        }
      : null);
  if (!preview) return null;
  const pxPerBeat = state.viewport.pxPerBeat;
  const headerOffset = metrics.trackHeaderWidth - state.viewport.scrollX;
  const rulerOffset = getTracksTop(metrics) - state.viewport.scrollY;
  const laneTop = (trackIndex: number, lane: number): { top: number; laneHeight: number } => {
    const top = trackTopAt(trackIndex, cache, metrics);
    const laneHeight =
      trackIndex < cache.laneHeights.length ? cache.laneHeights[trackIndex]! : metrics.trackHeight;
    return { top: top + lane * laneHeight, laneHeight };
  };
  const buildRect = (
    start: number,
    duration: number,
    trackIndex: number,
    lane = 0,
  ): PlaylistRect | null => {
    const { top, laneHeight } = laneTop(trackIndex, lane);
    return {
      x: headerOffset + start * pxPerBeat,
      y: rulerOffset + top + metrics.clipPaddingY,
      width: Math.max(0, duration * pxPerBeat),
      height: Math.max(0, laneHeight - metrics.clipPaddingY * 2),
    };
  };
  if (preview.kind === "clip-create") {
    const rect = buildRect(
      preview.previewStart,
      preview.previewDuration,
      preview.trackIndex,
      preview.lane,
    );
    return { rects: rect ? [rect] : [], primaryRect: rect, freeLaneRect: null, creating: true };
  }
  const clipById = new Map(state.clips.map((c) => [c.id, c] as const));
  if (preview.kind === "clip-move") {
    const rects: PlaylistRect[] = [];
    let primary: PlaylistRect | null = null;
    for (const move of preview.allMoves) {
      const clip = clipById.get(move.id);
      if (!clip) continue;
      const rect = buildRect(move.start, clip.duration, move.trackIndex, move.lane ?? clip.lane ?? 0);
      if (!rect) continue;
      rects.push(rect);
      if (move.id === preview.primaryClipId) {
        primary = rect;
      }
    }
    // The empty lane the row under the drag opens: as wide as the timeline.
    let freeLaneRect: PlaylistRect | null = null;
    if (preview.freeLane) {
      const { top, laneHeight } = laneTop(preview.freeLane.trackIndex, preview.freeLane.lane);
      freeLaneRect = {
        x: metrics.trackHeaderWidth + 4,
        y: rulerOffset + top + metrics.clipPaddingY,
        width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth - 8),
        height: Math.max(0, laneHeight - metrics.clipPaddingY * 2),
      };
    }
    return { rects, primaryRect: primary, freeLaneRect, creating: false };
  }
  if (preview.kind === "clip-resize") {
    const clip = clipById.get(preview.clipId);
    if (!clip) return EMPTY_DRAG_PREVIEW_VIEW;
    const trackIndex = cache.trackIndexById.get(clip.trackId);
    if (trackIndex === undefined) return EMPTY_DRAG_PREVIEW_VIEW;
    const rect = buildRect(
      preview.previewStart,
      preview.previewDuration,
      trackIndex,
      clip.lane ?? 0,
    );
    return { rects: rect ? [rect] : [], primaryRect: rect, freeLaneRect: null, creating: false };
  }
  // Marker preview is a 1-d line on the ruler; renderer reads x directly
  // from snapIndicatorX, so we return an empty rect bundle here.
  return EMPTY_DRAG_PREVIEW_VIEW;
}

function createTooltipView(state: PlaylistState): PlaylistTooltipView | null {
  if (!state.tooltip) return null;
  const view: PlaylistTooltipView = {
    kind: state.tooltip.kind,
    text: state.tooltip.text,
    time: state.tooltip.time ?? null,
    // Renderer applies the +12/-22 offset itself so the anchor here stays a
    // raw cursor coordinate, easy to compare against in tests.
    x: state.tooltip.anchor.x,
    y: state.tooltip.anchor.y,
  };
  if (state.tooltip.clipId !== undefined) view.clipId = state.tooltip.clipId;
  return view;
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
  timeAxis: PlaylistTimeAxis | null = null,
): PlaylistRulerTickPresentation[] {
  const step = pickGridStep(state.viewport.pxPerBeat);
  const startBeat = Math.max(
    0,
    Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) *
      step,
  );
  const endBeat = screenXToTime(state, state.viewport.width, metrics) + step;
  const ticks: PlaylistRulerTickPresentation[] = [];

  // Pluggable axis: same visible beat range, same x rounding and the same
  // header cull as the default grid — only the tick list and labels change.
  if (timeAxis) {
    const axisTicks = timeAxis.ticks(
      startBeat,
      endBeat,
      state.viewport.pxPerBeat,
    );
    const halfCell = state.viewport.pxPerBeat / 2;
    for (let i = 0; i < axisTicks.length; i += 1) {
      const tick = axisTicks[i]!;
      const x = Math.round(timeToScreenX(state, tick.beat, metrics)) + 0.5;
      const centered = tick.centered === true;
      // A centred label belongs to its cell: keep it while the cell centre
      // is past the header even if the tick line itself is not.
      if (x < metrics.trackHeaderWidth && !(centered && x + halfCell > metrics.trackHeaderWidth)) {
        continue;
      }
      ticks.push({
        beat: tick.beat,
        x,
        isBar: tick.major,
        label: tick.label,
        labelX: centered ? x + halfCell : x,
        centered,
        emphasis: tick.emphasis === true,
        dim: tick.dim === true,
      });
    }
    return ticks;
  }

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
      labelX: x,
      centered: false,
      emphasis: false,
      dim: false,
    });
  }

  return ticks;
}

const NO_BANDS: PlaylistRulerBandPresentation[] = [];

// Axis bands over the same visible beat range as the ticks. Once per
// presentation build (canon §3.3); [] (shared, never mutated) without bands.
function createRulerBands(
  state: PlaylistState,
  metrics: PlaylistMetrics,
  timeAxis: PlaylistTimeAxis | null,
): PlaylistRulerBandPresentation[] {
  if (!timeAxis || !timeAxis.bands) return NO_BANDS;
  const fromBeat = Math.max(
    0,
    screenXToTime(state, metrics.trackHeaderWidth, metrics),
  );
  const toBeat = screenXToTime(state, state.viewport.width, metrics);
  if (!(toBeat > fromBeat)) return NO_BANDS;
  const bands = timeAxis.bands(fromBeat, toBeat, state.viewport.pxPerBeat);
  if (bands.length === 0) return NO_BANDS;
  const out: PlaylistRulerBandPresentation[] = [];
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]!;
    out.push({
      kind: band.kind,
      x0: timeToScreenX(state, band.start, metrics),
      x1: timeToScreenX(state, band.end, metrics),
      label: band.label ?? null,
    });
  }
  return out;
}

function createScrollbars(
  state: PlaylistState,
  metrics: PlaylistMetrics,
  layoutOptions: PlaylistLayoutOptions,
): PlaylistPresentation["scrollbars"] {
  return {
    horizontal: {
      trackRect: getHorizontalScrollbarRect(state, metrics),
      thumbRect: getHorizontalScrollbarThumbRect(state, metrics),
    },
    vertical: {
      trackRect: getVerticalScrollbarRect(state, metrics),
      thumbRect: getVerticalScrollbarThumbRect(state, metrics, layoutOptions),
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
  timeAxis: PlaylistTimeAxis | null = null,
  layoutOptions: PlaylistLayoutOptions = {},
): PlaylistPresentation {
  const cache = buildTrackLayoutCache(state, metrics);
  const flagsByTrackId = getTrackFlags(state);
  const layout = createLayout(state, metrics);
  const trackRows = createTrackRows(
    state,
    metrics,
    flagsByTrackId,
    cache,
    layoutOptions.virtualTracks !== false,
  );
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
  const rulerTicks = createRulerTicks(state, metrics, timeAxis);
  const rulerBands = createRulerBands(state, metrics, timeAxis);
  const scrollbars = createScrollbars(state, metrics, layoutOptions);

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
    rulerBands,
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
      getTracksTop(metrics) +
      trackTopAt(trackIndex, cache, metrics) -
      state.viewport.scrollY,
    screenYToTrackIndex: (screenY: number) => {
      const localY = screenY - getTracksTop(metrics) + state.viewport.scrollY;
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

// --- Extend grabber ----------------------------------------------------------
//
// The single selected clip shows a vertical grabber that lengthens or
// shortens it from its RIGHT end: drag right = longer, left = shorter, by the
// same time the pointer travels (the end itself may be far off-screen). It
// sits at the CENTRE OF THE VISIBLE TIMELINE, clamped inside the clip's
// on-screen part — never at the clip's own middle, which on a long clip is
// as off-screen as its ends. While held it follows the pointer
// (dragPreview.handleX). Shared by the renderer (draws it) and the
// hit-test (grabs it) so both always agree.

// Hit width (px) of the grabber, and the on-screen clip width below which it
// is not offered (the edge handles are enough there).
export const CLIP_EXTEND_HIT_PX = 20;
export const CLIP_EXTEND_MIN_VISIBLE_PX = 64;
const CLIP_EXTEND_PILL_MAX_H = 30;
const CLIP_EXTEND_PILL_W = 10;

export interface PlaylistClipExtendHandle {
  clipId: string;
  // Centre x (screen) of the grabber.
  x: number;
  // Hit area and the drawn pill (screen).
  hitRect: PlaylistRect;
  pillRect: PlaylistRect;
  // A clip-extend drag is holding it.
  active: boolean;
  // The pointer is over it.
  hovered: boolean;
}

/** A blank handle to pass as `out` (render loops reuse one: no per-frame allocation). */
export function createClipExtendHandle(): PlaylistClipExtendHandle {
  return {
    clipId: "",
    x: 0,
    hitRect: { x: 0, y: 0, width: 0, height: 0 },
    pillRect: { x: 0, y: 0, width: 0, height: 0 },
    active: false,
    hovered: false,
  };
}

/**
 * The selected clip's extend grabber, or null when there is none: not
 * exactly one clip selected, a tool other than Select / Draw, an automation
 * or locked clip, too little of it on screen, or `canExtend` says no (the
 * host's veto, e.g. a one-time event whose width means nothing). O(1).
 * Fills and returns `out` when given (otherwise a new object).
 */
/** Px from the visible left edge of a long clip to its level grip. */
export const CLIP_LEVEL_GRIP_INSET = 40;

/**
 * Centre x (screen) of a clip's level grip on its top edge: the middle of a
 * short clip, else CLIP_LEVEL_GRIP_INSET px into its VISIBLE part — a clip
 * longer than the screen keeps a reachable grip (its own centre may be
 * off-screen), clear of the extend grabber at the centre of the view.
 * Pure arithmetic, O(1). Shared by the hit-test and the renderer.
 */
export function getClipLevelGripX(
  view: PlaylistClipPresentation,
  metrics: PlaylistMetrics,
  viewportWidth: number,
): number {
  const left = Math.max(view.rect.x, metrics.trackHeaderWidth);
  const right = Math.min(view.rect.x + view.rect.width, viewportWidth - metrics.scrollbarSize);
  const width = Math.max(0, right - left);
  return left + Math.min(width / 2, CLIP_LEVEL_GRIP_INSET);
}

export function getClipExtendHandle(
  presentation: PlaylistPresentation,
  canExtend?: (clipId: string) => boolean,
  out: PlaylistClipExtendHandle = createClipExtendHandle(),
): PlaylistClipExtendHandle | null {
  const { state, metrics } = presentation;
  if (state.tool !== "select" && state.tool !== "draw") return null;
  if (state.selection.clipIds.length !== 1) return null;
  const clipId = state.selection.clipIds[0]!;
  const view = presentation.clipViewsById.get(clipId);
  if (!view || !view.isVisible || view.isAutomation || view.trackLocked) return null;
  if (canExtend && !canExtend(clipId)) return null;

  const viewLeft = metrics.trackHeaderWidth;
  const viewRight = state.viewport.width - metrics.scrollbarSize;
  const viewTop = getTracksTop(metrics);
  const viewBottom = state.viewport.height - metrics.scrollbarSize;
  const rect = view.rect;
  const left = Math.max(rect.x, viewLeft);
  const right = Math.min(rect.x + rect.width, viewRight);
  const top = Math.max(rect.y, viewTop);
  const bottom = Math.min(rect.y + rect.height, viewBottom);
  if (bottom - top < 16) return null;

  const preview = state.dragPreview;
  const held =
    preview?.kind === "clip-resize" && preview.clipId === clipId && preview.handleX !== undefined
      ? preview.handleX
      : null;

  let x: number;
  if (held !== null) {
    // Held: under the pointer, kept on the clip (it may have shrunk).
    if (right - left < 4) return null;
    x = Math.min(Math.max(held, left + 2), right - 2);
  } else {
    if (right - left < CLIP_EXTEND_MIN_VISIBLE_PX) return null;
    // Clear of the edge resize handles.
    const pad = metrics.resizeHandleWidth + CLIP_EXTEND_HIT_PX / 2 + 4;
    const centre = (viewLeft + viewRight) / 2;
    x = Math.min(Math.max(centre, left + pad), right - pad);
  }
  x = Math.round(x);

  const pillHeight = Math.min(CLIP_EXTEND_PILL_MAX_H, bottom - top - 10);
  const pillTop = Math.round((top + bottom) / 2 - pillHeight / 2);
  const hitTop = Math.max(top, pillTop - 6);
  const hitBottom = Math.min(bottom, pillTop + pillHeight + 6);
  out.clipId = clipId;
  out.x = x;
  out.hitRect.x = x - CLIP_EXTEND_HIT_PX / 2;
  out.hitRect.y = hitTop;
  out.hitRect.width = CLIP_EXTEND_HIT_PX;
  out.hitRect.height = hitBottom - hitTop;
  out.pillRect.x = x - CLIP_EXTEND_PILL_W / 2;
  out.pillRect.y = pillTop;
  out.pillRect.width = CLIP_EXTEND_PILL_W;
  out.pillRect.height = pillHeight;
  out.active = held !== null;
  out.hovered = state.hover?.kind === "clip-extend" && state.hover.clipId === clipId;
  return out;
}
