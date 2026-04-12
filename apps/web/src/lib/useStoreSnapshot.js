import { useEffect, useState } from "react";
import { storeAdapter as defaultStoreAdapter } from "./storeAdapter";
function assertSnapshotStore(store) {
    if (typeof store.getState !== "function" ||
        typeof store.subscribeState !== "function") {
        throw new Error("Store adapter requires getState() and subscribeState().");
    }
}
export function useStoreSnapshot(store = defaultStoreAdapter) {
    assertSnapshotStore(store);
    const [snapshot, setSnapshot] = useState(() => store.getState());
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
