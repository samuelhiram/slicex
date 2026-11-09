// Goal seek on a debt: "drag the end of a debt to choose when you're free;
// the engine tells you the payment".
//
// Cards: the payoff date is monotonic in the planned payment (a larger
// payment leaves a pointwise smaller debt, hence less interest), so the
// minimal whole-peso payment is a binary search over `estimateDebtPayoffs`
// run on a reduced document (the card and its own purchases only: the
// estimate simulates each account on its own events, so the result for the
// card is identical) with a window just long enough to decide the target.
// Loans: the MVP accrues no loan interest, so the payment is plain division.
import { addDays, addMonths, isISODate, parseISODate } from "./dates";
import { getProjectionRange } from "./events";
import { positiveMoney } from "./money";
import { estimateDebtPayoffs } from "./payoff";
import { loanOpeningDebt } from "./projection";
import { countRecurrence, expandRecurrence } from "./recurrence";
import type {
  CardPurchaseItem,
  CreditCardItem,
  DebtPayoffEstimate,
  FinancialDocument,
  FinancialRecurrence,
  ISODate,
  LoanItem,
} from "./types";

export interface DebtPaymentSolution {
  accountId: string;
  /** New planned payment per period (card: paymentAmount; loan: paymentAmount). Whole pesos for cards, cents for loans. */
  paymentAmount: number;
  /** Payoff date the solution actually reaches (≤ target when feasible). */
  payoffDate: ISODate | null;
  /** False when even the most aggressive payment cannot reach the target (payment is then the one giving the earliest payoff). */
  feasible: boolean;
  /** Interest paid until payoff with the solved payment (0 for loans). */
  totalInterest: number;
  /** For loans without an explicit balance: the recurrence endDate to use with the new payment (the target, aligned to the last payment date). Undefined otherwise. */
  endDate?: ISODate;
}

/** Same default window as `estimateDebtPayoffs`. */
const MAX_MONTHS = 360;

/** Calendar months from `from`'s month to `to`'s month (days ignored). */
function monthsBetween(from: ISODate, to: ISODate): number {
  const [fy, fm] = parseISODate(from);
  const [ty, tm] = parseISODate(to);
  return (ty - fy) * 12 + (tm - fm);
}

/** Months of simulation that cover `date` plus two more months (clamped to 1..MAX_MONTHS). */
function windowMonthsFor(start: ISODate, date: ISODate): number {
  const months = monthsBetween(start, date) + 2;
  return months < 1 ? 1 : months > MAX_MONTHS ? MAX_MONTHS : months;
}

function reaches(estimate: DebtPayoffEstimate, date: ISODate): boolean {
  return estimate.payoffDate !== null && estimate.payoffDate <= date;
}

/** `amount / count` rounded UP to cents (amount already in cents, count ≥ 1). */
function ceilCents(amount: number, count: number): number {
  return Math.ceil(Math.round(amount * 100) / count) / 100;
}

// ---------------------------------------------------------------------------
// Credit cards.

