import { calculateBalanceAt } from "@slicex/core";
import type { CanvasStoreSnapshot, StoreAdapter } from "../types";

export type BalanceChangeCallback = (balance: number) => void;

export interface BalanceStoreSubscription {
  destroy(): void;
}

function normalizePlayheadAt(
  playheadAt: CanvasStoreSnapshot["playheadAt"],
): string | null {
  if (playheadAt == null) {
    return null;
  }

  if (playheadAt instanceof Date) {
    return Number.isNaN(playheadAt.getTime()) ? null : playheadAt.toISOString();
  }

  const parsed = new Date(playheadAt);
  return Number.isNaN(parsed.getTime()) ? null : playheadAt;
}

function calculateSnapshotBalance(snapshot: CanvasStoreSnapshot): number {
  const activeTimeline = snapshot.document;
  const playheadAt = normalizePlayheadAt(snapshot.playheadAt);

  if (!activeTimeline || !playheadAt) {
    return 0;
  }

  return calculateBalanceAt(activeTimeline, playheadAt);
}

function hasSnapshotApi(
  store: StoreAdapter,
): store is StoreAdapter & {
  getState: () => CanvasStoreSnapshot;
  subscribeState: (
    cb: (snapshot: CanvasStoreSnapshot) => void,
  ) => { unsubscribe: () => void };
} {
  return (
    typeof store.getState === "function" &&
    typeof store.subscribeState === "function"
  );
}

export function createBalanceStoreSubscriber(
  store: StoreAdapter,
  onBalanceChange: BalanceChangeCallback,
): BalanceStoreSubscription {
  if (!hasSnapshotApi(store)) {
    throw new Error(
      "Balance subscriber requires getState() and subscribeState() support.",
    );
  }

  const initialSnapshot = store.getState();
  let lastDocument = initialSnapshot.document;
  let lastPlayheadAt = normalizePlayheadAt(initialSnapshot.playheadAt);

  onBalanceChange(calculateSnapshotBalance(initialSnapshot));

  const subscription = store.subscribeState((snapshot) => {
    const nextPlayheadAt = normalizePlayheadAt(snapshot.playheadAt);

    if (
      snapshot.document === lastDocument &&
      nextPlayheadAt === lastPlayheadAt
    ) {
      return;
    }

    lastDocument = snapshot.document;
    lastPlayheadAt = nextPlayheadAt;
    onBalanceChange(calculateSnapshotBalance(snapshot));
  });

  return {
    destroy() {
      subscription.unsubscribe();
    },
  };
}