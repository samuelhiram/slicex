import { describe, expect, it } from "vitest";
import { createCalendarTimeAxis } from "../src/finance/time-axis";

// 2026-11-07 is a Saturday; 2026-11-09 a Monday; 2026-12-01 → beat 24;
// 2027-01-01 → beat 55.
const axis = createCalendarTimeAxis("2026-11-07");

function ascending(beats: number[]): boolean {
  for (let i = 1; i < beats.length; i += 1) {
    if (!(beats[i]! > beats[i - 1]!)) return false;
  }
  return true;
}

describe("calendar time axis — lower tier (days)", () => {
  it("≥ 38 px/day: every day 'Lu 16', centred, weekends dimmed, today emphasised", () => {
    const ticks = axis.ticks(0, 10, 40);
    expect(ticks).toHaveLength(11);
    expect(ticks.every((t) => t.centered)).toBe(true);
    // Today (Saturday 7) keeps its own label, as a pill; not dimmed.
    expect(ticks[0]).toMatchObject({ beat: 0, label: "Sá 7", emphasis: true, dim: false });
    expect(ticks[1]).toMatchObject({ label: "Do 8", dim: true });
    expect(ticks[2]).toMatchObject({ label: "Lu 9", major: true, dim: false });
    expect(ticks[4]).toMatchObject({ label: "Mi 11" });
  });

  it("16–38 px/day: every day as a centred number ('Mi 30' would not fit)", () => {
    expect(axis.ticks(0, 3, 32)[2]?.label).toBe("9");
    const ticks = axis.ticks(20, 26, 18);
    expect(ticks.map((t) => t.label)).toEqual(["27", "28", "29", "30", "1", "2", "3"]);
    // Month start and Mondays are major (stronger grid line).
    expect(ticks.find((t) => t.label === "1")?.major).toBe(true);
    expect(ticks.find((t) => t.label === "30")?.major).toBe(true);
    expect(ticks.find((t) => t.label === "29")?.major).toBe(false);
  });

  it("6–16 px/day: a tick per day, Mondays labelled with the day number", () => {
    const ticks = axis.ticks(0, 30, 10);
    expect(ticks).toHaveLength(31);
    expect(ticks[9]).toEqual({ beat: 9, major: true, label: "16" });
    expect(ticks[24]).toEqual({ beat: 24, major: true, label: null }); // 1 dic
    expect(ticks[23]).toEqual({ beat: 23, major: true, label: "30" });
    // The axis never blanks a label on a guess: Monday 9 stays labelled
    // (the canvas hides it at draw time if the "Hoy" pill covers it).
    expect(ticks[2]).toEqual({ beat: 2, major: true, label: "9" });
    expect(ticks.filter((t) => t.label !== null && !t.emphasis).every((t) => t.major)).toBe(
      true,
    );
  });

  it("today is a centred 'Hoy' pill below 16 px/day", () => {
    const ticks = axis.ticks(0, 30, 10);
    expect(ticks[0]).toMatchObject({
      beat: 0,
      label: "Hoy",
      emphasis: true,
      centered: true,
    });
  });

  it("a coarse level inserts the 'Hoy' tick, keeping beats ascending", () => {
    const ticks = axis.ticks(0, 120, 3);
    expect(ticks[0]).toMatchObject({ beat: 0, label: "Hoy", emphasis: true });
    expect(ascending(ticks.map((t) => t.beat))).toBe(true);
    const far = axis.ticks(0, 400, 1.5);
    expect(far[0]).toMatchObject({ beat: 0, label: "Hoy", emphasis: true });
    expect(ascending(far.map((t) => t.beat))).toBe(true);
  });

  it("no today pill when beat 0 is out of range", () => {
    const ticks = axis.ticks(30, 60, 10);
    expect(ticks.some((t) => t.emphasis)).toBe(false);
  });

  it("2.5–6 px/day: Mondays (minor) + month starts (major)", () => {
    const ticks = axis.ticks(0, 60, 4);
    expect(ticks.filter((t) => t.major).map((t) => t.beat)).toEqual([24, 55]);
    expect(
      ticks.filter((t) => !t.major && !t.emphasis).every((t) => (t.beat - 2) % 7 === 0),
    ).toBe(true);
    expect(ascending(ticks.map((t) => t.beat))).toBe(true);
    // 7 × 4 px = 28 px per week: room for the Monday's day number.
    expect(ticks.find((t) => t.beat === 16)?.label).toBe("23");
  });

  it("< 2.5 px/day: month starts with short month names", () => {
    const ticks = axis.ticks(0, 365, 1.5).filter((t) => !t.emphasis);
    expect(ticks).toHaveLength(12);
    expect(ticks.every((t) => t.major)).toBe(true);
    expect(ticks.find((t) => t.beat === 55)?.label).toBe("Ene");
  });

  it("never emits negative beats", () => {
    expect(axis.ticks(-20, 5, 12).every((t) => t.beat >= 0)).toBe(true);
  });
});

describe("calendar time axis — bands", () => {
  it("months on the upper tier: long names when there is room", () => {
    const groups = axis.bands!(0, 60, 10).filter((b) => b.kind === "group");
    expect(groups.map((g) => [g.start, g.end, g.label])).toEqual([
      [-6, 24, "Noviembre 2026"],
      [24, 55, "Diciembre 2026"],
      [55, 86, "Enero 2027"],
    ]);
  });

  it("short month names at mid zoom, years when far out", () => {
    const mid = axis.bands!(0, 60, 3).filter((b) => b.kind === "group");
    expect(mid[0]?.label).toBe("Nov 2026");
    const far = axis.bands!(0, 500, 1.5).filter((b) => b.kind === "group");
    expect(far.map((g) => g.label)).toEqual(["2026", "2027", "2028"]);
    expect(far[1]?.start).toBe(55);
  });

  it("weekends shaded from 6 px/day (Saturday + Sunday)", () => {
    const shades = axis.bands!(0, 14, 10).filter((b) => b.kind === "shade");
    expect(shades.map((b) => [b.start, b.end])).toEqual([
      [0, 2],
      [7, 9],
      [14, 16],
    ]);
    expect(axis.bands!(0, 14, 4).some((b) => b.kind === "shade")).toBe(false);
  });
});

describe("calendar time axis — snap + tooltip", () => {
  it("snaps to the start of each quincena (1st and 16th)", () => {
    // 2026-11-16 → beat 9; 2026-12-01 → 24; 2026-12-16 → 39
    const targets = axis.snapTargets!(5, 40);
    expect(targets).toContain(9);
    expect(targets).toContain(24);
    expect(targets).toContain(39);
    expect(ascending([...targets])).toBe(true);
  });

  it("formats tooltip times as calendar dates", () => {
    expect(axis.formatTime(0)).toBe("sáb 7 nov 2026");
    expect(axis.formatTime(2.9)).toBe("lun 9 nov 2026");
  });
});

describe("right edges name the last day they cover (ends are exclusive)", () => {
  it("an end on the boundary of a day is 'hasta' the day before", () => {
    // Beat 3 = start of 10 nov: the clip covers up to 9 nov.
    expect(axis.formatEnd!(3)).toBe(`hasta ${axis.formatTime(2)}`);
    expect(axis.lastCoveredBeat!(3)).toBe(2);
    // Mid-day end: that day is (partly) covered.
    expect(axis.formatEnd!(3.5)).toBe(`hasta ${axis.formatTime(3)}`);
    expect(axis.lastCoveredBeat!(3.5)).toBe(3);
  });
});
