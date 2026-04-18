import type { CanvasStoreSnapshot, CanvasViewportSnapshot } from "../types";

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasInteractionCommand =
  | {
      type: "viewport/set";
      viewport: CanvasViewportSnapshot;
    }
  | {
      type: "playhead/set";
      playheadAt: string | null;
    }
  | {
      type: "item/insert";
      date: string;
      trackIndex: number;
      durationDays: number;
    }
  | {
      type: "item/move";
      itemId: string;
      date: string;
      trackIndex: number;
    }
  | {
      type: "item/resize";
      itemId: string;
      edge: "start" | "end";
      date: string;
      durationDays: number;
    };

export interface CanvasInteractionHost {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;
  getBoundingClientRect: () => Pick<DOMRect, "left" | "top" | "width" | "height">;
  style?: {
    cursor?: string;
    touchAction?: string;
    userSelect?: string;
  };
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

export interface CanvasInteractionStoreReader {
  getState: () => CanvasStoreSnapshot;
}

export interface CanvasInteractionControllerOptions {
  onCommand: (command: CanvasInteractionCommand) => void;
  minZoom?: number;
  maxZoom?: number;
}

export interface CanvasInteractionController {
  destroy(): void;
}
