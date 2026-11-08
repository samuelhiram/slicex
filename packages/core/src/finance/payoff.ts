// Debt payoff estimates: when does each debt account reach 0 for good?
//
// Each account is simulated on its OWN events only (cash is irrelevant: the
// planned payments are fixed amounts capped at the debt), with exactly the
// projection's arithmetic (same-day order, average-daily-balance accrual at
// the same moments, cents after every step), so inside the projection range
// the simulated debt equals the projection's `accountDebtAfter`. Schedules
// are lazy day-number cursors (no date strings, no arrays) and the
// simulation stops as soon as the payoff is final, so a 360-month window
// costs only the months it actually needs.
import { addMonths, fromDayNumber, isISODate, parseISODate, toDayNumber } from "./dates";
import { EVENT_TYPE_PRIORITY } from "./events";
import { installmentAmount, installmentsPaidOf, isFutureInstallmentPlan, remainingInstallmentCount, remainingInstallmentDebt } from "./items";
import { positiveMoney, roundMoney } from "./money";
import { installmentOpeningDebt, loanOpeningDebt } from "./projection";
import { intersectWindow } from "./recurrence";
import { DayCursor } from "./schedule";
import type {
  CardPurchaseItem,
  CreditCardItem,
  DebtPayoffEstimate,
  DebtPayoffOptions,
  FinancialDocument,
  FinancialRecurrence,
  ISODate,
  InstallmentPlanItem,
  LoanItem,
} from "./types";

const DEFAULT_MAX_MONTHS = 360;

const INTEREST = 0;
const CHARGE = 1;
const PAYMENT = 2;

/** One schedule of the account's own events. */
interface Source {
  cursor: DayCursor;
  /** Same-day order (EVENT_TYPE_PRIORITY). */
  priority: number;
  role: typeof INTEREST | typeof CHARGE | typeof PAYMENT;
  /** Planned positive magnitude (charges, card / loan payments). */
  amount: number;
  /** CHARGE: the schedule keeps charging past the cap (a subscription), see `simulate`. */
  steady: boolean;
  /** PAYMENT of an MSI plan: installment n = firstNumber + taken (the last one carries the cents). */
  plan: InstallmentPlanItem | null;
  firstNumber: number;
  /** Occurrences already processed. */
  taken: number;
}

function source(cursor: DayCursor, priority: number, role: Source["role"], amount: number, steady = false): Source {
  return { cursor, priority, role, amount, steady, plan: null, firstNumber: 0, taken: 0 };
}

interface AccountInput {
  opening: number;
  /** Annual rate in % (0 = no interest source). */
  rate: number;
  sources: Source[];
  /**
   * The payment schedule goes on past the cap: debt left at the cap by
   * steady charges is the current cycle, paid by the next payment.
   */
  paysPastCap: boolean;
}

interface Totals {
  payoffDay: number | null;
  totalInterest: number;
  totalPaid: number;
  finalDebt: number;
}

/** Past the cap, or open-ended: a recurring charge that never stops inside the window. */
function isSteady(rec: FinancialRecurrence, capDate: ISODate): boolean {
  return rec.frequency !== "once" && (rec.endDate === undefined || rec.endDate > capDate);
}

/**
 * Runs one account from `startDay` to the end of `capDay`.
 *
 * Payoff rule. A payment that leaves the debt at 0 is a payoff CANDIDATE
 * (an account with no opening debt starts as one). The candidate is dropped
 * by a later finite charge (a purchase / debt opening whose schedule ends
 * inside the window) and by a later payment that leaves debt behind. Steady
 * charges (recurring with no end inside the window: subscriptions) do not
 * drop it as long as every following payment clears them, and debt they left
 * at the cap only counts as unpaid when the payments stop before the cap.
 * The simulation stops at the candidate once no charge remains.
 *
 * At the payoff, the interest accrued since the last cut (which the
 * projection posts at the next cut and the next payment settles) is counted
 * in totalInterest and totalPaid: they are the full cost of the debt. With no
 * payoff, interest accrued up to the end of the cap date is counted in
 * totalInterest and finalDebt. Either way
 * totalPaid = opening + charges + totalInterest − finalDebt.
 */
