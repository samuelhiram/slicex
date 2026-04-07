import { describe, it, expect } from "vitest";
import { calculateBalanceAt } from "../src/calculateBalanceAt";
describe("calculateBalanceAt", () => {
    it("sums one-time items correctly", () => {
        const doc = {
            id: "t1",
            tenantId: "tenant1",
            title: "test",
            items: [
                {
                    id: "a",
                    tenantId: "tenant1",
                    name: "income",
                    amount: 100,
                    date: "2026-01-01",
                    recurrence: null,
                },
            ],
        };
        expect(calculateBalanceAt(doc, "2026-01-02")).toBe(100);
        expect(calculateBalanceAt(doc, "2025-12-31")).toBe(0);
    });
    it("handles daily recurrence", () => {
        const doc = {
            id: "t2",
            tenantId: "tenant1",
            title: "daily",
            items: [
                {
                    id: "d1",
                    tenantId: "tenant1",
                    name: "daily",
                    amount: 10,
                    date: "2026-01-01",
                    recurrence: { frequency: "DAILY", interval: 1 },
                },
            ],
        };
        // 2026-01-01 .. 2026-01-05 => 5 occurrences
        expect(calculateBalanceAt(doc, "2026-01-05")).toBe(50);
    });
    it("respects recurrence count", () => {
        const doc = {
            id: "t3",
            tenantId: "tenant1",
            title: "count",
            items: [
                {
                    id: "c1",
                    tenantId: "tenant1",
                    name: "limited",
                    amount: 7,
                    date: "2026-01-01",
                    recurrence: { frequency: "WEEKLY", interval: 1, count: 2 },
                },
            ],
        };
        // Should only occur twice even if at is later
        expect(calculateBalanceAt(doc, "2026-02-28")).toBe(14);
    });
    it("respects until date for recurrence", () => {
        const doc = {
            id: "t4",
            tenantId: "tenant1",
            title: "until",
            items: [
                {
                    id: "u1",
                    tenantId: "tenant1",
                    name: "until",
                    amount: 5,
                    date: "2026-01-01",
                    recurrence: {
                        frequency: "MONTHLY",
                        interval: 1,
                        until: "2026-03-01",
                    },
                },
            ],
        };
        // Occurrences on 2026-01-01, 2026-02-01, 2026-03-01 => 3
        expect(calculateBalanceAt(doc, "2026-04-01")).toBe(15);
    });
});
