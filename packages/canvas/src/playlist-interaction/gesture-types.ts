import type { PlaylistClipType, PlaylistPoint } from "../playlist-core";
import type { BrushOcclusion } from "./brush";

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
      // Canon §3 brush pattern: O(1) occupied-cell lookup. Seeded with
      // existing clip cells at pointerdown; the handler adds painted
      // cells as it strokes.
      occupied: BrushOcclusion;
      // Snap step captured at gesture start so brush interpolation stays
      // consistent even if the user changes snap mode mid-drag.
      snapStep: number;
      // Default duration applied to each painted clip.
      duration: number;
      // Default visual color for painted clips.
      color: string;
      type: PlaylistClipType;
      label: string;
      sourceId?: string;
    }
  | {
      kind: "delete-drag";
      pointerId: number;
      lastPoint: PlaylistPoint;
      deletedClipIds: Set<string>;
    }
  | {
      kind: "mute-drag";
      pointerId: number;
      lastPoint: PlaylistPoint;
      muted: boolean;
      touchedClipIds: Set<string>;
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
