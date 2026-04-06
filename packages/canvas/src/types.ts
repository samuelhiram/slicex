import type { TimelineDocument } from '@slicex/core';

export type StoreSubscriber = (doc: TimelineDocument | null) => void;

export interface StoreAdapter {
  subscribe: (cb: StoreSubscriber) => { unsubscribe: () => void };
  getDocument: () => TimelineDocument | null;
}
