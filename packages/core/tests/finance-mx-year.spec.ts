import { describe, expect, it } from "vitest";
import { createDemoFinancialDocument, getProjectionRange, suggestMexicanYear } from "../src/finance";
import type { FinancialDocument, FinancialItem, ISODate, RecurrenceFrequency } from "../src/finance";

function makeDoc(items: FinancialItem[], startDate: ISODate = "2026-11-07", horizonMonths = 12): FinancialDocument {
  return { id: "d", name: "t", startDate, initialCash: 0, minimumCashReserve: 0, horizonMonths, items };
}

function income(id: string, amount: number, frequency: RecurrenceFrequency, extra: Partial<FinancialItem> = {}): FinancialItem {
  return {
    id,
    kind: "income",
    name: id,
    amount,
    recurrence: { frequency, startDate: "2026-01-01" },
    ...extra,
  } as FinancialItem;
}

function expense(id: string, name: string): FinancialItem {
  return { id, kind: "expense", name, amount: 1, recurrence: { frequency: "once", startDate: "2026-11-08", endDate: "2026-11-08" } };
}

const dateOf = (s: { item: FinancialItem }) => s.item.recurrence.startDate;

function amountOf(suggestions: ReturnType<typeof suggestMexicanYear>, slug: string): number | undefined {
  const s = suggestions.find((x) => x.id.startsWith(`sug-${slug}-`));
  return s && (s.item.kind === "income" || s.item.kind === "expense") ? s.item.amount : undefined;
}

