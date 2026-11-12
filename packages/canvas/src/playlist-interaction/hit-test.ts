import {
  SCROLLBAR_EDGE_MIN_THUMB,
  SCROLLBAR_EDGE_PX,
  createClipExtendHandle,
  getClipExtendHandle,
  getClipLevelGripX,
  getTracksTop,
  pointInRect,
  type PlaylistAutomationClip,
  type PlaylistClip,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistPresentation,
} from "../playlist-core";

export type PlaylistHit =
  | { kind: "empty" }
  // Inert chrome (the overview lane's header cell): no tool, no gesture.
  | { kind: "chrome" }
  | { kind: "marker"; markerId: string }
  | {
      kind: "scrollbar-horizontal";
      onThumb: boolean;
      // On one of the thumb's ends (zoom handle), when the thumb is wide
      // enough to have handles.
      edge?: "start" | "end";
    }
  | { kind: "scrollbar-vertical"; onThumb: boolean }
  | { kind: "track-header"; trackIndex: number; trackId: string }
  | {
      kind: "track-mute-button";
      trackIndex: number;
      trackId: string;
    }
  | {
      kind: "track-solo-button";
      trackIndex: number;
      trackId: string;
    }
  | {
      kind: "track-lock-button";
      trackIndex: number;
      trackId: string;
    }
  | {
      kind: "track-reorder-handle";
      trackIndex: number;
      trackId: string;
    }
  | {
      kind: "track-resize-handle";
      trackIndex: number;
      trackId: string;
    }
  | { kind: "play-position-marker" }
  | { kind: "ruler" }
  | {
      kind: "automation-point";
      clip: PlaylistAutomationClip;
      clipId: string;
      pointId: string;
    }
  | { kind: "resize-left"; clip: PlaylistClip; clipId: string }
  | { kind: "resize-right"; clip: PlaylistClip; clipId: string }
  // Top edge of a clip when the host gave clips a "level" (see
  // PlaylistInteractionOptions.onClipLevelDrag): dragging it vertically.
  | { kind: "clip-level"; clip: PlaylistClip; clipId: string }
  // The selected clip's extend grabber (getClipExtendHandle): dragging it
  // moves the clip's right end. `x` is the grabber's centre.
  | { kind: "clip-extend"; clip: PlaylistClip; clipId: string; x: number }
  | { kind: "automation-body"; clip: PlaylistAutomationClip; clipId: string }
  | { kind: "clip"; clip: PlaylistClip; clipId: string };

