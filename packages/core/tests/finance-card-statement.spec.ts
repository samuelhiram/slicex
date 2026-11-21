// Credit cards in "statement" payment mode ("pago para no generar intereses",
// totalero): every due date pays exactly the debt at the last cut, no
// interest ever. Projection semantics, payoff estimate (cross-checked against
// the projection), the cycle-date helpers, and the guarantee that "fixed"
// cards are unchanged.
import { describe, expect, it } from "vitest";
import {
  accountActivity,
  addDays,
  addMonths,
  buildProjectionAccounts,
  cardCycleDates,
  createDefaultFinancialItem,
  createDemoFinancialDocument,
  debtByAccountAt,
  estimateDebtPayoffs,
  expandFinancialEvents,
  nextCutDate,
  projectFinancialDocument,
  projectFinancialTimeline,
  statementDueDate,
} from "../src/finance";
import type {
  CardPurchaseItem,
  CreditCardItem,
  DebtPayoffEstimate,
  FinancialDocument,
  FinancialEvent,
  FinancialEventType,
  FinancialItem,
  FinancialProjection,
  ISODate,
  InstallmentPlanItem,
} from "../src/finance";
import { expandFinancialEventsUncached } from "../src/finance/events";

const START = "2026-11-07";

function doc(items: FinancialItem[], over: Partial<FinancialDocument> = {}): FinancialDocument {
  return {
    id: "t",
    name: "t",
    startDate: START,
    initialCash: 100000,
    minimumCashReserve: 0,
    horizonMonths: 12,
    items,
    ...over,
  };
}

/** Statement card: cut on the 15th, paid on the 5th. Rate / minimum / payment are set to show they are ignored. */
function card(over: Partial<CreditCardItem> = {}): CreditCardItem {
  return {
    id: "card",
    kind: "credit-card",
    name: "Card",
    balance: 0,
    annualRate: 60,
    cutDay: 15,
    dueDay: 5,
    minimumPayment: 300,
    paymentAmount: 1000,
    paymentMode: "statement",
    recurrence: { frequency: "monthly", startDate: START },
    ...over,
  };
}

/** The same card in the default ("fixed") mode, WITHOUT the paymentMode field. */
function fixedCard(over: Partial<CreditCardItem> = {}): CreditCardItem {
  const { paymentMode: _mode, ...rest } = card(over);
  return rest;
}

function once(id: string, amount: number, date: ISODate, cardId = "card"): CardPurchaseItem {
  return { id, kind: "card-purchase", name: id, cardId, amount, recurrence: { frequency: "once", startDate: date, endDate: date } };
}

function purchase(id: string, amount: number, recurrence: CardPurchaseItem["recurrence"], cardId = "card"): CardPurchaseItem {
  return { id, kind: "card-purchase", name: id, cardId, amount, recurrence };
}

/** [date, amount paid] of every card payment point of `cardId`. */
function payments(projection: FinancialProjection, cardId = "card"): [ISODate, number][] {
  return projection.points
    .filter((p) => p.type === "credit-card-payment" && p.itemId === cardId)
    .map((p) => [p.date, -p.cashDelta]);
}

function payoffOf(d: FinancialDocument, id: string, maxMonths?: number): DebtPayoffEstimate {
  const estimate = estimateDebtPayoffs(d, maxMonths === undefined ? undefined : { maxMonths }).get(id);
  expect(estimate, id).toBeDefined();
  return estimate!;
}

