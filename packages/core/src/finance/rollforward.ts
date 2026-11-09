// "Rec": bring a saved plan up to a new "today" and record what happened.
//
// The old document is projected; every point dated before the new start is
// "the past". The past becomes a ledger (planned vs actual, per event) and
// the document is rebased on the new start: cash, card / loan balances and
// MSI counters are carried over, one-off items that already happened leave
// the plan. Pure: no clock (the new "today" is passed in), never mutates the
// input document.
import { addDays, addMonths, isISODate, parseISODate, toDayNumber } from "./dates";
import { getProjectionRange } from "./events";
import { installmentsPaidOf, remainingInstallmentCount } from "./items";
import { roundMoney } from "./money";
import { projectFinancialDocument } from "./projection";
import { debtByAccountAt, snapshotAt } from "./queries";
import { monthDayNumber, monthIndexOf, sanitizeDayOfMonth } from "./recurrence";
import type {
  FinancialDocument,
  FinancialEventType,
  FinancialItem,
  FinancialProjection,
  FinancialProjectionPoint,
  FinancialRecurrence,
  ISODate,
} from "./types";

export type ActualStatus = "happened" | "skipped" | "edited";

/** What really happened to one past event (`eventId` = the projection point's id). */
export interface ActualRecord {
  eventId: string;
  status: ActualStatus;
  /**
   * Positive magnitude, required for "edited" (the sign comes from the event
   * type; a negative number is read as its magnitude). An "edited" record
   * without a finite amount counts as "happened".
   */
  amount?: number;
}

/** One past event, as planned and as it really happened. */
export interface LedgerEntry {
  eventId: string;
  itemId: string;
  name: string;
  type: FinancialEventType;
  date: ISODate;
  /** Signed planned effect on cash (projection cashDelta; 0 for no-cash events). */
  planned: number;
  /** Signed effect that actually happened (planned unless edited / skipped). */
  actual: number;
  status: "planned" | ActualStatus | "adjustment";
  /** Debt account the event touched (card / loan / MSI id); absent for cash-only events. */
  accountId?: string;
  /**
   * Signed planned effect on the debt of `accountId` (projection debtDelta;
   * 0 without account). A card purchase is +amount here, 0 in `planned`.
   */
  plannedDebt: number;
  /** Signed effect on the debt of `accountId` that actually happened. */
  actualDebt: number;
}

export interface RollForwardOptions {
  actuals?: ActualRecord[];
  /**
   * Real cash today, typed by the user. Overrides the computed cash; the
   * difference is booked as one "adjustment" ledger entry (eventId
   * "adjustment@<newStart>").
   */
  cashOverride?: number;
}

export interface RollForwardResult {
  doc: FinancialDocument;
  ledger: LedgerEntry[];
  /**
   * Events between the old start (inclusive) and newStart (exclusive) that
   * move cash or debt — what the UI asks the user to confirm.
   */
  pending: FinancialProjectionPoint[];
}

/** Ledger name of the cash reconciliation entry. */
const ADJUSTMENT_NAME = "Ajuste de efectivo";

/** Ledger name of the card interest accrued before the roll and posted with it. */
const ACCRUED_INTEREST_NAME = "Interés acumulado (estimado)";

/** One fixed-mode card's unposted interest, accrued like the projection does. */
interface CardAccrual {
  /** annualRate (percentage) the projection accrues the account at. */
  rate: number;
  /** Day number of the last cut on or before the last past day (or the projection start). */
  from: number;
  /** Day number up to which `pending` has been accrued. */
  accruedTo: number;
  /** Account debt over the current stretch (end-of-day debt of the last event day seen). */
  debt: number;
  /** Interest accrued since `from`, unrounded. */
  pending: number;
  /** Day number of the first cut on or after the new start. */
  nextCut: number;
}

/** Same expression and guard as the projection's `accrue`, so the sums agree to the last bit. */
function accrueCard(state: CardAccrual, day: number): void {
  const days = day - state.accruedTo;
  if (days <= 0) return;
  if (state.rate > 0 && state.debt > 0) state.pending += (state.debt * state.rate * days) / 36000;
  state.accruedTo = day;
}

