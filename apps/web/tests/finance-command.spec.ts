import { describe, expect, it } from "vitest";
import {
  createDemoFinancialDocument,
  expandRecurrence,
  isISODate,
  type FinancialDocument,
  type FinancialItem,
} from "@slicex/core";
import { completeCommand, parseCommand, type ParsedCommand } from "../src/finance/command";

// 2026-11-08 is a Sunday.
const TODAY = "2026-11-08";
const EMPTY_DOC: FinancialDocument = {
  id: "empty",
  name: "Vacío",
  startDate: TODAY,
  initialCash: 0,
  minimumCashReserve: 0,
  horizonMonths: 12,
  items: [],
};
// Demo doc: cards "Nu" (fin-nu, first) and "BBVA" (fin-bbva).
const DEMO_DOC = createDemoFinancialDocument(TODAY);

function parse(text: string, doc: FinancialDocument = EMPTY_DOC, today = TODAY): ParsedCommand {
  const parsed = parseCommand(text, { today, doc });
  if (parsed === null) throw new Error(`expected "${text}" to parse`);
  return parsed;
}

function amountOf(item: FinancialItem): number {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return item.amount;
    case "loan":
      return item.paymentAmount;
    case "credit-card":
      return item.balance;
    case "installment-plan":
      return item.originalAmount;
  }
}

