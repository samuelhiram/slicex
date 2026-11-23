// Example plans (deterministic: every date derives from `startDate`).
// - createExampleYearDocument: "el año de ejemplo" the app opens on a first
//   visit and with "Reiniciar con el ejemplo…".
// - createDemoFinancialDocument: the engine's stable fixture (tests across
//   the repo read its names and numbers) — change it only with them.
// - createRememberedPlanDocument: a plan with a past to remember (the
//   balance memory, FinancialDocument.history), opened days after it was set.
import { addDays, addMonths } from "./dates";
import type { FinancialDocument, FinancialRecurrence, ISODate } from "./types";

/**
 * "Mi año": a designer with a part-time studio salary (quincena), freelance
 * projects and a rented room; rent, groceries and petrol every week, the
 * usual bills, a car loan, two cards (one with an 18-MSI phone, the other a
 * 12-MSI fridge), the car insurance in ~3 months and a trip in ~5. Every
 * item carries an icon (apps/web icons.ts). Tuned so cash stays positive
 * all year with a dip under the 4 000 reserve around the insurance (a
 * valley to fix), and the cards are worth paying down.
 */
export function createExampleYearDocument(startDate: ISODate): FinancialDocument {
  const day = (offset: number): ISODate => addDays(startDate, offset);
  const carAnchor = day(6);
  return {
    id: "ejemplo",
    name: "Mi año",
    startDate,
    initialCash: 15000,
    minimumCashReserve: 4000,
    horizonMonths: 12,
    items: [
      // Ingresos
      {
        id: "ej-sueldo",
        kind: "income",
        name: "Sueldo del despacho",
        icon: "briefcase",
        amount: 11000,
        recurrence: { frequency: "semimonthly", startDate },
      },
      {
        id: "ej-freelance",
        kind: "income",
        name: "Proyectos freelance",
        icon: "laptop",
        amount: 7500,
        recurrence: { frequency: "monthly", startDate: day(12) },
      },
      {
        id: "ej-cuarto",
        kind: "income",
        name: "Renta del cuarto",
        icon: "key-round",
        amount: 3200,
        recurrence: { frequency: "monthly", startDate: day(10) },
      },
      {
        id: "ej-aguinaldo",
        kind: "income",
        name: "Aguinaldo",
        icon: "gift",
        amount: 16000,
        recurrence: { frequency: "once", startDate: day(28), endDate: day(28) },
      },
      // Gastos
      {
        id: "ej-renta",
        kind: "expense",
        name: "Renta del depa",
        icon: "house",
        amount: 9800,
        recurrence: { frequency: "monthly", startDate: day(11) },
      },
      {
        id: "ej-super",
        kind: "expense",
        name: "Súper",
        icon: "shopping-cart",
        amount: 1200,
        recurrence: { frequency: "weekly", startDate: day(2) },
      },
      {
        id: "ej-gasolina",
        kind: "expense",
        name: "Gasolina",
        icon: "fuel",
        amount: 550,
        recurrence: { frequency: "weekly", startDate: day(4) },
      },
      {
        id: "ej-luz",
        kind: "expense",
        name: "Luz",
        icon: "zap",
        amount: 1150,
        recurrence: { frequency: "monthly", interval: 2, startDate: day(20) },
      },
      {
        id: "ej-internet",
        kind: "expense",
        name: "Internet y celular",
        icon: "wifi",
        amount: 899,
        recurrence: { frequency: "monthly", startDate: day(7) },
      },
      {
        id: "ej-gym",
        kind: "expense",
        name: "Gimnasio",
        icon: "dumbbell",
        amount: 650,
        recurrence: { frequency: "monthly", startDate: day(12) },
      },
      {
        id: "ej-streaming",
        kind: "expense",
        name: "Streaming",
        icon: "tv",
        amount: 329,
        recurrence: { frequency: "monthly", startDate: day(16) },
      },
      {
        id: "ej-luna",
        kind: "expense",
        name: "Croquetas de Luna",
        icon: "paw-print",
        amount: 780,
        recurrence: { frequency: "monthly", startDate: day(9) },
      },
      {
        id: "ej-seguro",
        kind: "expense",
        name: "Seguro del auto",
        icon: "shield-check",
        amount: 9400,
        recurrence: {
          frequency: "once",
          startDate: addMonths(startDate, 3),
          endDate: addMonths(startDate, 3),
        },
      },
      {
        id: "ej-viaje",
        kind: "expense",
        name: "Viaje a Oaxaca",
        icon: "plane",
        amount: 12000,
        recurrence: {
          frequency: "once",
          startDate: addMonths(startDate, 5),
          endDate: addMonths(startDate, 5),
        },
      },
      // Deudas
      {
        id: "ej-auto",
        kind: "loan",
        name: "Crédito del auto",
        icon: "car",
        paymentAmount: 4850,
        balance: 62000,
        annualRate: 13.9,
        recurrence: {
          frequency: "monthly",
          startDate: carAnchor,
          endDate: addMonths(carAnchor, 12),
          anchorDate: carAnchor,
        },
      },
      {
        id: "ej-oro",
        kind: "credit-card",
        name: "Tarjeta Oro",
        icon: "credit-card",
        balance: 18400,
        annualRate: 54,
        cutDay: 3,
        dueDay: 23,
        minimumPayment: 1200,
        paymentAmount: 2500,
        recurrence: { frequency: "monthly", startDate },
      },
      {
        id: "ej-azul",
        kind: "credit-card",
        name: "Tarjeta Azul",
        icon: "credit-card",
        balance: 7900,
        annualRate: 42,
        cutDay: 12,
        dueDay: 2,
        minimumPayment: 600,
        paymentAmount: 1500,
        recurrence: { frequency: "monthly", startDate },
      },
      {
        id: "ej-celular",
        kind: "installment-plan",
        name: "Celular 18 MSI",
        icon: "smartphone",
        cardId: "ej-oro",
        originalAmount: 21600,
        installmentsTotal: 18,
        installmentsPaid: 5,
        recurrence: { frequency: "monthly", startDate },
      },
      {
        id: "ej-refri",
        kind: "installment-plan",
        name: "Refri 12 MSI",
        icon: "package",
        cardId: "ej-azul",
        originalAmount: 13200,
        installmentsTotal: 12,
        installmentsPaid: 2,
        recurrence: { frequency: "monthly", startDate },
      },
    ],
  };
}

