// Avalanche strategy with "statement"-mode cards: they are paid in full every
// month and never accrue interest, so they are not ranked / allocated, but the
// cash they still need is set aside (`committedPayments`) so availableForExtra
// stays honest.
import { describe, expect, it } from "vitest";
import {
  debtByAccountAt,
  projectFinancialDocument,
  rankDebtsByAvalanche,
  snapshotAt,
  statementCardCommitments,
  suggestAvalanchePayments,
} from "../src/finance";
import type { CardPurchaseItem, CreditCardItem, FinancialDocument, FinancialItem } from "../src/finance";

const START = "2026-11-07";
const REC = { frequency: "monthly" as const, startDate: START };

function card(id: string, balance: number, annualRate: number, minimumPayment: number, over: Partial<CreditCardItem> = {}): CreditCardItem {
  return { id, kind: "credit-card", name: id, balance, annualRate, cutDay: 15, dueDay: 5, minimumPayment, recurrence: REC, ...over };
}

function once(id: string, cardId: string, amount: number, date: string): CardPurchaseItem {
  return { id, kind: "card-purchase", name: id, cardId, amount, recurrence: { frequency: "once", startDate: date, endDate: date } };
}

function makeDoc(items: FinancialItem[]): FinancialDocument {
  return { id: "d", name: "d", startDate: START, initialCash: 20000, minimumCashReserve: 5000, horizonMonths: 12, items };
}

const items: FinancialItem[] = [
  card("bbva", 60000, 39, 2500),
  // Highest rate of all, but paid in full every month: never an avalanche target.
  card("totalero", 8000, 99.9, 400, { paymentMode: "statement" }),
  card("nu", 30000, 79, 1500),
  card("explicit-fixed", 4000, 50, 200, { paymentMode: "fixed" }),
  { ...card("off-statement", 900, 120, 0, { paymentMode: "statement" }), enabled: false },
  { id: "loan", kind: "loan", name: "loan", paymentAmount: 1000, balance: 8000, annualRate: 20, recurrence: REC },
];

describe("rankDebtsByAvalanche — statement cards", () => {
  it("leaves statement cards out (opening balances and projected balances); fixed ones stay", () => {
    const doc = makeDoc(items);
    expect(rankDebtsByAvalanche(doc).map((d) => d.id)).toEqual(["nu", "explicit-fixed", "bbva", "loan"]);
    const balances = new Map([
      ["bbva", 100],
      ["totalero", 5000],
      ["nu", 200],
      ["explicit-fixed", 300],
      ["loan", 400],
    ]);
    expect(rankDebtsByAvalanche(doc, balances).map((d) => d.id)).toEqual(["nu", "explicit-fixed", "bbva", "loan"]);
  });

  it("an explicit 'fixed' card ranks exactly like one without the field", () => {
    const implicit = makeDoc(items.map((i): FinancialItem => (i.id === "explicit-fixed" ? card("explicit-fixed", 4000, 50, 200) : i)));
    expect(rankDebtsByAvalanche(implicit)).toStrictEqual(rankDebtsByAvalanche(makeDoc(items)));
  });

  it("suggestAvalanchePayments never allocates to a statement card", () => {
    const doc = makeDoc(items);
    const plan = suggestAvalanchePayments({
      debts: rankDebtsByAvalanche(doc),
      availableCash: 1_000_000,
      minimumCashReserve: 0,
      committedPayments: statementCardCommitments(doc),
    });
    expect(plan.allocations.map((a) => a.id)).toEqual(["nu", "explicit-fixed", "bbva", "loan"]);
  });
});

describe("statementCardCommitments + committedPayments", () => {
  it("sums the enabled statement cards' balances (opening, or from the balances map; missing id → 0)", () => {
    const doc = makeDoc([...items, card("totalero-2", 1234.56, 30, 0, { paymentMode: "statement" })]);
    expect(statementCardCommitments(doc)).toBe(9234.56);
    expect(statementCardCommitments(doc, new Map([["totalero", 750.25], ["nu", 99999]]))).toBe(750.25);
    expect(statementCardCommitments(makeDoc(items.filter((i) => i.id !== "totalero")))).toBe(0);
  });

  it("is set aside like the minimums: cash − reserve − minimums − committed, floored at 0", () => {
    const doc = makeDoc(items);
    const debts = rankDebtsByAvalanche(doc);
    // Minimums: nu 1 500 + explicit-fixed 200 + bbva 2 500 + loan 1 000 = 5 200.
    const plan = suggestAvalanchePayments({ debts, availableCash: 20000, minimumCashReserve: 5000, committedPayments: 8000 });
    expect(plan.availableForExtra).toBe(20000 - 5000 - 5200 - 8000);
    expect(plan.allocations[0]).toEqual({ id: "nu", name: "nu", minimum: 1500, extra: 1800, total: 3300 });
    const short = suggestAvalanchePayments({ debts, availableCash: 20000, minimumCashReserve: 5000, committedPayments: 50000 });
    expect(short.availableForExtra).toBe(0);
    expect(short.allocations.every((a) => a.extra === 0)).toBe(true);
    expect(short.allocations.map((a) => a.minimum)).toEqual([1500, 200, 2500, 1000]);
  });

  it("absent, zero, negative or non-finite commitments leave the plan unchanged", () => {
    const debts = rankDebtsByAvalanche(makeDoc(items));
    const base = suggestAvalanchePayments({ debts, availableCash: 20000, minimumCashReserve: 5000 });
    for (const committedPayments of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(suggestAvalanchePayments({ debts, availableCash: 20000, minimumCashReserve: 5000, committedPayments })).toStrictEqual(base);
    }
    expect(base.availableForExtra).toBe(20000 - 5000 - 5200);
  });

  it("on a projection date, the commitment is the cash the projection pays the card for the debt it already carries", () => {
    const doc = makeDoc([
      card("totalero", 0, 99.9, 400, { paymentMode: "statement" }),
      once("before-cut", "totalero", 1000, "2026-11-14"),
      once("after-cut", "totalero", 2000, "2026-11-16"),
      card("nu", 30000, 79, 1500),
    ]);
    const projection = projectFinancialDocument(doc);
    const date = "2026-11-20"; // between the 11-15 cut and the 12-05 due date
    const balances = debtByAccountAt(projection, date);
    const committed = statementCardCommitments(doc, balances);
    expect(committed).toBe(3000);
    // Paid from cash on the next two due dates: 1 000 (before the cut) + 2 000 (after it).
    const paid = projection.points
      .filter((p) => p.itemId === "totalero" && p.type === "credit-card-payment" && p.date > date)
      .map((p) => [p.date, -p.cashDelta]);
    expect(paid).toEqual([
      ["2026-12-05", 1000],
      ["2027-01-05", 2000],
    ]);
    const debts = rankDebtsByAvalanche(doc, balances);
    expect(debts.map((d) => d.id)).toEqual(["nu"]);
    const cash = snapshotAt(projection, date).cash;
    const plan = suggestAvalanchePayments({ debts, availableCash: cash, minimumCashReserve: 5000, committedPayments: committed });
    expect(plan.availableForExtra).toBe(Math.max(0, cash - 5000 - 1500 - 3000));
  });
});
