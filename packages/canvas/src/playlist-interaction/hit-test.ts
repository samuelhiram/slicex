import {
  getAutomationPointPosition,
  getClipRect,
  getClipTitleRect,
  isAutomationClip,
  pointInRect,
} from "../playlist-core";
import type {
  PlaylistAutomationClip,
  PlaylistClip,
  PlaylistMetrics,
  PlaylistPoint,
  PlaylistState,
} from "../playlist-core";

export type PlaylistHit =
  | { kind: "automation-point"; clip: PlaylistAutomationClip; pointId: string }
  | { kind: "resize-left"; clip: PlaylistClip }
  | { kind: "resize-right"; clip: PlaylistClip }
  | { kind: "automation-body"; clip: PlaylistAutomationClip }
  | { kind: "clip"; clip: PlaylistClip }
  | { kind: "empty" };

function distance(left: PlaylistPoint, right: PlaylistPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function hitTestPlaylist(
  state: PlaylistState,
  point: PlaylistPoint,
  metrics: PlaylistMetrics,
): PlaylistHit {
  for (let index = state.clips.length - 1; index >= 0; index -= 1) {
    const clip = state.clips[index];
    const rect = getClipRect(state, clip, metrics);

    if (!pointInRect(point, rect)) {
      continue;
    }

    if (isAutomationClip(clip)) {
      for (let pointIndex = clip.points.length - 1; pointIndex >= 0; pointIndex -= 1) {
        const automationPoint = clip.points[pointIndex];
        const position = getAutomationPointPosition(
          state,
          clip,
          automationPoint,
          metrics,
        );

        if (distance(point, position) <= metrics.automationPointRadius + 4) {
          return {
            kind: "automation-point",
            clip,
            pointId: automationPoint.id,
          };
        }
      }
    }

    const titleRect = getClipTitleRect(state, clip, metrics);
    const localX = point.x - rect.x;
    const insideTitle = pointInRect(point, titleRect);
    const canResize = clip.type !== "automation" || insideTitle;

    if (canResize && localX <= metrics.resizeHandleWidth) {
      return { kind: "resize-left", clip };
    }

    if (canResize && rect.width - localX <= metrics.resizeHandleWidth) {
      return { kind: "resize-right", clip };
    }

    if (isAutomationClip(clip) && !insideTitle) {
      return { kind: "automation-body", clip };
    }

    return { kind: "clip", clip };
  }

  return { kind: "empty" };
}
