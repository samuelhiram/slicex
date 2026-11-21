import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  clampedDayOfMonth,
  compareISODate,
  daysInMonth,
  diffDays,
  fromDayNumber,
  isISODate,
  toDayNumber,
} from "../src/finance";

describe("finance dates", () => {
  it("validates strict real calendar dates", () => {
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("2023-02-29")).toBe(false);
    expect(isISODate("1900-02-29")).toBe(false);
    expect(isISODate("2000-02-29")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("2026-04-31")).toBe(false);
    expect(isISODate("2026-01-00")).toBe(false);
    expect(isISODate("2026-1-01")).toBe(false);
    expect(isISODate("2026-01-01T00:00")).toBe(false);
    expect(isISODate("")).toBe(false);
  });

  it("day numbers match Date.UTC and round-trip", () => {
    expect(toDayNumber("1970-01-01")).toBe(0);
    expect(toDayNumber("1969-12-31")).toBe(-1);
    for (let day = -30000; day < 60000; day += 37) {
      const iso = fromDayNumber(day);
      const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
      expect(Date.UTC(y, m - 1, d) / 86_400_000).toBe(day);
      expect(toDayNumber(iso)).toBe(day);
    }
    expect(() => toDayNumber("2026-02-30")).toThrow(RangeError);
  });

  it("adds and diffs days across leap years and negative offsets", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-11-07", -400)).toBe("2025-10-03");
    expect(diffDays("2026-01-01", "2025-12-31")).toBe(-1);
    expect(diffDays("2024-01-01", "2025-01-01")).toBe(366);
    expect(diffDays("2025-01-01", "2026-01-01")).toBe(365);
  });

  it("adds months clamping the day to the target month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
    expect(addMonths("2026-11-15", 14)).toBe("2028-01-15");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(addMonths("2026-11-07", 0)).toBe("2026-11-07");
  });

  it("month lengths and clamped day-of-month", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(clampedDayOfMonth(2026, 2, 31)).toBe("2026-02-28");
    expect(clampedDayOfMonth(2024, 2, 30)).toBe("2024-02-29");
    expect(clampedDayOfMonth(2026, 4, 0)).toBe("2026-04-01");
    expect(clampedDayOfMonth(2026, 7, 9)).toBe("2026-07-09");
  });

  it("compares ISO dates", () => {
    expect(compareISODate("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(compareISODate("2026-12-01", "2026-02-01")).toBeGreaterThan(0);
    expect(compareISODate("2026-05-05", "2026-05-05")).toBe(0);
  });
});
