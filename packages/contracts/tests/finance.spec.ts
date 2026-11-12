// The shared schemas of the financial model: what they accept, what they
// reject, and that each error lands on the field it is about.
import { describe, expect, it } from "vitest";
import {
  FinancialDocumentSchema,
  FinancialItemSchemaStrict,
  FinancialRecurrenceSchema,
  ISODateSchema,
  MoneySchema,
  SignedMoneySchema,
} from "../src/index";

const monthly = { frequency: "monthly", startDate: "2026-11-20" } as const;

function issues(value: unknown): Record<string, string> {
  const result = FinancialItemSchemaStrict.safeParse(value);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("ISODateSchema", () => {
  it("real calendar dates only", () => {
    expect(ISODateSchema.safeParse("2026-11-20").success).toBe(true);
    expect(ISODateSchema.safeParse("2027-02-29").success).toBe(false);
    expect(ISODateSchema.safeParse("20/11/2026").success).toBe(false);
    expect(ISODateSchema.safeParse("").success).toBe(false);
  });
});

describe("MoneySchema / SignedMoneySchema", () => {
  it("money is >= 0; a balance may be negative; neither takes NaN", () => {
    expect(MoneySchema.safeParse(0).success).toBe(true);
    expect(MoneySchema.safeParse(-1).error?.issues[0]!.message).toBe("No puede ser negativo");
    expect(SignedMoneySchema.safeParse(-1500).success).toBe(true);
    expect(SignedMoneySchema.safeParse(Number.NaN).error?.issues[0]!.message).toBe("Escribe un número");
    expect(SignedMoneySchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe("FinancialRecurrenceSchema", () => {
  it("cada N (interval) and end >= start", () => {
    expect(FinancialRecurrenceSchema.safeParse({ ...monthly, interval: 6 }).success).toBe(true);
    const zero = FinancialRecurrenceSchema.safeParse({ ...monthly, interval: 0 });
    expect(zero.success).toBe(false);
    const backwards = FinancialRecurrenceSchema.safeParse({ ...monthly, endDate: "2026-11-01" });
    expect(backwards.success).toBe(false);
    if (!backwards.success) {
      expect(backwards.error.issues[0]!.path).toEqual(["endDate"]);
      expect(backwards.error.issues[0]!.message).toBe("No puede ser antes de que empiece");
    }
  });
});

describe("FinancialItemSchemaStrict", () => {
  it("accepts every kind of the model", () => {
    const ok = [
      { id: "a", kind: "income", name: "Sueldo", amount: 9000, recurrence: monthly },
      { id: "b", kind: "expense", name: "Renta", amount: 8000, recurrence: monthly },
      { id: "c", kind: "loan", name: "Préstamo", paymentAmount: 7500, balance: 45000, recurrence: monthly },
      {
        id: "d",
        kind: "credit-card",
        name: "Nu",
        balance: 30000,
        annualRate: 99.9,
        cutDay: 5,
        dueDay: 25,
        minimumPayment: 1500,
        recurrence: { frequency: "monthly", startDate: "2026-11-25" },
      },
      { id: "e", kind: "card-purchase", name: "Laptop", cardId: "d", amount: 18000, recurrence: monthly },
      {
        id: "f",
        kind: "installment-plan",
        name: "MSI",
        originalAmount: 18000,
        installmentsTotal: 12,
        installmentsPaid: 3,
        recurrence: monthly,
      },
    ];
    for (const item of ok) expect(issues(item), item.kind).toEqual({});
  });

  it("each error lands on its field, in Spanish", () => {
    expect(issues({ id: "a", kind: "income", name: "S", amount: -1, recurrence: monthly })).toEqual({
      amount: "No puede ser negativo",
    });
    expect(issues({ id: "a", kind: "income", name: "S", amount: Number.NaN, recurrence: monthly })).toEqual({
      amount: "Escribe un número",
    });
    expect(
      issues({
        id: "d",
        kind: "credit-card",
        name: "Nu",
        balance: 0,
        annualRate: 0,
        cutDay: 32,
        dueDay: 0,
        minimumPayment: 0,
        recurrence: monthly,
      }),
    ).toEqual({ cutDay: "Debe ser un día entre 1 y 31", dueDay: "Debe ser un día entre 1 y 31" });
    expect(
      issues({
        id: "f",
        kind: "installment-plan",
        name: "MSI",
        originalAmount: 1,
        installmentsTotal: 3,
        installmentsPaid: 4,
        recurrence: monthly,
      }),
    ).toEqual({ installmentsPaid: "No puede ser mayor que Meses" });
    expect(issues({ id: "a", kind: "income", name: "S", amount: 1, recurrence: { ...monthly, startDate: "2026-13-01" } })).toEqual({
      "recurrence.startDate": "Fecha inválida",
    });
  });

  it("strips keys the kind does not have (e.g. left over from a kind switch)", () => {
    const result = FinancialItemSchemaStrict.safeParse({
      id: "a",
      kind: "income",
      name: "S",
      amount: 1,
      cutDay: 5,
      recurrence: monthly,
    });
    expect(result.success && "cutDay" in result.data).toBe(false);
  });
});

describe("FinancialDocumentSchema", () => {
  it("the document's own fields (items are validated one by one by the reader)", () => {
    const doc = {
      id: "plan",
      name: "Mi año",
      startDate: "2026-11-09",
      initialCash: -500,
      minimumCashReserve: 5000,
      horizonMonths: 12,
      items: [],
    };
    expect(FinancialDocumentSchema.safeParse(doc).success).toBe(true);
    expect(FinancialDocumentSchema.safeParse({ ...doc, horizonMonths: 0 }).success).toBe(false);
    expect(FinancialDocumentSchema.safeParse({ ...doc, minimumCashReserve: -1 }).success).toBe(false);
  });
});
