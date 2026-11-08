import { describe, expect, it } from "vitest";
import { addDays } from "@slicex/core";
import {
  formatDateInput,
  formatDateLong,
  formatDateShort,
  formatDateWeekday,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  parseDateInput,
  shiftISODate,
} from "../src/finance/format";

describe("formatMoney", () => {
  it("formats integers without decimals and with grouping", () => {
    expect(formatMoney(12000)).toBe("$12,000");
    expect(formatMoney(1234567)).toBe("$1,234,567");
    expect(formatMoney(5)).toBe("$5");
  });

  it("uses two decimals for non-integers", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0.07)).toBe("$0.07");
  });

  it("prefixes negatives with a hyphen", () => {
    expect(formatMoney(-2340)).toBe("-$2,340");
    expect(formatMoney(-12.3)).toBe("-$12.30");
  });

  it("rounds to cents before deciding on decimals", () => {
    expect(formatMoney(99.999)).toBe("$100");
    expect(formatMoney(10.004)).toBe("$10");
  });

  it("never prints a negative zero", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(-0)).toBe("$0");
    expect(formatMoney(-0.001)).toBe("$0");
  });

  it("degrades gracefully on non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatSignedMoney", () => {
  it("adds an explicit plus sign to positives", () => {
    expect(formatSignedMoney(9000)).toBe("+$9,000");
    expect(formatSignedMoney(0.5)).toBe("+$0.50");
  });

  it("uses the typographic minus (U+2212) for negatives", () => {
    expect(formatSignedMoney(-5792)).toBe("−$5,792");
    expect(formatSignedMoney(-5792.4)).toBe("−$5,792.40");
  });

  it("prints zero without sign", () => {
    expect(formatSignedMoney(0)).toBe("$0");
    expect(formatSignedMoney(-0.004)).toBe("$0");
  });
});

describe("formatDateShort / formatDateLong", () => {
  it("formats day + Spanish uppercase month", () => {
    expect(formatDateShort("2026-11-15")).toBe("15 NOV");
    expect(formatDateShort("2026-01-05")).toBe("5 ENE");
    expect(formatDateShort("2026-08-31")).toBe("31 AGO");
  });

  it("long form appends the year", () => {
    expect(formatDateLong("2027-03-15")).toBe("15 MAR 2027");
    expect(formatDateLong("2026-12-01")).toBe("1 DIC 2026");
  });

  it("covers every month abbreviation", () => {
    const expected = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];
    expected.forEach((abbr, index) => {
      const month = String(index + 1).padStart(2, "0");
      expect(formatDateShort(`2026-${month}-10`)).toBe(`10 ${abbr}`);
    });
  });

  it("does not shift the day through local time (Jan 1 / Dec 31)", () => {
    expect(formatDateLong("2027-01-01")).toBe("1 ENE 2027");
    expect(formatDateLong("2026-12-31")).toBe("31 DIC 2026");
  });

  it("returns unparseable input unchanged", () => {
    expect(formatDateShort("not-a-date")).toBe("not-a-date");
    expect(formatDateLong("2026-13-01")).toBe("2026-13-01");
    expect(formatDateLong("")).toBe("");
  });
});

