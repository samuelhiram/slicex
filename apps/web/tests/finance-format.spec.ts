import { describe, expect, it } from "vitest";
import {
  formatDateLong,
  formatDateShort,
  formatMoney,
  formatPercent,
  formatSignedMoney,
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
