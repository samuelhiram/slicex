// What the item editor says back BEFORE "Guardar", per kind (UX-01, UX-07,
// UX-08, UX-28, UX-33): when the money really moves and what the debt does.
// Every date / amount comes from the engine's own functions (the events,
// the payoff estimate, the goal seek) run on the draft — never a second
// copy of its rules — so the editor and the plan cannot disagree.
// Pure: no React, no DOM, no clock.
import {
  addMonths,
  amortizedPayment,
  estimateDebtPayoffs,
  expandFinancialEvents,
  isISODate,
  loanPaymentCount,
  periodsPerYear,
  projectFinancialDocument,
  solveDebtPayment,
  statementDueDate,
  type CardPurchaseItem,
  type CreditCardItem,
  type FinancialDocument,
  type FinancialItem,
  type ISODate,
  type InstallmentPlanItem,
  type LoanItem,
} from "@slicex/core";
import { formatDateWeekday, formatMoney, formatMoneyWhole } from "./format";
import { frequencyShort } from "./labels";
import { paymentCount } from "./schedule-ui";
import { formatMonthYear } from "./visuals";

export type ReadbackTone = "neutral" | "positive" | "warning";

function finite(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n);
}

function stripEnd<T extends FinancialItem>(item: T): T {
  const recurrence = { ...item.recurrence };
  delete recurrence.endDate;
  return { ...item, enabled: true, recurrence } as T;
}

// --- MSI ---------------------------------------------------------------------

export interface InstallmentSchedule {
  /** Every remaining installment the engine schedules with NO end date. */
  all: ISODate[];
  /** Those inside the plan's window (its endDate, when it has one). */
  kept: ISODate[];
  /** Number of the first remaining installment (installmentsPaid + 1). */
  firstNumber: number;
  total: number;
  /** The card it is paid with (found in the plan), or null. */
  card: CreditCardItem | null;
}

/**
 * The MSI's installments as the engine pays them: on the card's payment day
 * (or the start's day of month without a card), from max(start, plan start),
 * at most the remaining count. `kept` < `all` means an end date cuts some.
 * Null when the plan cannot be read yet (bad numbers / date).
 */
export function installmentSchedule(
  plan: InstallmentPlanItem,
  cards: ReadonlyArray<CreditCardItem>,
  docStartDate: ISODate,
): InstallmentSchedule | null {
  const total = plan.installmentsTotal;
  const paid = plan.installmentsPaid;
  if (!isISODate(plan.recurrence.startDate) || !isISODate(docStartDate)) return null;
  if (!finite(total) || !Number.isInteger(total) || total < 1) return null;
  if (!finite(paid) || !Number.isInteger(paid) || paid < 0 || paid > total) return null;
  if (!finite(plan.originalAmount) || plan.originalAmount < 0) return null;
  const card = plan.cardId ? (cards.find((candidate) => candidate.id === plan.cardId) ?? null) : null;
  const remaining = total - paid;
  if (remaining === 0) return { all: [], kept: [], firstNumber: total + 1, total, card };
  const start = plan.recurrence.startDate > docStartDate ? plan.recurrence.startDate : docStartDate;
  const open = stripEnd(plan);
  const doc: FinancialDocument = {
    id: "readback",
    name: "",
    startDate: docStartDate,
    initialCash: 0,
    minimumCashReserve: 0,
    horizonMonths: 1,
    items: card ? [open, { ...card, enabled: true }] : [open],
  };
  const range = { from: docStartDate, to: addMonths(start, remaining + 2) };
  const all = expandFinancialEvents(doc, range)
    .filter((event) => event.itemId === plan.id && event.type === "installment-payment")
    .map((event) => event.date);
  const end = plan.recurrence.endDate;
  const kept = end !== undefined && isISODate(end) ? all.filter((date) => date <= end) : all;
  return { all, kept, firstNumber: paid + 1, total, card };
}

/**
 * "Abonas $1,000 al mes con Nu: el primero el lun 21 dic 2026 (1 de 12), el
 * último el jue 21 oct 2027 (12 de 12)." — the MSI readback (UX-07, UX-33).
 */
export function installmentSentence(plan: InstallmentPlanItem, schedule: InstallmentSchedule): string {
  const { all, firstNumber, total, card } = schedule;
  if (all.length === 0) return "Ya no le quedan abonos.";
  const monthly = total > 0 ? plan.originalAmount / total : 0;
  const how = card ? ` con ${card.name.trim() || "tu tarjeta"}` : "";
  const first = all[0]!;
  const last = all[all.length - 1]!;
  const lastNumber = firstNumber + all.length - 1;
  const firstWord = firstNumber === 1 ? "el primero" : "el próximo";
  if (all.length === 1) {
    return `Abonas ${formatMoney(Math.round(monthly * 100) / 100)}${how} el ${formatDateWeekday(first)} (${firstNumber} de ${total}).`;
  }
  return (
    `Abonas ${formatMoney(Math.round(monthly * 100) / 100)} al mes${how}: ${firstWord} el ` +
    `${formatDateWeekday(first)} (${firstNumber} de ${total}), el último el ` +
    `${formatDateWeekday(last)} (${lastNumber} de ${total}).`
  );
}

