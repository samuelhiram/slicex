import { describe, expect, it } from "vitest";
import { createBalanceStoreSubscriber } from "../src/adapters/store-subscriber";
import type { CanvasStoreSnapshot, StoreAdapter } from "../src/types";

function createMockStore(initialSnapshot: CanvasStoreSnapshot) {
  let snapshot = initialSnapshot;
  const listeners = new Set<(nextSnapshot: CanvasStoreSnapshot) => void>();

  const store: StoreAdapter = {
    getDocument: () => snapshot.document,
    getState: () => snapshot,
    subscribe: () => ({ unsubscribe: () => {} }),
    subscribeState: (cb) => {
      listeners.add(cb);
      return {
        unsubscribe: () => {
          listeners.delete(cb);
        },
      };
    },
  };

  return {
    store,
    setState(nextSnapshot: Partial<CanvasStoreSnapshot>) {
      snapshot = { ...snapshot, ...nextSnapshot };
      for (const listener of listeners) {
        listener(snapshot);
      }
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
} satisfies NonNullable<CanvasStoreSnapshot["document"]>;

describe("createBalanceStoreSubscriber", () => {
  it("emits 0 before any object is crossed", () => {
    const { store } = createMockStore({
      document: timeline,
      viewport: { x: 0, y: 0, zoom: 1 },
      playheadAt: "2026-01-01T00:00:00.000Z",
      selection: [],
    });
    const balances: number[] = [];

    const subscriber = createBalanceStoreSubscriber(store, (balance) => {
      balances.push(balance);
    });

    expect(balances).toEqual([0]);
    subscriber.destroy();
  });

  it("updates the balance after an income appears", () => {
    const { store, setState } = createMockStore({
      document: timeline,
      viewport: { x: 0, y: 0, zoom: 1 },
      playheadAt: "2026-01-01T00:00:00.000Z",
      selection: [],
    });
    const balances: number[] = [];

    const subscriber = createBalanceStoreSubscriber(store, (balance) => {
      balances.push(balance);
    });

    setState({ playheadAt: "2026-01-03T00:00:00.000Z" });

    expect(balances).toEqual([0, 1000]);
    subscriber.destroy();
  });

  it("decreases the balance after an expense appears", () => {
    const { store, setState } = createMockStore({
      document: timeline,
      viewport: { x: 0, y: 0, zoom: 1 },
      playheadAt: "2026-01-03T00:00:00.000Z",
      selection: [],
    });
    const balances: number[] = [];

    const subscriber = createBalanceStoreSubscriber(store, (balance) => {
      balances.push(balance);
    });

    setState({ playheadAt: "2026-01-05T00:00:00.000Z" });

    expect(balances).toEqual([1000, 700]);
    subscriber.destroy();
  });

  it("stops emitting after destroy", () => {
    const { store, setState } = createMockStore({
      document: timeline,
      viewport: { x: 0, y: 0, zoom: 1 },
      playheadAt: "2026-01-03T00:00:00.000Z",
      selection: [],
    });
    const balances: number[] = [];

    const subscriber = createBalanceStoreSubscriber(store, (balance) => {
      balances.push(balance);
    });

    subscriber.destroy();
    setState({ playheadAt: "2026-01-06T00:00:00.000Z" });

    expect(balances).toEqual([1000]);
  });
});