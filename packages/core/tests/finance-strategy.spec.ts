import { describe, expect, it } from "vitest";
import {
  addDays,
  cloneFinancialDocument,
  compareProjections,
  createDefaultFinancialItem,
  createDemoFinancialDocument,
  debtByAccountAt,
  diffDays,
  expandFinancialEvents,
  findLiquidityWarnings,
  itemCashDirection,
  monthlyInstallment,
  projectFinancialDocument,
  rankDebtsByAvalanche,
  remainingInstallmentDebt,
  snapshotAt,
  suggestAvalanchePayments,
  summarizeProjection,
} from "../src/finance";
import type {
  CreditCardItem,
  FinancialDocument,
  FinancialItem,
  FinancialItemKind,
  FinancialProjection,
  InstallmentPlanItem,
} from "../src/finance";

const REC = { frequency: "monthly" as const, startDate: "2026-11-01" };

function card(id: string, name: string, balance: number, annualRate: number, minimumPayment: number): CreditCardItem {
  return { id, kind: "credit-card", name, balance, annualRate, cutDay: 5, dueDay: 25, minimumPayment, recurrence: REC };
}

function makeDoc(items: FinancialItem[]): FinancialDocument {
  return { id: "d", name: "d", startDate: "2026-11-01", initialCash: 20000, minimumCashReserve: 5000, horizonMonths: 12, items };
}

describe("avalanche strategy", () => {
  it("ranks by annual rate desc (Nu 99.9 > Mercado Pago 63 > BBVA 39)", () => {
    const doc = makeDoc([
      card("bbva", "BBVA", 60000, 39, 2500),
      card("nu", "Nu", 30000, 99.9, 1500),
      card("empty", "Empty", 0, 120, 0),
      { ...card("off", "Off", 500, 200, 50), enabled: false },
      card("mp", "Mercado Pago", 10000, 63, 500),
      { id: "loan", kind: "loan", name: "Loan", paymentAmount: 1000, balance: 8000, annualRate: 20, recurrence: REC },
      {
        id: "msi",
        kind: "installment-plan",
        name: "MSI",
        originalAmount: 12000,
        installmentsTotal: 12,
        installmentsPaid: 2,
        recurrence: REC,
      },
    ]);
    const ranked = rankDebtsByAvalanche(doc);
    expect(ranked.map((d) => d.id)).toEqual(["nu", "mp", "bbva", "loan", "msi"]);
    expect(ranked[3]).toEqual({ id: "loan", name: "Loan", kind: "loan", annualRate: 20, balance: 8000, minimumPayment: 1000 });
    expect(ranked[4]).toEqual({
      id: "msi",
      name: "MSI",
      kind: "installment-plan",
      annualRate: 0,
      balance: 10000,
      minimumPayment: 1000,
    });
  });

  it("ties on rate break by smaller balance, then name", () => {
    const ranked = rankDebtsByAvalanche(
      makeDoc([card("b", "B", 500, 50, 0), card("a2", "Zeta", 100, 50, 0), card("a1", "Alfa", 100, 50, 0)]),
    );
    expect(ranked.map((d) => d.id)).toEqual(["a1", "a2", "b"]);
  });

  it("suggestAvalanchePayments keeps the reserve, pays minimums, pours the rest in order", () => {
    const debts = rankDebtsByAvalanche(
      makeDoc([card("nu", "Nu", 2000, 99.9, 1500), card("mp", "MP", 1000, 63, 500), card("bbva", "BBVA", 60000, 39, 2500)]),
    );
    const plan = suggestAvalanchePayments({ debts, availableCash: 20000, minimumCashReserve: 5000 });
    // 20000 − 5000 − (1500 + 500 + 2500) = 10500 extra.
    expect(plan.availableForExtra).toBe(10500);
    expect(plan.allocations).toEqual([
      { id: "nu", name: "Nu", minimum: 1500, extra: 500, total: 2000 },
      { id: "mp", name: "MP", minimum: 500, extra: 500, total: 1000 },
      { id: "bbva", name: "BBVA", minimum: 2500, extra: 9500, total: 12000 },
    ]);

    const tight = suggestAvalanchePayments({ debts, availableCash: 8000, minimumCashReserve: 5000 });
    expect(tight.availableForExtra).toBe(0);
    expect(tight.allocations.map((a) => a.total)).toEqual([1500, 500, 2500]);
  });

  it("minimums are capped at the balance", () => {
    const plan = suggestAvalanchePayments({
      debts: [{ id: "x", name: "x", kind: "credit-card", annualRate: 10, balance: 300, minimumPayment: 1000 }],
      availableCash: 10000,
      minimumCashReserve: 0,
    });
    expect(plan).toEqual({ availableForExtra: 9700, allocations: [{ id: "x", name: "x", minimum: 300, extra: 0, total: 300 }] });
  });
});

