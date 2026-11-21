import { describe, expect, it } from "vitest";
import {
  buildProjectionAccounts,
  createDefaultFinancialItem,
  diffDays,
  expandFinancialEvents,
  projectFinancialDocument,
  projectFinancialTimeline,
  rankDebtsByAvalanche,
  snapshotAt,
} from "../src/finance";
import type {
  CreditCardItem,
  FinancialDocument,
  FinancialEvent,
  FinancialEventType,
  FinancialItem,
  ISODate,
  InstallmentPlanItem,
  LoanItem,
} from "../src/finance";

function makeDoc(items: FinancialItem[], over: Partial<FinancialDocument> = {}): FinancialDocument {
  return {
    id: "d",
    name: "test",
    startDate: "2026-11-01",
    initialCash: 5000,
    minimumCashReserve: 0,
    horizonMonths: 2,
    items,
    ...over,
  };
}

function once(id: string, kind: "income" | "expense", amount: number, date: ISODate): FinancialItem {
  return { id, kind, name: id, amount, recurrence: { frequency: "once", startDate: date, endDate: date } };
}

function ev(id: string, type: FinancialEventType, date: ISODate, amount: number): FinancialEvent {
  return { id: `${id}@${date}`, itemId: id, type, date, amount, name: id };
}

function card(over: Partial<CreditCardItem> = {}): CreditCardItem {
  return {
    id: "card",
    kind: "credit-card",
    name: "Card",
    balance: 0,
    annualRate: 0,
    cutDay: 1,
    dueDay: 20,
    minimumPayment: 0,
    recurrence: { frequency: "monthly", startDate: "2026-11-01" },
    ...over,
  };
}

const cashAfter = (doc: FinancialDocument) => projectFinancialDocument(doc).points.map((p) => p.cashAfter);

describe("projectFinancialTimeline — mandatory scenarios", () => {
  it("5000; +9000 / -5000 / +9000, then inserting -3000 recalculates the future", () => {
    const events = [
      ev("q1", "income", "2026-11-15", 9000),
      ev("rent", "expense", "2026-11-17", 5000),
      ev("q2", "income", "2026-11-30", 9000),
    ];
    const base = projectFinancialTimeline({
      initialCash: 5000,
      events,
      startDate: "2026-11-01",
      endDate: "2026-12-31",
    });
    expect(base.points.map((p) => p.cashAfter)).toEqual([14000, 9000, 18000]);

    // Unsorted insertion on purpose: the projection re-sorts defensively.
    const inserted = projectFinancialTimeline({
      initialCash: 5000,
      events: [...events, ev("extra", "expense", "2026-11-20", 3000)],
      startDate: "2026-11-01",
      endDate: "2026-12-31",
    });
    expect(inserted.points.map((p) => p.cashAfter)).toEqual([14000, 9000, 6000, 15000]);
    expect(snapshotAt(inserted, "2026-11-30").cash).toBe(15000);
    // Past is untouched.
    expect(snapshotAt(inserted, "2026-11-17").cash).toBe(snapshotAt(base, "2026-11-17").cash);
  });

  it("same scenario through a document", () => {
    const doc = makeDoc([
      once("q1", "income", 9000, "2026-11-15"),
      once("rent", "expense", 5000, "2026-11-17"),
      once("q2", "income", 9000, "2026-11-30"),
    ]);
    expect(cashAfter(doc)).toEqual([14000, 9000, 18000]);
    doc.items.push(once("extra", "expense", 3000, "2026-11-20"));
    expect(cashAfter(doc)).toEqual([14000, 9000, 6000, 15000]);
  });

  it("prompt example: 12000; +9000 / -5792 / -2000 / +9000", () => {
    const doc = makeDoc(
      [
        once("q1", "income", 9000, "2026-11-15"),
        once("plata", "expense", 5792, "2026-11-17"),
        once("gasto", "expense", 2000, "2026-11-20"),
        once("q2", "income", 9000, "2026-11-30"),
      ],
      { initialCash: 12000 },
    );
    const p = projectFinancialDocument(doc);
    expect(p.points.map((x) => x.cashAfter)).toEqual([21000, 15208, 13208, 22208]);
    expect(p.points.map((x) => x.cashDelta)).toEqual([9000, -5792, -2000, 9000]);
    expect(p.finalCash).toBe(22208);
    expect(p.minimumCash).toEqual({ date: "2026-11-01", cash: 12000 });
  });
});

