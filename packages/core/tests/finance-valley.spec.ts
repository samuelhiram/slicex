// explainValley / suggestValleyFixes: why a liquidity warning happens and
// which single item patch lifts it. Every fix is checked by re-projecting
// the patched document.
import { describe, expect, it } from "vitest";
import {
  addDays,
  createDemoFinancialDocument,
  expandRecurrence,
  explainValley,
  findLiquidityWarnings,
  projectFinancialDocument,
  suggestValleyFixes,
} from "../src/finance";
import type {
  CreditCardItem,
  ExpenseItem,
  FinancialDocument,
  FinancialItem,
  FinancialProjection,
  IncomeItem,
  LiquidityWarning,
  ValleyFix,
} from "../src/finance";

const START = "2026-11-07";

function doc(items: FinancialItem[], over: Partial<FinancialDocument> = {}): FinancialDocument {
  return {
    id: "t",
    name: "t",
    startDate: START,
    initialCash: 0,
    minimumCashReserve: 1000,
    horizonMonths: 12,
    items,
    ...over,
  };
}

function income(id: string, amount: number, recurrence: IncomeItem["recurrence"]): IncomeItem {
  return { id, kind: "income", name: id, amount, recurrence };
}

function expense(id: string, amount: number, recurrence: ExpenseItem["recurrence"], name = id): ExpenseItem {
  return { id, kind: "expense", name, amount, recurrence };
}

function once(date: string): ExpenseItem["recurrence"] {
  return { frequency: "once", startDate: date, endDate: date };
}

function apply(d: FinancialDocument, fix: ValleyFix): FinancialDocument {
  return { ...d, items: d.items.map((item) => (item.id === fix.itemId ? fix.patch : item)) };
}

/** Warnings of `projection` whose episode covers `date`. */
function warningsCovering(projection: FinancialProjection, reserve: number, date: string): LiquidityWarning[] {
  return findLiquidityWarnings(projection, reserve).filter((w) => w.startDate <= date && date <= w.date);
}

/** Lowest end-of-point cash inside [from, to] (plus the cash carried in). */
function minCashIn(projection: FinancialProjection, from: string, to: string): number {
  let min = projection.initialCash;
  for (const p of projection.points) {
    if (p.date < from) min = p.cashAfter;
    else break;
  }
  for (const p of projection.points) if (p.date >= from && p.date <= to && p.cashAfter < min) min = p.cashAfter;
  return min;
}

describe("explainValley — demo document", () => {
  const demo = createDemoFinancialDocument(START);
  const projection = projectFinancialDocument(demo);
  const warnings = findLiquidityWarnings(projection, demo.minimumCashReserve);
  const valley = warnings[0]!;

  it("the demo has its negative valley on 27 nov", () => {
    expect(valley).toMatchObject({ date: "2026-11-27", startDate: "2026-11-26", cash: -1292, severity: "negative" });
  });

  it("explains it: payday before, the outflows that drained it (biggest first), the next payday, the shortfall", () => {
    const explanation = explainValley(demo, projection, valley);
    expect(explanation.warning).toBe(valley);
    expect(explanation.lastInflow).toEqual({ date: "2026-11-15", name: "Sueldo", amount: 9000 });
    expect(explanation.nextInflow).toEqual({ date: "2026-11-30", name: "Sueldo", amount: 9000 });
    expect(explanation.shortfall).toBe(6292); // 5 000 − (−1 292)
    expect(explanation.causes).toEqual([
      { itemId: "fin-prestamo", name: "Préstamo personal", date: "2026-11-15", amount: 7500, type: "loan-payment" },
      { itemId: "fin-pago-plata", name: "Pago Tarjeta Plata", date: "2026-11-17", amount: 5792, type: "expense" },
      { itemId: "fin-nu", name: "Nu", date: "2026-11-26", amount: 3000, type: "credit-card-payment" },
      { itemId: "fin-bbva", name: "BBVA", date: "2026-11-27", amount: 2500, type: "credit-card-payment" },
      { itemId: "fin-gasto", name: "Gasto", date: "2026-11-20", amount: 2000, type: "expense" },
      { itemId: "fin-laptop-msi", name: "Laptop 12 MSI", date: "2026-11-27", amount: 1500, type: "installment-payment" },
    ]);
    // Cash after the payday minus every cause = the valley minimum.
    const afterPayday = 12000 + 9000;
    expect(afterPayday - explanation.causes.reduce((s, c) => s + c.amount, 0)).toBe(valley.cash);
  });

  it("explains the December dip too (below the reserve, not negative)", () => {
    const explanation = explainValley(demo, projection, warnings[1]!);
    expect(explanation.lastInflow).toEqual({ date: "2026-12-15", name: "Sueldo", amount: 9000 });
    expect(explanation.nextInflow).toEqual({ date: "2026-12-31", name: "Sueldo", amount: 9000 });
    expect(explanation.shortfall).toBe(2792);
    expect(explanation.causes.map((c) => c.itemId)).toEqual(["fin-prestamo", "fin-nu", "fin-bbva", "fin-laptop-msi"]);
  });
});