/**
 * Interest each enabled fixed-mode card (paymentMode undefined / "fixed")
 * has accrued but not posted by the end of the day before `newStartDay`, as
 * the amount to ADD to its rolled balance (per card id; cards with nothing
 * accrued are absent). "statement" cards never accrue interest.
 *
 * Accrual = the projection's average daily balance, replayed over the past
 * points: from the card's last cut on or before the last past day (the
 * projection start when no cut happened yet), each stretch between two event
 * days of the account is charged debt × annualRate × days / 36000 at the
 * debt the account had at the end of the stretch's first day (same-day
 * event order: the cut posts first), summed unrounded.
 *
 * The amount added is that accrual A discounted by the interest it will
 * itself earn until the next cut (k days away): A / (1 + annualRate × k /
 * 36000), rounded to cents once. The rolled projection charges that balance
 * interest from the new start, so at the next cut the card has paid exactly
 * A on top of the un-rolled path (A' + A'·rate·k/36000 = A): adding A itself
 * would compound it k days early, and rolling every day would compound
 * daily instead of monthly (≈ +0.34 %/month of the debt at 99.9 %). Exact
 * as long as the debt stays positive and no payment is capped before the
 * next cut; k = 0 (rolling onto a cut day) adds A itself.
 */
function accruedCardInterest(
  doc: FinancialDocument,
  projection: FinancialProjection,
  past: readonly FinancialProjectionPoint[],
  newStartDay: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const startDay = toDayNumber(projection.startDate);
  const lastPastDay = newStartDay - 1;
  const accounts = new Map(projection.accounts.map((account) => [account.id, account]));
  const states = new Map<string, CardAccrual>();
  for (const item of doc.items) {
    if (item.kind !== "credit-card" || item.enabled === false || item.paymentMode === "statement") continue;
    const account = accounts.get(item.id);
    if (account === undefined || account.annualRate <= 0 || account.statementCutDay !== undefined) continue;
    const dom = sanitizeDayOfMonth(item.cutDay);
    const pastMonth = monthIndexOf(lastPastDay);
    let lastCut = monthDayNumber(pastMonth, dom);
    if (lastCut > lastPastDay) lastCut = monthDayNumber(pastMonth - 1, dom);
    const from = lastCut > startDay ? lastCut : startDay;
    const startMonth = monthIndexOf(newStartDay);
    let nextCut = monthDayNumber(startMonth, dom);
    if (nextCut < newStartDay) nextCut = monthDayNumber(startMonth + 1, dom);
    const existing = states.get(item.id);
    if (existing !== undefined) {
      // Duplicate card ids share one account (rate of the first): latest cut / earliest next cut.
      if (from > existing.from) existing.from = existing.accruedTo = from;
      if (nextCut < existing.nextCut) existing.nextCut = nextCut;
      continue;
    }
    states.set(item.id, { rate: account.annualRate, from, accruedTo: from, debt: account.openingDebt, pending: 0, nextCut });
  }
  if (states.size === 0) return out;

  let date = "";
  let day = startDay;
  for (const point of past) {
    const state = point.accountId === undefined ? undefined : states.get(point.accountId);
    if (state === undefined || point.accountDebtAfter === undefined) continue;
    if (point.date !== date) {
      date = point.date;
      day = toDayNumber(date);
    }
    // Events up to the cut only set the debt the next stretch starts with.
    if (day > state.from) accrueCard(state, day);
    state.debt = point.accountDebtAfter;
  }

  for (const [id, state] of states) {
    accrueCard(state, newStartDay);
    const k = state.nextCut - newStartDay;
    const amount = roundMoney(state.pending / (1 + (state.rate * k) / 36000));
    if (amount > 0) out.set(id, amount);
  }
  return out;
}

/**
 * `doc`, or a copy with a longer horizon when its projection range ends
 * before `date` (the past must be fully projected). Extending the range only
 * adds events after the old end: nothing before it changes.
 */
function documentReaching(doc: FinancialDocument, date: ISODate): FinancialDocument {
  if (getProjectionRange(doc).to >= date) return doc;
  const [sy, sm] = parseISODate(doc.startDate);
  const [ty, tm] = parseISODate(date);
  let months = (ty - sy) * 12 + (tm - sm);
  // addMonths clamps the day (Jan 31 + 1 → Feb 28): one more month always suffices.
  if (addMonths(doc.startDate, months) < date) months++;
  return { ...doc, horizonMonths: months };
}

