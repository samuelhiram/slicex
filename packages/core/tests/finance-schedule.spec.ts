// DayCursor (lazy day-number schedules used by the payoff simulation) must
// visit exactly the dates of `expandRecurrence` / `expandMonthlyOnDay`.
import { describe, expect, it } from "vitest";
import { expandRecurrence, fromDayNumber, toDayNumber } from "../src/finance";
import type { FinancialRecurrence, ISODate, RecurrenceFrequency } from "../src/finance";
import { expandMonthlyOnDay } from "../src/finance/recurrence";
import { DayCursor } from "../src/finance/schedule";

function drain(cursor: DayCursor, max = 10000): ISODate[] {
  const out: ISODate[] = [];
  while (cursor.day !== Number.POSITIVE_INFINITY && out.length < max) {
    out.push(fromDayNumber(cursor.day));
    cursor.advance();
  }
  return out;
}

const FREQUENCIES: RecurrenceFrequency[] = ["once", "weekly", "biweekly", "semimonthly", "monthly"];
const RANGES = [
  { from: "2026-11-01", to: "2026-11-30" },
  { from: "2026-11-07", to: "2027-11-07" },
  { from: "2024-01-31", to: "2024-03-31" },
  { from: "2026-11-16", to: "2026-11-29" },
  { from: "2026-12-31", to: "2027-01-01" },
];
const STARTS = ["2016-11-04", "2026-01-31", "2026-11-07", "2026-11-15", "2026-11-30", "2027-02-28", "2030-01-01"];

describe("DayCursor", () => {
  it("startRecurrence visits exactly the expandRecurrence dates", () => {
    let compared = 0;
    for (const frequency of FREQUENCIES) {
      for (const startDate of STARTS) {
        for (const endDate of [undefined, "2027-03-31", "2026-11-20"]) {
          for (const anchorDate of [undefined, "2025-10-31", "2026-11-09"]) {
            const rule: FinancialRecurrence = { frequency, startDate };
            if (endDate !== undefined) rule.endDate = endDate;
            if (anchorDate !== undefined) rule.anchorDate = anchorDate;
            for (const range of RANGES) {
              expect(drain(new DayCursor().startRecurrence(rule, range)), JSON.stringify({ rule, range })).toEqual(
                expandRecurrence(rule, range),
              );
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBe(FREQUENCIES.length * STARTS.length * 3 * 3 * RANGES.length);
  });

  it("startMonthly matches expandMonthlyOnDay, limit included", () => {
    for (const dom of [1, 15, 29, 30, 31, 0, 45]) {
      for (const range of RANGES) {
        const window = { lo: toDayNumber(range.from), hi: toDayNumber(range.to) };
        for (const limit of [Number.POSITIVE_INFINITY, 3, 1, 0]) {
          expect(drain(new DayCursor().startMonthly(dom, window, limit))).toEqual(
            expandMonthlyOnDay(dom, window, [], limit),
          );
        }
      }
    }
  });

  it("malformed rules are exhausted from the start; advance past the end is a no-op", () => {
    const range = RANGES[0]!;
    expect(new DayCursor().startRecurrence({ frequency: "monthly", startDate: "2026-13-01" }, range).day).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      new DayCursor().startRecurrence({ frequency: "yearly" as RecurrenceFrequency, startDate: "2026-11-01" }, range).day,
    ).toBe(Number.POSITIVE_INFINITY);
    const once = new DayCursor().startRecurrence({ frequency: "once", startDate: "2026-11-10" }, range);
    expect(fromDayNumber(once.day)).toBe("2026-11-10");
    once.advance();
    once.advance();
    expect(once.day).toBe(Number.POSITIVE_INFINITY);
  });
});