describe("formatPercent", () => {
  it("formats with up to two decimals", () => {
    expect(formatPercent(99.9)).toBe("99.9%");
    expect(formatPercent(45)).toBe("45%");
    expect(formatPercent(3.256)).toBe("3.26%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("degrades gracefully on non-finite input", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

// --- es-MX date entry ----------------------------------------------------------

const TODAY = "2026-11-07";

describe("formatDateWeekday / formatDateInput", () => {
  it("prefixes the Spanish weekday to the long date", () => {
    expect(formatDateWeekday("2026-11-15")).toBe("dom 15 NOV 2026");
    expect(formatDateWeekday("2026-11-14")).toBe("sáb 14 NOV 2026");
    expect(formatDateWeekday("2026-11-20")).toBe("vie 20 NOV 2026");
    expect(formatDateWeekday("2027-01-01")).toBe("vie 1 ENE 2027");
    expect(formatDateWeekday("2000-02-29")).toBe("mar 29 FEB 2000");
    expect(formatDateWeekday("1970-01-01")).toBe("jue 1 ENE 1970");
  });

  it("agrees with the UTC calendar for every day of 2026–2028", () => {
    const names = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    for (let i = 0; i < 3 * 366; i += 1) {
      const iso = addDays("2026-01-01", i);
      const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
      const expected = names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
      expect(formatDateWeekday(iso).slice(0, 3)).toBe(expected);
    }
  });

  it("numeric es-MX entry text is day first, zero-padded", () => {
    expect(formatDateInput("2026-11-05")).toBe("05/11/2026");
    expect(formatDateInput("2027-01-31")).toBe("31/01/2027");
  });

  it("invalid / missing dates format to an empty entry or unchanged text", () => {
    expect(formatDateInput(undefined)).toBe("");
    expect(formatDateInput("")).toBe("");
    expect(formatDateInput("2026-02-30")).toBe("");
    expect(formatDateWeekday("2026-02-30")).toBe("2026-02-30");
    expect(formatDateWeekday("")).toBe("");
  });
});

describe("parseDateInput", () => {
  it.each([
    "15/11/2026",
    "15-11-2026",
    "15.11.2026",
    "15/11/26",
    "2026-11-15",
    "2026/11/15",
    "15 nov 2026",
    "15 NOV 2026",
    "15 Nov. 2026",
    "15 de noviembre de 2026",
    "nov 15 2026",
    "  15/11/2026  ",
    // What formatDateWeekday prints (and anything with a leading weekday,
    // which is decoration and never checked against the date).
    "dom 15 NOV 2026",
    "sáb 15 nov 2026",
    "domingo, 15 de noviembre de 2026",
    "mar 15/11/2026",
  ])("%s → 2026-11-15", (raw) => {
    expect(parseDateInput(raw, TODAY)).toBe("2026-11-15");
  });

  it("accepts single digits, full / alternative month names", () => {
    expect(parseDateInput("1/2/2027", TODAY)).toBe("2027-02-01");
    expect(parseDateInput("2026-1-5", TODAY)).toBe("2026-01-05");
    expect(parseDateInput("15 sept 2026", TODAY)).toBe("2026-09-15");
    expect(parseDateInput("15 set 2026", TODAY)).toBe("2026-09-15");
    expect(parseDateInput("3 diciembre 2026", TODAY)).toBe("2026-12-03");
    expect(parseDateInput("29/02/2028", TODAY)).toBe("2028-02-29");
  });

  it("without a year: the occurrence nearest to the reference", () => {
    expect(parseDateInput("15 nov", TODAY)).toBe("2026-11-15");
    expect(parseDateInput("1 nov", TODAY)).toBe("2026-11-01");
    expect(parseDateInput("15 ene", TODAY)).toBe("2027-01-15");
    expect(parseDateInput("15/1", TODAY)).toBe("2027-01-15");
    expect(parseDateInput("7 may", TODAY)).toBe("2027-05-07");
    expect(parseDateInput("15 mar", TODAY)).toBe("2027-03-15");
    expect(parseDateInput("mar 15", TODAY)).toBe("2027-03-15");
    expect(parseDateInput("29 feb", TODAY)).toBe("2028-02-29");
  });

  it("without a year, 'on-or-after': never before the reference", () => {
    expect(parseDateInput("15 nov", "2026-11-20", "on-or-after")).toBe("2027-11-15");
    expect(parseDateInput("20 nov", "2026-11-20", "on-or-after")).toBe("2026-11-20");
    expect(parseDateInput("15/11", "2026-11-20", "on-or-after")).toBe("2027-11-15");
    expect(parseDateInput("1 ene", "2026-11-20", "on-or-after")).toBe("2027-01-01");
    // An explicit year is never moved.
    expect(parseDateInput("15/11/2026", "2026-11-20", "on-or-after")).toBe("2026-11-15");
  });

  it.each([
    "",
    "   ",
    "abc",
    "15",
    "nov",
    "15 xyz",
    "15 ma",
    "31/11/2026",
    "29/02/2027",
    "2026-13-01",
    "2026-11-31",
    // Day first only: a US mm/dd date is rejected, never swapped.
    "11/15/2026",
    "15/11/1800",
    "015/11/2026",
    "15/11/2026x",
    "15 nov 2026 2027",
    // Two-digit years only in the numeric form ("mar 15/11" ≠ 15 MAR 2011).
    "15 nov 26",
    "mar 15/11",
    "15 nov 2026 lunes",
    "15/11/2026 ?",
  ])("rejects %j", (raw) => {
    expect(parseDateInput(raw, TODAY)).toBeNull();
  });

  it("a date without a year needs a valid reference", () => {
    expect(parseDateInput("15 nov", "")).toBeNull();
    expect(parseDateInput("15/11/2026", "")).toBe("2026-11-15");
  });

  it("round-trips its own output formats", () => {
    for (let i = 0; i < 800; i += 7) {
      const iso = addDays(TODAY, i - 200);
      expect(parseDateInput(formatDateInput(iso), TODAY)).toBe(iso);
      expect(parseDateInput(formatDateWeekday(iso), TODAY)).toBe(iso);
      expect(parseDateInput(formatDateLong(iso), TODAY)).toBe(iso);
    }
  });
});

describe("shiftISODate", () => {
  it("moves by whole days across month / year / leap boundaries", () => {
    expect(shiftISODate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftISODate("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftISODate("2026-11-15", 7)).toBe("2026-11-22");
  });

  it("returns null for an invalid date", () => {
    expect(shiftISODate("", 1)).toBeNull();
    expect(shiftISODate("2026-02-30", 1)).toBeNull();
  });
});