/** Index of the first point dated >= `date` (points are chronological). */
function firstPointOnOrAfter(points: readonly FinancialProjectionPoint[], date: ISODate): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * True when the schedule can no longer produce an occurrence on or after
 * `date`: a one-off dated before it, or a window that ended before it.
 * Malformed dates never count as over (the item is kept as is).
 */
function scheduleOver(rec: FinancialRecurrence, date: ISODate): boolean {
  if (rec.endDate !== undefined && isISODate(rec.endDate) && rec.endDate < date) return true;
  if (rec.frequency === "once") {
    const at = rec.anchorDate ?? rec.startDate;
    return isISODate(at) && at < date;
  }
  return false;
}

/** Magnitude of an "edited" record, or undefined when it carries no usable amount. */
function editedMagnitude(record: ActualRecord): number | undefined {
  const amount = record.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  return roundMoney(Math.abs(amount));
}

/** Shallow copy with its own recurrence object; unknown fields ride along. */
function copyItem<T extends FinancialItem>(item: T): T {
  return { ...item, recurrence: { ...item.recurrence } };
}

function addTo(map: Map<string, number>, key: string, value: number): void {
  map.set(key, roundMoney((map.get(key) ?? 0) + value));
}

/**
 * Rolls `doc` forward to `newStartDate` ("Rec"). Everything the old
 * projection dates before `newStartDate` is the past:
 *
 * - `pending`: those projection points (cash or debt moved), in order.
 * - `ledger`: one entry per pending point — status "planned" (assumed to have
 *   happened as planned) unless `options.actuals` says "happened", "skipped"
 *   (actual effect 0: a skipped expense gives the cash back, a skipped card
 *   payment leaves that amount owed) or "edited" (the real magnitude) — plus
 *   one no-cash "credit-card-interest" entry per fixed-mode card with interest
 *   accrued and not posted yet (eventId "interest@<cardId>@<newStart>",
 *   status "planned", plannedDebt = actualDebt = the amount added to the
 *   card), plus one "adjustment" entry when `cashOverride` differs from the
 *   computed cash.
 * - `doc`: startDate = newStartDate; initialCash = projected cash at the end
 *   of the day before + Σ(actual − planned), or `cashOverride`; card and loan
 *   balances / MSI counters carried over (see below); items whose schedule is
 *   over removed (their past lives in the ledger). Item order, ids, unknown
 *   fields and `horizonMonths` are preserved; every kept item is a shallow
 *   copy (recurrence copied too), so the result shares nothing mutable with
 *   the input, which is never mutated.
 *
 * Items:
 * - income / expense / card-purchase: removed when the schedule is over (a
 *   one-off dated before newStart, or `endDate` before it). Recurring items
 *   keep their recurrence untouched (anchor = phase); the engine clips their
 *   occurrences to the new start. A past purchase's amount is already in its
 *   card's balance.
 * - credit-card (enabled): balance = projected debt at the end of the day
 *   before newStart (`debtByAccountAt`) + the debt corrections of the actuals
 *   + (fixed mode) the interest accrued since the last cut and not posted yet,
 *   floored at 0. The new document's first interest cycle counts from
 *   newStart, so that interest is posted now, discounted by what it earns
 *   until the next cut (see `accruedCardInterest`): after the next cut the
 *   debt matches the un-rolled projection within cents, even when the plan is
 *   rolled every day. Cards are never removed (they are accounts that
 *   purchases and MSI plans point to). A "statement"-mode card (no interest)
 *   restarts with its whole balance as the pending statement, so rolling
 *   between a cut and its due date pays the purchases made after that cut
 *   one month early.
 * - loan (enabled): with `balance` → projected debt + corrections (floored at
 *   0). Without `balance` the debt is window-defined (remaining scheduled
 *   payments from the document start) and needs no change — unless the
 *   actuals moved its debt (a skipped payment), then it gets an explicit
 *   `balance` = projected debt + corrections. Removed when its schedule is
 *   over and nothing is owed.
 * - installment-plan: installmentsPaid += installments paid in the past (a
 *   skipped one is not paid; an edited one is paid — the plan counts
 *   installments, so an edited amount changes the cash, not the debt). A
 *   future plan that opened in the past becomes a current plan (the engine
 *   does that once its start is not after the document start). A skipped
 *   "debt-opening" (the MSI purchase never happened) removes the plan; an
 *   edited one sets `originalAmount`. Removed when fully paid.
 * - Disabled items have no projected balance: kept untouched unless their
 *   schedule is over (cards: always kept; MSI: removed when fully paid).
 * - Past purchases on a missing / disabled card (booked by the projection on
 *   a provisional account) leave the document with their debt.
 *
 * Corrections are first-order: a skipped payment adds its amount to the
 * balance, but the interest it would have generated before newStart is not
 * re-simulated.
 *
 * `newStartDate <= doc.startDate` returns `doc` itself with empty ledger /
 * pending. When newStart is past the projection end, the past is projected
 * over an extended range. Throws RangeError on a malformed date.
 */