function simulate(input: AccountInput, startDay: number, capDay: number): Totals {
  const { rate, sources } = input;
  let debt = input.opening;
  let pending = 0;
  let accruedTo = startDay;
  let interest = 0;
  let paid = 0;

  let chargesLeft = 0;
  for (const s of sources) if (s.role === CHARGE && s.cursor.day <= capDay) chargesLeft++;

  // Day of the payoff candidate (null = none).
  let candidate: number | null = debt > 0 ? null : startDay;
  let candidateInterest = 0;
  let candidatePaid = 0;

  // Average-daily-balance accrual: the projection's `accrue`, same operands, same order.
  const accrue = (day: number): void => {
    const days = day - accruedTo;
    if (days <= 0) return;
    if (rate > 0 && debt > 0) pending += (debt * rate * days) / 36000;
    accruedTo = day;
  };

  while (candidate === null || chargesLeft > 0) {
    // Next event: earliest day, then same-day priority, then source order.
    let next: Source | null = null;
    let nextDay = Number.POSITIVE_INFINITY;
    let nextPriority = 0;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i]!;
      const d = s.cursor.day;
      if (d < nextDay || (d === nextDay && s.priority < nextPriority)) {
        next = s;
        nextDay = d;
        nextPriority = s.priority;
      }
    }
    if (next === null || nextDay > capDay) break;

    switch (next.role) {
      case INTEREST: {
        accrue(nextDay);
        const posted = roundMoney(pending);
        pending = 0;
        if (posted !== 0) {
          debt = roundMoney(debt + posted);
          interest = roundMoney(interest + posted);
        }
        break;
      }
      case CHARGE: {
        if (next.amount === 0) break;
        accrue(nextDay);
        debt = roundMoney(debt + next.amount);
        if (!next.steady) candidate = null;
        break;
      }
      default: {
        const planned = next.plan ? installmentAmount(next.plan, next.firstNumber + next.taken) : next.amount;
        const applied = Math.min(planned, Math.max(0, debt));
        if (applied !== 0) {
          accrue(nextDay);
          debt = roundMoney(debt - applied);
          paid = roundMoney(paid + applied);
        }
        if (debt > 0) {
          candidate = null;
        } else if (candidate === null) {
          candidate = nextDay;
          const residual = roundMoney(pending);
          candidateInterest = roundMoney(interest + residual);
          candidatePaid = roundMoney(paid + residual);
        }
        break;
      }
    }
    next.taken++;
    next.cursor.advance();
    if (next.role === CHARGE && next.cursor.day > capDay) chargesLeft--;
  }

  if (candidate !== null && debt > 0 && !input.paysPastCap) candidate = null;
  if (candidate !== null) {
    return { payoffDay: candidate, totalInterest: candidateInterest, totalPaid: candidatePaid, finalDebt: 0 };
  }
  accrue(capDay + 1);
  const residual = roundMoney(pending);
  return {
    payoffDay: null,
    totalInterest: roundMoney(interest + residual),
    totalPaid: paid,
    finalDebt: roundMoney(debt + residual),
  };
}

function finiteRate(rate: number | undefined): number {
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 0;
}

type Range = { from: ISODate; to: ISODate };

function cardInput(
  card: CreditCardItem,
  purchases: readonly CardPurchaseItem[] | undefined,
  range: Range,
  startDay: number,
  capDay: number,
): AccountInput {
  const rate = finiteRate(card.annualRate);
  const sources: Source[] = [];
  // Interest is charged at every cut over the whole window (whatever the card's recurrence).
  if (rate > 0) {
    const cursor = new DayCursor().startMonthly(card.cutDay, { lo: startDay, hi: capDay });
    sources.push(source(cursor, EVENT_TYPE_PRIORITY["credit-card-interest"], INTEREST, 0));
  }
  if (purchases) {
    for (const purchase of purchases) {
      const amount = positiveMoney(purchase.amount);
      if (amount === 0) continue;
      const cursor = new DayCursor().startRecurrence(purchase.recurrence, range);
      if (cursor.day > capDay) continue;
      const steady = isSteady(purchase.recurrence, range.to);
      sources.push(source(cursor, EVENT_TYPE_PRIORITY["credit-card-purchase"], CHARGE, amount, steady));
    }
  }
  const planned = positiveMoney(card.paymentAmount ?? card.minimumPayment);
  const rec = card.recurrence;
  const payWindow = planned > 0 ? intersectWindow(rec.startDate, rec.endDate, range) : null;
  let paysPastCap = false;
  if (payWindow) {
    const cursor = new DayCursor().startMonthly(card.dueDay, payWindow);
    if (cursor.day <= capDay) {
      sources.push(source(cursor, EVENT_TYPE_PRIORITY["credit-card-payment"], PAYMENT, planned));
      paysPastCap = rec.endDate === undefined || rec.endDate > range.to;
    }
  }
  return { opening: positiveMoney(card.balance), rate, sources, paysPastCap };
}

function loanInput(loan: LoanItem, range: Range): AccountInput {
  const sources: Source[] = [];
  const amount = positiveMoney(loan.paymentAmount);
  if (amount > 0) {
    const cursor = new DayCursor().startRecurrence(loan.recurrence, range);
    sources.push(source(cursor, EVENT_TYPE_PRIORITY["loan-payment"], PAYMENT, amount));
  }
  // The MVP accrues no loan interest (annualRate is informative).
  return { opening: loanOpeningDebt(loan, range), rate: 0, sources, paysPastCap: true };
}

