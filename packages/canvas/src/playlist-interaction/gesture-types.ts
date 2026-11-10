import type { PlaylistClipType, PlaylistPoint } from "../playlist-core";
import type { BrushOcclusion } from "./brush";

export interface ClipDragOriginal {
  id: string;
  start: number;
  trackIndex: number;
  // Lane inside its track at drag start (stacked lanes, lanes.ts).
  lane: number;
}

// Per destination track, filled the first time the drag hovers it: whether
// other (not dragged) clips live there — then the row opens a free lane —
// and how many lanes it had when the gesture started (the free lane's
// index). Clips outside the drag don't change during it, so it stays valid.
export interface ClipDragTrackInfo {
  hasOthers: boolean;
  baseLanes: number;
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
      // Filled lazily by the controller (see ClipDragTrackInfo).
      trackInfo?: Map<string, ClipDragTrackInfo>;
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
      // Dragging an edge of the horizontal scrollbar's thumb: zoom so the
      // visible range keeps the opposite edge and follows the pointer.
      kind: "scrollbar-zoom";
      pointerId: number;
      edge: "start" | "end";
      // Beat of the edge that stays put.
      fixedBeat: number;
      // Track x of beat 0 and beats per track px, frozen at gesture start.
      trackX: number;
      beatsPerPx: number;
    }
  | {
      kind: "clip-level";
      pointerId: number;
      clipId: string;
      startY: number;
    }
  | {
      // The selected clip's extend grabber: the right end moves by the
      // time the pointer travels (relative: the end may be off-screen).
      kind: "clip-extend";
      pointerId: number;
      clipId: string;
      // Pointer time at the last move (beats), the clip's end at press and
      // the end travel so far (beats, gain applied move by move).
      startPointerTime: number;
      originalEnd: number;
      travelled: number;
      // Grabber centre minus pointer x at press, so the pill never jumps.
      grabOffsetX: number;
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
      // True when the sweep came from an RMB press with Draw/Paint/Mute, where
      // automation clips are off-limits (RMB there means "add control point").
      // The Delete tool leaves it false and deletes everything.
      skipAutomation?: boolean;
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
    }
  | {
      // Draw tool — drag from an empty cell to size the new clip while
      // creating it. The clip is created the moment the cursor crosses the
      // minClipDuration threshold; subsequent moves grow its right edge.
      kind: "clip-create-drag";
      pointerId: number;
      createdClipId: string | null;
      startPointerTime: number;
      startTrackIndex: number;
      startSnappedStart: number;
      // Template captured once so the created clip's metadata is stable
      // across moves (label/color/type/sourceId).
      template: {
        type: PlaylistClipType;
        label: string;
        color: string;
        sourceId?: string;
      };
      // The host creates through its own flow (onCreateRequest): the drag
      // only previews the range (dragPreview "clip-create"); on release
      // the host gets the request. Nothing is created here.
      hostCreate?: {
        templateClipId: string | null;
        // Snapped end of the previewed range; null until the drag passes
        // minClipDuration (a plain click requests nothing).
        end: number | null;
      };
    };

export type ActiveGestureKind = ActiveGesture["kind"];