describe("explainValley — hand-made documents", () => {
  it("keeps the 6 biggest outflows, and has no next inflow when the money never comes back", () => {
    const items: FinancialItem[] = [income("pay", 3000, { frequency: "once", startDate: "2026-11-10" })];
    for (let i = 1; i <= 8; i++) items.push(expense(`e${i}`, 100 * i, once(addDays("2026-11-10", i))));
    const d = doc(items, { initialCash: 1000 });
    const projection = projectFinancialDocument(d);
    const [warning] = findLiquidityWarnings(projection, d.minimumCashReserve);
    // 4 000 − (100 + … + 800) = 400; only the last expense crosses the reserve.
    expect(warning).toMatchObject({ startDate: "2026-11-18", date: "2026-11-18", cash: 400 });
    const explanation = explainValley(d, projection, warning!);
    expect(explanation.lastInflow).toEqual({ date: "2026-11-10", name: "pay", amount: 3000 });
    expect(explanation.nextInflow).toBeNull();
    expect(explanation.causes.map((c) => c.amount)).toEqual([800, 700, 600, 500, 400, 300]);
    expect(explanation.shortfall).toBe(roundTo2(d.minimumCashReserve - warning!.cash));
  });

  it("an episode opened by the initial cash has no inflow before it; ties keep chronological order", () => {
    const d = doc(
      [
        expense("a", 300, once("2026-11-08")),
        expense("b", 300, once("2026-11-09")),
        income("pay", 5000, { frequency: "once", startDate: "2026-11-20" }),
      ],
      { initialCash: 500 },
    );
    const projection = projectFinancialDocument(d);
    const [warning] = findLiquidityWarnings(projection, d.minimumCashReserve);
    expect(warning).toMatchObject({ startDate: START, date: "2026-11-09", cash: -100 });
    const explanation = explainValley(d, projection, warning!);
    expect(explanation.lastInflow).toBeNull();
    expect(explanation.causes.map((c) => c.itemId)).toEqual(["a", "b"]);
    expect(explanation.nextInflow).toEqual({ date: "2026-11-20", name: "pay", amount: 5000 });
    expect(explanation.shortfall).toBe(1100);
  });
});

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe("suggestValleyFixes — demo document", () => {
  const demo = createDemoFinancialDocument(START);
  const base = projectFinancialDocument(demo);
  const [valley] = findLiquidityWarnings(base, demo.minimumCashReserve);
  const all = suggestValleyFixes(demo, valley!, { limit: 10 });

  it("its best fix resolves the 27-nov valley, and the patch really removes the warning", () => {
    const best = all[0]!;
    expect(best).toMatchObject({
      id: "fin-prestamo:monthly:31",
      title: "Mover Préstamo personal al último día de cada mes",
      itemId: "fin-prestamo",
      outcome: "resolves",
      before: -1292,
    });
    expect(best.after).toBeGreaterThanOrEqual(demo.minimumCashReserve);
    const after = projectFinancialDocument(apply(demo, best));
    expect(warningsCovering(after, demo.minimumCashReserve, "2026-11-27")).toEqual([]);
    expect(minCashIn(after, addDays(valley!.startDate, -31), addDays(valley!.date, 31))).toBe(best.after);
    // The loan keeps its 6 payments (its debt), each on the last day of the month, right after payday.
    const dates = expandRecurrence(best.patch.recurrence, { from: START, to: "2027-12-31" });
    expect(dates).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(after.accounts.find((a) => a.id === "fin-prestamo")!.openingDebt).toBe(45000);
  });

  it("moving the one-off 'Pago Tarjeta Plata' to the next payday is suggested, with a short Spanish title", () => {
    const plata = all.find((f) => f.itemId === "fin-pago-plata")!;
    expect(plata).toMatchObject({
      id: "fin-pago-plata:move:2026-11-30",
      title: "Mover Pago Tarjeta Plata al 30 nov",
      outcome: "exits-red",
      before: -1292,
    });
    expect(plata.patch.recurrence).toEqual({ frequency: "once", startDate: "2026-11-30", endDate: "2026-11-30" });
    expect(plata.after).toBeGreaterThanOrEqual(0);
    expect(minCashIn(projectFinancialDocument(apply(demo, plata)), "2026-10-26", "2026-12-28")).toBe(plata.after);
  });

  it("offers Nu's minimum payment (it takes the valley out of the red)", () => {
    const nu = all.find((f) => f.itemId === "fin-nu")!;
    expect(nu).toMatchObject({ id: "fin-nu:minimum", title: "Pagar el mínimo de Nu ($1,500)", outcome: "exits-red" });
    expect((nu.patch as CreditCardItem).paymentAmount).toBe(1500);
    // BBVA already pays its minimum, MSI and installments have no rule.
    expect(all.some((f) => f.itemId === "fin-bbva" || f.itemId === "fin-laptop-msi")).toBe(false);
  });

  it("orders resolves > exits-red > improves, then by `after`; honours the limit", () => {
    const rank = { resolves: 0, "exits-red": 1, improves: 2 } as const;
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]!;
      const b = all[i]!;
      expect(rank[a.outcome] <= rank[b.outcome]).toBe(true);
      if (a.outcome === b.outcome) expect(a.after).toBeGreaterThanOrEqual(b.after);
    }
    expect(all.length).toBeGreaterThan(3);
    expect(suggestValleyFixes(demo, valley!)).toEqual(all.slice(0, 3));
    expect(suggestValleyFixes(demo, valley!, { limit: 1 })).toEqual(all.slice(0, 1));
    expect(suggestValleyFixes(demo, valley!, { limit: 0 })).toEqual([]);
  });

  it("never makes the overall minimum cash worse", () => {
    for (const fix of all) {
      expect(projectFinancialDocument(apply(demo, fix)).minimumCash.cash).toBeGreaterThanOrEqual(base.minimumCash.cash);
    }
  });

  it("does not mutate the document", () => {
    const fresh = createDemoFinancialDocument(START);
    suggestValleyFixes(demo, valley!);
    expect(demo).toEqual(fresh);
  });
});

