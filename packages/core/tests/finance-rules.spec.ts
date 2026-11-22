// Rule changes ("a partir de aquí") and one-occurrence edits ("solo este
// pago"): segments, event expansion, payoff and the editing operation.
import { describe, expect, it } from "vitest";
import {
  editItemOccurrence,
  estimateDebtPayoffs,
  expandFinancialEvents,
  occurrenceAmount,
  projectFinancialDocument,
  ruleOccurrenceDates,
  ruleSegments,
  scheduledTotal,
  shiftItemRules,
  withAmountInForce,
} from "../src/finance";
import { expandFinancialEventsUncached } from "../src/finance/events";
import type { ExpenseItem, FinancialDocument, FinancialItem, IncomeItem, LoanItem } from "../src/finance";

const doc = (items: FinancialItem[]): FinancialDocument => ({
  id: "d",
  name: "d",
  startDate: "2026-11-21",
  initialCash: 0,
  minimumCashReserve: 0,
  horizonMonths: 3,
  items,
});

const salary: IncomeItem = {
  id: "sueldo",
  kind: "income",
  name: "Sueldo",
  amount: 9000,
  recurrence: { frequency: "semimonthly", startDate: "2026-11-22" },
};

const gas: ExpenseItem = {
  id: "gas",
  kind: "expense",
  name: "Gas",
  amount: 800,
  recurrence: { frequency: "weekly", startDate: "2026-11-27" },
};

function amountsOf(items: FinancialItem[], id: string): [string, number][] {
  return expandFinancialEvents(doc(items))
    .filter((e) => e.itemId === id)
    .map((e) => [e.date, e.amount]);
}

describe("ruleSegments", () => {
  it("without changes: one segment that IS the item's rule", () => {
    const segments = ruleSegments(salary);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.recurrence).toBe(salary.recurrence);
    expect(segments[0]!.amount).toBe(9000);
  });

  it("an amount change keeps the phase; a cadence change restarts it at its date", () => {
    const item: ExpenseItem = {
      ...gas,
      ruleChanges: [
        { from: "2026-12-11", amount: 400 },
        { from: "2027-01-01", frequency: "biweekly" },
      ],
    };
    const segments = ruleSegments(item);
    expect(segments.map((s) => [s.from, s.to, s.amount, s.recurrence.frequency, s.recurrence.anchorDate])).toEqual([
      ["2026-11-27", "2026-12-10", 800, "weekly", undefined],
      ["2026-12-11", "2026-12-31", 400, "weekly", "2026-11-27"],
      ["2027-01-01", undefined, 400, "biweekly", undefined],
    ]);
    expect(amountsOf([item], "gas")).toEqual([
      ["2026-11-27", 800],
      ["2026-12-04", 800],
      ["2026-12-11", 400],
      ["2026-12-18", 400],
      ["2026-12-25", 400],
      ["2027-01-01", 400],
      ["2027-01-15", 400],
      ["2027-01-29", 400],
      ["2027-02-12", 400],
    ]);
  });

  it("a change on or before the start replaces the base rule; one after the end does nothing", () => {
    const item: IncomeItem = {
      ...salary,
      recurrence: { ...salary.recurrence, endDate: "2026-12-31" },
      ruleChanges: [
        { from: "2026-01-01", amount: 10000 },
        { from: "2027-06-01", amount: 1 },
      ],
    };
    expect(amountsOf([item], "sueldo")).toEqual([
      ["2026-11-30", 10000],
      ["2026-12-15", 10000],
      ["2026-12-31", 10000],
    ]);
  });
});

describe("occurrence edits", () => {
  it("change one occurrence; 0 keeps it as an event the projection skips", () => {
    const item: ExpenseItem = {
      ...gas,
      occurrenceEdits: [
        { date: "2026-12-04", amount: 400 },
        { date: "2026-12-11", amount: 0 },
        { date: "2026-12-12", amount: 99 }, // not an occurrence: nothing
      ],
    };
    expect(amountsOf([item], "gas").slice(0, 4)).toEqual([
      ["2026-11-27", 800],
      ["2026-12-04", 400],
      ["2026-12-11", 0],
      ["2026-12-18", 800],
    ]);
    const points = projectFinancialDocument(doc([item])).points.filter((p) => p.itemId === "gas");
    expect(points.some((p) => p.date === "2026-12-11")).toBe(false);
    expect(occurrenceAmount(item, "2026-12-04")).toBe(400);
    expect(occurrenceAmount(item, "2026-12-18")).toBe(800);
  });

  it("the memoised expansion follows a replaced array and matches the reference path", () => {
    const base: ExpenseItem = { ...gas };
    const d = doc([base]);
    expandFinancialEvents(d);
    const edited = { ...base, occurrenceEdits: [{ date: "2026-12-04", amount: 1 }] };
    const d2 = doc([edited, salary]);
    expect(expandFinancialEvents(d2)).toEqual(expandFinancialEventsUncached(d2));
    expect(expandFinancialEvents(d2).find((e) => e.date === "2026-12-04" && e.itemId === "gas")!.amount).toBe(1);
  });
});

