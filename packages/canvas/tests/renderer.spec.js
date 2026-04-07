import { it, expect } from "vitest";
import { createRenderer, projectCanvasScene } from "../src/renderer";
it("returns a destroyable renderer in headless mode", () => {
    let stateSubscribeCalled = false;
    let docSubscribeCalled = false;
    const store = {
        getDocument() {
            return null;
        },
        getState() {
            return {
                document: null,
                viewport: { x: 0, y: 0, zoom: 1 },
                playheadAt: null,
                selection: [],
            };
        },
        subscribeState(cb) {
            stateSubscribeCalled = true;
            cb(this.getState());
            return {
                unsubscribe: () => { },
            };
        },
        subscribe(cb) {
            docSubscribeCalled = true;
            return {
                unsubscribe: () => { },
            };
        },
    };
    const fakeContainer = { appendChild: () => { } };
    const r = createRenderer(fakeContainer, store);
    expect(r).toHaveProperty("app");
    expect(typeof r.destroy).toBe("function");
    expect(stateSubscribeCalled).toBe(true);
    expect(docSubscribeCalled).toBe(false);
    r.destroy();
});
it("projects a timeline document into scene state", () => {
    const projection = projectCanvasScene({
        document: {
            id: "timeline-1",
            tenantId: "tenant-1",
            title: "Demo",
            items: [
                {
                    id: "income",
                    tenantId: "tenant-1",
                    name: "Income",
                    amount: 2500,
                    date: "2026-01-03T00:00:00.000Z",
                    recurrence: null,
                },
                {
                    id: "rent",
                    tenantId: "tenant-1",
                    name: "Rent",
                    amount: -1200,
                    date: "2026-01-01T00:00:00.000Z",
                    recurrence: null,
                },
            ],
        },
        viewport: { x: 160, y: 0, zoom: 1.5 },
        playheadAt: "2026-01-04T00:00:00.000Z",
        selection: [],
    }, { width: 1280, height: 720 });
    expect(projection.tracks).toHaveLength(2);
    expect(projection.objects).toHaveLength(2);
    expect(projection.objects[0].trackIndex).toBe(0);
    expect(projection.objects[1].trackIndex).toBe(1);
    expect(projection.viewport.originDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(projection.viewport.scrollX).toBe(160);
    expect(projection.viewport.zoom).toBe(1.5);
    expect(projection.viewport.height).toBe(688);
    expect((projection.playhead.playheadAt instanceof Date
        ? projection.playhead.playheadAt
        : new Date(projection.playhead.playheadAt ?? "")).toISOString()).toBe("2026-01-04T00:00:00.000Z");
});
