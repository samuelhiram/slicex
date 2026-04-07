import type { TimelineDocument } from "@slicex/core";

export type StoreSubscriber = (doc: TimelineDocument | null) => void;

export interface CanvasViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasStoreSnapshot {
  document: TimelineDocument | null;
  viewport?: CanvasViewportSnapshot;
  playheadAt?: Date | string | null;
  selection?: string[];
}

export type StoreSnapshotSubscriber = (state: CanvasStoreSnapshot) => void;

export interface StoreAdapter {
  subscribe: (cb: StoreSubscriber) => { unsubscribe: () => void };
  getDocument: () => TimelineDocument | null;
  getState?: () => CanvasStoreSnapshot;
  subscribeState?: (cb: StoreSnapshotSubscriber) => { unsubscribe: () => void };
}