describe("statement mode — projection", () => {
  it("a purchase one day before the cut is paid on the next due date; one day after, a month later", () => {
    const d = doc([card(), once("before", 1000, "2026-11-14"), once("after", 2000, "2026-11-16")]);
    const p = projectFinancialDocument(d);
    // Cut 2026-11-15 closes a 1 000 statement; cut 2026-12-15 closes the 2 000 one.
    expect(payments(p)).toEqual([
      ["2026-12-05", 1000],
      ["2027-01-05", 2000],
    ]);
    expect(debtByAccountAt(p, "2026-12-05").get("card")).toBe(2000);
    expect(debtByAccountAt(p, "2027-01-05").get("card")).toBe(0);
    expect(p.finalDebt).toBe(0);
    expect(statementDueDate(card(), "2026-11-14")).toBe("2026-12-05");
    expect(statementDueDate(card(), "2026-11-16")).toBe("2027-01-05");
    // Payments are real cash outflows.
    const first = p.points.find((x) => x.type === "credit-card-payment")!;
    expect(first).toMatchObject({ cashBefore: 100000, cashAfter: 99000, cashDelta: -1000, debtDelta: -1000, accountDebtAfter: 2000 });
  });

  it("a purchase dated on the cut day belongs to that statement", () => {
    const d = doc([card(), once("on-cut", 500, "2026-11-15"), once("next-day", 700, "2026-11-16")]);
    expect(payments(projectFinancialDocument(d))).toEqual([
      ["2026-12-05", 500],
      ["2027-01-05", 700],
    ]);
    expect(statementDueDate(card(), "2026-11-15")).toBe("2026-12-05");
  });

  it("the opening balance is paid on the first due date (cut first, or due before any cut)", () => {
    // Cut 2026-11-15 then due 2026-12-05: the statement is the opening balance.
    expect(payments(projectFinancialDocument(doc([card({ balance: 5000 })])))).toEqual([["2026-12-05", 5000]]);
    // Start 2026-11-01: the first due (11-05) comes before the first cut and pays the
    // opening balance only; a purchase made before it waits for the 11-15 cut.
    const early = doc([card({ balance: 5000, recurrence: { frequency: "monthly", startDate: "2026-11-01" } }), once("x", 300, "2026-11-03")], {
      startDate: "2026-11-01",
    });
    expect(payments(projectFinancialDocument(early))).toEqual([
      ["2026-11-05", 5000],
      ["2026-12-05", 300],
    ]);
  });

  it("never charges interest, whatever the rate; minimum / planned payment are ignored", () => {
    const items = [card({ balance: 30000, annualRate: 99.9 }), once("tv", 7000, "2027-01-20")];
    const d = doc(items);
    const p = projectFinancialDocument(d);
    expect(p.points.some((x) => x.type === "credit-card-interest")).toBe(false);
    expect(expandFinancialEvents(d).some((e) => e.type === "credit-card-interest")).toBe(false);
    expect(accountActivity(p, "card", p.startDate, p.endDate)).toEqual({ interest: 0, payments: 37000, charges: 7000 });
    expect(payments(p)).toEqual([
      ["2026-12-05", 30000],
      ["2027-03-05", 7000],
    ]);
    // Payment events carry 0: the projection computes them.
    const events = expandFinancialEvents(d).filter((e) => e.type === "credit-card-payment");
    expect(events.length).toBe(12);
    expect(events.every((e) => e.amount === 0)).toBe(true);
    // Sanity: the same card in fixed mode does pay interest.
    const fixed = projectFinancialDocument(doc([fixedCard({ balance: 30000, annualRate: 99.9 }), items[1]!]));
    expect(fixed.points.filter((x) => x.type === "credit-card-interest").length).toBeGreaterThan(0);
  });

  it("the statement is the whole debt at the cut: unpaid previous statement + purchase on the cut day", () => {
    // Payments only from 2027-01-01: the 2026-12-05 due date is outside the window.
    const d = doc([
      card({ balance: 1000, recurrence: { frequency: "monthly", startDate: "2027-01-01" } }),
      once("a", 300, "2026-11-20"),
      once("on-cut", 200, "2026-12-15"),
      once("after", 400, "2026-12-20"),
    ]);
    const p = projectFinancialDocument(d);
    // 12-15 statement = 1 000 (unpaid 11-15 statement) + 300 + 200 (bought on the cut day).
    expect(payments(p)).toEqual([
      ["2027-01-05", 1500],
      ["2027-02-05", 400],
    ]);
    expect(debtByAccountAt(p, "2027-01-05").get("card")).toBe(400);
  });

  it("cut and due on the same day: the payment pays the previous statement, the cut closes after", () => {
    const d = doc([card({ balance: 1000, cutDay: 15, dueDay: 15 }), once("x", 200, "2026-11-15")]);
    expect(payments(projectFinancialDocument(d))).toEqual([
      ["2026-11-15", 1000],
      ["2026-12-15", 200],
    ]);
    expect(statementDueDate(card({ cutDay: 15, dueDay: 15 }), "2026-11-15")).toBe("2026-12-15");
  });

  it("statementDueDate predicts the projection's payment for every purchase date (four card layouts)", () => {
    const layouts: { cutDay: number; dueDay: number; start: ISODate }[] = [
      { cutDay: 15, dueDay: 5, start: START },
      { cutDay: 31, dueDay: 30, start: "2027-01-01" }, // clamping through February
      { cutDay: 15, dueDay: 15, start: START },
      { cutDay: 5, dueDay: 25, start: "2026-12-20" }, // due in the cut's month, across the year end
    ];
    for (const layout of layouts) {
      const c = card({ cutDay: layout.cutDay, dueDay: layout.dueDay, recurrence: { frequency: "monthly", startDate: layout.start } });
      for (let i = 0; i < 70; i++) {
        const date = addDays(layout.start, i);
        const d = doc([c, once("x", 1000, date)], { startDate: layout.start, horizonMonths: 6 });
        const label = `${layout.cutDay}/${layout.dueDay} ${date}`;
        expect(payments(projectFinancialDocument(d)), label).toEqual([[statementDueDate(c, date), 1000]]);
        expect(payoffOf(d, "card").payoffDate, label).toBe(statementDueDate(c, date));
      }
    }
  });

  it("MSI plans on a statement card are still their own account, paid on the card's due day", () => {
    const plan: InstallmentPlanItem = {
      id: "msi",
      kind: "installment-plan",
      name: "6 MSI",
      cardId: "card",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2027-01-10" },
    };
    const d = doc([card(), plan]);
    const p = projectFinancialDocument(d);
    expect(p.points.filter((x) => x.itemId === "msi" && x.type === "installment-payment").map((x) => x.date)).toEqual([
      "2027-02-05",
      "2027-03-05",
      "2027-04-05",
      "2027-05-05",
      "2027-06-05",
      "2027-07-05",
    ]);
    expect(payments(p)).toEqual([]);
    expect(debtByAccountAt(p, "2027-03-01").get("card")).toBe(0);
    expect(payoffOf(d, "msi")).toMatchObject({ payoffDate: "2027-07-05", totalPaid: 6000 });
    expect(payoffOf(d, "card").payoffDate).toBe(START);
  });

  it("buildProjectionAccounts flags statement cards with their cut day (fixed cards unchanged)", () => {
    const accounts = buildProjectionAccounts(doc([card({ cutDay: 31 }), fixedCard({ id: "f", name: "F" })]));
    expect(accounts).toStrictEqual([
      { id: "card", name: "Card", kind: "credit-card", openingDebt: 0, annualRate: 60, statementCutDay: 31 },
      { id: "f", name: "F", kind: "credit-card", openingDebt: 0, annualRate: 60 },
    ]);
    expect("statementCutDay" in accounts[1]!).toBe(false);
  });

  it("projectFinancialTimeline: a statement account ignores payment amounts and interest events", () => {
    const ev = (type: FinancialEventType, date: ISODate, amount: number): FinancialEvent => ({
      id: `c@${date}`,
      itemId: "c",
      type,
      date,
      amount,
      name: "c",
      accountId: "c",
    });
    const p = projectFinancialTimeline({
      initialCash: 1000,
      startDate: "2026-11-01",
      endDate: "2027-01-31",
      accounts: [{ id: "c", name: "C", kind: "credit-card", openingDebt: 100, annualRate: 99, statementCutDay: 31 }],
      events: [
        ev("credit-card-purchase", "2026-11-10", 50),
        ev("credit-card-interest", "2026-11-30", 0),
        ev("credit-card-payment", "2026-12-10", 9999),
        ev("credit-card-payment", "2026-12-20", 9999),
      ],
    });
    // Cut 11-30 (31 clamped): statement 150, paid on 12-10; the 12-20 payment finds no statement.
    expect(p.points.map((x) => [x.type, x.date, x.cashDelta, x.accountDebtAfter])).toEqual([
      ["credit-card-purchase", "2026-11-10", 0, 150],
      ["credit-card-payment", "2026-12-10", -150, 0],
    ]);
    expect(p.accounts[0]).toMatchObject({ annualRate: 99, statementCutDay: 31 });
    expect(p.finalDebt).toBe(0);
  });

  it("toggling paymentMode in place re-expands the card (memo key)", () => {
    const c = fixedCard({ balance: 2000 });
    const d = doc([c, once("x", 100, "2026-12-01")]);
    const before = expandFinancialEvents(d);
    expect(before.some((e) => e.type === "credit-card-interest")).toBe(true);
    c.paymentMode = "statement";
    const after = expandFinancialEvents(d);
    expect(after.some((e) => e.type === "credit-card-interest")).toBe(false);
    expect(after.filter((e) => e.type === "credit-card-payment").every((e) => e.amount === 0)).toBe(true);
    expect(after).toEqual(expandFinancialEventsUncached(d));
    c.paymentMode = "fixed";
    expect(expandFinancialEvents(d)).toEqual(before);
  });
});

