import type { PlaylistPoint } from "../playlist-core";

export interface ClipDragOriginal {
  id: string;
  start: number;
  trackIndex: number;
}

export type ActiveGesture =
  | {
      kind: "pan";
      pointerId: number;
      startPoint: PlaylistPoint;
      startScrollX: number;
      startScrollY: number;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startPoint: PlaylistPoint;
    }
  | {
      kind: "clip-drag";
      pointerId: number;
      primaryClipId: string;
      startPointerTime: number;
      startTrackIndex: number;
      originals: ClipDragOriginal[];
    }
  | {
      kind: "clip-resize";
      pointerId: number;
      clipId: string;
      edge: "left" | "right";
    }
  | {
      kind: "automation-point-drag";
      pointerId: number;
      clipId: string;
      pointId: string;
      originalTime: number;
      originalValue: number;
    }
  | {
      kind: "play-position-drag";
      pointerId: number;
    }
  | {
      kind: "scrollbar-horizontal";
      pointerId: number;
      startPoint: PlaylistPoint;
      startScrollX: number;
    }
  | {
      kind: "scrollbar-vertical";
      pointerId: number;
      startPoint: PlaylistPoint;
      startScrollY: number;
    }
  | {
      kind: "paint-drag";
      pointerId: number;
      lastTrackIndex: number;
      lastSnappedStart: number;
    }
  | {
      kind: "delete-drag";
      pointerId: number;
    };

export type ActiveGestureKind = ActiveGesture["kind"];
