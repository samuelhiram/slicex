import { Viewport } from "pixi-viewport";
export function createViewport(options, dependencies = {}) {
    const ViewportClass = dependencies.ViewportClass ?? Viewport;
    const viewport = new ViewportClass({
        screenWidth: options.screenWidth,
        screenHeight: options.screenHeight,
        worldWidth: options.worldWidth,
        worldHeight: options.worldHeight,
        events: options.events,
        ticker: options.ticker,
        noTicker: options.ticker == null,
        passiveWheel: true,
        stopPropagation: true,
    });
    viewport.drag({
        direction: options.dragDirection ?? "x",
        pressDrag: true,
        wheel: false,
    });
    viewport.wheel({
        wheelZoom: true,
        trackpadPinch: true,
        percent: options.wheelPercent ?? 0.2,
    });
    viewport.pinch({
        factor: options.pinchFactor ?? 0.2,
    });
    return viewport;
}