describe("scenarios", () => {
  it("cloneFinancialDocument deep-copies and applies overrides", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const copy = cloneFinancialDocument(doc, { id: "alt", name: "Alterno" });
    expect(copy.id).toBe("alt");
    expect(copy.name).toBe("Alterno");
    expect(copy.items).toEqual(doc.items);
    expect(copy.items).not.toBe(doc.items);
    (copy.items[0] as { amount: number }).amount = 1;
    copy.items[0]!.recurrence.startDate = "2030-01-01";
    expect((doc.items[0] as { amount: number }).amount).toBe(9000);
    expect(doc.items[0]!.recurrence.startDate).toBe("2026-11-07");
    expect(cloneFinancialDocument(doc).id).toBe("demo");
  });

  it("compareProjections reports scenario − base deltas", () => {
    const base = createDemoFinancialDocument("2026-11-07");
    const alt = cloneFinancialDocument(base, { id: "alt" });
    alt.items.push({
      id: "trip",
      kind: "expense",
      name: "Viaje",
      amount: 4000,
      recurrence: { frequency: "once", startDate: "2026-12-20", endDate: "2026-12-20" },
    });
    const pb = projectFinancialDocument(base);
    const ps = projectFinancialDocument(alt);
    const cmp = compareProjections(pb, ps);
    expect(cmp.base).toEqual(summarizeProjection(pb));
    expect(cmp.scenario).toEqual(summarizeProjection(ps));
    expect(cmp.finalCashDelta).toBe(-4000);
    expect(cmp.finalDebtDelta).toBe(0);
    expect(cmp.minimumCashDelta).toBeLessThanOrEqual(0);
  });
});

describe("items helpers", () => {
  it("MSI maths", () => {
    const plan: InstallmentPlanItem = {
      id: "p",
      kind: "installment-plan",
      name: "p",
      originalAmount: 1000,
      installmentsTotal: 3,
      installmentsPaid: 1,
      recurrence: REC,
    };
    expect(monthlyInstallment(plan)).toBe(333.33);
    // 1000 − 333.33: the last installment absorbs the cent (333.34).
    expect(remainingInstallmentDebt(plan)).toBe(666.67);
    expect(remainingInstallmentDebt({ ...plan, installmentsPaid: 5 })).toBe(0);
    expect(monthlyInstallment({ ...plan, installmentsTotal: 0 })).toBe(0);
  });

  it("createDefaultFinancialItem gives sensible defaults per kind", () => {
    const doc = makeDoc([card("c1", "C1", 0, 10, 0)]);
    const kinds: FinancialItemKind[] = ["income", "expense", "loan", "credit-card", "card-purchase", "installment-plan"];
    for (const kind of kinds) {
      const item = createDefaultFinancialItem(kind, `new-${kind}`, "2026-11-21", doc);
      expect(item.kind).toBe(kind);
      expect(item.id).toBe(`new-${kind}`);
      expect(item.recurrence.startDate).toBe("2026-11-21");
    }
    expect(createDefaultFinancialItem("income", "i", "2026-11-21")).toMatchObject({ amount: 1000, recurrence: { frequency: "monthly" } });
    expect(createDefaultFinancialItem("expense", "e", "2026-11-21")).toMatchObject({ amount: 500, recurrence: { frequency: "once" } });
    expect(createDefaultFinancialItem("loan", "l", "2026-11-21")).toMatchObject({
      paymentAmount: 1000,
      recurrence: { frequency: "monthly", endDate: "2027-11-21" },
    });
    expect(createDefaultFinancialItem("credit-card", "c", "2026-11-21")).toMatchObject({
      balance: 0,
      annualRate: 60,
      cutDay: 21,
      dueDay: 3,
      minimumPayment: 0,
    });
    expect(createDefaultFinancialItem("credit-card", "c", "2026-11-05")).toMatchObject({ cutDay: 5, dueDay: 15 });
    expect(createDefaultFinancialItem("card-purchase", "b", "2026-11-21", doc)).toMatchObject({ cardId: "c1", amount: 1000 });
    expect(createDefaultFinancialItem("card-purchase", "b", "2026-11-21")).toMatchObject({ cardId: "" });
    expect(createDefaultFinancialItem("installment-plan", "m", "2026-11-21", doc)).toMatchObject({
      cardId: "c1",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
    });
    expect("cardId" in createDefaultFinancialItem("installment-plan", "m", "2026-11-21")).toBe(false);
  });

  it("itemCashDirection", () => {
    expect(itemCashDirection("income")).toBe(1);
    expect(itemCashDirection("expense")).toBe(-1);
    expect(itemCashDirection("loan")).toBe(-1);
    expect(itemCashDirection("installment-plan")).toBe(-1);
    expect(itemCashDirection("credit-card")).toBe(-1);
    expect(itemCashDirection("card-purchase")).toBe(0);
  });
});

