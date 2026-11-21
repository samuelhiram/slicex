// Sideways strips (header metrics, tool bar) move with a plain mouse wheel.
import { describe, expect, it } from "vitest";
import { wheelScrollLeft } from "../src/ui/wheel-scroll-x";

const strip = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 900, clientWidth: 400 });
const wheel = (deltaY: number, extra: Partial<WheelEvent> = {}) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...extra,
});

describe("wheelScrollLeft", () => {
  it("a vertical notch scrolls the strip sideways, both ways", () => {
    expect(wheelScrollLeft(strip(0), wheel(100))).toBe(100);
    expect(wheelScrollLeft(strip(200), wheel(-100))).toBe(100);
  });

  it("stops at the ends and then leaves the wheel alone", () => {
    expect(wheelScrollLeft(strip(450), wheel(100))).toBe(500);
    expect(wheelScrollLeft(strip(500), wheel(100))).toBeNull();
    expect(wheelScrollLeft(strip(0), wheel(-100))).toBeNull();
  });

  it("line-mode wheels scale to pixels", () => {
    expect(wheelScrollLeft(strip(0), wheel(3, { deltaMode: 1 }))).toBe(48);
  });

  it("ignores a strip that fits, trackpad sideways swipes and Ctrl+wheel", () => {
    expect(wheelScrollLeft({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 }, wheel(100))).toBeNull();
    expect(wheelScrollLeft(strip(0), wheel(100, { deltaX: 30 }))).toBeNull();
    expect(wheelScrollLeft(strip(0), wheel(100, { ctrlKey: true }))).toBeNull();
  });
});