describe("loans and cards", () => {
  const loan: LoanItem = {
    id: "loan",
    kind: "loan",
    name: "Préstamo",
    paymentAmount: 7500,
    recurrence: { frequency: "monthly", startDate: "2026-12-15", endDate: "2027-05-15" },
  };

  it("a window loan owes its base schedule; a bigger payment pays it off sooner", () => {
    const plain = estimateDebtPayoffs(doc([loan])).get("loan")!;
    expect(plain.payoffDate).toBe("2027-05-15");
    const faster: LoanItem = { ...loan, occurrenceEdits: [{ date: "2027-01-15", amount: 15000 }] };
    const estimate = estimateDebtPayoffs(doc([faster])).get("loan")!;
    expect(estimate.payoffDate).toBe("2027-04-15");
    expect(estimate.totalPaid).toBe(45000);
  });

  it("skipping a payment leaves debt at the end", () => {
    const skipped: LoanItem = { ...loan, occurrenceEdits: [{ date: "2027-01-15", amount: 0 }] };
    const estimate = estimateDebtPayoffs(doc([skipped])).get("loan")!;
    expect(estimate.payoffDate).toBeNull();
    expect(estimate.finalDebt).toBe(7500);
  });

  it("a balance loan with a raise from a date pays off when the events say", () => {
    const balanceLoan: LoanItem = {
      ...loan,
      balance: 30000,
      recurrence: { frequency: "monthly", startDate: "2026-12-15" },
      ruleChanges: [{ from: "2027-02-15", amount: 10000 }],
    };
    // 7,500 (dic) + 7,500 (ene) + 10,000 (feb) + 5,000 (mar, capped)
    expect(estimateDebtPayoffs(doc([balanceLoan])).get("loan")!.payoffDate).toBe("2027-03-15");
    const projection = projectFinancialDocument({ ...doc([balanceLoan]), horizonMonths: 6 });
    const debts = projection.points.filter((p) => p.itemId === "loan").map((p) => [p.date, p.accountDebtAfter]);
    expect(debts.slice(0, 4)).toEqual([
      ["2026-12-15", 22500],
      ["2027-01-15", 15000],
      ["2027-02-15", 5000],
      ["2027-03-15", 0],
    ]);
  });

  it("a fixed card pays the amount in force on each due date", () => {
    const card: FinancialItem = {
      id: "card",
      kind: "credit-card",
      name: "Tarjeta",
      balance: 10000,
      annualRate: 0,
      cutDay: 1,
      dueDay: 20,
      minimumPayment: 1000,
      paymentAmount: 2000,
      recurrence: { frequency: "monthly", startDate: "2026-11-21" },
      ruleChanges: [{ from: "2027-01-01", amount: 4000 }],
      occurrenceEdits: [{ date: "2026-12-20", amount: 0 }],
    };
    const payments = expandFinancialEvents(doc([card]))
      .filter((e) => e.type === "credit-card-payment")
      .map((e) => [e.date, e.amount]);
    expect(payments).toEqual([
      ["2026-12-20", 0],
      ["2027-01-20", 4000],
      ["2027-02-20", 4000],
    ]);
    // dic 20 skipped, then 4,000 × 3 ≥ 10,000.
    expect(estimateDebtPayoffs(doc([card])).get("card")!.payoffDate).toBe("2027-03-20");
  });
});

