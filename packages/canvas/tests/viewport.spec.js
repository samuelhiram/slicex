import { describe, expect, it } from "vitest";
import { createViewport } from "../src/viewport";
class MockViewport {
    options;
    dragOptions;
    wheelOptions;
    pinchOptions;
    constructor(options) {
        this.options = options;
    }
    drag(options) {
        this.dragOptions = options;
        return this;
    }
    wheel(options) {
        this.wheelOptions = options;
        return this;
    }
    pinch(options) {
        this.pinchOptions = options;
        return this;
    }
}
describe("createViewport", () => {
    it("configures horizontal drag and zoom plugins", () => {
        const viewport = createViewport({
            screenWidth: 800,
            screenHeight: 600,
            worldWidth: 2400,
            worldHeight: 64,
            events: {},
        }, { ViewportClass: MockViewport });
        expect(viewport.options).toMatchObject({
            screenWidth: 800,
            screenHeight: 600,
            worldWidth: 2400,
            worldHeight: 64,
            noTicker: true,
            passiveWheel: true,
            stopPropagation: true,
        });
        expect(viewport.dragOptions).toMatchObject({
            direction: "x",
            pressDrag: true,
            wheel: false,
        });
        expect(viewport.wheelOptions).toMatchObject({
            wheelZoom: true,
            trackpadPinch: true,
        });
        expect(viewport.pinchOptions).toMatchObject({
            factor: 0.2,
        });
    });
});
