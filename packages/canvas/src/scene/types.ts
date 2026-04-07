import type { FinancialObject } from "@slicex/core";

export const TRACK_HEIGHT_PX = 64;
export const RULER_HEIGHT_PX = 32;
export const OBJECT_HEIGHT_PX = 28;
export const OBJECT_VERTICAL_PADDING_PX = 18;
export const PLAYHEAD_WIDTH_PX = 2;

export interface SceneTrack {
  id: string;
  label?: string;
  color?: number;
}

export interface SceneObjectPlacement {
  object: FinancialObject;
  trackIndex: number;
}

export interface SceneViewportState {
  originDate: Date;
  scrollX: number;
  zoom: number;
  width: number;
  height: number;
}

export interface ScenePlayheadState extends SceneViewportState {
  playheadAt: Date | string | null;
}
