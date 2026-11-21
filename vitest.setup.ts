import { vi } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
}

// jsdom has no matchMedia; Mantine's provider (forms' calendar) reads it.
// No media query matches: the OS prefers the light theme, as before.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

// Radix primitives (the app's Select) use pointer capture and
// scrollIntoView, which jsdom does not implement: inert stand-ins.
if (typeof Element !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
    if (typeof proto[name] !== "function") {
      Object.defineProperty(Element.prototype, name, {
        configurable: true,
        writable: true,
        value: name === "hasPointerCapture" ? () => false : () => {},
      });
    }
  }
  if (typeof proto.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }
}
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);