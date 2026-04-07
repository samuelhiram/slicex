import { calculateBalanceAt } from "@slicex/core";
function normalizePlayheadAt(playheadAt) {
    if (playheadAt == null) {
        return null;
    }
    if (playheadAt instanceof Date) {
        return Number.isNaN(playheadAt.getTime()) ? null : playheadAt.toISOString();
    }
    const parsed = new Date(playheadAt);
    return Number.isNaN(parsed.getTime()) ? null : playheadAt;
}
function calculateSnapshotBalance(snapshot) {
    const activeTimeline = snapshot.document;
    const playheadAt = normalizePlayheadAt(snapshot.playheadAt);
    if (!activeTimeline || !playheadAt) {
        return 0;
    }
    return calculateBalanceAt(activeTimeline, playheadAt);
}
function hasSnapshotApi(store) {
    return (typeof store.getState === "function" &&
        typeof store.subscribeState === "function");
}
export function createBalanceStoreSubscriber(store, onBalanceChange) {
    if (!hasSnapshotApi(store)) {
        throw new Error("Balance subscriber requires getState() and subscribeState() support.");
    }
    const initialSnapshot = store.getState();
    let lastDocument = initialSnapshot.document;
    let lastPlayheadAt = normalizePlayheadAt(initialSnapshot.playheadAt);
    onBalanceChange(calculateSnapshotBalance(initialSnapshot));
    const subscription = store.subscribeState((snapshot) => {
        const nextPlayheadAt = normalizePlayheadAt(snapshot.playheadAt);
        if (snapshot.document === lastDocument &&
            nextPlayheadAt === lastPlayheadAt) {
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
