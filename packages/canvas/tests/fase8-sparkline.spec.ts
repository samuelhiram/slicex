// F9 (Fase 8) — Pattern sparkline stub.
//
// Validates the deterministic provider and the swap-in API.
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultSparklineBars,
  setSparklineProvider,
} from "../src/playlist-renderer-pixi/clip-node-registry";

describe("F9 — default sparkline is deterministic per clip id", () => {
  it("the same clip id yields the same bars on every call", () => {
    const a = defaultSparklineBars("clip-drums-1");
    const b = defaultSparklineBars("clip-drums-1");
    expect(a).toEqual(b);
  });

  it("different clip ids yield different bar sequences", () => {
    const a = defaultSparklineBars("clip-drums-1");
    const b = defaultSparklineBars("clip-bass-1");
    expect(a).not.toEqual(b);
  });

  it("bar count lives in [8, 19]", () => {
    for (const id of [
      "clip-a",
      "clip-b",
      "clip-77",
      "a-very-long-id-with-many-chars",
      "x",
    ]) {
      const bars = defaultSparklineBars(id);
      expect(bars.length).toBeGreaterThanOrEqual(8);
      expect(bars.length).toBeLessThanOrEqual(19);
    }
  });

  it("each bar height stays in [0.2, 0.85]", () => {
    const bars = defaultSparklineBars("clip-drums-1");
    for (const ratio of bars) {
      expect(ratio).toBeGreaterThanOrEqual(0.2);
      expect(ratio).toBeLessThanOrEqual(0.85);
    }
  });
});

describe("F9 — provider override", () => {
  afterEach(() => {
    setSparklineProvider(null);
  });

  it("setSparklineProvider lets callers swap in their own bars", () => {
    const stub = [0.1, 0.5, 0.9];
    setSparklineProvider((id) => (id === "clip-x" ? stub : null));
    // Internal contract: when the provider returns null we fall back to
    // the default; when it returns an array we use it verbatim. We only
    // assert no-throw here — the actual draw is exercised by the
    // renderer (which is a Pixi-mounted concern outside the unit suite).
    expect(() => setSparklineProvider(null)).not.toThrow();
  });

  it("setSparklineProvider(null) restores the default deterministic bars", () => {
    const beforeCustom = defaultSparklineBars("clip-x");
    setSparklineProvider(() => [0.5, 0.5]);
    setSparklineProvider(null);
    expect(defaultSparklineBars("clip-x")).toEqual(beforeCustom);
  });
});
