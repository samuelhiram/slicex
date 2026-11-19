import { describe, expect, it } from "vitest";
import {
  applyMovementEffect,
  createDemoFinancialDocument,
  EMPTY_MOVEMENT_EFFECT,
  filterMovements,
  invertMovementEffect,
  isEmptyMovementEffect,
  movementChangeEffect,
  movementEffect,
  quickCategories,
  summarizeMovements,
  totalsByCategory,
  usedCategories,
  type FinancialDocument,
  type Movement,
} from "../src";

const TODAY = "2026-11-18";

function doc(): FinancialDocument {
  return {
    id: "d",
    name: "d",
    startDate: TODAY,
    initialCash: 8000,
    minimumCashReserve: 0,
    horizonMonths: 12,
    items: [
      {
        id: "nu",
        kind: "credit-card",
        name: "Nu",
        balance: 3000,
        annualRate: 60,
        cutDay: 5,
        dueDay: 15,
        minimumPayment: 300,
        recurrence: { frequency: "monthly", startDate: TODAY },
      },
    ],
  };
}

function mov(partial: Partial<Movement> & Pick<Movement, "id">): Movement {
  return { kind: "expense", amount: 100, date: TODAY, concept: "Algo", ...partial };
}

describe("movement effects", () => {
  it("an expense leaves cash, an income adds it, a card takes the debt instead", () => {
    expect(movementEffect(mov({ id: "a", amount: 500 }))).toEqual({ cash: -500, debts: [] });
    expect(movementEffect(mov({ id: "b", kind: "income", amount: 1200 }))).toEqual({ cash: 1200, debts: [] });
    expect(movementEffect(mov({ id: "c", amount: 250, cardId: "nu" }))).toEqual({
      cash: 0,
      debts: [{ accountId: "nu", amount: 250 }],
    });
    // A refund to the card lowers its debt.
    expect(movementEffect(mov({ id: "d", kind: "income", amount: 80, cardId: "nu" }))).toEqual({
      cash: 0,
      debts: [{ accountId: "nu", amount: -80 }],
    });
    expect(movementEffect(mov({ id: "z", amount: 0 }))).toBe(EMPTY_MOVEMENT_EFFECT);
  });

  it("a change books the difference: record, edit, move to a card, delete", () => {
    const cash = mov({ id: "a", amount: 500 });
    expect(movementChangeEffect(null, cash)).toEqual({ cash: -500, debts: [] });
    expect(movementChangeEffect(cash, { ...cash, amount: 450 })).toEqual({ cash: 50, debts: [] });
    expect(movementChangeEffect(cash, { ...cash, cardId: "nu" })).toEqual({
      cash: 500,
      debts: [{ accountId: "nu", amount: 500 }],
    });
    expect(movementChangeEffect(cash, null)).toEqual({ cash: 500, debts: [] });
    // Same effect (only the concept changed): nothing to book.
    expect(isEmptyMovementEffect(movementChangeEffect(cash, { ...cash, concept: "Otro" }))).toBe(true);
    const effect = movementChangeEffect(null, mov({ id: "c", amount: 70, cardId: "nu" }));
    expect(invertMovementEffect(effect)).toEqual({ cash: 0, debts: [{ accountId: "nu", amount: -70 }] });
  });

  it("is booked on today's cash and the card's balance, never below 0, same doc when nothing moves", () => {
    const base = doc();
    const after = applyMovementEffect(base, { cash: -500.25, debts: [{ accountId: "nu", amount: 250 }] });
    expect(after.initialCash).toBe(7499.75);
    expect(after.items[0]).toMatchObject({ balance: 3250 });
    expect(base.initialCash).toBe(8000);
    const refunded = applyMovementEffect(base, { cash: 0, debts: [{ accountId: "nu", amount: -9999 }] });
    expect(refunded.items[0]).toMatchObject({ balance: 0 });
    expect(applyMovementEffect(base, EMPTY_MOVEMENT_EFFECT)).toBe(base);
    // A card the plan doesn't have: skipped.
    expect(applyMovementEffect(base, { cash: 0, debts: [{ accountId: "otra", amount: 10 }] })).toBe(base);
    // Cash can go negative (an overdraft).
    expect(applyMovementEffect(base, { cash: -9000, debts: [] }).initialCash).toBe(-1000);
  });

  it("works on the demo plan without touching other items", () => {
    const demo = createDemoFinancialDocument(TODAY);
    const after = applyMovementEffect(demo, { cash: -100, debts: [] });
    expect(after.items).toBe(demo.items);
    expect(after.initialCash).toBe(demo.initialCash - 100);
  });
});

