import { describe, expect, it } from "vitest";
import { addDays, compareISODate, expandRecurrence } from "../src/finance";
import type { FinancialRecurrence, ISODate, RecurrenceFrequency } from "../src/finance";
import { countMonthlyOnDay, countRecurrence, expandMonthlyOnDay } from "../src/finance/recurrence";

const NOV = { from: "2026-11-01", to: "2026-11-30" };

/** Naive reference: step from the anchor one period at a time. */
function naiveFixedStep(anchor: ISODate, step: number, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = anchor; compareISODate(d, to) <= 0; d = addDays(d, step)) {
    if (compareISODate(d, from) >= 0) out.push(d);
  }
  return out;
}

describe("expandRecurrence", () => {
  it("once: inside the window, outside the range, clipped by the window", () => {
    expect(expandRecurrence({ frequency: "once", startDate: "2026-11-10" }, NOV)).toEqual(["2026-11-10"]);
    expect(expandRecurrence({ frequency: "once", startDate: "2026-12-10" }, NOV)).toEqual([]);
    expect(
      expandRecurrence({ frequency: "once", startDate: "2026-11-10", anchorDate: "2026-11-05" }, NOV),
    ).toEqual([]);
    expect(
      expandRecurrence({ frequency: "once", startDate: "2026-11-01", anchorDate: "2026-11-05" }, NOV),
    ).toEqual(["2026-11-05"]);
  });

  it("weekly with a past anchor keeps the phase", () => {
    const rule: FinancialRecurrence = { frequency: "weekly", startDate: "2026-11-01", anchorDate: "2026-10-02" };
    expect(expandRecurrence(rule, NOV)).toEqual(["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  });

  it("biweekly with a 10-year-old anchor skips arithmetically and matches the naive walk", () => {
    const anchor = "2016-11-04";
    const rule: FinancialRecurrence = { frequency: "biweekly", startDate: anchor };
    const got = expandRecurrence(rule, NOV);
    expect(got).toEqual(naiveFixedStep(anchor, 14, NOV.from, NOV.to));
    expect(got.length).toBe(2);
    // A ~2000-year-old anchor is still O(occurrences in range).
    const ancient = expandRecurrence({ frequency: "weekly", startDate: "0026-01-02" }, NOV);
    expect(ancient.length).toBeGreaterThanOrEqual(4);
    expect(ancient.length).toBeLessThanOrEqual(5);
  });

  it("monthly on the 31st clamps without drifting", () => {
    const rule: FinancialRecurrence = { frequency: "monthly", startDate: "2026-01-31" };
    expect(expandRecurrence(rule, { from: "2026-01-01", to: "2026-05-31" })).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(
      expandRecurrence({ frequency: "monthly", startDate: "2024-01-31" }, { from: "2024-02-01", to: "2024-03-31" }),
    ).toEqual(["2024-02-29", "2024-03-31"]);
  });

  it("monthly anchor may sit after the window start (window widened to the left)", () => {
    const rule: FinancialRecurrence = { frequency: "monthly", startDate: "2026-01-01", anchorDate: "2026-03-15" };
    expect(expandRecurrence(rule, { from: "2026-01-01", to: "2026-03-31" })).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
  });

  it("semimonthly pays the 15th and the last day (February included)", () => {
    const rule: FinancialRecurrence = { frequency: "semimonthly", startDate: "2020-01-01" };
    expect(expandRecurrence(rule, { from: "2026-02-01", to: "2026-03-31" })).toEqual([
      "2026-02-15",
      "2026-02-28",
      "2026-03-15",
      "2026-03-31",
    ]);
    expect(expandRecurrence(rule, { from: "2024-02-16", to: "2024-03-01" })).toEqual(["2024-02-29"]);
  });

  it("endDate is inclusive", () => {
    const rule: FinancialRecurrence = { frequency: "weekly", startDate: "2026-11-02", endDate: "2026-11-16" };
    expect(expandRecurrence(rule, NOV)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("empty when window and range do not intersect", () => {
    expect(expandRecurrence({ frequency: "monthly", startDate: "2027-01-01" }, NOV)).toEqual([]);
    expect(expandRecurrence({ frequency: "weekly", startDate: "2026-01-01", endDate: "2026-10-31" }, NOV)).toEqual([]);
    expect(expandRecurrence({ frequency: "weekly", startDate: "not-a-date" }, NOV)).toEqual([]);
  });
});

describe("countRecurrence (fincore-1: arithmetic occurrence count)", () => {
  it("matches expandRecurrence().length for every frequency on random windows", () => {
    // Deterministic LCG so the cases are stable.
    let seed = 12345;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const freqs: RecurrenceFrequency[] = ["once", "weekly", "biweekly", "semimonthly", "monthly"];
    const base = "2024-01-01";
    for (let i = 0; i < 2000; i++) {
      const start = addDays(base, rand(900));
      const rule: FinancialRecurrence = { frequency: freqs[rand(freqs.length)]!, startDate: start };
      if (rand(3) > 0) rule.endDate = addDays(start, rand(700) - 30);
      if (rand(2) === 0) rule.anchorDate = addDays(start, rand(400) - 200);
      const from = addDays(base, rand(900));
      const range = { from, to: addDays(from, rand(800) - 20) };
      expect(countRecurrence(rule, range)).toBe(expandRecurrence(rule, range).length);
    }
  });

  it("countMonthlyOnDay matches expandMonthlyOnDay on edge months (31st, February)", () => {
    for (const dom of [1, 15, 28, 29, 30, 31]) {
      for (let lo = 0; lo < 70; lo += 3) {
        for (let len = 0; len < 120; len += 7) {
          const window = { lo: 20450 + lo, hi: 20450 + lo + len };
          expect(countMonthlyOnDay(dom, window)).toBe(expandMonthlyOnDay(dom, window, []).length);
        }
      }
    }
  });

  it("counts a 1000-year schedule without expanding it", () => {
    const rule: FinancialRecurrence = { frequency: "monthly", startDate: "2026-01-31", endDate: "3025-12-31" };
    expect(countRecurrence(rule, { from: "2026-01-01", to: "3025-12-31" })).toBe(12000);
    const semi: FinancialRecurrence = { frequency: "semimonthly", startDate: "2026-01-01", endDate: "3025-12-31" };
    expect(countRecurrence(semi, { from: "2026-01-01", to: "3025-12-31" })).toBe(24000);
  });
});