describe("editItemOccurrence", () => {
  it("'this' adds an edit, and an amount equal to the rule removes it", () => {
    const edited = editItemOccurrence(gas, { date: "2026-12-04", scope: "this", amount: 400 });
    expect(edited.occurrenceEdits).toEqual([{ date: "2026-12-04", amount: 400 }]);
    const back = editItemOccurrence(edited, { date: "2026-12-04", scope: "this", amount: 800 });
    expect(back.occurrenceEdits).toBeUndefined();
    expect(editItemOccurrence(gas, { date: "2026-12-04", scope: "this", amount: 800 })).toBe(gas);
  });

  it("'following' on a later occurrence adds a change; on the first one it edits the base rule", () => {
    const raise = editItemOccurrence(salary, { date: "2026-12-15", scope: "following", amount: 12000 });
    expect(raise.amount).toBe(9000);
    expect(raise.ruleChanges).toEqual([{ from: "2026-12-15", amount: 12000 }]);
    expect(amountsOf([raise], "sueldo").slice(0, 3)).toEqual([
      ["2026-11-30", 9000],
      ["2026-12-15", 12000],
      ["2026-12-31", 12000],
    ]);
    const first = editItemOccurrence(salary, { date: "2026-11-30", scope: "following", amount: 10000 });
    expect(first.amount).toBe(10000);
    expect(first.ruleChanges).toBeUndefined();
  });

  it("'following' with a cadence restarts the phase there and merges with a change on that date", () => {
    const weekly = editItemOccurrence(salary, { date: "2026-12-15", scope: "following", frequency: "weekly" });
    expect(weekly.ruleChanges).toEqual([{ from: "2026-12-15", frequency: "weekly" }]);
    expect(ruleOccurrenceDates(weekly, { from: "2026-11-21", to: "2026-12-31" })).toEqual([
      "2026-11-30",
      "2026-12-15",
      "2026-12-22",
      "2026-12-29",
    ]);
    const both = editItemOccurrence(weekly, { date: "2026-12-15", scope: "following", amount: 5000 });
    expect(both.ruleChanges).toEqual([{ from: "2026-12-15", amount: 5000, frequency: "weekly" }]);
    // Back to the old cadence and amount: the change goes away.
    const back = editItemOccurrence(both, {
      date: "2026-12-15",
      scope: "following",
      amount: 9000,
      frequency: "semimonthly",
    });
    expect(back.ruleChanges).toBeUndefined();
  });

  it("'following' replaces the edit of that occurrence and keeps later ones", () => {
    const item: IncomeItem = {
      ...salary,
      occurrenceEdits: [
        { date: "2026-12-15", amount: 1 },
        { date: "2027-01-15", amount: 2 },
      ],
    };
    const next = editItemOccurrence(item, { date: "2026-12-15", scope: "following", amount: 12000 });
    expect(next.occurrenceEdits).toEqual([{ date: "2027-01-15", amount: 2 }]);
  });

  it("a one-time item edits its own amount, or starts repeating from its date", () => {
    const once: ExpenseItem = {
      ...gas,
      recurrence: { frequency: "once", startDate: "2026-12-13", endDate: "2026-12-13" },
    };
    expect(editItemOccurrence(once, { date: "2026-12-13", scope: "this", amount: 5 }).amount).toBe(5);
    const repeating = editItemOccurrence(once, { date: "2026-12-13", scope: "following", frequency: "monthly" });
    expect(repeating.recurrence).toEqual({ frequency: "monthly", startDate: "2026-12-13" });
  });

  it("MSI and statement cards are not editable", () => {
    const msi: FinancialItem = {
      id: "m",
      kind: "installment-plan",
      name: "MSI",
      originalAmount: 1200,
      installmentsTotal: 12,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2026-12-01" },
    };
    expect(editItemOccurrence(msi, { date: "2026-12-01", scope: "this", amount: 1 })).toBe(msi);
  });
});

describe("helpers", () => {
  it("shiftItemRules moves changes and edits with the item", () => {
    const item: ExpenseItem = {
      ...gas,
      ruleChanges: [{ from: "2026-12-11", amount: 400 }],
      occurrenceEdits: [{ date: "2026-12-04", amount: 1 }],
    };
    const moved = shiftItemRules(item, 3);
    expect(moved.ruleChanges).toEqual([{ from: "2026-12-14", amount: 400 }]);
    expect(moved.occurrenceEdits).toEqual([{ date: "2026-12-07", amount: 1 }]);
    expect(shiftItemRules(gas, 3)).toBe(gas);
  });

  it("scheduledTotal = the sum of the expanded amounts", () => {
    const item: ExpenseItem = {
      ...gas,
      ruleChanges: [{ from: "2026-12-11", amount: 400, frequency: "daily", interval: 3 }],
      occurrenceEdits: [{ date: "2026-12-14", amount: 1000 }],
    };
    const range = { from: "2026-11-21", to: "2027-02-21" };
    const sum = expandFinancialEvents(doc([item]))
      .filter((e) => e.itemId === "gas")
      .reduce((acc, e) => acc + e.amount, 0);
    expect(scheduledTotal(item, range)).toBe(sum);
  });
});

describe("withAmountInForce", () => {
  it("sets the amount of the rule in force on a date: the change's or the base's", () => {
    const item: ExpenseItem = { ...gas, ruleChanges: [{ from: "2026-12-11", amount: 400 }] };
    expect(withAmountInForce(item, "2026-12-20", 450).ruleChanges).toEqual([{ from: "2026-12-11", amount: 450 }]);
    const base = withAmountInForce(item, "2026-11-30", 900);
    expect(base.amount).toBe(900);
    expect(base.ruleChanges).toEqual(item.ruleChanges);
    expect(withAmountInForce(item, "2026-12-20", 400)).toBe(item);
  });
});
