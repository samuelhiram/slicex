import { describe, expect, it } from "vitest";
import { applyCanvasCommand, createDraftTimelineDocument, resolveInitialViewportOriginDate, } from "../src/lib/canvasCommandBridge";
function createPort(initialSnapshot) {
    let snapshot = initialSnapshot;
    return {
        getState() {
            return snapshot;
        },
        setViewport(viewport) {
            snapshot = {
                ...snapshot,
                viewport,
            };
        },
        setPlayheadAt(value) {
            snapshot = {
                ...snapshot,
                playheadAt: value,
            };
        },
        patchDocument(updater) {
            snapshot = {
                ...snapshot,
                document: updater(snapshot.document),
            };
        },
        getSnapshot() {
            return snapshot;
        },
    };
}
describe("canvas command bridge", () => {
    it("resolves the initial viewport origin from the earliest timeline date", () => {
        const origin = resolveInitialViewportOriginDate({
            document: {
                id: "timeline-1",
                tenantId: "tenant-1",
                title: "Demo",
                items: [
                    {
                        id: "later",
                        tenantId: "tenant-1",
                        name: "Later",
                        amount: 100,
                        date: "2026-01-05T00:00:00.000Z",
                        recurrence: null,
                    },
                    {
                        id: "earlier",
                        tenantId: "tenant-1",
                        name: "Earlier",
                        amount: 50,
                        date: "2026-01-02T00:00:00.000Z",
                        recurrence: null,
                    },
                ],
            },
            viewport: { x: 0, y: 0, zoom: 1 },
            playheadAt: null,
            selection: [],
        });
        expect(origin).toBe("2026-01-02T00:00:00.000Z");
    });
    it("creates a draft timeline when inserting into an empty document", () => {
        const port = createPort({
            document: null,
            viewport: { x: 0, y: 0, zoom: 1, originDate: null },
            playheadAt: null,
            selection: [],
        });
        applyCanvasCommand({
            type: "item/insert",
            date: "2026-01-05T00:00:00.000Z",
            trackIndex: 0,
            durationDays: 3,
        }, port);
        const document = port.getSnapshot().document;
        expect(document).not.toBeNull();
        expect(document?.title).toBe("Untitled timeline");
        expect(document?.items).toHaveLength(1);
        expect(document?.items[0]).toMatchObject({
            date: "2026-01-05T00:00:00.000Z",
            durationDays: 3,
            amount: 0,
            recurrence: null,
        });
    });
    it("applies viewport, playhead, move and resize commands", () => {
        const port = createPort({
            document: {
                id: "timeline-1",
                tenantId: "tenant-1",
                title: "Demo",
                items: [
                    {
                        id: "rent",
                        tenantId: "tenant-1",
                        name: "Rent",
                        amount: -1000,
                        date: "2026-01-03T00:00:00.000Z",
                        durationDays: 2,
                        recurrence: null,
                    },
                    {
                        id: "income",
                        tenantId: "tenant-1",
                        name: "Income",
                        amount: 2500,
                        date: "2026-01-06T00:00:00.000Z",
                        recurrence: null,
                    },
                ],
            },
            viewport: { x: 0, y: 0, zoom: 1, originDate: "2026-01-01T00:00:00.000Z" },
            playheadAt: null,
            selection: [],
        });
        applyCanvasCommand({
            type: "viewport/set",
            viewport: {
                x: 80,
                y: 0,
                zoom: 1.5,
                originDate: "2026-01-01T00:00:00.000Z",
            },
        }, port);
        applyCanvasCommand({
            type: "playhead/set",
            playheadAt: "2026-01-04T00:00:00.000Z",
        }, port);
        applyCanvasCommand({
            type: "item/move",
            itemId: "income",
            date: "2026-01-04T00:00:00.000Z",
            trackIndex: 0,
        }, port);
        applyCanvasCommand({
            type: "item/resize",
            itemId: "rent",
            edge: "end",
            date: "2026-01-03T00:00:00.000Z",
            durationDays: 4,
        }, port);
        const snapshot = port.getSnapshot();
        expect(snapshot.viewport).toMatchObject({
            x: 80,
            y: 0,
            zoom: 1.5,
            originDate: "2026-01-01T00:00:00.000Z",
        });
        expect(snapshot.playheadAt).toBe("2026-01-04T00:00:00.000Z");
        expect(snapshot.document?.items[0].id).toBe("income");
        expect(snapshot.document?.items[0].date).toBe("2026-01-04T00:00:00.000Z");
        expect(snapshot.document?.items[1]).toMatchObject({
            id: "rent",
            durationDays: 4,
            date: "2026-01-03T00:00:00.000Z",
        });
    });
    it("can create a blank draft timeline on demand", () => {
        const draft = createDraftTimelineDocument();
        expect(draft.title).toBe("Untitled timeline");
        expect(draft.items).toEqual([]);
        expect(draft.id).toContain("timeline-");
        expect(draft.tenantId).toContain("tenant-");
    });
});
