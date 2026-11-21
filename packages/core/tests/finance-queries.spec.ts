import { describe, expect, it } from "vitest";
import {
  addDays,
  createDemoFinancialDocument,
  debtByAccountAt,
  findLiquidityWarnings,
  nextPayment,
  projectFinancialDocument,
  projectFinancialTimeline,
  snapshotAt,
} from "../src/finance";
import type { FinancialEvent, FinancialEventType, ISODate } from "../src/finance";

function ev(id: string, type: FinancialEventType, date: ISODate, amount: number, accountId?: string): FinancialEvent {
  const e: FinancialEvent = { id: `${id}@${date}`, itemId: id, type, date, amount, name: id };
  if (accountId) e.accountId = accountId;
  return e;
}

const projection = projectFinancialTimeline({
  initialCash: 6000,
  startDate: "2026-11-01",
  endDate: "2026-12-31",
  accounts: [{ id: "card", name: "card", kind: "credit-card", openingDebt: 1000, annualRate: 0 }],
  events: [
    ev("buy", "credit-card-purchase", "2026-11-03", 500, "card"),
    ev("rent", "expense", "2026-11-05", 2000), // 4000 < reserve
    ev("food", "expense", "2026-11-06", 1500), // 2500 (episode min)
    ev("pay", "income", "2026-11-10", 9000), // 11500
    ev("tv", "expense", "2026-11-12", 12000), // -500 (negative)
    ev("cardpay", "credit-card-payment", "2026-11-12", 300, "card"), // -800
    ev("pay2", "income", "2026-11-30", 9000), // 8200
  ],
});

describe("finance queries", () => {
  it("snapshotAt returns the state at the end of the day", () => {
    expect(snapshotAt(projection, "2026-10-01")).toEqual({ date: "2026-10-01", cash: 6000, debt: 1000 });
    expect(snapshotAt(projection, "2026-11-01")).toEqual({ date: "2026-11-01", cash: 6000, debt: 1000 });
    expect(snapshotAt(projection, "2026-11-03")).toEqual({ date: "2026-11-03", cash: 6000, debt: 1500 });
    expect(snapshotAt(projection, "2026-11-04").cash).toBe(6000);
    expect(snapshotAt(projection, "2026-11-12")).toEqual({ date: "2026-11-12", cash: -800, debt: 1200 });
    expect(snapshotAt(projection, "2027-06-01")).toEqual({ date: "2027-06-01", cash: 8200, debt: 1200 });
  });

  it("nextPayment finds the first outflow strictly after a date", () => {
    expect(nextPayment(projection, "2026-11-01")).toEqual({
      date: "2026-11-05",
      itemId: "rent",
      name: "rent",
      amount: 2000,
      type: "expense",
    });
    expect(nextPayment(projection, "2026-11-05")!.itemId).toBe("food");
    expect(nextPayment(projection, "2026-11-06")!.itemId).toBe("tv");
    expect(nextPayment(projection, "2026-11-12")).toBeNull();
  });

  it("findLiquidityWarnings reports one warning per contiguous episode", () => {
    const warnings = findLiquidityWarnings(projection, 5000);
    expect(warnings).toEqual([
      {
        date: "2026-11-06",
        cash: 2500,
        startDate: "2026-11-05",
        eventId: "food@2026-11-06",
        itemId: "food",
        name: "food",
        severity: "below-reserve",
      },
      {
        date: "2026-11-12",
        cash: -800,
        startDate: "2026-11-12",
        eventId: "cardpay@2026-11-12",
        itemId: "cardpay",
        name: "cardpay",
        severity: "negative",
      },
    ]);
    expect(findLiquidityWarnings(projection, -1000)).toEqual([]);
  });

  it("an initial cash below the reserve opens a synthetic episode", () => {
    const p = projectFinancialTimeline({
      initialCash: 3000,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      events: [ev("inc", "income", "2026-11-15", 5000)],
    });
    expect(findLiquidityWarnings(p, 5000)).toEqual([
      {
        date: "2026-11-01",
        cash: 3000,
        startDate: "2026-11-01",
        eventId: "initial",
        itemId: "",
        name: "Liquidez inicial",
        severity: "below-reserve",
      },
    ]);
  });
});