/**
 * "Mi escenario": payroll every quincena, two one-off expenses, a personal
 * loan for ~6 months, two revolving cards (Nu, BBVA) and a 12-MSI laptop on
 * BBVA. Tuned so cash dips below the 5 000 reserve within the first two
 * months (demo warnings) while staying non-negative for most of the year.
 */
export function createDemoFinancialDocument(startDate: ISODate): FinancialDocument {
  const plataDate = addDays(startDate, 10);
  const gastoDate = addDays(startDate, 13);
  const loanAnchor = addDays(startDate, 8);
  return {
    id: "demo",
    name: "Mi escenario",
    startDate,
    initialCash: 12000,
    minimumCashReserve: 5000,
    horizonMonths: 12,
    items: [
      {
        id: "fin-sueldo",
        kind: "income",
        name: "Sueldo",
        icon: "briefcase",
        amount: 9000,
        recurrence: { frequency: "semimonthly", startDate },
      },
      {
        id: "fin-pago-plata",
        kind: "expense",
        name: "Pago Tarjeta Plata",
        icon: "credit-card",
        amount: 5792,
        recurrence: { frequency: "once", startDate: plataDate, endDate: plataDate },
      },
      {
        id: "fin-gasto",
        kind: "expense",
        name: "Gasto",
        icon: "shopping-cart",
        amount: 2000,
        recurrence: { frequency: "once", startDate: gastoDate, endDate: gastoDate },
      },
      {
        id: "fin-prestamo",
        kind: "loan",
        name: "Préstamo personal",
        icon: "landmark",
        paymentAmount: 7500,
        annualRate: 32,
        recurrence: {
          frequency: "monthly",
          startDate: loanAnchor,
          endDate: addMonths(startDate, 6),
          anchorDate: loanAnchor,
        },
      },
      {
        id: "fin-nu",
        kind: "credit-card",
        name: "Nu",
        icon: "credit-card",
        balance: 30069,
        annualRate: 99.9,
        cutDay: 15,
        dueDay: 26,
        minimumPayment: 1500,
        paymentAmount: 3000,
        recurrence: { frequency: "monthly", startDate },
      },
      {
        id: "fin-bbva",
        kind: "credit-card",
        name: "BBVA",
        icon: "credit-card",
        balance: 60941,
        annualRate: 39,
        cutDay: 7,
        dueDay: 27,
        minimumPayment: 2500,
        recurrence: { frequency: "monthly", startDate },
      },
      {
        id: "fin-laptop-msi",
        kind: "installment-plan",
        name: "Laptop 12 MSI",
        icon: "laptop",
        cardId: "fin-bbva",
        originalAmount: 18000,
        installmentsTotal: 12,
        installmentsPaid: 3,
        recurrence: { frequency: "monthly", startDate },
      },
    ],
  };
}