function solveCard(doc: FinancialDocument, card: CreditCardItem, target: ISODate): DebtPaymentSolution | null {
  // "statement" cards pay whatever the statement says: there is no payment to solve.
  if (card.paymentMode === "statement") return null;
  const start = doc.startDate;
  const fullTo = addMonths(start, MAX_MONTHS);

  // The card's own purchases (same account key as estimateDebtPayoffs) and
  // the last day a FINITE charge can happen inside the default window. The
  // reduced window must reach past it: then every purchase is classified
  // steady / finite exactly as in the default 360-month estimate, and no
  // finite charge that would reopen the debt is left outside the window.
  const purchases: CardPurchaseItem[] = [];
  let lastFinite = start;
  for (const item of doc.items) {
    if (item.kind !== "card-purchase" || item.enabled === false) continue;
    if ((item.cardId ? item.cardId : item.id) !== card.id) continue;
    if (positiveMoney(item.amount) === 0) continue;
    purchases.push(item);
    const rec = item.recurrence;
    let last: ISODate | undefined;
    if (rec.frequency === "once") last = rec.anchorDate ?? rec.startDate;
    else if (rec.endDate !== undefined && rec.endDate <= fullTo) last = rec.endDate;
    if (last !== undefined && isISODate(last) && last > lastFinite) lastFinite = last < fullTo ? last : fullTo;
  }

  let months = windowMonthsFor(start, target > lastFinite ? target : lastFinite);
  const opening = positiveMoney(card.balance);
  const rate = Number.isFinite(card.annualRate) && card.annualRate > 0 ? card.annualRate : 0;

  // Upper bound: one payment that clears everything the card can ever owe
  // inside the window — opening + every charge, grown by a generous interest
  // factor (31-day cycles at the card rate, compounded up to two months past
  // the first payment date). With it every payment clears the whole debt, so
  // it reaches the earliest payoff any payment can reach.
  const capTo = addMonths(start, months);
  let charges = 0;
  for (const purchase of purchases) {
    charges += positiveMoney(purchase.amount) * countRecurrence(purchase.recurrence, { from: start, to: capTo });
  }
  if (opening === 0 && charges === 0) return null; // nothing owed
  const payStart = card.recurrence.startDate;
  const monthsToFirstPayment = isISODate(payStart) && payStart > start ? monthsBetween(start, payStart) : 0;
  const growth = Math.pow(1 + (rate * 31) / 36000, Math.min(monthsToFirstPayment, MAX_MONTHS) + 3);
  const minimum = Math.max(1, Math.ceil(positiveMoney(card.minimumPayment) - 1e-9));
  const upper = Math.max(minimum + 1, Math.ceil((opening + charges) * growth) + 1);

  // One reduced document per evaluation: the card (with the trial payment)
  // and its purchases. Shallow copies only; the purchase items are shared.
  const items: [CreditCardItem, ...CardPurchaseItem[]] = [card, ...purchases];
  const reduced: FinancialDocument = { ...doc, items };
  const evaluate = (payment: number, maxMonths: number): DebtPayoffEstimate => {
    items[0] = { ...card, paymentAmount: payment };
    return estimateDebtPayoffs(reduced, { maxMonths }).get(card.id)!;
  };

  let atMinimum = evaluate(minimum, months);
  if (reaches(atMinimum, target)) return cardSolution(card, minimum, atMinimum, true);

  let hi = upper;
  let atHi = evaluate(hi, months);
  let goal = target;
  let feasible = true;
  if (!reaches(atHi, target)) {
    // Infeasible: aim for the earliest payoff any payment reaches.
    feasible = false;
    if (atHi.payoffDate === null && months < MAX_MONTHS) {
      // The earliest payoff may lie past the reduced window (payments that
      // start late): look over the whole default window.
      months = MAX_MONTHS;
      atHi = evaluate(hi, months);
      if (atHi.payoffDate !== null) {
        months = windowMonthsFor(start, atHi.payoffDate > lastFinite ? atHi.payoffDate : lastFinite);
        atHi = evaluate(hi, months);
        atMinimum = evaluate(minimum, months);
      }
    }
    if (atHi.payoffDate === null) {
      // No payment ever clears the card (its payments stop too early): keep the current one.
      const current = Math.max(minimum, Math.ceil(positiveMoney(card.paymentAmount ?? card.minimumPayment) - 1e-9));
      return cardSolution(card, current, evaluate(current, MAX_MONTHS), false);
    }
    goal = atHi.payoffDate;
    if (reaches(atMinimum, goal)) return cardSolution(card, minimum, atMinimum, false);
  }

  // Invariant: `lo` misses the goal, `hi` reaches it.
  let lo = minimum;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const atMid = evaluate(mid, months);
    if (reaches(atMid, goal)) {
      hi = mid;
      atHi = atMid;
    } else {
      lo = mid;
    }
  }
  return cardSolution(card, hi, atHi, feasible);
}

function cardSolution(
  card: CreditCardItem,
  payment: number,
  estimate: DebtPayoffEstimate,
  feasible: boolean,
): DebtPaymentSolution {
  return {
    accountId: card.id,
    paymentAmount: payment,
    payoffDate: estimate.payoffDate,
    feasible,
    totalInterest: estimate.totalInterest,
  };
}

// ---------------------------------------------------------------------------
// Loans.

/** Last occurrence of `rec` inside [from, to] (respects the rule window), or null. */
function lastOccurrenceUpTo(rec: FinancialRecurrence, from: ISODate, to: ISODate): ISODate | null {
  if (to < from) return null;
  if (rec.frequency === "once") {
    const dates = expandRecurrence(rec, { from, to });
    return dates.length > 0 ? dates[0]! : null;
  }
  // Recurring schedules never leave a gap longer than 31 days.
  const lo = addDays(to, -31);
  const dates = expandRecurrence(rec, { from: lo > from ? lo : from, to });
  return dates.length > 0 ? dates[dates.length - 1]! : null;
}

/** First occurrence of `rec` on/after `from` (respects the rule window, looks up to `limit`), or null. */
function firstOccurrenceFrom(rec: FinancialRecurrence, from: ISODate, limit: ISODate): ISODate | null {
  if (rec.frequency === "once" || !isISODate(rec.startDate)) {
    const dates = expandRecurrence(rec, { from, to: limit });
    return dates.length > 0 ? dates[0]! : null;
  }
  const lo = rec.startDate > from ? rec.startDate : from;
  const hi = addDays(lo, 31);
  const dates = expandRecurrence(rec, { from: lo, to: hi < limit ? hi : limit });
  return dates.length > 0 ? dates[0]! : null;
}

