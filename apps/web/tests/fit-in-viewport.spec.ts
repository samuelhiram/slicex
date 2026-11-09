// Floating UI guard: menus / popovers / the command bar always land fully
// on screen (shifted, capped, scrollable) — nothing opens out of reach.
import { describe, expect, it } from "vitest";
import { FLOATING_MARGIN as M, fitInViewport } from "../src/ui/fit-in-viewport";

const VIEW = { width: 390, height: 844 };

describe("fitInViewport", () => {
  it("leaves a box that fits alone", () => {
    expect(fitInViewport({ left: 20, top: 40, width: 200, height: 300 }, VIEW)).toEqual({
      dx: 0,
      dy: 0,
      maxWidth: null,
      maxHeight: null,
    });
  });

  it("a context menu opened near the bottom-right edge moves back inside", () => {
    const fit = fitInViewport({ left: 300, top: 700, width: 232, height: 373 }, VIEW);
    expect(300 + fit.dx + 232).toBeLessThanOrEqual(VIEW.width - M);
    expect(700 + fit.dy + 373).toBeLessThanOrEqual(VIEW.height - M);
    expect(fit.maxHeight).toBeNull();
  });

  it("a popover hanging off the left edge moves right", () => {
    const fit = fitInViewport({ left: -62, top: 56, width: 298, height: 87 }, VIEW);
    expect(-62 + fit.dx).toBe(M);
  });

  it("wider / taller than the window: capped (and it scrolls), pinned to the margin", () => {
    const fit = fitInViewport({ left: 178, top: 173, width: 600, height: 1200 }, VIEW);
    expect(fit.maxWidth).toBe(VIEW.width - 2 * M);
    expect(fit.maxHeight).toBe(VIEW.height - 2 * M);
    expect(178 + fit.dx).toBe(M);
    expect(173 + fit.dy).toBe(M);
  });
});
