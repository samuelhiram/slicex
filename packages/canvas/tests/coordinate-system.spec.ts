import { describe, expect, it } from "vitest";
import {
  DAY_WIDTH_PX,
  dateToPixel,
  pixelToDate,
} from "../src/coordinate-system";

describe("coordinate-system", () => {
  it("keeps dateToPixel and pixelToDate as inverses", () => {
    const origin = new Date("2026-01-01T00:00:00.000Z");
    const dates = [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-08T00:00:00.000Z"),
      new Date("2026-02-14T00:00:00.000Z"),
    ];

    for (const zoom of [0.5, 1, 1.25, 2]) {
      for (const date of dates) {
        const pixel = dateToPixel(date, origin, zoom);
        const roundTripped = pixelToDate(pixel, origin, zoom);
        expect(roundTripped.toISOString()).toBe(date.toISOString());
      }
    }
  });

  it("uses 80px per day at zoom 1", () => {
    const origin = new Date("2026-01-01T00:00:00.000Z");
    const nextDay = new Date("2026-01-02T00:00:00.000Z");

    expect(dateToPixel(nextDay, origin, 1)).toBe(DAY_WIDTH_PX);
  });
});