describe("suggestMexicanYear", () => {
  it("suggests the Mexican year for the demo, sorted by date", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const suggestions = suggestMexicanYear(doc);
    expect(suggestions.map((s) => [s.id, dateOf(s), s.category])).toEqual([
      ["sug-buen-fin-2026", "2026-11-13", "expense"],
      ["sug-regalos-navidad-2026", "2026-12-15", "expense"],
      ["sug-aguinaldo-2026", "2026-12-20", "income"],
      ["sug-predial-2027", "2027-01-31", "expense"],
      ["sug-regreso-a-clases-2027", "2027-08-15", "expense"],
    ]);
    const aguinaldo = suggestions.find((s) => s.id === "sug-aguinaldo-2026")!;
    // 9 000 every quincena = 18 000 / month → 15 days = 9 000.
    expect(aguinaldo.item).toEqual({
      id: "sug-aguinaldo-2026",
      kind: "income",
      name: "Aguinaldo",
      amount: 9000,
      recurrence: { frequency: "once", startDate: "2026-12-20", endDate: "2026-12-20" },
    });
    expect(aguinaldo.title).toBe("Aguinaldo");
    expect(aguinaldo.why).toBe("Por ley, al menos 15 días de sueldo antes del 20 de diciembre");
    expect(amountOf(suggestions, "buen-fin")).toBe(1800); // 10 % of 18 000, to the 50
    expect(amountOf(suggestions, "regalos-navidad")).toBe(1800); // 20 % of the aguinaldo
    expect(amountOf(suggestions, "predial")).toBe(1500);
    expect(amountOf(suggestions, "regreso-a-clases")).toBe(4000);

    const range = getProjectionRange(doc);
    for (const s of suggestions) {
      expect(s.item.id).toBe(s.id);
      expect(s.item.name).toBe(s.title);
      expect(s.item.kind).toBe(s.category);
      expect(s.item.recurrence.endDate).toBe(dateOf(s));
      expect(dateOf(s) >= range.from && dateOf(s) <= range.to).toBe(true);
      expect(s.why.length).toBeGreaterThan(0);
    }
  });

  it("picks the main salary by monthly equivalent (enabled, recurring, not ended)", () => {
    const pick = (items: FinancialItem[]) => amountOf(suggestMexicanYear(makeDoc(items)), "aguinaldo");
    // weekly 3 000 → 13 000 / month beats monthly 12 000.
    expect(pick([income("a", 12000, "monthly"), income("b", 3000, "weekly")])).toBe(6500);
    // biweekly 7 000 → 15 166.67 / month → 7 583.
    expect(pick([income("a", 7000, "biweekly")])).toBe(7583);
    // A disabled, a one-off and an ended income are not the salary.
    expect(
      pick([
        income("a", 10000, "monthly"),
        income("muted", 99999, "monthly", { enabled: false }),
        income("bonus", 99999, "once"),
        income("old", 99999, "monthly", { recurrence: { frequency: "monthly", startDate: "2025-01-01", endDate: "2026-06-30" } }),
      ]),
    ).toBe(5000);
  });

  it("without a salary: no aguinaldo, expenses with their placeholders", () => {
    const suggestions = suggestMexicanYear(makeDoc([expense("rent", "Renta")]));
    expect(suggestions.map((s) => s.id)).toEqual([
      "sug-buen-fin-2026",
      "sug-regalos-navidad-2026",
      "sug-predial-2027",
      "sug-regreso-a-clases-2027",
    ]);
    expect(amountOf(suggestions, "buen-fin")).toBe(2000);
    expect(amountOf(suggestions, "regalos-navidad")).toBe(3000);
    expect(suggestions.every((s) => s.category === "expense")).toBe(true);
  });

  it("skips what the plan already has (name keyword, case / accent-insensitive, or same id)", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    doc.items.push(
      income("x1", 1, "once", { name: "AGUINALDO dic" }),
      expense("x2", "Prédial municipal"),
      expense("x3", "Útiles ESCOLARES"),
      expense("sug-buen-fin-2026", "Ofertas"),
    );
    expect(suggestMexicanYear(doc).map((s) => s.id)).toEqual(["sug-regalos-navidad-2026"]);
    // The aguinaldo amount still drives the Christmas budget.
    expect(amountOf(suggestMexicanYear(doc), "regalos-navidad")).toBe(1800);
  });

  it("only suggests dates inside the projection range (next occurrence)", () => {
    const salary = income("s", 20000, "monthly");
    // [2027-01-15, 2027-04-15]: only the predial.
    expect(suggestMexicanYear(makeDoc([salary], "2027-01-15", 3)).map((s) => s.id)).toEqual(["sug-predial-2027"]);
    // Start on Dec 20 (inclusive) and a range that reaches the next one: the next is this year's.
    const dec20 = suggestMexicanYear(makeDoc([salary], "2026-12-20", 12));
    expect(dec20.find((s) => s.id.startsWith("sug-aguinaldo"))!.id).toBe("sug-aguinaldo-2026");
    // Start the day after: next year's, still in range.
    const dec21 = suggestMexicanYear(makeDoc([salary], "2026-12-21", 12));
    expect(dec21.map((s) => [s.id, dateOf(s)])).toEqual([
      ["sug-predial-2027", "2027-01-31"],
      ["sug-regreso-a-clases-2027", "2027-08-15"],
      ["sug-buen-fin-2027", "2027-11-12"],
      ["sug-regalos-navidad-2027", "2027-12-15"],
      ["sug-aguinaldo-2027", "2027-12-20"],
    ]);
    expect(suggestMexicanYear({ ...makeDoc([salary]), startDate: "bad" })).toEqual([]);
  });

  it("Buen Fin falls on the Friday before the third Monday of November", () => {
    const fridays: [number, ISODate][] = [
      [2023, "2023-11-17"],
      [2024, "2024-11-15"],
      [2025, "2025-11-14"],
      [2026, "2026-11-13"],
      [2027, "2027-11-12"],
      [2030, "2030-11-15"],
    ];
    for (const [year, friday] of fridays) {
      const s = suggestMexicanYear(makeDoc([], `${year}-11-01`, 1)).find((x) => x.id === `sug-buen-fin-${year}`);
      expect([year, s && dateOf(s)]).toEqual([year, friday]);
    }
    // A tiny salary still budgets at least 50.
    expect(amountOf(suggestMexicanYear(makeDoc([income("s", 100, "monthly")])), "buen-fin")).toBe(50);
  });
});
