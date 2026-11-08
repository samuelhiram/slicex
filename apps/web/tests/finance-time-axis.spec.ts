import { describe, expect, it } from "vitest";
import { createCalendarTimeAxis } from "../src/finance/time-axis";

// 2026-11-07 is a Saturday; 2026-11-09 a Monday; 2026-12-01 → beat 24;
// 2027-01-01 → beat 55.
const axis = createCalendarTimeAxis("2026-11-07");

describe("calendar time axis", () => {
  it("zoomed in: a tick per day, Mondays and month starts labelled", () => {
    const ticks = axis.ticks(0, 30, 12);
    expect(ticks).toHaveLength(31);
    expect(ticks[0]).toEqual({ beat: 0, major: false, label: null });
    // beat 2 sits under the "Hoy" marker label (40px at 12px/day): cleared.
    expect(ticks[2]).toEqual({ beat: 2, major: true, label: null });
    expect(ticks[9]).toEqual({ beat: 9, major: true, label: "16 NOV" });
    expect(ticks[24]).toEqual({ beat: 24, major: true, label: "DIC" });
  });

  it("drops a Monday label that would collide with a month label", () => {
    const ticks = axis.ticks(20, 30, 10);
    const nov30 = ticks.find((t) => t.beat === 23); // Monday 30 NOV
    const dec1 = ticks.find((t) => t.beat === 24);
    expect(nov30).toEqual({ beat: 23, major: true, label: null });
    expect(dec1?.label).toBe("DIC");
  });

  it("zoomed far out, January shows just the year", () => {
    const jan = axis.ticks(0, 365, 1.5).find((t) => t.beat === 55);
    expect(jan?.label).toBe("2027");
  });

  it("mid zoom: Mondays as minor ticks, month starts as labelled majors", () => {
    const ticks = axis.ticks(0, 60, 4);
    const majors = ticks.filter((t) => t.major);
    expect(majors.map((t) => [t.beat, t.label])).toEqual([
      [24, "DIC"],
      [55, "ENE 2027"],
    ]);
    expect(ticks.filter((t) => !t.major).every((t) => (t.beat - 2) % 7 === 0)).toBe(true);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.beat).toBeGreaterThan(ticks[i - 1]!.beat);
    }
  });

  it("zoomed out: month starts only", () => {
    const ticks = axis.ticks(0, 365, 1.5);
    expect(ticks.every((t) => t.major && t.label)).toBe(true);
    expect(ticks).toHaveLength(12);
  });

  it("keeps ruler labels clear of the Hoy marker at beat 0", () => {
    const monday = createCalendarTimeAxis("2026-11-09");
    expect(monday.ticks(0, 20, 10)[0]?.label).toBeNull();
    const first = createCalendarTimeAxis("2026-12-01");
    expect(first.ticks(0, 400, 1.5)[0]?.label).toBeNull();
  });

  it("snaps to the start of each quincena (1st and 16th)", () => {
    // 2026-11-16 → beat 9; 2026-12-01 → 24; 2026-12-16 → 39
    const targets = axis.snapTargets!(5, 40);
    expect(targets).toContain(9);
    expect(targets).toContain(24);
    expect(targets).toContain(39);
    for (let i = 1; i < targets.length; i += 1) {
      expect(targets[i]!).toBeGreaterThan(targets[i - 1]!);
    }
  });

  it("never emits negative beats", () => {
    expect(axis.ticks(-20, 5, 12).every((t) => t.beat >= 0)).toBe(true);
  });

  it("formats tooltip times as calendar dates", () => {
    expect(axis.formatTime(0)).toBe("sáb 7 NOV 2026");
    expect(axis.formatTime(2.9)).toBe("lun 9 NOV 2026");
  });
});
