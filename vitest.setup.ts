import { vi } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
}

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);