/** Days (inside the range) whose end-of-day cash is negative. */
function negativeDays(p: FinancialProjection): number {
  let days = 0;
  let cash = p.initialCash;
  let since = p.startDate;
  for (const point of p.points) {
    if (point.date !== since) {
      if (cash < 0) days += diffDays(since, point.date);
      since = point.date;
    }
    cash = point.cashAfter;
  }
  if (cash < 0) days += diffDays(since, p.endDate) + 1;
  return days;
}

describe("demo document", () => {
  it("has the expected shape", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    expect(doc).toMatchObject({
      id: "demo",
      name: "Mi escenario",
      startDate: "2026-11-07",
      initialCash: 12000,
      minimumCashReserve: 5000,
      horizonMonths: 12,
    });
    expect(doc.items.map((i) => i.id)).toEqual([
      "fin-sueldo",
      "fin-pago-plata",
      "fin-gasto",
      "fin-prestamo",
      "fin-nu",
      "fin-bbva",
      "fin-laptop-msi",
    ]);
    const msi = doc.items.find((i) => i.kind === "installment-plan") as InstallmentPlanItem;
    expect(msi.cardId).toBe("fin-bbva");
    expect(createDemoFinancialDocument("2026-11-07")).toEqual(doc);
    const ids = expandFinancialEvents(doc).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dips below the reserve within 2 months but is not negative for most of the year (today)", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const p = projectFinancialDocument(doc);
    const warnings = findLiquidityWarnings(p, doc.minimumCashReserve);
    expect(warnings.length).toBeGreaterThan(0);
    expect(diffDays(doc.startDate, warnings[0]!.startDate)).toBeLessThanOrEqual(60);
    const total = diffDays(p.startDate, p.endDate) + 1;
    expect(negativeDays(p)).toBeLessThan(total / 2);
    expect(p.finalCash).toBeGreaterThan(doc.initialCash);
    expect(p.finalDebt).toBeLessThan(p.initialDebt);
  });

  it("stays mostly non-negative for any start date of the year", () => {
    let dipsEarly = 0;
    for (let i = 0; i < 365; i++) {
      const doc = createDemoFinancialDocument(addDays("2026-01-01", i));
      const p = projectFinancialDocument(doc);
      const total = diffDays(p.startDate, p.endDate) + 1;
      expect(negativeDays(p)).toBeLessThan(total * 0.1);
      expect(p.finalCash).toBeGreaterThan(0);
      const w = findLiquidityWarnings(p, doc.minimumCashReserve);
      if (w.length > 0 && diffDays(doc.startDate, w[0]!.startDate) <= 60) dipsEarly++;
    }
    // Starts on the 28th–31st clear the reserve by a hair (cash 5 708).
    expect(dipsEarly).toBeGreaterThan(365 * 0.75);
  });
});