describe("statement mode — payoff estimate", () => {
  it("the payoff is the due date that pays the statement holding the last purchase", () => {
    const before = doc([card({ balance: 5000 }), once("tv", 800, "2027-02-14")]);
    const after = doc([card({ balance: 5000 }), once("tv", 800, "2027-02-16")]);
    expect(payoffOf(before, "card")).toEqual({
      accountId: "card",
      name: "Card",
      kind: "credit-card",
      payoffDate: "2027-03-05",
      totalInterest: 0,
      totalPaid: 5800,
      finalDebt: 0,
    });
    expect(payoffOf(after, "card")).toMatchObject({ payoffDate: "2027-04-05", totalInterest: 0, totalPaid: 5800, finalDebt: 0 });
    for (const d of [before, after]) {
      const estimate = payoffOf(d, "card");
      const date = estimate.payoffDate!;
      const p = projectFinancialDocument(d);
      expect(debtByAccountAt(p, date).get("card")).toBe(0);
      expect(debtByAccountAt(p, addDays(date, -1)).get("card")!).toBeGreaterThan(0);
      expect(accountActivity(p, "card", START, date)).toEqual({ interest: 0, payments: estimate.totalPaid, charges: 800 });
    }
  });

  it("the opening balance alone is paid off on the first due date; nothing owed → the start date", () => {
    expect(payoffOf(doc([card({ balance: 1000 })]), "card")).toMatchObject({ payoffDate: "2026-12-05", totalPaid: 1000 });
    expect(payoffOf(doc([card()]), "card")).toEqual({
      accountId: "card",
      name: "Card",
      kind: "credit-card",
      payoffDate: START,
      totalInterest: 0,
      totalPaid: 0,
      finalDebt: 0,
    });
    // A window that ends before the first due date: still owed.
    expect(payoffOf(doc([card({ balance: 1000 })]), "card", 0)).toMatchObject({ payoffDate: null, totalPaid: 0, finalDebt: 1000 });
  });

  it("a big balance never compounds: paid in one statement whatever the rate (fixed mode would take years)", () => {
    const statement = payoffOf(doc([card({ balance: 30000, annualRate: 99.9 })]), "card");
    expect(statement).toMatchObject({ payoffDate: "2026-12-05", totalInterest: 0, totalPaid: 30000 });
    const fixed = payoffOf(doc([fixedCard({ balance: 30000, annualRate: 99.9, paymentAmount: 2000 })]), "card");
    expect(fixed.payoffDate).toBeNull();
  });

  it("subscriptions: covered by every statement, so they do not hold the payoff back", () => {
    // Charged on the 20th (after the 15th cut): each payment leaves the current cycle's 200 owed.
    const after = doc([card({ balance: 5000 }), purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-20" })]);
    expect(payoffOf(after, "card")).toMatchObject({ payoffDate: "2026-12-05", totalInterest: 0, totalPaid: 5000, finalDebt: 0 });
    const p = projectFinancialDocument(after);
    expect(debtByAccountAt(p, "2026-12-05").get("card")).toBe(200);
    expect(payments(p).slice(0, 3)).toEqual([
      ["2026-12-05", 5000],
      ["2027-01-05", 200],
      ["2027-02-05", 200],
    ]);
    // Charged on the 10th (before the cut): the statement includes it and the debt hits 0.
    const before = doc([card({ balance: 5000 }), purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-10" })]);
    expect(payoffOf(before, "card")).toMatchObject({ payoffDate: "2026-12-05", totalPaid: 5200 });
    expect(debtByAccountAt(projectFinancialDocument(before), "2026-12-05").get("card")).toBe(0);
    // No balance + subscription: nothing is ever carried.
    const fresh = doc([card(), purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-20" })]);
    expect(payoffOf(fresh, "card").payoffDate).toBe(START);
  });

  it("payments that stop while a subscription keeps charging → never paid off", () => {
    const d = doc([
      card({ recurrence: { frequency: "monthly", startDate: START, endDate: "2027-05-07" } }),
      purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-10" }),
    ]);
    const estimate = payoffOf(d, "card", 24);
    expect(estimate.payoffDate).toBeNull();
    expect(estimate.finalDebt).toBeGreaterThan(0);
    // The debt at the cap is exactly the projection's.
    const p = projectFinancialDocument({ ...d, horizonMonths: 24 });
    expect(estimate.finalDebt).toBe(debtByAccountAt(p, p.endDate).get("card"));
  });

  it("the simulated debt equals the projection's at every cap (0..24 months)", () => {
    // One-off purchases every 9 days (never "steady"): every statement payment leaves the
    // post-cut ones owed, so there is no payoff inside these caps and finalDebt is the
    // simulated debt at the end of the cap.
    const items: FinancialItem[] = [card({ balance: 3000 })];
    let lastPurchase = "";
    for (let k = 0; k <= 90; k++) {
      lastPurchase = addDays("2026-11-09", 9 * k);
      items.push(once(`p${k}`, 100 + k + 0.25, lastPurchase));
    }
    items.push(purchase("other-card", 999, { frequency: "weekly", startDate: "2026-11-09" }, "elsewhere"));
    const d = doc(items);
    for (let m = 0; m <= 24; m++) {
      const estimate = payoffOf(d, "card", m);
      const p = projectFinancialDocument({ ...d, horizonMonths: m });
      const end = addMonths(START, m);
      expect(p.endDate).toBe(end);
      expect(estimate.payoffDate, `m=${m}`).toBeNull();
      expect(estimate.finalDebt, `m=${m}`).toBe(debtByAccountAt(p, end).get("card"));
      expect(estimate.totalPaid, `m=${m}`).toBe(accountActivity(p, "card", START, end).payments);
      expect(estimate.totalInterest).toBe(0);
    }
    // Once the purchases end, the payoff is the due date that pays the statement of the last one.
    const payoff = payoffOf(d, "card");
    expect(payoff.payoffDate).toBe(statementDueDate(card(), lastPurchase));
    const long = projectFinancialDocument({ ...d, horizonMonths: 36 });
    expect(debtByAccountAt(long, payoff.payoffDate!).get("card")).toBe(0);
    expect(debtByAccountAt(long, addDays(payoff.payoffDate!, -1)).get("card")!).toBeGreaterThan(0);
    const activity = accountActivity(long, "card", START, payoff.payoffDate!);
    expect(activity.payments).toBe(payoff.totalPaid);
    expect(payoff.totalPaid).toBeCloseTo(3000 + activity.charges, 2);
  });

  it("a subscription is steady only past the cap: a short window reports the payoff like fixed mode", () => {
    // Weekly gas until 2029: within a 1-month window it keeps charging past the cap (steady),
    // so the 12-05 statement payment clears everything but the current cycle.
    const d = doc([card({ balance: 3000 }), purchase("gas", 150, { frequency: "weekly", startDate: "2026-11-09", endDate: "2029-01-01" })]);
    expect(payoffOf(d, "card", 1)).toMatchObject({ payoffDate: "2026-12-05", totalPaid: 3150, finalDebt: 0 });
    // Over 30 years the schedule ends inside the window: its last charge (2026-11-09 + 112
    // weeks = 2029-01-01) is what counts.
    expect(payoffOf(d, "card").payoffDate).toBe(statementDueDate(card(), "2029-01-01"));
    expect(statementDueDate(card(), "2029-01-01")).toBe("2029-02-05");
  });
});

describe("cardCycleDates / nextCutDate / statementDueDate", () => {
  it("lists every cut and due date in [from, to], inclusive, ascending", () => {
    expect(cardCycleDates(card(), "2026-11-05", "2027-01-15")).toEqual({
      cuts: ["2026-11-15", "2026-12-15", "2027-01-15"],
      dues: ["2026-11-05", "2026-12-05", "2027-01-05"],
    });
    expect(cardCycleDates(card(), "2026-11-06", "2027-01-14")).toEqual({
      cuts: ["2026-11-15", "2026-12-15"],
      dues: ["2026-12-05", "2027-01-05"],
    });
  });

  it("clamps the day to the month length without drifting (cutDay 31 in February, leap years)", () => {
    const c = card({ cutDay: 31, dueDay: 30 });
    expect(cardCycleDates(c, "2027-01-01", "2027-04-30")).toEqual({
      cuts: ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"],
      dues: ["2027-01-30", "2027-02-28", "2027-03-30", "2027-04-30"],
    });
    expect(cardCycleDates(c, "2028-02-01", "2028-03-01").cuts).toEqual(["2028-02-29"]);
    expect(nextCutDate(c, "2027-02-01")).toBe("2027-02-28");
    expect(nextCutDate(c, "2027-02-28")).toBe("2027-02-28");
    expect(nextCutDate(c, "2027-03-01")).toBe("2027-03-31");
    expect(nextCutDate(c, "2028-02-10")).toBe("2028-02-29");
    // Bought in February: Feb 28 cut; the Feb 28 due date (30 clamped) pays the January statement.
    expect(statementDueDate(c, "2027-02-10")).toBe("2027-03-30");
    expect(statementDueDate(c, "2027-01-31")).toBe("2027-02-28");
  });

  it("rolls over the year end", () => {
    expect(cardCycleDates(card(), "2026-12-10", "2027-02-10")).toEqual({
      cuts: ["2026-12-15", "2027-01-15"],
      dues: ["2027-01-05", "2027-02-05"],
    });
    expect(nextCutDate(card(), "2026-12-16")).toBe("2027-01-15");
    expect(statementDueDate(card(), "2026-12-16")).toBe("2027-02-05");
    expect(statementDueDate(card(), "2026-12-15")).toBe("2027-01-05");
    expect(statementDueDate(card({ cutDay: 28, dueDay: 18 }), "2026-12-29")).toBe("2027-02-18");
  });

  it("first cut on or after the date; due strictly after that cut", () => {
    expect(nextCutDate(card(), "2026-11-15")).toBe("2026-11-15");
    expect(nextCutDate(card(), "2026-11-16")).toBe("2026-12-15");
    // Due later in the same month as the cut.
    const c = card({ cutDay: 5, dueDay: 25 });
    expect(statementDueDate(c, "2026-11-03")).toBe("2026-11-25");
    expect(statementDueDate(c, "2026-11-05")).toBe("2026-11-25");
    expect(statementDueDate(c, "2026-11-06")).toBe("2026-12-25");
  });

  it("long ranges step by month; empty for an inverted or malformed range; date helpers throw on malformed dates", () => {
    const { cuts, dues } = cardCycleDates(card(), "2026-01-01", "2055-12-31");
    expect(cuts.length).toBe(360);
    expect(dues.length).toBe(360);
    expect(cuts[359]).toBe("2055-12-15");
    expect(cardCycleDates(card(), "2027-01-02", "2027-01-01")).toEqual({ cuts: [], dues: [] });
    expect(cardCycleDates(card(), "nope", "2027-01-01")).toEqual({ cuts: [], dues: [] });
    expect(() => nextCutDate(card(), "2027-02-30")).toThrow(RangeError);
    expect(() => statementDueDate(card(), "bad")).toThrow(RangeError);
  });
});

describe("fixed mode is unchanged", () => {
  function withFixedFlag(d: FinancialDocument): FinancialDocument {
    return {
      ...d,
      items: d.items.map((item): FinancialItem => (item.kind === "credit-card" ? { ...item, paymentMode: "fixed" } : item)),
    };
  }

  it("a card with paymentMode 'fixed' projects, expands and pays off exactly like one without the field", () => {
    const plan: InstallmentPlanItem = {
      id: "msi",
      kind: "installment-plan",
      name: "MSI",
      cardId: "card",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2027-01-10" },
    };
    const implicit = doc(
      [
        fixedCard({ balance: 20000, annualRate: 45, paymentAmount: 2500 }),
        purchase("gas", 800, { frequency: "biweekly", startDate: "2026-11-12", endDate: "2027-06-30" }),
        once("tv", 7000, "2027-01-03"),
        plan,
      ],
      { horizonMonths: 36 },
    );
    const explicit = withFixedFlag(implicit);
    expect("paymentMode" in implicit.items[0]!).toBe(false);
    expect(projectFinancialDocument(explicit)).toStrictEqual(projectFinancialDocument(implicit));
    expect(JSON.stringify(projectFinancialDocument(explicit))).toBe(JSON.stringify(projectFinancialDocument(implicit)));
    expect(expandFinancialEvents(explicit)).toStrictEqual(expandFinancialEvents(implicit));
    expect(buildProjectionAccounts(explicit)).toStrictEqual(buildProjectionAccounts(implicit));
    expect(estimateDebtPayoffs(explicit)).toStrictEqual(estimateDebtPayoffs(implicit));
    // Interest still posted at every cut in fixed mode.
    expect(projectFinancialDocument(implicit).points.some((x) => x.type === "credit-card-interest")).toBe(true);
  });

  it("the demo document gives the same projection and payoffs with every card explicitly 'fixed'", () => {
    const demo = createDemoFinancialDocument(START);
    const explicit = withFixedFlag(demo);
    expect(JSON.stringify(projectFinancialDocument(explicit))).toBe(JSON.stringify(projectFinancialDocument(demo)));
    expect(estimateDebtPayoffs(explicit)).toStrictEqual(estimateDebtPayoffs(demo));
  });

  it("createDefaultFinancialItem keeps producing fixed cards (no paymentMode field)", () => {
    const item = createDefaultFinancialItem("credit-card", "c", START);
    expect("paymentMode" in item).toBe(false);
  });
});
