import { useEffect, useState } from "react";
import type { CanvasStoreSnapshot, StoreAdapter } from "@slicex/canvas";
import { storeAdapter as defaultStoreAdapter } from "./storeAdapter";

export type SnapshotStoreAdapter = StoreAdapter & {
  getState: () => CanvasStoreSnapshot;
  subscribeState: (
    cb: (snapshot: CanvasStoreSnapshot) => void,
  ) => { unsubscribe: () => void };
};

function assertSnapshotStore(
  store: StoreAdapter,
): asserts store is SnapshotStoreAdapter {
  if (
    typeof (store as SnapshotStoreAdapter).getState !== "function" ||
    typeof (store as SnapshotStoreAdapter).subscribeState !== "function"
  ) {
    throw new Error("Store adapter requires getState() and subscribeState().");
  }
}

export function useStoreSnapshot(
  store: StoreAdapter = defaultStoreAdapter,
): CanvasStoreSnapshot {
  assertSnapshotStore(store);
  const [snapshot, setSnapshot] = useState<CanvasStoreSnapshot>(() => store.getState());

  useEffect(() => {
    setSnapshot(store.getState());

    const subscription = store.subscribeState((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [store]);

  return snapshot;
}