describe("parseCommand — the required phrasings", () => {
  it('"renta 8000 el 1" → monthly expense anchored on the next day 1', () => {
    const { item, summary, assumed } = parse("renta 8000 el 1");
    expect(item).toMatchObject({
      id: "cmd-draft",
      kind: "expense",
      name: "Renta",
      amount: 8000,
      recurrence: { frequency: "monthly", startDate: "2026-12-01" },
    });
    expect(item.recurrence.endDate).toBeUndefined();
    expect(item.recurrence.anchorDate).toBeUndefined();
    expect(summary).toBe("Gasto · Renta · $8,000 · cada mes, día 1 · desde 1 dic");
    expect(assumed).toEqual([]);
  });

  it('"el 1" on the 1st itself starts today', () => {
    expect(parse("renta 8000 el 1", EMPTY_DOC, "2026-11-01").item.recurrence.startDate).toBe("2026-11-01");
  });

  it('"sueldo 9000 quincenal" → semimonthly income from today', () => {
    const { item, summary, assumed } = parse("sueldo 9000 quincenal");
    expect(item).toMatchObject({
      kind: "income",
      name: "Sueldo",
      amount: 9000,
      recurrence: { frequency: "semimonthly", startDate: TODAY },
    });
    expect(summary).toBe("Ingreso · Sueldo · $9,000 · cada quincena (15 y fin de mes) · desde hoy");
    expect(assumed).toEqual([]);
  });

  it('"nómina 18,000 cada quincena" → semimonthly income, accent kept in the name', () => {
    const { item } = parse("nómina 18,000 cada quincena");
    expect(item).toMatchObject({
      kind: "income",
      name: "Nómina",
      amount: 18000,
      recurrence: { frequency: "semimonthly", startDate: TODAY },
    });
  });

  it('"netflix 219 mensual el 5" → monthly expense on day 5', () => {
    const { item } = parse("netflix 219 mensual el 5");
    expect(item).toMatchObject({
      kind: "expense",
      name: "Netflix",
      amount: 219,
      recurrence: { frequency: "monthly", startDate: "2026-12-05" },
    });
  });

  it('"gasolina 600 cada semana" / "semanal" → weekly expense from today', () => {
    for (const text of ["gasolina 600 cada semana", "gasolina 600 semanal", "gasolina 600 a la semana"]) {
      const { item, summary, assumed } = parse(text);
      expect(item).toMatchObject({
        kind: "expense",
        name: "Gasolina",
        amount: 600,
        recurrence: { frequency: "weekly", startDate: TODAY },
      });
      expect(summary).toBe("Gasto · Gasolina · $600 · cada semana, domingo · desde hoy");
      expect(assumed).toEqual(["fecha"]);
    }
  });

  it('"cada 14 días" / "catorcenal" / "cada dos semanas" → biweekly', () => {
    expect(parse("gym 500 cada 14 días").item.recurrence.frequency).toBe("biweekly");
    expect(parse("sueldo 8000 catorcenal").item).toMatchObject({
      kind: "income",
      recurrence: { frequency: "biweekly" },
    });
    expect(parse("sueldo 8000 cada dos semanas").item.recurrence.frequency).toBe("biweekly");
  });

  it("one-off dates: hoy, mañana, pasado mañana, el viernes, 15 de diciembre, 15 dic, 15/12", () => {
    const cases: Array<[string, string]> = [
      ["uber 150 hoy", "2026-11-08"],
      ["uber 150 mañana", "2026-11-09"],
      ["uber 150 pasado mañana", "2026-11-10"],
      ["uber 150 el viernes", "2026-11-13"],
      ["uber 150 el 15 de diciembre", "2026-12-15"],
      ["uber 150 15 dic", "2026-12-15"],
      ["uber 150 15/12", "2026-12-15"],
      ["uber 150 15/12/2026", "2026-12-15"],
      ["uber 150 2026-12-15", "2026-12-15"],
      ["uber 150 dic 15", "2026-12-15"],
    ];
    for (const [text, date] of cases) {
      const { item } = parse(text);
      expect(item, text).toMatchObject({
        kind: "expense",
        name: "Uber",
        amount: 150,
        recurrence: { frequency: "once", startDate: date, endDate: date },
      });
    }
  });

  it("a weekday excludes today (Sunday → next Sunday)", () => {
    expect(parse("uber 150 el domingo").item.recurrence.startDate).toBe("2026-11-15");
    expect(parse("uber 150 el lunes").item.recurrence.startDate).toBe("2026-11-09");
  });

  it("a date without a year that already passed moves to next year", () => {
    expect(parse("uber 150 15/10").item.recurrence.startDate).toBe("2027-10-15");
    expect(parse("uber 150 5 nov").item.recurrence.startDate).toBe("2027-11-05");
    // An explicit year is kept.
    expect(parse("uber 150 5 nov 2026").item.recurrence.startDate).toBe("2026-11-05");
  });

  it('"me pagan 25000 el 30" → monthly income on day 30, name defaulted', () => {
    const { item, summary, assumed } = parse("me pagan 25000 el 30");
    expect(item).toMatchObject({
      kind: "income",
      name: "Ingreso",
      amount: 25000,
      recurrence: { frequency: "monthly", startDate: "2026-11-30" },
    });
    expect(summary).toBe("Ingreso · $25,000 · cada mes, día 30 · desde 30 nov");
    expect(assumed).toEqual(["nombre"]);
  });

  it("income / expense verbs", () => {
    for (const text of ["cobro 5000", "recibo 3000", "ingreso 2000", "me depositan 4000"]) {
      expect(parse(text).item.kind, text).toBe("income");
    }
    for (const text of ["pago luz 450", "gasto 300", "compra 99", "me cobran 219 de netflix el 5"]) {
      expect(parse(text).item.kind, text).toBe("expense");
    }
    expect(parse("pago luz 450").item.name).toBe("Luz");
    expect(parse("me cobran 219 de netflix el 5").item).toMatchObject({
      name: "Netflix",
      recurrence: { frequency: "monthly", startDate: "2026-12-05" },
    });
    // The verb beats the noun: collecting rent is income.
    expect(parse("cobro renta del depa 7000").item).toMatchObject({ kind: "income", name: "Renta del depa" });
    // Income nouns: aguinaldo, bono, venta, sueldo, nómina.
    expect(parse("bono 5000").item).toMatchObject({ kind: "income", recurrence: { frequency: "once" } });
    expect(parse("venta 1200 mañana").item.kind).toBe("income");
  });

  it("no hint at all → expense, with 'tipo' assumed", () => {
    const { item, assumed } = parse("algo 100");
    expect(item).toMatchObject({ kind: "expense", name: "Algo", recurrence: { frequency: "once", startDate: TODAY } });
    expect(assumed).toEqual(["tipo", "fecha"]);
  });

  it('"aguinaldo 13500 el 20 de diciembre" → one-off income', () => {
    const { item, summary } = parse("aguinaldo 13500 el 20 de diciembre");
    expect(item).toMatchObject({
      kind: "income",
      name: "Aguinaldo",
      amount: 13500,
      recurrence: { frequency: "once", startDate: "2026-12-20", endDate: "2026-12-20" },
    });
    expect(summary).toBe("Ingreso · Aguinaldo · $13,500 · el 20 dic");
  });

  it('"préstamo 7500 mensual 6 meses" → loan ending on the 6th payment', () => {
    const { item, summary, assumed } = parse("préstamo 7500 mensual 6 meses");
    expect(item).toMatchObject({
      kind: "loan",
      name: "Préstamo",
      paymentAmount: 7500,
      recurrence: { frequency: "monthly", startDate: TODAY, endDate: "2027-04-08" },
    });
    const payments = expandRecurrence(item.recurrence, { from: TODAY, to: "2030-01-01" });
    expect(payments).toHaveLength(6);
    expect(summary).toBe("Préstamo · $7,500 · cada mes, día 8 · desde hoy · hasta 8 abr 2027");
    expect(assumed).toEqual(["fecha"]);
  });

  it('"préstamo 7500 mensual hasta junio" → last payment ≤ end of June', () => {
    const { item } = parse("préstamo 7500 mensual hasta junio");
    expect(item.recurrence).toMatchObject({ frequency: "monthly", startDate: TODAY, endDate: "2027-06-08" });
  });

  it("loan extras: payment counts, balance + payment, rate, default term", () => {
    const twelve = parse("préstamo 2000 12 pagos el 15").item;
    expect(expandRecurrence(twelve.recurrence, { from: TODAY, to: "2030-01-01" })).toHaveLength(12);
    expect(twelve.recurrence.startDate).toBe("2026-11-15");

    const withBalance = parse("préstamo de 50000 pagando 7500 mensual al 32%").item;
    expect(withBalance).toMatchObject({ kind: "loan", name: "Préstamo", balance: 50000, paymentAmount: 7500, annualRate: 32 });

    const open = parse("préstamo coche 3000");
    expect(open.item).toMatchObject({
      kind: "loan",
      name: "Coche",
      recurrence: { frequency: "monthly", startDate: TODAY, endDate: "2027-11-08" },
    });
    expect(open.assumed).toEqual(["frecuencia", "fecha", "plazo"]);

    expect(parse("hipoteca 12000 mensual el 10").item).toMatchObject({ kind: "loan", name: "Hipoteca" });
  });

  it('"laptop 18000 a 12 msi" / "12 msi laptop 18000" → MSI starting next month', () => {
    for (const text of ["laptop 18000 a 12 msi", "12 msi laptop 18000", "laptop 18000 a 12 meses sin intereses"]) {
      const { item, summary, assumed } = parse(text);
      expect(item, text).toMatchObject({
        kind: "installment-plan",
        name: "Laptop",
        originalAmount: 18000,
        installmentsTotal: 12,
        installmentsPaid: 0,
        recurrence: { frequency: "monthly", startDate: "2026-12-08" },
      });
      expect(item.kind === "installment-plan" && item.cardId).toBe(undefined);
      expect(summary).toBe("MSI · Laptop · $18,000 a 12 MSI ($1,500/mes) · desde 8 dic");
      expect(assumed).toEqual(["fecha"]);
    }
  });

  it("MSI on a card: first card by default, or the one named", () => {
    const byDefault = parse("laptop 18000 a 12 msi", DEMO_DOC);
    expect(byDefault.item).toMatchObject({ kind: "installment-plan", cardId: "fin-nu" });
    expect(byDefault.assumed).toContain("tarjeta");

    const named = parse("tele 9000 6 msi con bbva llevo 2", DEMO_DOC);
    expect(named.item).toMatchObject({
      kind: "installment-plan",
      name: "Tele",
      cardId: "fin-bbva",
      installmentsTotal: 6,
      installmentsPaid: 2,
    });
    expect(named.assumed).not.toContain("tarjeta");
    expect(named.summary).toBe("MSI · Tele · $9,000 a 6 MSI ($1,500/mes) · 2 pagados · con BBVA · desde 8 dic");
  });

  it('"tarjeta nu 30000 al 99.9%" → credit card with default cut / due days', () => {
    const { item, summary, assumed } = parse("tarjeta nu 30000 al 99.9%");
    expect(item).toMatchObject({
      kind: "credit-card",
      name: "Nu",
      balance: 30000,
      annualRate: 99.9,
      cutDay: 8,
      dueDay: 18,
      minimumPayment: 0,
    });
    expect(summary).toBe("Tarjeta · Nu · saldo $30,000 · 99.9% anual · corte día 8, pago día 18");
    expect(assumed).toEqual(["día de corte", "día de pago"]);
  });

  it("credit card extras: corte / pago / mínimo / tarjeta de crédito", () => {
    const { item, assumed } = parse("tarjeta de crédito BBVA 20000 al 39% corte 7 pago el 27 mínimo 2500");
    expect(item).toMatchObject({
      kind: "credit-card",
      name: "BBVA",
      balance: 20000,
      annualRate: 39,
      cutDay: 7,
      dueDay: 27,
      minimumPayment: 2500,
    });
    expect(assumed).toEqual([]);
    // "pago tarjeta" is a payment, not a new card.
    expect(parse("pago tarjeta nu 3000").item).toMatchObject({ kind: "expense", name: "Tarjeta nu" });
  });

  it("card purchases: con <card> / con tarjeta", () => {
    const named = parse("súper 1500 con nu", DEMO_DOC);
    expect(named.item).toMatchObject({ kind: "card-purchase", name: "Súper", amount: 1500, cardId: "fin-nu" });
    expect(named.summary).toBe("Compra con tarjeta · Súper · $1,500 · con Nu · hoy");
    expect(parse("cena 800 con la tarjeta bbva el viernes", DEMO_DOC).item).toMatchObject({
      kind: "card-purchase",
      cardId: "fin-bbva",
      recurrence: { frequency: "once", startDate: "2026-11-13" },
    });
    const generic = parse("uber 150 con tarjeta");
    expect(generic.item).toMatchObject({ kind: "card-purchase", name: "Uber", cardId: "" });
    expect(generic.assumed).toContain("tarjeta");
  });
});