// --- Credit card ---------------------------------------------------------------

/** The card with only its own purchases: what the payoff / goal seek simulate. */
function cardAccount(card: CreditCardItem, doc: FinancialDocument): FinancialDocument {
  const purchases = doc.items.filter(
    (item): item is CardPurchaseItem =>
      item.kind === "card-purchase" && item.enabled !== false && item.cardId === card.id,
  );
  return { ...doc, items: [{ ...card, enabled: true }, ...purchases] };
}

export interface CardPreview {
  /** First payment the plan makes (date + amount), or null when none in the horizon. */
  next: { date: ISODate; amount: number } | null;
  /** Payoff estimate (same as the line header's "Libre en …"). */
  payoffDate: ISODate | null;
  totalInterest: number;
  /** Debt the card carries at all (balance or purchases). */
  owes: boolean;
}

/** Next payment and payoff of a card draft, by the engine (projection + payoff estimate). */
export function cardPreview(card: CreditCardItem, doc: FinancialDocument): CardPreview | null {
  if (!isISODate(doc.startDate) || !isISODate(card.recurrence.startDate)) return null;
  if (![card.balance, card.annualRate, card.cutDay, card.dueDay].every(finite)) return null;
  const account = cardAccount(card, doc);
  const projection = projectFinancialDocument(account);
  const payment = projection.points.find(
    (point) => point.itemId === card.id && point.type === "credit-card-payment" && point.cashDelta < 0,
  );
  const estimate = estimateDebtPayoffs(account).get(card.id);
  const owes = card.balance > 0 || account.items.length > 1;
  return {
    next: payment ? { date: payment.date, amount: -payment.cashDelta } : null,
    payoffDate: estimate?.payoffDate ?? null,
    totalInterest: estimate?.totalInterest ?? 0,
    owes,
  };
}

function dayText(day: number): string {
  return day >= 31 ? "el último día" : `el ${day}`;
}

/**
 * "Cortas el 11 y pagas el 21 de cada mes. Próximo pago: lun 21 dic 2026 · $2,000." (UX-33)
 */
export function cardSentence(card: CreditCardItem, preview: CardPreview | null): string {
  const cycle = `Cortas ${dayText(card.cutDay)} y pagas ${dayText(card.dueDay)} de cada mes.`;
  if (!preview) return cycle;
  if (!preview.next) {
    return preview.owes ? `${cycle} En tu plan no hay ningún pago de esta tarjeta.` : `${cycle} No debes nada: no hay pagos.`;
  }
  return `${cycle} Próximo pago: ${formatDateWeekday(preview.next.date)} · ${formatMoney(preview.next.amount)}.`;
}

/**
 * The live payoff line of a card (UX-01): "Libre en jul 2028 · intereses ≈
 * $4,210", "Con $0 al mes no se liquida", totalero's own sentence.
 */
export function cardPayoffLine(
  card: CreditCardItem,
  preview: CardPreview | null,
): { text: string; tone: ReadbackTone } | null {
  if (!preview || !preview.owes) return null;
  if (card.paymentMode === "statement") {
    return {
      text: preview.payoffDate
        ? `Totalero: pagas cada estado de cuenta completo, sin intereses · libre en ${formatMonthYear(preview.payoffDate)}`
        : "Totalero: pagas cada estado de cuenta completo, sin intereses",
      tone: "positive",
    };
  }
  const planned = card.paymentAmount ?? card.minimumPayment;
  if (!finite(planned) || planned <= 0) {
    return { text: "Con $0 al mes no se liquida: la deuda solo crece con los intereses", tone: "warning" };
  }
  if (preview.payoffDate === null) {
    return {
      text: `Con ${formatMoneyWhole(planned)} al mes no se liquida: no alcanza para los intereses`,
      tone: "warning",
    };
  }
  return {
    text: `Libre en ${formatMonthYear(preview.payoffDate)} · intereses ≈ ${formatMoneyWhole(preview.totalInterest)}`,
    tone: "neutral",
  };
}

/** "Se carga a Nu el …; lo pagas completo el … (totalero)". UX-33 for a purchase. */
export function purchaseSentence(purchase: CardPurchaseItem, card: CreditCardItem | null): string | null {
  const date = purchase.recurrence.startDate;
  if (!card || !isISODate(date)) return null;
  const name = card.name.trim() || "tu tarjeta";
  const once = purchase.recurrence.frequency === "once";
  const when = once ? `el ${formatDateWeekday(date)}` : `desde el ${formatDateWeekday(date)}`;
  if (card.paymentMode === "statement") {
    if (!once) return `Se carga a ${name} ${when}; cada cargo lo pagas completo con el estado de cuenta.`;
    return `Se carga a ${name} ${when}; lo pagas completo el ${formatDateWeekday(statementDueDate(card, date))} (totalero, sin intereses).`;
  }
  return `Se carga a ${name} ${when}: se suma a su deuda y sale de tu caja con los pagos de la tarjeta.`;
}

