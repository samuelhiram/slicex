import {
  pointInRect,
  type PlaylistAutomationClip,
  type PlaylistClip,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistPresentation,
} from "../playlist-core";

export type PlaylistHit =
  | { kind: "empty" }
  | { kind: "marker"; markerId: string }
  | { kind: "scrollbar-horizontal"; onThumb: boolean }
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

export function hitTestPlaylist(
  presentation: PlaylistPresentation,
  point: PlaylistPoint,
  metrics: PlaylistMetrics,
): PlaylistHit {
  const { playPosition, scrollbars, trackRows, visibleClipViews } =
    presentation;

  if (pointInRect(point, scrollbars.horizontal.trackRect)) {
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

  if (point.y > metrics.rulerHeight) {
    // Track-resize handle spans the full width to mimic FL Studio: drag the
    // divisor between two tracks at any x (header or timeline).
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

    if (row) {
      if (pointInRect(point, row.buttons.mute)) {
        return {
          kind: "track-mute-button",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      if (pointInRect(point, row.buttons.solo)) {
        return {
          kind: "track-solo-button",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      if (pointInRect(point, row.buttons.lock)) {
        return {
          kind: "track-lock-button",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      if (pointInRect(point, row.reorderHandleRect)) {
        return {
          kind: "track-reorder-handle",
          trackIndex: row.index,
          trackId: row.track.id,
        };
      }
      return {
        kind: "track-header",
        trackIndex: row.index,
        trackId: row.track.id,
      };
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