/**
 * "Plan con memoria": the balance was set 22 days before `today` ("tengo
 * $15,000") and the plan saved that day, remembering what each of the six
 * weeks before it opened with. Opened on `today` it rolls forward and
 * remembers every day it leaves behind: the timeline reaches back 45 days.
 * Salary every quincena, rent, groceries and petrol every week, streaming,
 * a car repair 10 days ago (the past's low, under the 2 000 reserve) and an
 * aguinaldo in 20 days. Today it opens with $10,421.
 */
export function createRememberedPlanDocument(today: ISODate): FinancialDocument {
  const day = (offset: number): ISODate => addDays(today, offset);
  const once = (date: ISODate): FinancialRecurrence => ({ frequency: "once", startDate: date, endDate: date });
  const start = day(-22);
  return {
    id: "plan-memoria",
    name: "Plan con memoria",
    startDate: start,
    initialCash: 15000,
    minimumCashReserve: 2000,
    horizonMonths: 12,
    history: [
      { date: day(-45), cash: 9800 },
      { date: day(-40), cash: 8600 },
      { date: day(-37), cash: 19600 },
      { date: day(-33), cash: 13100 },
      { date: day(-30), cash: 11900 },
      { date: day(-26), cash: 10300 },
    ],
    items: [
      { id: "m-sueldo", kind: "income", name: "Sueldo", icon: "briefcase", amount: 11000, recurrence: { frequency: "semimonthly", startDate: start } },
      { id: "m-renta", kind: "expense", name: "Renta", icon: "house", amount: 6500, recurrence: { frequency: "monthly", startDate: day(-19) } },
      { id: "m-super", kind: "expense", name: "Súper", icon: "shopping-cart", amount: 1200, recurrence: { frequency: "weekly", startDate: day(-20) } },
      { id: "m-gasolina", kind: "expense", name: "Gasolina", icon: "fuel", amount: 550, recurrence: { frequency: "weekly", startDate: day(-18) } },
      { id: "m-streaming", kind: "expense", name: "Streaming", icon: "tv", amount: 329, recurrence: { frequency: "monthly", startDate: day(-8) } },
      { id: "m-coche", kind: "expense", name: "Reparación del coche", icon: "car", amount: 3500, recurrence: once(day(-10)) },
      { id: "m-aguinaldo", kind: "income", name: "Aguinaldo", icon: "gift", amount: 16000, recurrence: once(day(20)) },
    ],
  };
}