function loanSolution(
  loan: LoanItem,
  payment: number,
  payoffDate: ISODate | null,
  feasible: boolean,
  endDate?: ISODate,
): DebtPaymentSolution {
  const out: DebtPaymentSolution = { accountId: loan.id, paymentAmount: payment, payoffDate, feasible, totalInterest: 0 };
  if (endDate !== undefined) out.endDate = endDate;
  return out;
}

function solveLoan(doc: FinancialDocument, loan: LoanItem, target: ISODate): DebtPaymentSolution | null {
  const start = doc.startDate;
  const rec = loan.recurrence;
  const fullTo = addMonths(start, MAX_MONTHS);

  if (loan.balance !== undefined && Number.isFinite(loan.balance)) {
    // Explicit balance: spread it over the loan's scheduled payments (its
    // own window, endDate included) from the document start to the target.
    const balance = positiveMoney(loan.balance);
    if (balance === 0) return null;
    const n = target >= start ? countRecurrence(rec, { from: start, to: target }) : 0;
    const payment = n > 0 ? ceilCents(balance, n) : balance;
    const maxMonths = n > 0 ? windowMonthsFor(start, target) : MAX_MONTHS;
    const reduced: FinancialDocument = { ...doc, items: [{ ...loan, paymentAmount: payment }] };
    const estimate = estimateDebtPayoffs(reduced, { maxMonths }).get(loan.id)!;
    return loanSolution(loan, payment, estimate.payoffDate, n > 0 && reaches(estimate, target));
  }

  // No balance: the debt is paymentAmount × the payments from the document
  // start to endDate (see LoanItem). Keep that total and re-spread it over
  // the payments up to the target, which becomes the new endDate.
  const total = loanOpeningDebt(loan, getProjectionRange(doc));
  if (total === 0) return null;
  const open: FinancialRecurrence = { ...rec };
  delete open.endDate;
  const last = target >= start ? lastOccurrenceUpTo(open, start, target) : null;
  if (last === null) {
    // Not even one payment fits before the target: one payment of the whole
    // debt on the first scheduled date is the earliest payoff.
    const first = firstOccurrenceFrom(open, start, fullTo);
    return first === null ? loanSolution(loan, total, null, false) : loanSolution(loan, total, first, false, first);
  }
  const n = countRecurrence(open, { from: start, to: last });
  // n ≥ 1 (`last` is one of them); n × payment ≥ total by less than n cents.
  return loanSolution(loan, ceilCents(total, n), last, true, last);
}

// ---------------------------------------------------------------------------

/**
 * Goal seek: the planned payment that pays debt account `accountId` off by
 * `targetPayoff`.
 *
 * - Credit card ("fixed" mode): the minimal whole-peso `paymentAmount`
 *   (≥ max(1, minimumPayment)) whose `estimateDebtPayoffs` payoff is on or
 *   before the target. Binary search; each step simulates only the card and
 *   its own purchases over a window that ends two months past the later of
 *   the target and the last finite purchase. When no payment can make it
 *   (the target is before the first due date that could clear the card),
 *   `feasible` is false and the payment is the minimal one that reaches the
 *   EARLIEST payoff any payment reaches. A "statement" card has no payment
 *   to solve: null.
 * - Loan with `balance`: ceil-to-cents(balance / n), n = the loan's scheduled
 *   payments (its own recurrence window) from the document start to the
 *   target; n = 0 → infeasible with the whole balance as the payment.
 * - Loan without balance, with `recurrence.endDate`: keeps the loan's total
 *   (paymentAmount × payments to endDate), moves endDate to the last
 *   scheduled payment ≤ target (returned as `endDate`) and spreads the total
 *   over the payments up to it (rounded up to cents). No payment before the
 *   target → infeasible: the whole total on the first scheduled payment.
 *
 * Null for installment plans, unknown / disabled ids, accounts that owe
 * nothing, and malformed dates. Pure and allocation-light: a card call costs
 * ~log2(debt) payoff simulations over the reduced window.
 */
export function solveDebtPayment(
  doc: FinancialDocument,
  accountId: string,
  targetPayoff: ISODate,
): DebtPaymentSolution | null {
  if (!isISODate(doc.startDate) || !isISODate(targetPayoff)) return null;
  // The first enabled item with that id (the one estimateDebtPayoffs reports).
  for (const item of doc.items) {
    if (item.id !== accountId || item.enabled === false) continue;
    switch (item.kind) {
      case "credit-card":
        return solveCard(doc, item, targetPayoff);
      case "loan":
        return solveLoan(doc, item, targetPayoff);
      default:
        return null;
    }
  }
  return null;
}
