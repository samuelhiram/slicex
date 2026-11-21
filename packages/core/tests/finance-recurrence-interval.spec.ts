// "Cada N días / meses" (FinancialRecurrence.interval): expandRecurrence,
// countRecurrence and the lazy DayCursor agree, phased from the anchor.
import { describe, expect, it } from "vitest";
import { expandRecurrence, fromDayNumber, recurrenceInterval } from "../src/finance";
import type { FinancialRecurrence, ISODate } from "../src/finance";
import { countRecurrence } from "../src/finance/recurrence";
import { DayCursor } from "../src/finance/schedule";

function drain(cursor: DayCursor): ISODate[] {
  const out: ISODate[] = [];
  while (cursor.day !== Number.POSITIVE_INFINITY && out.length < 5000) {
    out.push(fromDayNumber(cursor.day));
    cursor.advance();
  }
  return out;
}

const YEAR = { from: "2026-11-01", to: "2027-10-31" };

describe("recurrenceInterval", () => {
  it("whole numbers >= 1; absent / junk = 1", () => {
    expect(recurrenceInterval({})).toBe(1);
    expect(recurrenceInterval({ interval: 3 })).toBe(3);
    expect(recurrenceInterval({ interval: 0 })).toBe(1);
    expect(recurrenceInterval({ interval: Number.NaN })).toBe(1);
    expect(recurrenceInterval({ interval: 2.6 })).toBe(3);
  });
});

describe("cada N días", () => {
  const rule: FinancialRecurrence = { frequency: "daily", interval: 10, startDate: "2026-11-09" };

  it("every 10 days from the anchor", () => {
    expect(expandRecurrence(rule, { from: "2026-11-01", to: "2026-12-15" })).toEqual([
      "2026-11-09",
      "2026-11-19",
      "2026-11-29",
      "2026-12-09",
    ]);
  });

  it("an anchor in the past keeps the phase (arithmetic skip)", () => {
    const phased: FinancialRecurrence = { ...rule, startDate: "2026-11-01", anchorDate: "2020-01-01" };
    const dates = expandRecurrence(phased, YEAR);
    // 2020-01-01 + k×10: the first on or after 2026-11-01.
    expect(dates[0]).toBe("2026-11-05");
    expect(dates.every((date, i) => i === 0 || (Date.parse(date) - Date.parse(dates[i - 1]!)) / 86400000 === 10)).toBe(true);
  });

  it("no interval = every day", () => {
    expect(expandRecurrence({ frequency: "daily", startDate: "2026-11-09" }, { from: "2026-11-09", to: "2026-11-12" })).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
  });
});

describe("cada N meses", () => {
  it("every 3 months on the anchor's day, phased from the anchor's month", () => {
    const rule: FinancialRecurrence = { frequency: "monthly", interval: 3, startDate: "2026-11-20" };
    expect(expandRecurrence(rule, YEAR)).toEqual(["2026-11-20", "2027-02-20", "2027-05-20", "2027-08-20"]);
  });

  it("a month-end anchor clamps each month without drifting", () => {
    const rule: FinancialRecurrence = { frequency: "monthly", interval: 2, startDate: "2026-12-31" };
    expect(expandRecurrence(rule, YEAR)).toEqual([
      "2026-12-31",
      "2027-02-28",
      "2027-04-30",
      "2027-06-30",
      "2027-08-31",
      "2027-10-31",
    ]);
  });

  it("the phase comes from the anchor, not from the window", () => {
    const rule: FinancialRecurrence = {
      frequency: "monthly",
      interval: 6,
      startDate: "2026-11-01",
      anchorDate: "2026-01-15",
    };
    // Jan / Jul phase: Jan 15 2027, Jul 15 2027.
    expect(expandRecurrence(rule, YEAR)).toEqual(["2027-01-15", "2027-07-15"]);
  });

  it("interval 1 is plain monthly", () => {
    const one: FinancialRecurrence = { frequency: "monthly", interval: 1, startDate: "2026-11-20" };
    const plain: FinancialRecurrence = { frequency: "monthly", startDate: "2026-11-20" };
    expect(expandRecurrence(one, YEAR)).toEqual(expandRecurrence(plain, YEAR));
  });
});

describe("count and cursor agree with the expansion", () => {
  const rules: FinancialRecurrence[] = [];
  for (const interval of [1, 2, 3, 5, 7, 10, 30, 45]) {
    rules.push({ frequency: "daily", interval, startDate: "2026-11-03", anchorDate: "2026-10-30" });
  }
  for (const interval of [1, 2, 3, 4, 6, 12, 18]) {
    for (const day of ["01", "15", "29", "31"]) {
      rules.push({ frequency: "monthly", interval, startDate: "2026-11-05", anchorDate: `2026-08-${day === "31" ? "31" : day}` });
    }
  }
  const ranges = [
    YEAR,
    { from: "2026-11-01", to: "2026-11-30" },
    { from: "2027-02-01", to: "2031-06-17" },
  ];

  it("countRecurrence === expandRecurrence().length", () => {
    for (const rule of rules) {
      for (const range of ranges) {
        expect(countRecurrence(rule, range), JSON.stringify({ rule, range })).toBe(expandRecurrence(rule, range).length);
      }
    }
  });

  it("DayCursor visits exactly the expanded dates", () => {
    for (const rule of rules) {
      for (const range of ranges) {
        expect(drain(new DayCursor().startRecurrence(rule, range)), JSON.stringify({ rule, range })).toEqual(
          expandRecurrence(rule, range),
        );
      }
    }
  });
});