describe("suggestValleyFixes — hand-made documents", () => {
  it("a monthly expense moves its day of month onto the payday, keeping every occurrence", () => {
    const d = doc(
      [
        income("Nómina", 5000, { frequency: "monthly", startDate: "2026-12-01" }),
        expense("rent", 2000, { frequency: "monthly", startDate: "2026-11-25", endDate: "2027-06-25" }, "Renta"),
      ],
      { initialCash: 1500 },
    );
    const [valley] = findLiquidityWarnings(projectFinancialDocument(d), d.minimumCashReserve);
    expect(valley).toMatchObject({ date: "2026-11-25", cash: -500 });
    const [fix] = suggestValleyFixes(d, valley!);
    expect(fix).toMatchObject({
      id: "rent:monthly:1",
      title: "Mover Renta al día 1 de cada mes",
      outcome: "resolves",
      before: -500,
      after: 1500,
    });
    const before = expandRecurrence(d.items[1]!.recurrence, { from: START, to: "2027-12-31" });
    const after = expandRecurrence(fix!.patch.recurrence, { from: START, to: "2027-12-31" });
    expect(after).toHaveLength(before.length);
    after.forEach((date, i) => {
      expect(date.slice(8)).toBe("01");
      expect(date > before[i]!).toBe(true);
    });
    // The end only moved because the last rent (25 jun) moves to 1 jul.
    expect(fix!.patch.recurrence.endDate).toBe("2027-07-01");
    expect(findLiquidityWarnings(projectFinancialDocument(apply(d, fix!)), d.minimumCashReserve)).toEqual([]);
  });

  it("titles carry the year only when it differs from the document's", () => {
    const d = doc(
      [
        income("aguinaldo", 8000, { frequency: "once", startDate: "2027-01-05" }),
        expense("viaje", 3000, once("2026-12-20"), "Viaje"),
      ],
      { initialCash: 2500 },
    );
    const [valley] = findLiquidityWarnings(projectFinancialDocument(d), d.minimumCashReserve);
    const [fix] = suggestValleyFixes(d, valley!);
    expect(fix).toMatchObject({ id: "viaje:move:2027-01-05", title: "Mover Viaje al 5 ene 2027", outcome: "resolves" });
  });

  it("drops a fix that lifts the valley but deepens a later one (overall minimum gets worse)", () => {
    const cardItem: CreditCardItem = {
      id: "card",
      kind: "credit-card",
      name: "Tarjeta",
      balance: 4000,
      annualRate: 60,
      cutDay: 10,
      dueDay: 20,
      minimumPayment: 500,
      paymentAmount: 4000,
      recurrence: { frequency: "monthly", startDate: "2027-01-01" },
    };
    const items: FinancialItem[] = [
      income("pay", 5000, { frequency: "monthly", startDate: "2027-02-01" }),
      cardItem,
    ];
    const d = doc(items, { startDate: "2027-01-01", initialCash: 3000 });
    const [valley] = findLiquidityWarnings(projectFinancialDocument(d), d.minimumCashReserve);
    expect(valley).toMatchObject({ date: "2027-01-20", itemId: "card", severity: "negative" });
    // Alone, paying the minimum resolves the January valley…
    expect(suggestValleyFixes(d, valley!)).toMatchObject([{ id: "card:minimum", outcome: "resolves" }]);

    // …but with a big September bill, the months of minimum payments leave less cash for it.
    const withBill = { ...d, items: [...items, expense("bill", 45000, once("2027-09-01"))] };
    const baseline = projectFinancialDocument(withBill);
    const [janValley] = findLiquidityWarnings(baseline, withBill.minimumCashReserve);
    expect(janValley!.date).toBe("2027-01-20");
    const minimumPlan = projectFinancialDocument({
      ...withBill,
      items: withBill.items.map((i) => (i.id === "card" ? { ...cardItem, paymentAmount: 500 } : i)),
    });
    expect(minimumPlan.minimumCash.cash).toBeLessThan(baseline.minimumCash.cash);
    expect(suggestValleyFixes(withBill, janValley!).some((f) => f.id === "card:minimum")).toBe(false);
  });

  it("statement-mode cards are never asked to pay the minimum; disabled / unknown causes get no fix", () => {
    const statementCard: CreditCardItem = {
      id: "card",
      kind: "credit-card",
      name: "Totalera",
      balance: 4000,
      annualRate: 60,
      cutDay: 10,
      dueDay: 20,
      minimumPayment: 500,
      paymentAmount: 4000,
      paymentMode: "statement",
      recurrence: { frequency: "monthly", startDate: START },
    };
    const d = doc([income("pay", 5000, { frequency: "monthly", startDate: "2026-12-01" }), statementCard], {
      initialCash: 3000,
    });
    const [valley] = findLiquidityWarnings(projectFinancialDocument(d), d.minimumCashReserve);
    expect(valley).toMatchObject({ itemId: "card", date: "2026-11-20" });
    expect(suggestValleyFixes(d, valley!)).toEqual([]);
  });

  it("'improves' when the window minimum only goes up; equal results prefer the smaller date shift", () => {
    const d = doc(
      [
        expense("a", 400, once("2026-11-10"), "A"),
        expense("b", 300, once("2026-11-12"), "B"),
        income("small", 200, { frequency: "once", startDate: "2026-11-20" }),
        income("big", 5000, { frequency: "once", startDate: "2026-12-20" }),
      ],
      { initialCash: 1200 },
    );
    const projection = projectFinancialDocument(d);
    const [valley] = findLiquidityWarnings(projection, d.minimumCashReserve);
    expect(valley).toMatchObject({ startDate: "2026-11-10", date: "2026-11-12", cash: 500, severity: "below-reserve" });
    expect(explainValley(d, projection, valley!).lastInflow).toBeNull();
    const fixes = suggestValleyFixes(d, valley!);
    // Either move leaves 700 at the small payday: better, still below the reserve, never red.
    expect(fixes.map((f) => [f.id, f.outcome, f.before, f.after])).toEqual([
      ["b:move:2026-11-20", "improves", 500, 700], // shifted 8 days
      ["a:move:2026-11-20", "improves", 500, 700], // shifted 10 days
    ]);
    for (const fix of fixes) {
      const after = projectFinancialDocument(apply(d, fix));
      expect(minCashIn(after, addDays(valley!.startDate, -31), addDays(valley!.date, 31))).toBe(fix.after);
      expect(fix.afterDate).toBe("2026-11-20");
    }
  });

  it("nothing to move without a later payday", () => {
    const noPayday = doc([expense("big", 3000, once("2026-11-10"))], { initialCash: 1500 });
    const [late] = findLiquidityWarnings(projectFinancialDocument(noPayday), noPayday.minimumCashReserve);
    expect(explainValley(noPayday, projectFinancialDocument(noPayday), late!).nextInflow).toBeNull();
    expect(suggestValleyFixes(noPayday, late!)).toEqual([]);
  });
});
