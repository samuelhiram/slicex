import { describe, expect, it } from "vitest";
import { parseStatement, summarizeStatement, type StatementRow } from "../src/finance/statement";

const TODAY = "2026-11-20";
const ctx = { today: TODAY };

function one(line: string, today = TODAY): StatementRow {
  const rows = parseStatement(line, { today });
  expect(rows, line).toHaveLength(1);
  return rows[0]!;
}

describe("parseStatement — plain lines", () => {
  it('"15/11/2026 OXXO REFORMA 123.45"', () => {
    expect(one("15/11/2026 OXXO REFORMA 123.45")).toEqual({
      date: "2026-11-15",
      description: "OXXO REFORMA",
      amount: 123.45,
      raw: "15/11/2026 OXXO REFORMA 123.45",
    });
  });

  it('"15-NOV-2026 AMAZON MX $1,234.56"', () => {
    expect(one("15-NOV-2026 AMAZON MX $1,234.56")).toMatchObject({
      date: "2026-11-15",
      description: "AMAZON MX",
      amount: 1234.56,
    });
  });

  it('"15 nov AMAZON 1,234.56" infers the most recent year ≤ today', () => {
    expect(one("15 nov AMAZON 1,234.56")).toMatchObject({
      date: "2026-11-15",
      description: "AMAZON",
      amount: 1234.56,
    });
    // Before Nov 15 in 2026, "15 nov" is last year's.
    expect(one("15 nov AMAZON 1,234.56", "2026-11-08").date).toBe("2025-11-15");
    expect(one("31 dic RESTAURANTE 450.00", "2027-01-05").date).toBe("2026-12-31");
  });

  it("Spanish month abbreviations in any case, with or without year / dashes / 'de'", () => {
    expect(one("03 ENE 2026 LIVERPOOL 899.00").date).toBe("2026-01-03");
    expect(one("3 ene CINEPOLIS 180.00").date).toBe("2026-01-03");
    expect(one("15 Dic WALMART 1,050.00").date).toBe("2025-12-15");
    expect(one("15/dic/2025 WALMART 1,050.00").date).toBe("2025-12-15");
    expect(one("15 de septiembre de 2026 COSTCO 2,300.10").date).toBe("2026-09-15");
    expect(one("5 SEP COSTCO 2,300.10").date).toBe("2026-09-05");
    expect(one("nov 2 SPOTIFY 129.00").date).toBe("2026-11-02");
  });

  it("other numeric date shapes: dd/mm, dd-mm-yy, yyyy-mm-dd", () => {
    expect(one("02/11 SPOTIFY 129.00").date).toBe("2026-11-02");
    expect(one("02-11-26 SPOTIFY 129.00").date).toBe("2026-11-02");
    expect(one("2026-11-02 SPOTIFY 129.00").date).toBe("2026-11-02");
    expect(one("02.11.2026 SPOTIFY 129.00").date).toBe("2026-11-02");
  });

  it("skips a second (posting) date and a time", () => {
    expect(one("14/11/2026 15/11/2026 UBER TRIP 89.90")).toMatchObject({
      date: "2026-11-14",
      description: "UBER TRIP",
      amount: 89.9,
    });
    expect(one("14/11/2026 18:32 UBER TRIP 89.90").description).toBe("UBER TRIP");
  });

  it("keeps the movement, not the running balance, when two amounts trail", () => {
    expect(one("15/11/2026 OXXO REFORMA 123.45 4,876.55")).toMatchObject({
      description: "OXXO REFORMA",
      amount: 123.45,
    });
    // A bare store number stays in the description.
    expect(one("15/11/2026 OXXO 123 45.00")).toMatchObject({ description: "OXXO 123", amount: 45 });
  });

  it("thousands separators and currency markers", () => {
    expect(one("15/11/2026 SAMSUNG 12,345,678.90").amount).toBe(12345678.9);
    expect(one("15/11/2026 SAMSUNG $ 1,234.56").amount).toBe(1234.56);
    expect(one("15/11/2026 SAMSUNG 1,234.56 MXN").amount).toBe(1234.56);
    expect(one("15/11/2026 SAMSUNG 1234").amount).toBe(1234);
  });
});