describe("parseCommand — amounts", () => {
  const cases: Array<[string, number]> = [
    ["renta 8000", 8000],
    ["renta 8,000", 8000],
    ["renta $8,000.50", 8000.5],
    ["renta $ 8000", 8000],
    ["renta 8 mil", 8000],
    ["renta 8mil", 8000],
    ["renta 8 mil 500", 8500],
    ["renta 8k", 8000],
    ["renta 8K", 8000],
    ["renta 1.5k", 1500],
    ["renta 8000 pesos", 8000],
    ["casa medio millón", 500000],
    ["casa 2 millones", 2000000],
    ["renta cinco mil", 5000],
    ["renta mil", 1000],
  ];
  for (const [text, amount] of cases) {
    it(`"${text}" → ${amount}`, () => {
      const { item } = parse(text);
      expect(amountOf(item)).toBe(amount);
      expect(item.name).not.toMatch(/\d|pesos|\$/);
    });
  }

  it("the largest number is the amount; the others stay in the name", () => {
    expect(parse("depto 2 renta 8000").item).toMatchObject({ name: "Depto 2 renta", amount: 8000 });
  });

  it("8000/mes reads as monthly", () => {
    expect(parse("renta 8000/mes").item).toMatchObject({ amount: 8000, recurrence: { frequency: "monthly" } });
  });
});

