// Chronological cash / debt projection.
import { isISODate, toDayNumber } from "./dates";
import {
  compareEventsByDateAndType,
  expandFinancialEvents,
  getProjectionRange,
  isSortedByDateAndType,
} from "./events";
import { isFutureInstallmentPlan, remainingInstallmentDebt } from "./items";
import { positiveMoney, roundMoney } from "./money";
import { countRecurrence, sanitizeDayOfMonth } from "./recurrence";
import { DayCursor } from "./schedule";
import type {
  FinancialDocument,
  FinancialEvent,
  FinancialProjection,
  FinancialProjectionPoint,
  ISODate,
  InstallmentPlanItem,
  LoanItem,
  ProjectionAccount,
} from "./types";

/**
 * Internal: loan debt tracked by the projection (see LoanItem doc). Without
 * a balance, every scheduled payment from `range.from` (the document start)
 * to the loan endDate counts, past the horizon too. O(1): the payments are
 * counted arithmetically, never expanded.
 */
export function loanOpeningDebt(loan: LoanItem, range: { from: ISODate; to: ISODate }): number {
  if (loan.balance !== undefined && Number.isFinite(loan.balance)) return positiveMoney(loan.balance);
  const endDate = loan.recurrence.endDate;
  if (endDate === undefined) return 0;
  const count = countRecurrence(loan.recurrence, { from: range.from, to: endDate });
  return roundMoney(positiveMoney(loan.paymentAmount) * count);
}

/** Internal: MSI debt at the document start (0 for a future plan, see InstallmentPlanItem). */
export function installmentOpeningDebt(plan: InstallmentPlanItem, docStartDate: ISODate): number {
  return isFutureInstallmentPlan(plan, docStartDate) ? 0 : remainingInstallmentDebt(plan);
}

