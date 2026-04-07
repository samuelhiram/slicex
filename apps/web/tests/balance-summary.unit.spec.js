import { jsx as _jsx } from "react/jsx-runtime";
/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BalanceSummary } from "../src/components/BalanceSummary";
function createMockStore(initialSnapshot) {
    let snapshot = initialSnapshot;
    const listeners = new Set();
    let unsubscribeCount = 0;
    const store = {
        getDocument: () => snapshot.document,
        getState: () => snapshot,
        subscribe: () => ({ unsubscribe: () => { } }),
        subscribeState: (cb) => {
            listeners.add(cb);
            return {
                unsubscribe: () => {
                    unsubscribeCount += 1;
                    listeners.delete(cb);
                },
            };
        },
    };
    return {
        store,
        emit(nextSnapshot) {
            snapshot = { ...snapshot, ...nextSnapshot };
            for (const listener of listeners) {
                listener(snapshot);
            }
        },
        listenerCount() {
            return listeners.size;
        },
        unsubscribeCount() {
            return unsubscribeCount;
        },
    };
}
const timeline = {
    id: "timeline-1",
    tenantId: "tenant-1",
    title: "Demo balance",
    items: [
        {
            id: "income",
            tenantId: "tenant-1",
            name: "Income",
            amount: 1000,
            date: "2026-01-03T00:00:00.000Z",
            recurrence: null,
        },
        {
            id: "expense",
            tenantId: "tenant-1",
            name: "Expense",
            amount: -300,
            date: "2026-01-05T00:00:00.000Z",
            recurrence: null,
        },
    ],
};
describe("BalanceSummary", () => {
    let container;
    let root;
    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => {
            root.unmount();
        });
        document.body.removeChild(container);
    });
    it("updates when the playhead changes and cleans up on unmount", () => {
        const store = createMockStore({
            document: timeline,
            viewport: { x: 0, y: 0, zoom: 1 },
            playheadAt: "2026-01-01T00:00:00.000Z",
            selection: [],
        });
        act(() => {
            root.render(_jsx(BalanceSummary, { store: store.store }));
        });
        const balanceValue = container.querySelector("[data-testid='balance-summary-value']");
        expect(balanceValue?.textContent).toBe("0");
        act(() => {
            store.emit({ playheadAt: "2026-01-03T00:00:00.000Z" });
        });
        expect(balanceValue?.textContent).toBe("1,000");
        act(() => {
            store.emit({ playheadAt: "2026-01-05T00:00:00.000Z" });
        });
        expect(balanceValue?.textContent).toBe("700");
        act(() => {
            root.unmount();
        });
        expect(store.listenerCount()).toBe(0);
        expect(store.unsubscribeCount()).toBe(1);
        act(() => {
            store.emit({ playheadAt: "2026-01-06T00:00:00.000Z" });
        });
        expect(balanceValue?.textContent).toBe("700");
    });
});