describe("projectFinancialTimeline — items", () => {
  it("single income and single expense", () => {
    expect(cashAfter(makeDoc([once("i", "income", 250.5, "2026-11-03")]))).toEqual([5250.5]);
    const p = projectFinancialDocument(makeDoc([once("e", "expense", 6000, "2026-11-03")]));
    expect(p.points[0]!.cashAfter).toBe(-1000);
    expect(p.minimumCash).toEqual({ date: "2026-11-03", cash: -1000 });
  });

  it("recurring income and recurring expense", () => {
    const income: FinancialItem = {
      id: "inc",
      kind: "income",
      name: "inc",
      amount: 1000,
      recurrence: { frequency: "monthly", startDate: "2026-11-01" },
    };
    // Range = [2026-11-01, 2027-01-01] → Nov 1, Dec 1, Jan 1.
    expect(projectFinancialDocument(makeDoc([income])).finalCash).toBe(8000);
    const expense: FinancialItem = {
      id: "exp",
      kind: "expense",
      name: "exp",
      amount: 100,
      recurrence: { frequency: "weekly", startDate: "2026-11-02" },
    };
    const p = projectFinancialDocument(makeDoc([expense], { horizonMonths: 1 }));
    expect(p.points.map((x) => x.date)).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
    expect(p.finalCash).toBe(4500);
  });

  it("orders same-day events by type priority, then item order; suffixes duplicate ids", () => {
    const day = "2026-11-15";
    const doc = makeDoc([
      card({ id: "c", balance: 1000, annualRate: 36, cutDay: 15, dueDay: 15, minimumPayment: 100 }),
      {
        id: "msi",
        kind: "installment-plan",
        name: "msi",
        cardId: "c",
        originalAmount: 600,
        installmentsTotal: 6,
        installmentsPaid: 0,
        recurrence: { frequency: "monthly", startDate: day, endDate: day },
      },
      { id: "loan", kind: "loan", name: "loan", paymentAmount: 300, recurrence: { frequency: "once", startDate: day } },
      once("exp", "expense", 50, day),
      { id: "buy", kind: "card-purchase", name: "buy", cardId: "c", amount: 70, recurrence: { frequency: "once", startDate: day } },
      once("inc2", "income", 20, day),
      once("inc1", "income", 10, day),
    ]);
    const sameDay = expandFinancialEvents(doc).filter((e) => e.date === day);
    expect(sameDay.map((e) => e.type)).toEqual([
      "income",
      "income",
      "credit-card-interest",
      "credit-card-purchase",
      // The MSI starts after the document start with nothing paid: a future
      // purchase whose debt opens that day, before its first installment.
      "debt-opening",
      "expense",
      "loan-payment",
      "installment-payment",
      "credit-card-payment",
    ]);
    expect(sameDay.map((e) => e.itemId).slice(0, 2)).toEqual(["inc2", "inc1"]);
    expect(sameDay.find((e) => e.type === "credit-card-interest")!.id).toBe("c@2026-11-15");
    expect(sameDay.find((e) => e.type === "credit-card-payment")!.id).toBe("c@2026-11-15#2");
    const ids = expandFinancialEvents(doc).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("future recalculation: editing an item only shifts points from its date on", () => {
    const items = [
      once("a", "income", 1000, "2026-11-05"),
      once("b", "expense", 300, "2026-11-10"),
      once("c", "income", 500, "2026-11-20"),
    ];
    const before = projectFinancialDocument(makeDoc(items));
    const edited = projectFinancialDocument(
      makeDoc([items[0]!, { ...items[1]!, amount: 800 } as FinancialItem, items[2]!]),
    );
    expect(edited.points[0]).toEqual(before.points[0]);
    expect(edited.points[1]!.cashAfter).toBe(before.points[1]!.cashAfter - 500);
    expect(edited.points[2]!.cashAfter).toBe(before.points[2]!.cashAfter - 500);
  });

  it("loan payments recur and reduce the loan debt (derived from the schedule)", () => {
    const loan: FinancialItem = {
      id: "loan",
      kind: "loan",
      name: "loan",
      paymentAmount: 1000,
      recurrence: { frequency: "monthly", startDate: "2026-11-10", endDate: "2027-01-10" },
    };
    const doc = makeDoc([loan], { horizonMonths: 3 });
    expect(buildProjectionAccounts(doc)).toEqual([
      { id: "loan", name: "loan", kind: "loan", openingDebt: 3000, annualRate: 0 },
    ]);
    const p = projectFinancialDocument(doc);
    expect(p.initialDebt).toBe(3000);
    expect(p.points.map((x) => x.debtAfter)).toEqual([2000, 1000, 0]);
    expect(p.points.map((x) => x.cashAfter)).toEqual([4000, 3000, 2000]);
    expect(p.points.every((x) => x.type === "loan-payment" && x.accountId === "loan")).toBe(true);

    // Explicit balance wins; payment beyond the balance still costs cash.
    const withBalance = projectFinancialDocument(makeDoc([{ ...loan, balance: 2500 } as FinancialItem], { horizonMonths: 3 }));
    expect(withBalance.points.map((x) => x.debtAfter)).toEqual([1500, 500, 0]);
    expect(withBalance.points.map((x) => x.debtDelta)).toEqual([-1000, -1000, -500]);
    expect(withBalance.finalCash).toBe(2000);

    // Indefinite loan without balance → debt unknown (0), cash still moves.
    const open = projectFinancialDocument(
      makeDoc([{ ...loan, recurrence: { frequency: "monthly", startDate: "2026-11-10" } } as FinancialItem]),
    );
    expect(open.initialDebt).toBe(0);
    expect(open.finalCash).toBe(3000);
  });

  it("card purchase raises the debt without touching cash", () => {
    const doc = makeDoc([
      card(),
      { id: "buy", kind: "card-purchase", name: "buy", cardId: "card", amount: 1000, recurrence: { frequency: "once", startDate: "2026-11-05" } },
    ]);
    const p = projectFinancialDocument(doc);
    expect(p.points).toHaveLength(1);
    expect(p.points[0]).toMatchObject({ type: "credit-card-purchase", cashDelta: 0, debtDelta: 1000, debtAfter: 1000, cashAfter: 5000 });
  });

  it("card purchase on a missing card books an auto-created zero-rate account", () => {
    const doc = makeDoc([
      { id: "buy", kind: "card-purchase", name: "buy", cardId: "ghost", amount: 400, recurrence: { frequency: "once", startDate: "2026-11-05" } },
    ]);
    const p = projectFinancialDocument(doc);
    expect(p.points[0]).toMatchObject({ accountId: "ghost", debtAfter: 400, cashAfter: 5000 });
    expect(p.finalDebt).toBe(400);
  });

  it("card payment is capped at the debt and emits no point once the debt is 0", () => {
    const doc = makeDoc([card({ balance: 500, paymentAmount: 2000, minimumPayment: 100 })]);
    const p = projectFinancialDocument(doc);
    const payments = p.points.filter((x) => x.type === "credit-card-payment");
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ date: "2026-11-20", cashDelta: -500, debtDelta: -500, debtAfter: 0 });
    expect(p.finalCash).toBe(4500);
    expect(expandFinancialEvents(doc).filter((e) => e.type === "credit-card-payment")).toHaveLength(2);
  });

  it("estimates card interest: debt × rate/100/360 × days since last accrual", () => {
    const doc = makeDoc([card({ balance: 10000, annualRate: 36, cutDay: 10, dueDay: 28 })], {
      startDate: "2026-01-01",
    });
    const p = projectFinancialDocument(doc);
    const interest = p.points.filter((x) => x.type === "credit-card-interest");
    // Jan 10: 10000 × 0.001 × 9 = 90; Feb 10: 10090 × 0.001 × 31 = 312.79.
    expect(interest.map((x) => [x.date, x.debtDelta, x.debtAfter])).toEqual([
      ["2026-01-10", 90, 10090],
      ["2026-02-10", 312.79, 10402.79],
    ]);
    expect(interest.every((x) => x.estimated === true && x.cashDelta === 0)).toBe(true);
    // Zero-amount planned payments produce no point.
    expect(p.points.some((x) => x.type === "credit-card-payment")).toBe(false);
  });

  it("first accrual on the start date is 0 days → no interest point", () => {
    const p = projectFinancialDocument(
      makeDoc([card({ balance: 10000, annualRate: 36, cutDay: 1 })], { startDate: "2026-01-01", horizonMonths: 1 }),
    );
    const interest = p.points.filter((x) => x.type === "credit-card-interest");
    expect(interest.map((x) => [x.date, x.debtDelta])).toEqual([["2026-02-01", 310]]);
  });

  it("installment plan pays at most the remaining installments", () => {
    const plan: FinancialItem = {
      id: "msi",
      kind: "installment-plan",
      name: "msi",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 4,
      recurrence: { frequency: "monthly", startDate: "2026-11-05" },
    };
    const p = projectFinancialDocument(makeDoc([plan], { horizonMonths: 6 }));
    expect(p.initialDebt).toBe(2000);
    expect(p.points.map((x) => [x.date, x.cashAfter, x.debtAfter])).toEqual([
      ["2026-11-05", 4000, 1000],
      ["2026-12-05", 3000, 0],
    ]);

    // On a card → the card's due day. Counting starts at max(startDate,
    // doc.startDate) whatever the requested range: Nov 20 is installment 5.
    const onCard = makeDoc([card({ dueDay: 20 }), { ...plan, cardId: "card" } as FinancialItem], { horizonMonths: 6 });
    expect(expandFinancialEvents(onCard).filter((e) => e.type === "installment-payment").map((e) => e.date)).toEqual([
      "2026-11-20",
      "2026-12-20",
    ]);
    expect(
      expandFinancialEvents(onCard, { from: "2026-12-01", to: "2027-06-01" })
        .filter((e) => e.type === "installment-payment")
        .map((e) => e.date),
    ).toEqual(["2026-12-20"]);
  });

  it("disabled items are ignored (events and accounts)", () => {
    const doc = makeDoc([
      { ...once("i", "income", 1000, "2026-11-05"), enabled: false } as FinancialItem,
      card({ balance: 900, enabled: false, paymentAmount: 100 }),
      once("e", "expense", 100, "2026-11-06"),
    ]);
    expect(expandFinancialEvents(doc).map((e) => e.itemId)).toEqual(["e"]);
    expect(buildProjectionAccounts(doc)).toEqual([]);
    const p = projectFinancialDocument(doc);
    expect(p.initialDebt).toBe(0);
    expect(p.finalCash).toBe(4900);
  });

  it("ignores events outside [startDate, endDate]", () => {
    const p = projectFinancialTimeline({
      initialCash: 100,
      events: [ev("a", "income", "2026-10-31", 50), ev("b", "income", "2026-11-02", 50), ev("c", "income", "2026-12-02", 50)],
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    expect(p.points.map((x) => x.itemId)).toEqual(["b"]);
    expect(p.finalCash).toBe(150);
  });
});

describe("regressions (engine review)", () => {
  it("fincore-1: a loan longer than the horizon keeps every payment up to endDate as debt", () => {
    const loan: LoanItem = {
      id: "car",
      kind: "loan",
      name: "car",
      paymentAmount: 7500,
      annualRate: 14,
      recurrence: { frequency: "monthly", startDate: "2026-11-15", endDate: "2030-10-15" },
    };
    const doc = makeDoc([loan], { horizonMonths: 12 });
    const p = projectFinancialDocument(doc);
    // 48 payments; 12 fall inside the horizon, 36 (270 000) remain after it.
    expect(p.initialDebt).toBe(360000);
    expect(p.points).toHaveLength(12);
    expect(p.finalDebt).toBe(270000);
    expect(rankDebtsByAvalanche(doc)).toMatchObject([{ id: "car", balance: 360000 }]);

    // Payments before the document start are already paid.
    const started = makeDoc([{ ...loan, recurrence: { ...loan.recurrence, startDate: "2025-11-15" } }]);
    expect(projectFinancialDocument(started).initialDebt).toBe(360000);

    // A 1000-year weekly loan is counted arithmetically (no date expansion).
    const weekly: LoanItem = {
      ...loan,
      paymentAmount: 10,
      recurrence: { frequency: "weekly", startDate: "2026-11-02", endDate: "3026-11-02" },
    };
    const payments = Math.floor(diffDays("2026-11-02", "3026-11-02") / 7) + 1;
    expect(buildProjectionAccounts(makeDoc([weekly]))[0]!.openingDebt).toBe(payments * 10);

    // "+ Préstamo" at a playhead 200 days in: 13 payments, all owed.
    const added = makeDoc([createDefaultFinancialItem("loan", "l", "2027-05-20")], { horizonMonths: 12 });
    const pa = projectFinancialDocument(added);
    expect(pa.initialDebt).toBe(13000);
    expect(pa.finalDebt).toBe(13000 - 1000 * pa.points.length);
    expect(pa.finalDebt).toBeGreaterThan(0);
  });

  it("fincore-2: a future MSI purchase opens its debt on its start date, without cash", () => {
    const doc = makeDoc([createDefaultFinancialItem("installment-plan", "msi", "2027-03-01")], { horizonMonths: 12 });
    expect(buildProjectionAccounts(doc)).toEqual([
      { id: "msi", name: "6 MSI", kind: "installment-plan", openingDebt: 0, annualRate: 0 },
    ]);
    const p = projectFinancialDocument(doc);
    expect(p.initialDebt).toBe(0);
    expect(snapshotAt(p, "2026-11-15").debt).toBe(0);
    expect(snapshotAt(p, "2027-02-28").debt).toBe(0);
    // Opening first, then the first installment the same day (anchor day 1).
    expect(p.points.slice(0, 2).map((x) => [x.date, x.type, x.cashDelta, x.debtDelta, x.debtAfter])).toEqual([
      ["2027-03-01", "debt-opening", 0, 6000, 6000],
      ["2027-03-01", "installment-payment", -1000, -1000, 5000],
    ]);
    expect(snapshotAt(p, "2027-03-01").debt).toBe(5000);
    expect(p.finalDebt).toBe(0);
    expect(p.finalCash).toBe(-1000);
    expect(rankDebtsByAvalanche(doc)).toEqual([]);

    // Outside the range: nothing (no debt, no opening).
    const beyond = projectFinancialDocument(
      makeDoc([createDefaultFinancialItem("installment-plan", "msi", "2028-03-01")], { horizonMonths: 12 }),
    );
    expect(beyond.initialDebt).toBe(0);
    expect(beyond.points).toEqual([]);

    // Started plans (on/before the document start, or with installments
    // paid) carry their debt from the document start, as before.
    const today = projectFinancialDocument(makeDoc([createDefaultFinancialItem("installment-plan", "msi", "2026-11-01")]));
    expect(today.initialDebt).toBe(6000);
    expect(today.points.some((x) => x.type === "debt-opening")).toBe(false);
    const paid = { ...createDefaultFinancialItem("installment-plan", "msi", "2027-03-01"), installmentsPaid: 1 } as FinancialItem;
    const partly = projectFinancialDocument(makeDoc([paid], { horizonMonths: 12 }));
    expect(partly.initialDebt).toBe(5000);
    expect(partly.points.some((x) => x.type === "debt-opening")).toBe(false);
  });

  it("fincore-4: card interest accrues on the average daily balance", () => {
    // Cut 15, 60 %/yr, no balance; a 10 000 purchase ONE day before the cut.
    const c = createDefaultFinancialItem("credit-card", "c", "2026-11-15");
    const doc = makeDoc([
      c,
      { id: "buy", kind: "card-purchase", name: "buy", cardId: "c", amount: 10000, recurrence: { frequency: "once", startDate: "2026-12-14" } },
    ]);
    const p = projectFinancialDocument(doc);
    const interest = p.points.filter((x) => x.type === "credit-card-interest");
    // 10 000 x 0.60 / 360 x 1 day = 16.67 (was 500: 30 days).
    expect(interest[0]).toMatchObject({ date: "2026-12-15", debtDelta: 16.67, debtAfter: 10016.67, estimated: true });

    // A payment the day before the cut only removes the last day.
    const paying = makeDoc(
      [
        card({
          balance: 10000,
          annualRate: 36,
          cutDay: 10,
          dueDay: 9,
          paymentAmount: 9000,
          recurrence: { frequency: "monthly", startDate: "2026-01-01" },
        }),
      ],
      { startDate: "2026-01-01", horizonMonths: 1 },
    );
    const pp = projectFinancialDocument(paying);
    // Jan 1-9 at 10 000 (8 days) + Jan 9-10 at 1 000 (1 day) = 80 + 1 (was 9).
    expect(pp.points.find((x) => x.type === "credit-card-interest")).toMatchObject({ date: "2026-01-10", debtDelta: 81 });
  });

  it("fincore-6: a custom range does not restart the remaining installments", () => {
    const plan: InstallmentPlanItem = {
      id: "msi",
      kind: "installment-plan",
      name: "msi",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2026-11-01" },
    };
    const doc = makeDoc([plan]);
    const dates = (range: { from: ISODate; to: ISODate }) =>
      expandFinancialEvents(doc, range)
        .filter((e) => e.type === "installment-payment")
        .map((e) => e.date);
    // All 6 installments fall due Nov 2026 - Apr 2027.
    expect(dates({ from: "2027-06-01", to: "2027-12-31" })).toEqual([]);
    expect(dates({ from: "2027-02-15", to: "2027-12-31" })).toEqual(["2027-03-01", "2027-04-01"]);
    // A range that starts before the document start does not re-emit the
    // installments already counted in installmentsPaid.
    const late = makeDoc([{ ...plan, installmentsPaid: 3, recurrence: { frequency: "monthly", startDate: "2026-08-01" } }]);
    expect(
      expandFinancialEvents(late, { from: "2026-08-01", to: "2027-12-31" })
        .filter((e) => e.type === "installment-payment")
        .map((e) => e.date),
    ).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("fincore-7: the last MSI installment absorbs the cents", () => {
    const plan = (originalAmount: number, installmentsTotal: number, installmentsPaid = 0): InstallmentPlanItem => ({
      id: "msi",
      kind: "installment-plan",
      name: "msi",
      originalAmount,
      installmentsTotal,
      installmentsPaid,
      recurrence: { frequency: "monthly", startDate: "2026-11-01" },
    });
    const run = (item: InstallmentPlanItem) =>
      projectFinancialDocument(makeDoc([item], { horizonMonths: 30, initialCash: 0 }));

    const p24 = run(plan(999.99, 24));
    expect(p24.initialDebt).toBe(999.99);
    expect(p24.finalCash).toBe(-999.99);
    expect(p24.finalDebt).toBe(0);
    expect(p24.points).toHaveLength(24);
    expect(p24.points[22]!.cashDelta).toBe(-41.67);
    expect(p24.points[23]!.cashDelta).toBe(-41.58);
    expect(p24.points.every((x) => x.cashDelta === x.debtDelta)).toBe(true);

    expect(run(plan(10000, 3)).points.map((x) => x.cashDelta)).toEqual([-3333.33, -3333.33, -3333.34]);
    const partly = run(plan(1000, 3, 1));
    expect(partly.initialDebt).toBe(666.67);
    expect(partly.points.map((x) => [x.cashDelta, x.debtAfter])).toEqual([
      [-333.33, 333.34],
      [-333.34, 0],
    ]);
  });

  it("points carry the touched account debt; the projection lists its accounts", () => {
    const doc = makeDoc([
      card({ balance: 1000, paymentAmount: 300 }),
      { id: "buy", kind: "card-purchase", name: "buy", cardId: "ghost", amount: 400, recurrence: { frequency: "once", startDate: "2026-11-05" } },
      { id: "solo", kind: "card-purchase", name: "Solo", cardId: "", amount: 50, recurrence: { frequency: "once", startDate: "2026-11-06" } },
      once("e", "expense", 100, "2026-11-07"),
    ]);
    const p = projectFinancialDocument(doc);
    expect(p.accounts).toEqual([
      { id: "card", name: "Card", kind: "credit-card", openingDebt: 1000, annualRate: 0 },
      { id: "ghost", name: "ghost", kind: "credit-card", openingDebt: 0, annualRate: 0 },
      { id: "solo", name: "Solo", kind: "credit-card", openingDebt: 0, annualRate: 0 },
    ]);
    expect(p.points.map((x) => [x.itemId, x.accountId, x.accountDebtAfter])).toEqual([
      ["buy", "ghost", 400],
      ["solo", "solo", 50],
      ["e", undefined, undefined],
      ["card", "card", 700],
      ["card", "card", 400],
    ]);

    // Duplicate input accounts are merged; a purchase without accountId is booked on its item.
    const merged = projectFinancialTimeline({
      initialCash: 0,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      accounts: [
        { id: "a", name: "A", kind: "loan", openingDebt: 100, annualRate: 0 },
        { id: "a", name: "A2", kind: "loan", openingDebt: 50, annualRate: 0 },
      ],
      events: [ev("x", "credit-card-purchase", "2026-11-02", 10), ev("x", "credit-card-purchase", "2026-11-03", 5)],
    });
    expect(merged.accounts).toEqual([
      { id: "a", name: "A", kind: "loan", openingDebt: 150, annualRate: 0 },
      { id: "x", name: "x", kind: "credit-card", openingDebt: 0, annualRate: 0 },
    ]);
    expect(merged.points.map((x) => [x.accountId, x.accountDebtAfter, x.debtAfter])).toEqual([
      ["x", 10, 160],
      ["x", 15, 165],
    ]);
  });
});