function distance(left: PlaylistPoint, right: PlaylistPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function getAutomationPointHit(
  clipView: PlaylistPresentation["visibleClipViews"][number],
  point: PlaylistPoint,
  metrics: PlaylistMetrics,
): PlaylistHit | null {
  for (
    let index = clipView.automationPoints.length - 1;
    index >= 0;
    index -= 1
  ) {
    const automationPoint = clipView.automationPoints[index];

    if (
      distance(point, automationPoint.position) <=
      metrics.automationPointRadius + 4
    ) {
      return {
        kind: "automation-point",
        clip: clipView.clip as PlaylistAutomationClip,
        clipId: clipView.clip.id,
        pointId: automationPoint.point.id,
      };
    }
  }

  return null;
}

// Height (px) of the clip-level handle along a clip's top edge.
export const CLIP_LEVEL_HANDLE_PX = 5;
// Grip-only level handle (PlaylistHitOptions.clipLevelGrip): the hit target
// around the visible grip centred on the top edge (24 px wide; 24 px tall
// for a coarse pointer, CLIP_LEVEL_GRIP_FINE_PX otherwise).
export const CLIP_LEVEL_GRIP_WIDTH = 24;
export const CLIP_LEVEL_GRIP_FINE_PX = 7;

export interface PlaylistHitOptions {
  // Clips expose a level handle on their top edge.
  clipLevel?: boolean;
  // The selected clip exposes the extend grabber; the predicate is the
  // host's veto per clip (see getClipExtendHandle).
  clipExtend?: (clipId: string) => boolean;
  // false: the thin track chrome (the full-width resize divisor, the
  // mute / solo / lock buttons, the reorder grip) is not hit; the point
  // resolves to the row header / clip / background under it. The right
  // button uses this, so a context menu opens wherever it is pressed.
  trackChrome?: boolean;
  // The level handle is only the grip at the centre of the top edge (what
  // is drawn), not the whole edge: a press elsewhere on the edge is the
  // clip. `height` is the grip's hit height in px (≥ 24 for touch).
  clipLevelGrip?: { height: number };
  // Grow the hit box of the track header buttons (mute / solo / lock /
  // grip) by this many px on each side, without changing their drawing,
  // so each is at least 24 px to the pointer.
  trackButtonSlop?: number;
}

function pointInRectSlop(
  point: PlaylistPoint,
  rect: { x: number; y: number; width: number; height: number },
  slop: number,
): boolean {
  return (
    point.x >= rect.x - slop &&
    point.x <= rect.x + rect.width + slop &&
    point.y >= rect.y - slop &&
    point.y <= rect.y + rect.height + slop
  );
}

// Scratch for the extend-grabber lookup (pointermove rate: no allocation).
const extendScratch = createClipExtendHandle();

export function hitTestPlaylist(
  presentation: PlaylistPresentation,
  point: PlaylistPoint,
  metrics: PlaylistMetrics,
  options: PlaylistHitOptions = {},
): PlaylistHit {
  const { playPosition, scrollbars, trackRows, visibleClipViews } =
    presentation;

  if (pointInRect(point, scrollbars.horizontal.trackRect)) {
    const thumb = scrollbars.horizontal.thumbRect;
    if (thumb.width >= SCROLLBAR_EDGE_MIN_THUMB && point.y >= thumb.y && point.y <= thumb.y + thumb.height) {
      if (Math.abs(point.x - thumb.x) <= SCROLLBAR_EDGE_PX) {
        return { kind: "scrollbar-horizontal", onThumb: true, edge: "start" };
      }
      if (Math.abs(point.x - (thumb.x + thumb.width)) <= SCROLLBAR_EDGE_PX) {
        return { kind: "scrollbar-horizontal", onThumb: true, edge: "end" };
      }
    }
    return {
      kind: "scrollbar-horizontal",
      onThumb: pointInRect(point, scrollbars.horizontal.thumbRect),
    };
  }

  if (pointInRect(point, scrollbars.vertical.trackRect)) {
    return {
      kind: "scrollbar-vertical",
      onThumb: pointInRect(point, scrollbars.vertical.thumbRect),
    };
  }

  if (
    playPosition.isVisible &&
    point.y <= metrics.rulerHeight &&
    point.x >= metrics.trackHeaderWidth &&
    Math.abs(point.x - playPosition.x) <= metrics.playMarkerHitWidth
  ) {
    return { kind: "play-position-marker" };
  }

  // Timeline markers live on the ruler. Walk in reverse so the topmost
  // (drawn-last) marker wins when two are close together.
  if (point.y <= metrics.rulerHeight && point.x >= metrics.trackHeaderWidth) {
    const markers = presentation.markerViews;
    for (let i = markers.length - 1; i >= 0; i -= 1) {
      const view = markers[i]!;
      if (!view.isVisible) continue;
      if (pointInRect(point, view.hitRect)) {
        return { kind: "marker", markerId: view.marker.id };
      }
    }
    return { kind: "ruler" };
  }

  // Overview lane (between ruler and tracks): behaves like the ruler — seek
  // and scrub the play position. Its header cell is inert chrome. Tracks
  // and clips scrolled up under the lane are never hit through it.
  const tracksTop = getTracksTop(metrics);
  if (point.y <= tracksTop && tracksTop > metrics.rulerHeight) {
    return point.x >= metrics.trackHeaderWidth
      ? { kind: "ruler" }
      : { kind: "chrome" };
  }

  const trackChrome = options.trackChrome !== false;

  if (
    trackChrome &&
    point.y > metrics.rulerHeight &&
    point.x < metrics.trackHeaderWidth
  ) {
    // Track-resize handle: only the divisor inside the header column. The
    // grid lines over the timeline never resize a row.
    const resizeRow = trackRows.find((candidate) =>
      pointInRect(point, candidate.resizeHandleRect),
    );
    if (resizeRow) {
      return {
        kind: "track-resize-handle",
        trackIndex: resizeRow.index,
        trackId: resizeRow.track.id,
      };
    }
  }

  if (point.x < metrics.trackHeaderWidth && point.y > metrics.rulerHeight) {
    const row = trackRows.find((candidate) =>
      pointInRect(point, candidate.headerRect),
    );
    const slop = options.trackButtonSlop ?? 0;

    if (row && trackChrome) {
      if (pointInRectSlop(point, row.buttons.mute, slop)) {
        return {
          kind: "track-mute-button",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      if (pointInRectSlop(point, row.buttons.solo, slop)) {
        return {
          kind: "track-solo-button",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      if (pointInRectSlop(point, row.buttons.lock, slop)) {
        return {
          kind: "track-lock-button",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      if (pointInRectSlop(point, row.reorderHandleRect, slop)) {
        return {
          kind: "track-reorder-handle",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
    }
    if (row) {
      return {
        kind: "track-header",
        trackIndex: row.index,
        trackId: row.track.id,
      };
    }
  }

  if (options.clipExtend) {
    const handle = getClipExtendHandle(presentation, options.clipExtend, extendScratch);
    if (handle && pointInRect(point, handle.hitRect)) {
      const view = presentation.clipViewsById.get(handle.clipId);
      if (view) {
        return { kind: "clip-extend", clip: view.clip, clipId: view.clip.id, x: handle.x };
      }
    }
  }

  for (let index = visibleClipViews.length - 1; index >= 0; index -= 1) {
    const clipView = visibleClipViews[index];

    if (!pointInRect(point, clipView.rect)) {
      continue;
    }

    const automationPointHit = getAutomationPointHit(clipView, point, metrics);

    if (automationPointHit) {
      return automationPointHit;
    }

    if (pointInRect(point, clipView.resizeLeftRect)) {
      return {
        kind: "resize-left",
        clip: clipView.clip,
        clipId: clipView.clip.id,
      };
    }

    if (pointInRect(point, clipView.resizeRightRect)) {
      return {
        kind: "resize-right",
        clip: clipView.clip,
        clipId: clipView.clip.id,
      };
    }

    const grip = options.clipLevelGrip;
    if (
      options.clipLevel === true &&
      !clipView.isAutomation &&
      (grip
        ? point.y <= clipView.rect.y + grip.height &&
          Math.abs(
            point.x - getClipLevelGripX(clipView, metrics, presentation.state.viewport.width),
          ) <=
            CLIP_LEVEL_GRIP_WIDTH / 2
        : point.y <= clipView.rect.y + CLIP_LEVEL_HANDLE_PX)
    ) {
      return {
        kind: "clip-level",
        clip: clipView.clip,
        clipId: clipView.clip.id,
      };
    }

    if (clipView.isAutomation && !pointInRect(point, clipView.titleRect)) {
      return {
        kind: "automation-body",
        clip: clipView.clip as PlaylistAutomationClip,
        clipId: clipView.clip.id,
      };
    }

    return {
      kind: "clip",
      clip: clipView.clip,
      clipId: clipView.clip.id,
    };
  }

  return { kind: "empty" };
}
