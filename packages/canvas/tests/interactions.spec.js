import { describe, expect, it } from "vitest";
import { createCanvasInteractionController } from "../src/interactions";
import { DAY_WIDTH_PX } from "../src/coordinate-system";
import { projectCanvasScene } from "../src/renderer";
import { RULER_HEIGHT_PX } from "../src/scene/types";
function createMockHost(width = 800, height = 480) {
    const listeners = new Map();
    const host = {
        style: {},
        addEventListener(type, listener) {
            const bucket = listeners.get(type) ?? new Set();
            bucket.add(listener);
            listeners.set(type, bucket);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        getBoundingClientRect() {
            return {
                left: 0,
                top: 0,
                width,
                height,
            };
        },
        dispatch(type, event) {
            for (const listener of listeners.get(type) ?? []) {
                listener({
                    preventDefault: () => { },
                    stopPropagation: () => { },
                    ...event,
                });
            }
        },
    };
    return host;
}
function createMockStore(snapshot) {
    return {
        getState: () => snapshot,
    };
}
const baseSnapshot = {
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
    viewport: {
        x: 0,
        y: 0,
        zoom: 1,
        originDate: "2026-01-01T00:00:00.000Z",
    },
    playheadAt: null,
    selection: [],
};
describe("createCanvasInteractionController", () => {
    it("pans the timeline when dragging the background", () => {
        const commands = [];
        const host = createMockHost();
        const controller = createCanvasInteractionController(host, createMockStore(baseSnapshot), {
            onCommand(command) {
                commands.push(command);
            },
        });
        host.dispatch("pointerdown", {
            button: 0,
            pointerId: 1,
            clientX: 400,
            clientY: 220,
        });
        host.dispatch("pointermove", {
            button: 0,
            pointerId: 1,
            clientX: 350,
            clientY: 220,
        });
        expect(commands).toEqual([
            {
                type: "viewport/set",
                viewport: {
                    x: 50,
                    y: 0,
                    zoom: 1,
                    originDate: "2026-01-01T00:00:00.000Z",
                },
            },
        ]);
        controller.destroy();
    });
    it("zooms around the cursor on wheel gestures", () => {
        const commands = [];
        const host = createMockHost();
        const controller = createCanvasInteractionController(host, createMockStore(baseSnapshot), {
            onCommand(command) {
                commands.push(command);
            },
        });
        host.dispatch("wheel", {
            deltaX: 0,
            deltaY: -120,
            clientX: 200,
            clientY: 220,
            ctrlKey: true,
            metaKey: false,
        });
        expect(commands).toHaveLength(1);
        expect(commands[0]?.type).toBe("viewport/set");
        if (commands[0]?.type === "viewport/set") {
            expect(commands[0].viewport.zoom).toBeGreaterThan(1);
            expect(commands[0].viewport.x).toBeGreaterThan(0);
            expect(commands[0].viewport.originDate).toBe("2026-01-01T00:00:00.000Z");
        }
        controller.destroy();
    });
    it("scrubs the playhead from the ruler", () => {
        const commands = [];
        const host = createMockHost();
        const controller = createCanvasInteractionController(host, createMockStore(baseSnapshot), {
            onCommand(command) {
                commands.push(command);
            },
        });
        host.dispatch("pointerdown", {
            button: 0,
            pointerId: 1,
            clientX: 80,
            clientY: 12,
        });
        expect(commands).toEqual([
            {
                type: "playhead/set",
                playheadAt: "2026-01-02T00:00:00.000Z",
            },
        ]);
        controller.destroy();
    });
    it("inserts, moves and resizes items from hit targets", () => {
        const commands = [];
        const host = createMockHost();
        const projection = projectCanvasScene(baseSnapshot, {
            width: 800,
            height: 480,
        });
        const placement = projection.objects[0];
        const controller = createCanvasInteractionController(host, createMockStore(baseSnapshot), {
            onCommand(command) {
                commands.push(command);
            },
        });
        host.dispatch("dblclick", {
            button: 0,
            pointerId: 1,
            clientX: 320,
            clientY: 110,
        });
        host.dispatch("pointerdown", {
            button: 0,
            pointerId: 2,
            clientX: placement.x + placement.widthPx / 2,
            clientY: placement.y + RULER_HEIGHT_PX + placement.heightPx / 2,
        });
        host.dispatch("pointermove", {
            button: 0,
            pointerId: 2,
            clientX: placement.x + DAY_WIDTH_PX,
            clientY: placement.y + RULER_HEIGHT_PX + placement.heightPx + 40,
        });
        host.dispatch("pointerdown", {
            button: 0,
            pointerId: 3,
            clientX: placement.x + placement.widthPx - 5,
            clientY: placement.y + RULER_HEIGHT_PX + placement.heightPx / 2,
        });
        host.dispatch("pointermove", {
            button: 0,
            pointerId: 3,
            clientX: placement.x + DAY_WIDTH_PX * 3,
            clientY: placement.y + RULER_HEIGHT_PX + placement.heightPx / 2,
        });
        expect(commands).toEqual([
            {
                type: "item/insert",
                date: "2026-01-05T00:00:00.000Z",
                trackIndex: 1,
                durationDays: 1,
            },
            {
                type: "item/move",
                itemId: "rent",
                date: "2026-01-04T00:00:00.000Z",
                trackIndex: 1,
            },
            {
                type: "item/resize",
                itemId: "rent",
                edge: "end",
                date: "2026-01-03T00:00:00.000Z",
                durationDays: 4,
            },
        ]);
        controller.destroy();
    });
});