function finiteRate(rate: number | undefined): number {
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/**
 * Debt accounts of the enabled cards, loans and installment plans (document
 * order). A card in "statement" payment mode carries `statementCutDay`.
 */
export function buildProjectionAccounts(
  doc: FinancialDocument,
  range: { from: ISODate; to: ISODate } = getProjectionRange(doc),
): ProjectionAccount[] {
  const accounts: ProjectionAccount[] = [];
  for (const item of doc.items) {
    if (item.enabled === false) continue;
    switch (item.kind) {
      case "credit-card": {
        const account: ProjectionAccount = {
          id: item.id,
          name: item.name,
          kind: "credit-card",
          openingDebt: positiveMoney(item.balance),
          annualRate: finiteRate(item.annualRate),
        };
        if (item.paymentMode === "statement") account.statementCutDay = sanitizeDayOfMonth(item.cutDay);
        accounts.push(account);
        break;
      }
      case "loan":
        accounts.push({
          id: item.id,
          name: item.name,
          kind: "loan",
          openingDebt: loanOpeningDebt(item, range),
          annualRate: finiteRate(item.annualRate),
        });
        break;
      case "installment-plan":
        accounts.push({
          id: item.id,
          name: item.name,
          kind: "installment-plan",
          openingDebt: installmentOpeningDebt(item, doc.startDate),
          annualRate: 0,
        });
        break;
      default:
        break;
    }
  }
  return accounts;
}

interface AccountState {
  debt: number;
  /** Rate the account accrues at (0 for a "statement" card, which never pays interest). */
  rate: number;
  /** Interest accrued since the last cut and not posted yet (unrounded). */
  pendingInterest: number;
  /** Day number up to which `pendingInterest` has been accrued. */
  accruedTo: number;
  /** "statement" cards: the pending statement, paid by the next card payment. */
  statement: number;
  /** "statement" cards: the first cut not closed yet (see `closeStatements`); null for every other account. */
  cuts: DayCursor | null;
  /** The entry of `FinancialProjection.accounts` for this id. */
  out: ProjectionAccount;
}

/**
 * Average-daily-balance accrual: charges the current debt for the days since
 * the last accrual. Called before every debt change and at the cut. O(1).
 */
function accrue(account: AccountState, day: number): void {
  const days = day - account.accruedTo;
  if (days <= 0) return;
  if (account.rate > 0 && account.debt > 0) {
    account.pendingInterest += (account.debt * account.rate * days) / 36000;
  }
  account.accruedTo = day;
}

/**
 * "statement" cards: closes every cut strictly before `day` (a cut closes
 * once its day is over, after that day's events). Lazy: called before ANY
 * event touches the account, so no event touched it between the last one
 * (on or before the oldest open cut) and `day`; the debt at the end of every
 * cut day passed is therefore the current debt. O(cuts passed), month steps.
 */
function closeStatements(account: AccountState, cuts: DayCursor, day: number): void {
  if (cuts.day >= day) return;
  account.statement = account.debt;
  do cuts.advance();
  while (cuts.day < day);
}

/**
 * Applies `events` in chronological order (date → type priority, stable)
 * from `initialCash`. Events outside [startDate, endDate] are ignored and
 * events whose applied amount is 0 produce no point. Purchases and debt
 * openings on an unknown account (or without `accountId`: booked on
 * `itemId`) auto-create a zero-rate account; payments to unknown loan /
 * installment accounts only move cash; card payments to unknown cards apply 0.
 *
 * Accounts with `statementCutDay` ("statement" cards, see CreditCardItem):
 * the pending statement starts at the opening debt and becomes the account
 * debt at every cut (cutDay each month from `startDate`, clamped to the
 * month length, after that day's events); each "credit-card-payment" on the
 * account pays min(statement, debt) — its event amount is ignored — and
 * resets the statement to 0. No interest accrues on those accounts.
 */
export function projectFinancialTimeline(input: TimelineInput): FinancialProjection {
  const events = isSortedByDateAndType(input.events)
    ? input.events
    : input.events.slice().sort(compareEventsByDateAndType);
  return projectSortedTimeline(input, events);
}

interface TimelineInput {
  initialCash: number;
  events: FinancialEvent[];
  startDate: ISODate;
  endDate: ISODate;
  accounts?: ProjectionAccount[];
}

/** `projectFinancialTimeline` for `events` already in date → type order (skips the O(n) check). */
function projectSortedTimeline(input: TimelineInput, events: readonly FinancialEvent[]): FinancialProjection {
  const { startDate, endDate } = input;
  const startDay = toDayNumber(startDate);
  const initialCash = roundMoney(input.initialCash);

  const accounts = new Map<string, AccountState>();
  const outAccounts: ProjectionAccount[] = [];
  let initialDebt = 0;
  for (const account of input.accounts ?? []) {
    const opening = positiveMoney(account.openingDebt);
    initialDebt = roundMoney(initialDebt + opening);
    const existing = accounts.get(account.id);
    if (existing) {
      existing.debt = roundMoney(existing.debt + opening);
      existing.out.openingDebt = existing.debt;
      if (existing.cuts !== null) existing.statement = existing.debt;
    } else {
      const rate = finiteRate(account.annualRate);
      const out: ProjectionAccount = {
        id: account.id,
        name: account.name,
        kind: account.kind,
        openingDebt: opening,
        annualRate: rate,
      };
      let cuts: DayCursor | null = null;
      if (account.statementCutDay !== undefined) {
        const cutDay = sanitizeDayOfMonth(account.statementCutDay);
        out.statementCutDay = cutDay;
        // Open-ended: only cuts before an event of the range are ever reached.
        cuts = new DayCursor().startMonthly(cutDay, { lo: startDay, hi: Number.POSITIVE_INFINITY });
      }
      outAccounts.push(out);
      accounts.set(account.id, {
        debt: opening,
        rate: cuts === null ? rate : 0,
        pendingInterest: 0,
        accruedTo: startDay,
        statement: opening,
        cuts,
        out,
      });
    }
  }

  const points: FinancialProjectionPoint[] = [];
  let cash = initialCash;
  let totalDebt = initialDebt;
  let minimumCash = { date: startDate, cash: initialCash };
  // Day number of `dayDate`, validated and parsed once per distinct date
  // (events are sorted, so a date repeats contiguously).
  let dayDate: ISODate | undefined;
  let day = startDay;

  for (const event of events) {
    const date = event.date;
    if (date < startDate) continue;
    if (date > endDate) break;
    if (date !== dayDate) {
      if (!isISODate(date)) continue;
      dayDate = date;
      day = toDayNumber(date);
    }

    const opensDebt = event.type === "credit-card-purchase" || event.type === "debt-opening";
    // Purchases / openings without an accountId are booked on the item itself.
    const accountId = event.accountId ?? (opensDebt ? event.itemId : undefined);
    let account = accountId !== undefined ? accounts.get(accountId) : undefined;
    if (account !== undefined && account.cuts !== null) closeStatements(account, account.cuts, day);

    let cashDelta = 0;
    let debtDelta = 0;
    let estimated = false;

    switch (event.type) {
      case "income":
        cashDelta = positiveMoney(event.amount);
        break;
      case "expense":
        cashDelta = -positiveMoney(event.amount);
        break;
      case "loan-payment":
      case "installment-payment": {
        const amount = positiveMoney(event.amount);
        cashDelta = -amount;
        if (account) {
          const applied = Math.min(amount, Math.max(0, account.debt));
          debtDelta = -applied;
        }
        break;
      }
      case "credit-card-purchase":
      case "debt-opening":
        debtDelta = positiveMoney(event.amount);
        break;
      case "credit-card-interest": {
        if (!account) break;
        accrue(account, day);
        debtDelta = roundMoney(account.pendingInterest);
        account.pendingInterest = 0;
        estimated = true;
        break;
      }
      case "credit-card-payment": {
        if (!account) break;
        let planned: number;
        if (account.cuts !== null) {
          // "statement" card: pays the statement closed at the last cut, then owes none.
          planned = account.statement;
          account.statement = 0;
        } else {
          planned = positiveMoney(event.amount);
        }
        const applied = Math.min(planned, Math.max(0, account.debt));
        cashDelta = -applied;
        debtDelta = -applied;
        break;
      }
      default:
        break;
    }

    if (cashDelta === 0 && debtDelta === 0) continue;

    const debtBefore = totalDebt;
    if (debtDelta !== 0 && accountId !== undefined) {
      if (!account && opensDebt) {
        const out: ProjectionAccount = {
          id: accountId,
          name: accountId === event.itemId ? event.name : accountId,
          kind: event.type === "debt-opening" ? "installment-plan" : "credit-card",
          openingDebt: 0,
          annualRate: 0,
        };
        outAccounts.push(out);
        account = { debt: 0, rate: 0, pendingInterest: 0, accruedTo: day, statement: 0, cuts: null, out };
        accounts.set(accountId, account);
      }
      if (account) {
        // Close the stretch at the old balance before changing it (a no-op
        // for interest posts, which already accrued up to today).
        accrue(account, day);
        const before = Math.max(0, account.debt);
        account.debt = roundMoney(account.debt + debtDelta);
        totalDebt = roundMoney(totalDebt + Math.max(0, account.debt) - before);
      }
    }

    const cashBefore = cash;
    cash = roundMoney(cash + cashDelta);
    const cashStep = roundMoney(cash - cashBefore);
    const debtStep = roundMoney(totalDebt - debtBefore);
    // One complete literal per shape (no key added after creation, so no
    // out-of-object property store per point); optional keys stay absent.
    // `estimated` implies an account, hence an accountId.
    let point: FinancialProjectionPoint;
    if (accountId === undefined) {
      point = {
        eventId: event.id,
        itemId: event.itemId,
        type: event.type,
        name: event.name,
        date,
        cashBefore,
        cashAfter: cash,
        cashDelta: cashStep,
        debtDelta: debtStep,
        debtAfter: totalDebt,
      };
    } else if (!estimated) {
      point = {
        eventId: event.id,
        itemId: event.itemId,
        type: event.type,
        name: event.name,
        date,
        cashBefore,
        cashAfter: cash,
        cashDelta: cashStep,
        debtDelta: debtStep,
        debtAfter: totalDebt,
        accountId,
        accountDebtAfter: account ? Math.max(0, account.debt) : 0,
      };
    } else {
      point = {
        eventId: event.id,
        itemId: event.itemId,
        type: event.type,
        name: event.name,
        date,
        cashBefore,
        cashAfter: cash,
        cashDelta: cashStep,
        debtDelta: debtStep,
        debtAfter: totalDebt,
        accountId,
        accountDebtAfter: account ? Math.max(0, account.debt) : 0,
        estimated: true,
      };
    }
    points.push(point);

    if (cash < minimumCash.cash) minimumCash = { date, cash };
  }

  return {
    startDate,
    endDate,
    initialCash,
    initialDebt,
    accounts: outAccounts,
    points,
    finalCash: cash,
    finalDebt: totalDebt,
    minimumCash,
  };
}

/** getProjectionRange → expandFinancialEvents → buildProjectionAccounts → projectFinancialTimeline. */
export function projectFinancialDocument(doc: FinancialDocument): FinancialProjection {
  const range = getProjectionRange(doc);
  const events = expandFinancialEvents(doc, range);
  // expandFinancialEvents output is sorted by construction.
  return projectSortedTimeline(
    { initialCash: doc.initialCash, events, startDate: range.from, endDate: range.to, accounts: buildProjectionAccounts(doc, range) },
    events,
  );
}