describe("regressions (engine review)", () => {
  it("fincore-5: a payday spent the same day does not split a below-reserve episode", () => {
    const p = projectFinancialTimeline({
      initialCash: 6000,
      startDate: "2026-11-01",
      endDate: "2026-12-31",
      events: [
        ev("rent", "expense", "2026-11-10", 2000), // 4000
        ev("pay", "income", "2026-11-15", 9000), // 13000 intraday
        ev("tv", "expense", "2026-11-15", 10000), // 3000 end of day
        ev("pay2", "income", "2026-11-30", 9000), // 12000
      ],
    });
    expect(findLiquidityWarnings(p, 5000)).toEqual([
      {
        date: "2026-11-15",
        cash: 3000,
        startDate: "2026-11-10",
        eventId: "tv@2026-11-15",
        itemId: "tv",
        name: "tv",
        severity: "below-reserve",
      },
    ]);
  });

  it("fincore-5: demo episodes match the end-of-day cash for every start date of the year", () => {
    const below = createDemoFinancialDocument("2026-01-21");
    const first = findLiquidityWarnings(projectFinancialDocument(below), below.minimumCashReserve);
    // Jan 31 ends at 708 (Sueldo, then Pago Tarjeta Plata): still the Jan 29 episode.
    expect(first[0]).toMatchObject({ startDate: "2026-01-29", cash: -2500 });
    expect(first.some((w) => w.startDate === "2026-01-31")).toBe(false);

    for (let i = 0; i < 365; i++) {
      const doc = createDemoFinancialDocument(addDays("2026-01-01", i));
      const p = projectFinancialDocument(doc);
      // Reference: rising edges of (end-of-day cash < reserve), day by day.
      const starts: string[] = [];
      let wasBelow = false;
      for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1)) {
        const isBelow = snapshotAt(p, d).cash < doc.minimumCashReserve;
        if (isBelow && !wasBelow) starts.push(d);
        wasBelow = isBelow;
      }
      expect(findLiquidityWarnings(p, doc.minimumCashReserve).map((w) => w.startDate)).toEqual(starts);
    }
  });

  it("debtByAccountAt: per-account debt at the end of a date", () => {
    const at = (date: string) => Object.fromEntries(debtByAccountAt(projection, date));
    expect(at("2026-10-01")).toEqual({ card: 1000 });
    expect(at("2026-11-03")).toEqual({ card: 1500 });
    expect(at("2026-11-12")).toEqual({ card: 1200 });
    expect(at("2027-06-01")).toEqual({ card: 1200 });
    // Same projection object → same answers (index built once, lazily).
    expect(at("2026-11-03")).toEqual({ card: 1500 });

    // Purchases on an unknown card show up under their auto-created account.
    const ghost = projectFinancialTimeline({
      initialCash: 0,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      events: [ev("buy", "credit-card-purchase", "2026-11-05", 400, "ghost")],
    });
    expect([...debtByAccountAt(ghost, "2026-11-04")]).toEqual([["ghost", 0]]);
    expect([...debtByAccountAt(ghost, "2026-11-05")]).toEqual([["ghost", 400]]);
  });

  it("debtByAccountAt sums to snapshotAt().debt on every day of the demo", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const p = projectFinancialDocument(doc);
    expect(p.accounts.map((a) => a.id)).toEqual(["fin-prestamo", "fin-nu", "fin-bbva", "fin-laptop-msi"]);
    for (let d = addDays(p.startDate, -1); d <= p.endDate; d = addDays(d, 1)) {
      let sum = 0;
      for (const debt of debtByAccountAt(p, d).values()) sum += debt;
      expect(Math.round(sum * 100) / 100).toBe(snapshotAt(p, d).debt);
    }
  });
});