describe("regressions (engine review)", () => {
  /** What the debt panel does: balances and cash read at the same date. */
  function planAt(doc: FinancialDocument, date: string) {
    const p = projectFinancialDocument(doc);
    const debts = rankDebtsByAvalanche(doc, debtByAccountAt(p, date));
    const cash = snapshotAt(p, date).cash;
    return { p, debts, plan: suggestAvalanchePayments({ debts, availableCash: cash, minimumCashReserve: doc.minimumCashReserve }) };
  }

  it("fincore-3 (A): a settled MSI is not ranked nor paid at a later date", () => {
    const doc: FinancialDocument = {
      ...makeDoc([
        {
          id: "msi",
          kind: "installment-plan",
          name: "MSI",
          originalAmount: 6000,
          installmentsTotal: 6,
          installmentsPaid: 0,
          recurrence: { frequency: "monthly", startDate: "2026-11-01" },
        },
      ]),
      initialCash: 50000,
    };
    const { p, debts, plan } = planAt(doc, "2027-08-01");
    expect(snapshotAt(p, "2027-08-01")).toMatchObject({ cash: 44000, debt: 0 });
    expect(debts).toEqual([]);
    expect(plan).toEqual({ availableForExtra: 39000, allocations: [] });
    // Opening balances (no `balances`) still rank it at the document start.
    expect(rankDebtsByAvalanche(doc).map((d) => [d.id, d.balance])).toEqual([["msi", 6000]]);
  });

  it("fincore-3 (B): card debt that comes only from purchases is ranked; unknown cards are skipped", () => {
    const c = { ...createDefaultFinancialItem("credit-card", "c", "2026-11-01"), minimumPayment: 500 } as FinancialItem;
    const doc = makeDoc([
      c,
      { id: "buy", kind: "card-purchase", name: "buy", cardId: "c", amount: 20000, recurrence: { frequency: "once", startDate: "2026-11-01" } },
      { id: "lost", kind: "card-purchase", name: "lost", cardId: "ghost", amount: 300, recurrence: { frequency: "once", startDate: "2026-11-01" } },
    ]);
    const p = projectFinancialDocument(doc);
    const balances = debtByAccountAt(p, "2026-11-01");
    expect(balances.get("ghost")).toBe(300);
    expect(snapshotAt(p, "2026-11-01").debt).toBe(20300);
    expect(rankDebtsByAvalanche(doc, balances)).toEqual([
      { id: "c", name: "Tarjeta", kind: "credit-card", annualRate: 60, balance: 20000, minimumPayment: 500 },
    ]);
    // A missing id counts as 0.
    expect(rankDebtsByAvalanche(doc, new Map())).toEqual([]);
  });

  it("react-5 (engine): demo at 2027-07-15 ranks the balances owed that day", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const date = "2027-07-15";
    const { p, debts, plan } = planAt(doc, date);
    // The loan was settled on 2027-04-15; 1 of the MSI installments is left.
    expect(debts.map((d) => d.id)).toEqual(["fin-nu", "fin-bbva", "fin-laptop-msi"]);
    expect(debts.find((d) => d.id === "fin-laptop-msi")!.balance).toBe(1500);
    let sum = 0;
    for (const d of debts) sum += d.balance;
    expect(Math.round(sum * 100) / 100).toBe(snapshotAt(p, date).debt);
    // No minimum of the finished loan is taken out of the extra.
    const cash = snapshotAt(p, date).cash;
    expect(plan.availableForExtra).toBe(Math.round((cash - 5000 - 1500 - 2500 - 1500) * 100) / 100);
    // Nu extra is capped at its balance on that date, not at its opening balance.
    const nu = plan.allocations[0]!;
    expect(nu.total).toBe(debts[0]!.balance);
    expect(nu.total).toBeLessThan(30069);
  });

  it("fincore-2: a future MSI is not ranked at the document start", () => {
    const doc = makeDoc([createDefaultFinancialItem("installment-plan", "msi", "2027-03-01")]);
    expect(rankDebtsByAvalanche(doc)).toEqual([]);
    const p = projectFinancialDocument(doc);
    expect(rankDebtsByAvalanche(doc, debtByAccountAt(p, "2027-02-28"))).toEqual([]);
    expect(rankDebtsByAvalanche(doc, debtByAccountAt(p, "2027-03-01")).map((d) => [d.id, d.balance])).toEqual([
      ["msi", 5000],
    ]);
  });

  it("fincore-7: remaining MSI debt is originalAmount minus the paid installments", () => {
    const plan: InstallmentPlanItem = {
      id: "p",
      kind: "installment-plan",
      name: "p",
      originalAmount: 999.99,
      installmentsTotal: 24,
      installmentsPaid: 0,
      recurrence: REC,
    };
    expect(monthlyInstallment(plan)).toBe(41.67);
    expect(remainingInstallmentDebt(plan)).toBe(999.99);
    expect(remainingInstallmentDebt({ ...plan, installmentsPaid: 23 })).toBe(41.58);
    expect(remainingInstallmentDebt({ ...plan, originalAmount: 10000, installmentsTotal: 3 })).toBe(10000);
  });
});
