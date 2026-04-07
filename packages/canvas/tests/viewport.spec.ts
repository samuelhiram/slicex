import { describe, expect, it } from "vitest";
import type { CanvasViewportConstructor } from "../src/viewport";
import { createViewport } from "../src/viewport";

type MockViewportOptions = ConstructorParameters<CanvasViewportConstructor>[0];

class MockViewport {
  options: MockViewportOptions;
  dragOptions?: {
    direction?: string;
    pressDrag?: boolean;
    wheel?: boolean;
  };
  wheelOptions?: {
    wheelZoom?: boolean;
    trackpadPinch?: boolean;
    percent?: number;
  };
  pinchOptions?: {
    factor?: number;
  };

  constructor(options: MockViewportOptions) {
    this.options = options;
  }

  drag(options: MockViewport["dragOptions"]) {
    this.dragOptions = options;
    return this;
  }

  wheel(options: MockViewport["wheelOptions"]) {
    this.wheelOptions = options;
    return this;
  }

  pinch(options: MockViewport["pinchOptions"]) {
    this.pinchOptions = options;
    return this;
  }
}

describe("createViewport", () => {
  it("configures horizontal drag and zoom plugins", () => {
    const viewport = createViewport(
      {
        screenWidth: 800,
        screenHeight: 600,
        worldWidth: 2400,
        worldHeight: 64,
        events: {} as MockViewportOptions["events"],
      },
      { ViewportClass: MockViewport as unknown as CanvasViewportConstructor },
    ) as unknown as MockViewport;

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
