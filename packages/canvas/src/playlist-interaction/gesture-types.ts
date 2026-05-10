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
      additive: boolean;
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
      // Captured at pointerdown so a drag is proportional even as the
      // virtual content extent grows mid-gesture.
      scrollableRange: number;
      travel: number;
    }
  | {
      kind: "scrollbar-vertical";
      pointerId: number;
      startPoint: PlaylistPoint;
      startScrollY: number;
      scrollableRange: number;
      travel: number;
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
    }
  | {
      kind: "track-resize";
      pointerId: number;
      trackIndex: number;
      startY: number;
      startHeight: number;
    }
  | {
      kind: "track-reorder";
      pointerId: number;
      fromIndex: number;
      currentIndex: number;
    }
  | {
      kind: "slip-drag";
      pointerId: number;
      clipId: string;
      startPointerTime: number;
      startContentOffset: number;
      startStretchRatio: number;
    }
  | {
      kind: "slice-drag";
      pointerId: number;
      startPoint: PlaylistPoint;
      currentPoint: PlaylistPoint;
    }
  | {
      kind: "marker-drag";
      pointerId: number;
      markerId: string;
      startTime: number;
      startPointerTime: number;
    };

export type ActiveGestureKind = ActiveGesture["kind"];