describe("searching the journal", () => {
  const journal: Movement[] = [
    mov({ id: "1", date: "2026-11-01", time: "09:00", concept: "Café Oxxo", category: "Comida", amount: 45 }),
    mov({ id: "2", date: "2026-11-15", time: "18:30", concept: "Gasolina", category: "Gasolina", amount: 800, cardId: "nu" }),
    mov({ id: "3", date: "2026-11-15", time: "08:10", concept: "Mandado Soriana", category: "Mandado", amount: 1250.5, notes: "Ticket en la guantera" }),
    mov({ id: "4", kind: "income", date: "2026-11-10", concept: "Venta bici", category: "Venta", amount: 2000 }),
    mov({ id: "5", date: "2026-11-15", concept: "Propina", amount: 20 }),
  ];

  it("lists newest first: by date, then time (no time last), then recorded later", () => {
    expect(filterMovements(journal).map((m) => m.id)).toEqual(["2", "3", "5", "4", "1"]);
    const sameMoment = [mov({ id: "x", time: "10:00" }), mov({ id: "y", time: "10:00" })];
    expect(filterMovements(sameMoment).map((m) => m.id)).toEqual(["y", "x"]);
  });

  it("finds words without caring about accents or case, in concept, category, notes and amount", () => {
    expect(filterMovements(journal, { query: "cafe" }).map((m) => m.id)).toEqual(["1"]);
    expect(filterMovements(journal, { query: "GUANTERA" }).map((m) => m.id)).toEqual(["3"]);
    expect(filterMovements(journal, { query: "mandado 1250" }).map((m) => m.id)).toEqual(["3"]);
    expect(filterMovements(journal, { query: "$1,250.50" }).map((m) => m.id)).toEqual(["3"]);
    expect(filterMovements(journal, { query: "800" }).map((m) => m.id)).toEqual(["2"]);
    expect(filterMovements(journal, { query: "nada" })).toEqual([]);
  });

  it("filters by kind, dates, category and how it was paid", () => {
    expect(filterMovements(journal, { kind: "income" }).map((m) => m.id)).toEqual(["4"]);
    expect(filterMovements(journal, { from: "2026-11-10", to: "2026-11-14" }).map((m) => m.id)).toEqual(["4"]);
    expect(filterMovements(journal, { category: "mandado" }).map((m) => m.id)).toEqual(["3"]);
    expect(filterMovements(journal, { paidWith: "nu" }).map((m) => m.id)).toEqual(["2"]);
    expect(filterMovements(journal, { paidWith: "cash" }).map((m) => m.id)).toEqual(["3", "5", "4", "1"]);
  });

  it("totals what is shown and per category", () => {
    expect(summarizeMovements(journal)).toEqual({ count: 5, expenses: 2115.5, income: 2000, net: -115.5 });
    const groups = totalsByCategory(journal.filter((m) => m.kind === "expense"));
    expect(groups.map((g) => [g.category, g.total])).toEqual([
      ["Mandado", 1250.5],
      ["Gasolina", 800],
      ["Comida", 45],
      ["Sin categoría", 20],
    ]);
    expect(usedCategories(journal)).toEqual(["Comida", "Gasolina", "Mandado", "Venta"]);
  });

  it("offers the quick selectors most used first, the person's own ones too", () => {
    expect(quickCategories([], "expense", 4)).toEqual(["Mandado", "Comida", "Gasolina", "Transporte"]);
    const used = [
      mov({ id: "a", category: "Gasolina" }),
      mov({ id: "b", category: "gasolina" }),
      mov({ id: "c", category: "Tacos" }),
      mov({ id: "d", category: "Comida" }),
    ];
    expect(quickCategories(used, "expense", 5)).toEqual(["Gasolina", "Comida", "Tacos", "Mandado", "Transporte"]);
    expect(quickCategories(used, "income", 2)).toEqual(["Venta", "Cobro"]);
  });
});