function installmentInput(plan: InstallmentPlanItem, card: CreditCardItem | undefined, range: Range): AccountInput {
  const sources: Source[] = [];
  const rec = plan.recurrence;
  const remaining = remainingInstallmentCount(plan);
  if (remaining > 0) {
    // A future purchase books its debt (no cash) on its start date.
    if (isFutureInstallmentPlan(plan, range.from) && rec.startDate <= range.to) {
      const cursor = new DayCursor().startFixedStep(toDayNumber(rec.startDate), 0, {
        lo: toDayNumber(range.from),
        hi: toDayNumber(range.to),
      });
      sources.push(source(cursor, EVENT_TYPE_PRIORITY["debt-opening"], CHARGE, remainingInstallmentDebt(plan)));
    }
    // Installments from max(startDate, doc start), on the card's dueDay or the anchor's day of month.
    const window = intersectWindow(rec.startDate, rec.endDate, range);
    if (window) {
      let dayOfMonth: number;
      if (card) {
        dayOfMonth = card.dueDay;
      } else {
        const anchor = rec.anchorDate !== undefined && isISODate(rec.anchorDate) ? rec.anchorDate : rec.startDate;
        dayOfMonth = parseISODate(anchor)[2];
      }
      const cursor = new DayCursor().startMonthly(dayOfMonth, window, remaining);
      const s = source(cursor, EVENT_TYPE_PRIORITY["installment-payment"], PAYMENT, 0);
      s.plan = plan;
      s.firstNumber = installmentsPaidOf(plan) + 1;
      sources.push(s);
    }
  }
  return { opening: installmentOpeningDebt(plan, range.from), rate: 0, sources, paysPastCap: true };
}

/**
 * Payoff estimate of every enabled debt account of `doc` (credit cards,
 * loans, MSI plans; keyed by item id, document order; the first item wins
 * when ids repeat). Each account is simulated from `doc.startDate` to
 * `addMonths(doc.startDate, maxMonths)` (default 360) on its own events only:
 * card cuts (interest), purchases on the card, MSI debt openings, and the
 * planned payments capped at the debt. Same rules as the projection, so
 * inside the projection range the simulated debt matches `accountDebtAfter`.
 * MSI plans are their own accounts (they do not add to the card's debt).
 *
 * payoffDate is the payment that clears the account for good: after it no
 * purchase or debt opening is left, or the only ones left are recurring
 * charges with no end (subscriptions) that every following payment clears.
 * `doc.startDate` when nothing is owed from the start; null when the debt is
 * still there at the cap (e.g. a card whose payment never covers its
 * interest: its debt then compounds every month up to the cap).
 *
 * Cost: O(events visited) per account, without allocating dates; the
 * simulation stops at the payoff. Never throws: an invalid start date yields
 * an empty map. A new map on every call.
 */
export function estimateDebtPayoffs(
  doc: FinancialDocument,
  options?: DebtPayoffOptions,
): Map<string, DebtPayoffEstimate> {
  const out = new Map<string, DebtPayoffEstimate>();
  if (!isISODate(doc.startDate)) return out;
  const months = options?.maxMonths;
  const maxMonths = months === undefined || !Number.isFinite(months) ? DEFAULT_MAX_MONTHS : Math.max(0, Math.floor(months));
  const range: Range = { from: doc.startDate, to: addMonths(doc.startDate, maxMonths) };
  const startDay = toDayNumber(range.from);
  const capDay = toDayNumber(range.to);

  // One pass: the card each MSI plan pays on (first card per id, disabled
  // ones included, like the projection) and the enabled purchases per account.
  const cards = new Map<string, CreditCardItem>();
  const purchases = new Map<string, CardPurchaseItem[]>();
  for (const item of doc.items) {
    if (item.kind === "credit-card") {
      if (!cards.has(item.id)) cards.set(item.id, item);
    } else if (item.kind === "card-purchase" && item.enabled !== false) {
      const accountId = item.cardId ? item.cardId : item.id;
      const list = purchases.get(accountId);
      if (list) list.push(item);
      else purchases.set(accountId, [item]);
    }
  }

  for (const item of doc.items) {
    if (item.enabled === false || out.has(item.id)) continue;
    let input: AccountInput;
    switch (item.kind) {
      case "credit-card":
        input = cardInput(item, purchases.get(item.id), range, startDay, capDay);
        break;
      case "loan":
        input = loanInput(item, range);
        break;
      case "installment-plan":
        input = installmentInput(item, item.cardId ? cards.get(item.cardId) : undefined, range);
        break;
      default:
        continue;
    }
    const totals = simulate(input, startDay, capDay);
    out.set(item.id, {
      accountId: item.id,
      name: item.name,
      kind: item.kind,
      payoffDate: totals.payoffDay === null ? null : fromDayNumber(totals.payoffDay),
      totalInterest: totals.totalInterest,
      totalPaid: totals.totalPaid,
      finalDebt: totals.finalDebt,
    });
  }
  return out;
}