// --- Loans -----------------------------------------------------------------------

export interface LoanCheck {
  text: string;
  tone: ReadbackTone;
  /** "Ajustar a N pagos": the count that pays the balance off. */
  adjustTo?: number;
}

/**
 * Do balance, payment and number of payments agree? (UX-08) With the rate,
 * by standard amortization: the payment already includes the interest. Null
 * when there is nothing to check (no balance, no payment, no count yet).
 */
export function loanCheck(loan: LoanItem): LoanCheck | null {
  const balance = loan.balance;
  const payment = loan.paymentAmount;
  if (!finite(balance) || balance <= 0 || !finite(payment) || payment <= 0) return null;
  if (loan.recurrence.frequency === "once") return null;
  const perYear = periodsPerYear(loan.recurrence);
  const needed = loanPaymentCount(balance, loan.annualRate, payment, perYear);
  const count = paymentCount(loan.recurrence);
  const withRate = finite(loan.annualRate) && loan.annualRate > 0;
  const debt = `tu saldo de ${formatMoneyWhole(balance)}${withRate ? ` al ${loan.annualRate}%` : ""}`;
  if (needed === null) {
    return { text: `Con ${formatMoney(payment)} no cubres ni los intereses de ${debt}: usa «Calcular pago».`, tone: "warning" };
  }
  if (count === null || count === 0) return null;
  const total = formatMoneyWhole(payment * count);
  if (count > needed) {
    return {
      text: `${count} × ${formatMoney(payment)} = ${total}, más de lo que cuesta ${debt}: lo liquidas en ${needed} ${needed === 1 ? "pago" : "pagos"}.`,
      tone: "warning",
      adjustTo: needed,
    };
  }
  if (count < needed) {
    const missing = needed - count;
    return {
      text: `Con ${count} ${count === 1 ? "pago" : "pagos"} de ${formatMoney(payment)} no alcanzas a liquidar ${debt}: te faltarían ${missing}.`,
      tone: "warning",
      adjustTo: needed,
    };
  }
  return { text: `${count} × ${formatMoney(payment)} = ${total}: con el último pago liquidas ${debt}.`, tone: "positive" };
}

/** "Calcular pago": the amortized payment of the loan's balance over its payments, or null when it cannot be computed. */
export function loanSuggestedPayment(loan: LoanItem): number | null {
  const count = paymentCount(loan.recurrence);
  if (!finite(loan.balance) || loan.balance <= 0 || !count || count < 1) return null;
  const payment = amortizedPayment(loan.balance, loan.annualRate, count, periodsPerYear(loan.recurrence));
  return payment > 0 ? payment : null;
}

// --- Goal seek ("Quiero liquidarla el …", UX-28) ----------------------------------

export interface PayoffGoal {
  /** Same words as the canvas pill: "Libre en ago 2027 · pagas $2,150/mes". */
  text: string;
  feasible: boolean;
  paymentAmount: number;
  /** The end date the payment needs (loans), so the plan stops paying then. */
  endDate?: ISODate;
}

/** `doc` with the draft in place of (or added as) its item. */
export function docWithItem(doc: FinancialDocument, item: FinancialItem): FinancialDocument {
  let found = false;
  const items = doc.items.map((candidate) => {
    if (candidate.id !== item.id) return candidate;
    found = true;
    return item;
  });
  return { ...doc, items: found ? items : [...items, item] };
}

/** The payment that frees the debt by `target` (solveDebtPayment on the draft), worded like the canvas pill. */
export function payoffGoal(
  item: CreditCardItem | LoanItem,
  doc: FinancialDocument,
  target: ISODate,
): PayoffGoal | null {
  if (!isISODate(target)) return null;
  const solution = solveDebtPayment(docWithItem(doc, { ...item, enabled: true }), item.id, target);
  if (!solution) return null;
  const per = item.kind === "credit-card" ? "/mes" : frequencyShort(item.recurrence);
  const payment = formatMoneyWhole(solution.paymentAmount);
  const when = solution.payoffDate ? formatMonthYear(solution.payoffDate) : "";
  const text = solution.feasible
    ? `Libre en ${when} · pagas ${payment}${per}`
    : when
      ? `Lo antes posible: ${when} pagando ${payment}${per}`
      : `Pagando ${payment}${per}`;
  const goal: PayoffGoal = { text, feasible: solution.feasible, paymentAmount: solution.paymentAmount };
  // Loans pay their whole window: end it on the payoff so the cash stops too.
  if (item.kind === "loan") {
    const end = solution.endDate ?? solution.payoffDate ?? undefined;
    if (end) goal.endDate = end;
  }
  return goal;
}
