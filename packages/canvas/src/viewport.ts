import { Viewport } from "pixi-viewport";
import type { EventSystem, Ticker } from "pixi.js";

export type CanvasViewport = InstanceType<typeof Viewport>;

export type CanvasViewportConstructor = new (
  options: ConstructorParameters<typeof Viewport>[0],
) => CanvasViewport;

export interface CanvasViewportOptions {
  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  events: EventSystem;
  ticker?: Ticker;
  dragDirection?: "x" | "xy";
  wheelPercent?: number;
  pinchFactor?: number;
}

export interface CanvasViewportDependencies {
  ViewportClass?: CanvasViewportConstructor;
}

export function createViewport(
  options: CanvasViewportOptions,
  dependencies: CanvasViewportDependencies = {},
): CanvasViewport {
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