describe("parseCommand — window: desde / a partir de / hasta", () => {
  it('"desde 1 dic" and "a partir del 1 de diciembre" set the start', () => {
    for (const text of ["gimnasio 500 mensual desde 1 dic", "gimnasio 500 mensual a partir del 1 de diciembre"]) {
      const { item, assumed } = parse(text);
      expect(item, text).toMatchObject({
        name: "Gimnasio",
        recurrence: { frequency: "monthly", startDate: "2026-12-01" },
      });
      expect(assumed).toEqual([]);
    }
    expect(parse("gimnasio 500 mensual desde enero").item.recurrence.startDate).toBe("2027-01-01");
  });

  it('"el N" + "desde" anchors on the first day N on or after the start', () => {
    expect(parse("renta 8000 el 5 desde enero").item.recurrence.startDate).toBe("2027-01-05");
  });

  it('"hasta marzo" ends on the last occurrence ≤ the end of March', () => {
    expect(parse("sueldo 9000 quincenal hasta marzo").item.recurrence.endDate).toBe("2027-03-31");
    expect(parse("netflix 219 mensual el 5 hasta marzo").item.recurrence).toMatchObject({
      startDate: "2026-12-05",
      endDate: "2027-03-05",
    });
    expect(parse("netflix 219 mensual el 5 hasta el 15 de marzo de 2027").item.recurrence.endDate).toBe("2027-03-05");
    const summary = parse("sueldo 9000 quincenal hasta marzo").summary;
    expect(summary).toBe("Ingreso · Sueldo · $9,000 · cada quincena (15 y fin de mes) · desde hoy · hasta 31 mar 2027");
  });
});