describe("parseStatement — payments / credits are negative", () => {
  it('"-1,500.00", "1,500.00-", "(1,500.00)"', () => {
    expect(one("16/11/2026 TRANSFERENCIA SPEI -1,500.00").amount).toBe(-1500);
    expect(one("16/11/2026 TRANSFERENCIA SPEI 1,500.00-").amount).toBe(-1500);
    expect(one("16/11/2026 TRANSFERENCIA SPEI (1,500.00)").amount).toBe(-1500);
  });

  it('"1,500.00 CR" / "1,500.00CR"', () => {
    expect(one("16/11/2026 BONIFICACION ANUALIDAD 1,500.00 CR").amount).toBe(-1500);
    expect(one("16/11/2026 SPEI RECIBIDO 1,500.00CR").amount).toBe(-1500);
  });

  it('"ABONO" / "PAGO" in the description', () => {
    expect(one("16/11/2026 SU PAGO GRACIAS 3,000.00")).toMatchObject({
      description: "SU PAGO GRACIAS",
      amount: -3000,
    });
    expect(one("16/11/2026 ABONO EN EFECTIVO 500.00").amount).toBe(-500);
    expect(one("16/11/2026 Pago recibido 500.00").amount).toBe(-500);
    expect(one("16/11/2026 DEVOLUCION AMAZON 299.00").amount).toBe(-299);
    // A merchant, not a payment.
    expect(one("16/11/2026 MERCADO PAGO *TIENDA 299.00").amount).toBe(299);
    expect(one("16/11/2026 MERCADOPAGO*TIENDA 299.00").amount).toBe(299);
  });
});

describe("parseStatement — delimited rows", () => {
  it('comma CSV without header: "2026-11-15,Uber,89.00"', () => {
    expect(one("2026-11-15,Uber,89.00")).toMatchObject({ date: "2026-11-15", description: "Uber", amount: 89 });
    expect(one('2026-11-15,"Amazon, MX","1,234.56"')).toMatchObject({ description: "Amazon, MX", amount: 1234.56 });
    // Unquoted thousands separator in a comma CSV.
    expect(one("2026-11-15,Liverpool,1,234.56")).toMatchObject({ description: "Liverpool", amount: 1234.56 });
  });

  it("tab-separated with a Fecha / Concepto / Cargo / Abono header", () => {
    const text = [
      "Fecha\tConcepto\tCargo\tAbono",
      "15/11/2026\tOXXO REFORMA\t123.45\t",
      "16/11/2026\tSU PAGO GRACIAS\t\t1,500.00",
      "17/11/2026\tAMAZON MX\t$1,234.56\t",
    ].join("\n");
    const rows = parseStatement(text, ctx);
    expect(rows.map((row) => [row.date, row.description, row.amount])).toEqual([
      ["2026-11-15", "OXXO REFORMA", 123.45],
      ["2026-11-16", "SU PAGO GRACIAS", -1500],
      ["2026-11-17", "AMAZON MX", 1234.56],
    ]);
    expect(rows[1]!.raw).toBe("16/11/2026\tSU PAGO GRACIAS\t\t1,500.00");
  });

  it("an empty first column does not shift the others", () => {
    const text = ["Referencia\tFecha\tDescripción\tCargo\tAbono", "\t15/11/2026\tOXXO\t50.00\t"].join("\n");
    expect(parseStatement(text, ctx)).toEqual([
      { date: "2026-11-15", description: "OXXO", amount: 50, raw: "15/11/2026\tOXXO\t50.00" },
    ]);
  });

  it("semicolon CSV with Descripción and a single Importe column with negatives", () => {
    const text = [
      "Fecha;Descripción;Importe;Saldo",
      "15/11/2026;OXXO REFORMA;123.45;10,123.45",
      "16/11/2026;SPEI ENVIADO;-2,000.00;8,123.45",
      "17/11/2026;NETFLIX;219.00;8,342.45",
    ].join("\n");
    expect(parseStatement(text, ctx).map((row) => [row.description, row.amount])).toEqual([
      ["OXXO REFORMA", 123.45],
      ["SPEI ENVIADO", -2000],
      ["NETFLIX", 219],
    ]);
  });

  it("Movimiento / Monto headers, a Tipo column, and payment words in a single amount column", () => {
    const text = [
      "Fecha,Movimiento,Monto,Tipo",
      '15/11/2026,UBER EATS,"350.00",Cargo',
      '16/11/2026,TRANSFERENCIA,"1,000.00",Abono',
      '17/11/2026,PAGO TDC,"2,000.00",',
    ].join("\n");
    expect(parseStatement(text, ctx).map((row) => [row.description, row.amount])).toEqual([
      ["UBER EATS", 350],
      ["TRANSFERENCIA", -1000],
      ["PAGO TDC", -2000],
    ]);
  });

  it("headerless tab / semicolon rows, references are not amounts", () => {
    expect(one("15/11/2026\tOXXO\t123.45")).toMatchObject({ description: "OXXO", amount: 123.45 });
    expect(one("15/11/2026;123456789;OXXO;123.45")).toMatchObject({
      description: "123456789 OXXO",
      amount: 123.45,
    });
  });
});

