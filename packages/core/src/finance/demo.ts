// Demo scenario for the MVP (deterministic: every date derives from `startDate`).
import { addDays, addMonths } from "./dates";
import type { FinancialDocument, ISODate } from "./types";

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
        amount: 9000,
        recurrence: { frequency: "semimonthly", startDate },
      },
      {
        id: "fin-pago-plata",
        kind: "expense",
        name: "Pago Tarjeta Plata",
        amount: 5792,
        recurrence: { frequency: "once", startDate: plataDate, endDate: plataDate },
      },
      {
        id: "fin-gasto",
        kind: "expense",
        name: "Gasto",
        amount: 2000,
        recurrence: { frequency: "once", startDate: gastoDate, endDate: gastoDate },
      },
      {
        id: "fin-prestamo",
        kind: "loan",
        name: "Préstamo personal",
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
        cardId: "fin-bbva",
        originalAmount: 18000,
        installmentsTotal: 12,
        installmentsPaid: 3,
        recurrence: { frequency: "monthly", startDate },
      },
    ],
  };
}
