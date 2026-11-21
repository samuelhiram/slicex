// Item helpers: MSI maths, "add" defaults, cash direction per kind.
import { addMonths, isISODate, parseISODate } from "./dates";
import { positiveMoney, roundMoney } from "./money";
import type {
  FinancialDocument,
  FinancialItem,
  FinancialItemKind,
  ISODate,
  InstallmentPlanItem,
} from "./types";

/** Internal: installmentsTotal as an integer ≥ 0. */
function installmentsTotalOf(plan: InstallmentPlanItem): number {
  const total = Number.isFinite(plan.installmentsTotal) ? Math.floor(plan.installmentsTotal) : 0;
  return total > 0 ? total : 0;
}

/** Internal: installmentsPaid as an integer ≥ 0. */
export function installmentsPaidOf(plan: InstallmentPlanItem): number {
  const paid = Number.isFinite(plan.installmentsPaid) ? Math.floor(plan.installmentsPaid) : 0;
  return paid > 0 ? paid : 0;
}

/** Internal: remaining MSI installments (integer ≥ 0). */
export function remainingInstallmentCount(plan: InstallmentPlanItem): number {
  const remaining = installmentsTotalOf(plan) - installmentsPaidOf(plan);
  return remaining > 0 ? remaining : 0;
}

/** originalAmount / installmentsTotal, rounded to cents (0 when total ≤ 0). */
export function monthlyInstallment(plan: InstallmentPlanItem): number {
  const total = installmentsTotalOf(plan);
  if (total <= 0) return 0;
  return roundMoney(positiveMoney(plan.originalAmount) / total);
}

/** Part of originalAmount covered by the first `count` installments (capped at originalAmount). */
function paidPortion(plan: InstallmentPlanItem, installment: number, count: number): number {
  const original = positiveMoney(plan.originalAmount);
  if (count >= installmentsTotalOf(plan)) return original;
  const portion = roundMoney(installment * count);
  return portion < original ? portion : original;
}

/**
 * Internal: amount of installment number `n` (1-based). Every installment is
 * `monthlyInstallment` except the last one, which absorbs the cent remainder,
 * so installments 1..total add up exactly to originalAmount. 0 outside 1..total.
 */
export function installmentAmount(plan: InstallmentPlanItem, n: number): number {
  const total = installmentsTotalOf(plan);
  if (!(n >= 1 && n <= total)) return 0;
  const installment = monthlyInstallment(plan);
  const amount = roundMoney(paidPortion(plan, installment, n) - paidPortion(plan, installment, n - 1));
  return amount > 0 ? amount : 0;
}

/**
 * originalAmount − monthlyInstallment × installmentsPaid, rounded to cents
 * (0 when no installment remains). Equals the sum of the remaining
 * installments (the last one absorbs the cent remainder).
 */
export function remainingInstallmentDebt(plan: InstallmentPlanItem): number {
  if (remainingInstallmentCount(plan) <= 0) return 0;
  const debt = roundMoney(
    positiveMoney(plan.originalAmount) - paidPortion(plan, monthlyInstallment(plan), installmentsPaidOf(plan)),
  );
  return debt > 0 ? debt : 0;
}

/**
 * Internal: a plan with no installment paid whose start is after the document
 * start is a future purchase — its debt opens on `recurrence.startDate`
 * (see InstallmentPlanItem).
 */
export function isFutureInstallmentPlan(plan: InstallmentPlanItem, docStartDate: ISODate): boolean {
  const start = plan.recurrence.startDate;
  return (
    installmentsPaidOf(plan) === 0 &&
    remainingInstallmentCount(plan) > 0 &&
    isISODate(start) &&
    isISODate(docStartDate) &&
    start > docStartDate
  );
}

function firstCardId(doc: FinancialDocument | undefined): string | undefined {
  if (!doc) return undefined;
  for (const item of doc.items) {
    if (item.kind === "credit-card") return item.id;
  }
  return undefined;
}

/**
 * Sensible defaults for an "add item" button. `recurrence.startDate = date`
 * for every kind; one-off kinds also get `endDate = date`.
 */
export function createDefaultFinancialItem(
  kind: FinancialItemKind,
  id: string,
  date: ISODate,
  doc?: FinancialDocument,
): FinancialItem {
  switch (kind) {
    case "income":
      return {
        id,
        kind,
        name: "Ingreso",
        amount: 1000,
        recurrence: { frequency: "monthly", startDate: date },
      };
    case "expense":
      return {
        id,
        kind,
        name: "Gasto",
        amount: 500,
        recurrence: { frequency: "once", startDate: date, endDate: date },
      };
    case "loan":
      return {
        id,
        kind,
        name: "Préstamo",
        paymentAmount: 1000,
        recurrence: { frequency: "monthly", startDate: date, endDate: addMonths(date, 12) },
      };
    case "credit-card": {
      const cutDay = parseISODate(date)[2];
      const dueDay = ((cutDay + 10 - 1) % 28) + 1;
      return {
        id,
        kind,
        name: "Tarjeta",
        balance: 0,
        annualRate: 60,
        cutDay,
        dueDay,
        minimumPayment: 0,
        recurrence: { frequency: "monthly", startDate: date },
      };
    }
    case "card-purchase":
      return {
        id,
        kind,
        name: "Compra",
        cardId: firstCardId(doc) ?? "",
        amount: 1000,
        recurrence: { frequency: "once", startDate: date, endDate: date },
      };
    case "installment-plan": {
      const cardId = firstCardId(doc);
      const plan: InstallmentPlanItem = {
        id,
        kind,
        name: "6 MSI",
        originalAmount: 6000,
        installmentsTotal: 6,
        installmentsPaid: 0,
        recurrence: { frequency: "monthly", startDate: date },
      };
      if (cardId !== undefined) plan.cardId = cardId;
      return plan;
    }
    default: {
      const never: never = kind;
      throw new RangeError(`Unknown financial item kind "${String(never)}"`);
    }
  }
}

/** Sign of the item's cash effect: income +1; expense/loan/installment-plan/credit-card (payments) −1; card-purchase 0. */
export function itemCashDirection(kind: FinancialItemKind): 1 | -1 | 0 {
  switch (kind) {
    case "income":
      return 1;
    case "card-purchase":
      return 0;
    default:
      return -1;
  }
}