describe("parseStatement — what is ignored", () => {
  it("lines without a date or amount, headers, totals", () => {
    const text = [
      "BANCO EJEMPLO — ESTADO DE CUENTA",
      "Periodo: 01/11/2026 al 30/11/2026",
      "Fecha Concepto Importe",
      "15/11/2026 OXXO REFORMA 123.45",
      "15/11/2026 SIN IMPORTE",
      "OXXO 99.00",
      "30/11/2026 SALDO ANTERIOR 5,000.00",
      "30/11/2026 TOTAL CARGOS 1,357.01",
      "TOTAL 1,357.01",
      "Pago mínimo 1,500.00",
      "16/11/2026 TOTAL PLAY 499.00",
      "16/11/2026 ZERO 0.00",
      "",
      "   ",
    ].join("\n");
    expect(parseStatement(text, ctx).map((row) => [row.description, row.amount])).toEqual([
      ["OXXO REFORMA", 123.45],
      ["TOTAL PLAY", 499],
    ]);
  });

  it("never throws", () => {
    const junk = [
      "",
      "\n\n\n",
      ";;;;",
      "\t\t\t",
      ",,,,",
      '"""',
      "31/02/2026 IMPOSSIBLE 10.00",
      "99/99/9999 X 1",
      "15/11/2026 $ - CR",
      "1e999",
      "15 nov",
      "Fecha;Concepto;Importe\n;;\nfoo;bar;baz",
      "x".repeat(10000),
    ];
    for (const text of junk) {
      expect(() => parseStatement(text, ctx), JSON.stringify(text.slice(0, 40))).not.toThrow();
    }
    expect(parseStatement("31/02/2026 IMPOSSIBLE 10.00", ctx)).toEqual([]);
    expect(parseStatement(undefined as unknown as string, ctx)).toEqual([]);
    expect(parseStatement("15/11/2026 OXXO 1.00", { today: "nope" })).toEqual([]);
  });
});

describe("summarizeStatement", () => {
  it("adds charges and payments, net and date range", () => {
    const rows = parseStatement(
      [
        "17/11/2026 AMAZON 1,234.56",
        "15/11/2026 OXXO 123.45",
        "16/11/2026 SU PAGO GRACIAS 3,000.00",
        "18/11/2026 DEVOLUCION 0.01",
      ].join("\n"),
      ctx,
    );
    expect(summarizeStatement(rows)).toEqual({
      charges: 1358.01,
      payments: 3000.01,
      net: -1642,
      from: "2026-11-15",
      to: "2026-11-18",
    });
  });

  it("empty input", () => {
    expect(summarizeStatement([])).toEqual({ charges: 0, payments: 0, net: 0, from: null, to: null });
  });
});