export function rollForward(
  doc: FinancialDocument,
  newStartDate: ISODate,
  options: RollForwardOptions = {},
): RollForwardResult {
  if (!isISODate(newStartDate)) {
    throw new RangeError(`Invalid ISO date "${String(newStartDate)}" (expected YYYY-MM-DD)`);
  }
  if (!isISODate(doc.startDate)) {
    throw new RangeError(`Invalid document start date "${String(doc.startDate)}" (expected YYYY-MM-DD)`);
  }
  if (newStartDate <= doc.startDate) return { doc, ledger: [], pending: [] };

  const lastPastDay = addDays(newStartDate, -1);
  const projection = projectFinancialDocument(documentReaching(doc, lastPastDay));
  const pending = projection.points.slice(0, firstPointOnOrAfter(projection.points, newStartDate));

  const actuals = new Map<string, ActualRecord>();
  for (const record of options.actuals ?? []) actuals.set(record.eventId, record); // last one wins

  const ledger: LedgerEntry[] = [];
  let cashCorrection = 0;
  /** Σ(actualDebt − plannedDebt) per account. */
  const debtCorrections = new Map<string, number>();
  /** Installments paid in the past per MSI plan id. */
  const installmentsPaid = new Map<string, number>();
  /** Status + magnitude of the past "debt-opening" of each future MSI plan that opened. */
  const openings = new Map<string, { status: ActualStatus | "planned"; amount: number }>();

  for (const point of pending) {
    const accountId = point.accountId;
    const planned = point.cashDelta;
    const plannedDebt = accountId !== undefined ? point.debtDelta : 0;
    let actual = planned;
    let actualDebt = plannedDebt;
    let status: LedgerEntry["status"] = "planned";

    const record = actuals.get(point.eventId);
    if (record !== undefined) {
      status = "happened";
      if (record.status === "skipped") {
        status = "skipped";
        actual = 0;
        actualDebt = 0;
      } else if (record.status === "edited") {
        const magnitude = editedMagnitude(record);
        if (magnitude !== undefined) {
          status = "edited";
          if (planned !== 0) {
            actual = planned > 0 ? magnitude : -magnitude;
            if (point.type === "installment-payment") {
              // MSI plans count installments: an edited one still pays one.
              actualDebt = plannedDebt;
            } else if (plannedDebt !== 0) {
              // A payment the projection capped at the debt left (|debt| < |cash|)
              // could not have reduced the debt by more than that.
              const cap = Math.abs(plannedDebt) < Math.abs(planned) ? Math.abs(plannedDebt) : magnitude;
              const applied = magnitude < cap ? magnitude : cap;
              actualDebt = plannedDebt < 0 ? -applied : applied;
            }
          } else {
            // No-cash event (purchase, debt opening, posted interest): the debt moved by `magnitude`.
            actualDebt = plannedDebt < 0 ? -magnitude : magnitude;
          }
        }
      }
    }

    if (actual !== planned) cashCorrection = roundMoney(cashCorrection + actual - planned);
    if (accountId !== undefined && actualDebt !== plannedDebt) {
      addTo(debtCorrections, accountId, actualDebt - plannedDebt);
    }
    if (point.type === "installment-payment" && status !== "skipped") {
      installmentsPaid.set(point.itemId, (installmentsPaid.get(point.itemId) ?? 0) + 1);
    }
    if (point.type === "debt-opening") {
      openings.set(point.itemId, { status, amount: actualDebt });
    }

    const entry: LedgerEntry = {
      eventId: point.eventId,
      itemId: point.itemId,
      name: point.name,
      type: point.type,
      date: point.date,
      planned,
      actual,
      status,
      plannedDebt,
      actualDebt,
    };
    if (accountId !== undefined) entry.accountId = accountId;
    ledger.push(entry);
  }

  // Card interest accrued since the last cut and not posted yet: booked now
  // (no cash) so it is never lost, however often the plan is rolled.
  const accrued = accruedCardInterest(doc, projection, pending, toDayNumber(newStartDate));
  for (const [cardId, amount] of accrued) {
    addTo(debtCorrections, cardId, amount);
    ledger.push({
      eventId: `interest@${cardId}@${newStartDate}`,
      itemId: cardId,
      name: ACCRUED_INTEREST_NAME,
      type: "credit-card-interest",
      date: newStartDate,
      planned: 0,
      actual: 0,
      status: "planned",
      accountId: cardId,
      plannedDebt: amount,
      actualDebt: amount,
    });
  }

  const computedCash = roundMoney(snapshotAt(projection, lastPastDay).cash + cashCorrection);
  let initialCash = computedCash;
  const override = options.cashOverride;
  if (typeof override === "number" && Number.isFinite(override)) {
    initialCash = roundMoney(override);
    const adjustment = roundMoney(initialCash - computedCash);
    if (adjustment !== 0) {
      ledger.push({
        eventId: `adjustment@${newStartDate}`,
        itemId: "",
        name: ADJUSTMENT_NAME,
        type: adjustment > 0 ? "income" : "expense",
        date: newStartDate,
        planned: 0,
        actual: adjustment,
        status: "adjustment",
        plannedDebt: 0,
        actualDebt: 0,
      });
    }
  }

  // Projected debt per account at the end of the last past day (the opening
  // debt of the accounts nothing touched).
  const debts = debtByAccountAt(projection, lastPastDay);
  // The projection merges accounts that share an id: the first item with that
  // id carries the merged balance, later duplicates 0 (the sum is preserved).
  const assigned = new Set<string>();
  const balanceOf = (id: string): number => {
    if (assigned.has(id)) return 0;
    assigned.add(id);
    const debt = roundMoney((debts.get(id) ?? 0) + (debtCorrections.get(id) ?? 0));
    return debt > 0 ? debt : 0;
  };

  const items: FinancialItem[] = [];
  for (const item of doc.items) {
    const projected = item.enabled !== false && debts.has(item.id);
    switch (item.kind) {
      case "income":
      case "expense":
      case "card-purchase":
        if (!scheduleOver(item.recurrence, newStartDate)) items.push(copyItem(item));
        break;
      case "credit-card": {
        const card = copyItem(item);
        if (projected) card.balance = balanceOf(item.id);
        items.push(card);
        break;
      }
      case "loan": {
        const over = scheduleOver(item.recurrence, newStartDate);
        const explicit =
          (item.balance !== undefined && Number.isFinite(item.balance)) ||
          (debtCorrections.get(item.id) ?? 0) !== 0;
        if (!projected || !explicit) {
          // Window-defined debt (the remaining scheduled payments): already right.
          if (!over) items.push(copyItem(item));
          break;
        }
        const balance = balanceOf(item.id);
        if (over && balance === 0) break;
        const loan = copyItem(item);
        loan.balance = balance;
        items.push(loan);
        break;
      }
      case "installment-plan": {
        const opening = openings.get(item.id);
        if (opening?.status === "skipped") break;
        const plan = copyItem(item);
        if (opening?.status === "edited") plan.originalAmount = opening.amount;
        const paid = installmentsPaid.get(item.id) ?? 0;
        if (paid > 0) plan.installmentsPaid = installmentsPaidOf(item) + paid;
        if (remainingInstallmentCount(plan) > 0) items.push(plan);
        break;
      }
      default:
        // Unknown kind: carried through untouched.
        items.push(copyItem(item as FinancialItem));
        break;
    }
  }

  return {
    doc: { ...doc, startDate: newStartDate, initialCash, items },
    ledger,
    pending,
  };
}