describe("parseCommand — more schedules", () => {
  it('"el 31" starts on the clamped date and anchors on a real 31st', () => {
    const { item } = parse("ahorro 1000 el 31");
    expect(item.recurrence).toMatchObject({ frequency: "monthly", startDate: "2026-11-30", anchorDate: "2026-12-31" });
    const dates = expandRecurrence(item.recurrence, { from: TODAY, to: "2027-03-31" });
    expect(dates).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it('"fin de mes", "15 y 30", "los viernes", "una vez", "en 3 días", "en diciembre"', () => {
    expect(parse("renta 8000 a fin de mes").item.recurrence).toMatchObject({ frequency: "monthly", startDate: "2026-11-30" });
    expect(parse("sueldo 9000 los días 15 y 30").item.recurrence.frequency).toBe("semimonthly");
    expect(parse("gasolina 600 los viernes").item.recurrence).toMatchObject({ frequency: "weekly", startDate: "2026-11-13" });
    expect(parse("sueldo 9000 una vez").item.recurrence.frequency).toBe("once");
    expect(parse("dentista 900 en 3 días").item.recurrence.startDate).toBe("2026-11-11");
    expect(parse("aguinaldo 13500 en diciembre").item.recurrence.startDate).toBe("2026-12-01");
  });

  it('an unsupported period ("cada 3 meses") falls back to the defaults and flags it', () => {
    const { item, assumed } = parse("seguro 3000 cada 3 meses");
    expect(item).toMatchObject({ name: "Seguro", amount: 3000, recurrence: { frequency: "once" } });
    expect(assumed).toEqual(["frecuencia", "fecha"]);
  });

  it("income without frequency defaults to monthly (assumed)", () => {
    const { item, assumed } = parse("sueldo 9000");
    expect(item.recurrence.frequency).toBe("monthly");
    expect(assumed).toEqual(["frecuencia", "fecha"]);
  });

  it("tolerates word order and leftover glue words", () => {
    expect(parse("el 1 renta 8000").item).toMatchObject({ name: "Renta", recurrence: { startDate: "2026-12-01" } });
    expect(parse("renta de la casa 8000 el 1 de cada mes").item).toMatchObject({
      name: "Renta de la casa",
      recurrence: { frequency: "monthly", startDate: "2026-12-01" },
    });
    expect(parse("RENTA 8000 EL 1").item).toMatchObject({ name: "RENTA", amount: 8000 });
  });
});

describe("parseCommand — robustness", () => {
  it("returns null when there is no amount", () => {
    for (const text of ["", "   ", "renta", "renta el 1", "el 15 de diciembre", "hola mundo", "$", "renta 0"]) {
      expect(parseCommand(text, { today: TODAY, doc: EMPTY_DOC }), text).toBeNull();
    }
  });

  it("returns null on a malformed context instead of throwing", () => {
    expect(parseCommand("renta 8000", { today: "2026-13-40", doc: EMPTY_DOC })).toBeNull();
    expect(parseCommand(undefined as unknown as string, { today: TODAY, doc: EMPTY_DOC })).toBeNull();
    expect(parseCommand("renta 8000", undefined as unknown as { today: string; doc: FinancialDocument })).toBeNull();
    expect(parseCommand("renta 8000", { today: TODAY, doc: undefined as unknown as FinancialDocument })).not.toBeNull();
  });

  it("never throws and always yields valid drafts (fuzz)", () => {
    const vocabulary = [
      "renta", "8000", "el", "1", "31", "quincenal", "mensual", "cada", "semana", "14", "días", "hoy",
      "mañana", "pasado", "viernes", "15", "de", "diciembre", "dic", "15/12", "2026-02-29", "desde",
      "hasta", "a", "partir", "del", "marzo", "6", "meses", "msi", "12", "tarjeta", "nu", "al",
      "99.9%", "con", "préstamo", "me", "pagan", "8k", "1.5k", "mil", "medio", "millón", "$8,000.50",
      "corte", "pago", "mínimo", "llevo", "y", "30", "fin", "mes", "%", "/", ",", "sin", "intereses",
      "2027", "en", "3", "una", "vez", "los", "pagos", "¿?", "-5", "1e9", "99999999999999999999",
    ];
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 1500; run += 1) {
      const length = 1 + Math.floor(random() * 9);
      const words: string[] = [];
      for (let k = 0; k < length; k += 1) words.push(vocabulary[Math.floor(random() * vocabulary.length)]!);
      const text = words.join(" ");
      const doc = run % 2 === 0 ? DEMO_DOC : EMPTY_DOC;
      let parsed: ParsedCommand | null = null;
      expect(() => {
        parsed = parseCommand(text, { today: TODAY, doc });
      }, text).not.toThrow();
      if (parsed === null) continue;
      const { item, summary } = parsed as ParsedCommand;
      expect(item.id).toBe("cmd-draft");
      expect(isISODate(item.recurrence.startDate), text).toBe(true);
      if (item.recurrence.endDate !== undefined) expect(isISODate(item.recurrence.endDate), text).toBe(true);
      if (item.recurrence.anchorDate !== undefined) expect(isISODate(item.recurrence.anchorDate), text).toBe(true);
      expect(amountOf(item), text).toBeGreaterThan(0);
      expect(item.name.length, text).toBeGreaterThan(0);
      expect(summary.length, text).toBeGreaterThan(0);
    }
  });
});

describe("completeCommand", () => {
  it("completes the last word with the missing suffix only", () => {
    expect(completeCommand("quinc")).toBe("enal");
    expect(completeCommand("sueldo 9000 quinc")).toBe("enal");
    expect(completeCommand("sueldo 9000 men")).toBe("sual");
    expect(completeCommand("gasolina 600 sem")).toBe("anal");
    expect(completeCommand("cato")).toBe("rcenal");
    expect(completeCommand("15 dic")).toBe("iembre");
    expect(completeCommand("nom")).toBe("ina");
    expect(completeCommand("nóm")).toBe("ina");
    expect(completeCommand("pre")).toBe("stamo");
    expect(completeCommand("tar")).toBe("jeta");
    expect(completeCommand("agu")).toBe("inaldo");
    expect(completeCommand("cole")).toBe("giatura");
    expect(completeCommand("gaso")).toBe("lina");
    expect(completeCommand("uber 150 man")).toBe("ana");
    expect(completeCommand("uber 150 pas")).toBe("ado mañana");
    expect(completeCommand("uber 150 el vie")).toBe("rnes");
    expect(completeCommand("renta 8000 hasta mar")).toBe("zo");
  });

  it("prefers the noun after cada / la / por", () => {
    expect(completeCommand("nómina 18000 cada quinc")).toBe("ena");
    expect(completeCommand("gasolina 600 cada sem")).toBe("ana");
    expect(completeCommand("gasolina 600 a la sem")).toBe("ana");
  });

  it("keeps the user's case", () => {
    expect(completeCommand("QUINC")).toBe("ENAL");
    expect(completeCommand("Quinc")).toBe("enal");
  });

  it("returns null when there is nothing to complete", () => {
    expect(completeCommand("")).toBeNull();
    expect(completeCommand("qu")).toBeNull(); // < 3 letters
    expect(completeCommand("renta ")).toBeNull(); // trailing space: no word being typed
    expect(completeCommand("renta 8000")).toBeNull();
    expect(completeCommand("quincenal")).toBeNull(); // already complete
    expect(completeCommand("semana")).toBeNull();
    expect(completeCommand("al mes")).toBeNull();
    expect(completeCommand("gas")).toBeNull();
    expect(completeCommand("xyzab")).toBeNull();
    expect(completeCommand(undefined as unknown as string)).toBeNull();
  });
});
