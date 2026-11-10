// Cash valleys that explain and fix themselves.
//
// `explainValley` reads a liquidity warning back from its projection: the
// payday before the drop, the outflows that drained it, when the money comes
// back. `suggestValleyFixes` turns the biggest causes into concrete item
// patches (move a one-off payment to the next payday, shift a monthly one,
// pay a card's minimum), measures each by re-projecting the patched document,
// and keeps the ones that help without making any other moment worse.
import { addDays, daysInMonth, diffDays, fromDayNumber, isISODate, parseISODate, toDayNumber } from "./dates";
import { positiveMoney, roundMoney } from "./money";
import { projectFinancialDocument } from "./projection";
import { countRecurrence, expandRecurrence, monthDayNumber, monthIndexOf } from "./recurrence";
import type {
  FinancialDocument,
  FinancialEventType,
  FinancialItem,
  FinancialProjection,
  FinancialProjectionPoint,
  FinancialRecurrence,
  ISODate,
  LiquidityWarning,
} from "./types";

export interface ValleyCause {
  itemId: string;
  name: string;
  date: ISODate;
  /** Positive outflow (the cash the event took). */
  amount: number;
  type: FinancialEventType;
}

export interface ValleyExplanation {
  warning: LiquidityWarning;
  /** Inflow (income point) right before the drop, if any. */
  lastInflow: { date: ISODate; name: string; amount: number } | null;
  /** First inflow after the valley minimum, if any (when the money comes back). */
  nextInflow: { date: ISODate; name: string; amount: number } | null;
  /** Outflows between lastInflow (exclusive) and the valley minimum date (inclusive), biggest first, at most 6. */
  causes: ValleyCause[];
  /** reserve − cash at the minimum (≥ 0). */
  shortfall: number;
}

export interface ValleyFix {
  /** Stable: `${itemId}:move:${date}`, `${itemId}:monthly:${day}`, `${itemId}:minimum`. */
  id: string;
  /** Spanish, short, e.g. "Mover Pago Tarjeta Plata al 30 nov". */
  title: string;
  itemId: string;
  /** The full replacement item. */
  patch: FinancialItem;
  /**
   * resolves = no cash below the reserve in the evaluation window anymore;
   * exits-red = the window minimum was negative and is now ≥ 0;
   * improves = the window minimum goes up.
   */
  outcome: "resolves" | "exits-red" | "improves";
  /** Min cash in the evaluation window before the fix. */
  before: number;
  /** Min cash in the same window after the fix. */
  after: number;
  afterDate: ISODate;
}

const MAX_CAUSES = 6;
const MAX_CANDIDATES = 8;
const DEFAULT_LIMIT = 3;
/** Evaluation window: the valley ± this many days. */
const WINDOW_DAYS = 31;
/** A monthly payment is shifted by at most this many days. */
const MAX_MONTHLY_SHIFT = 20;

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** Index of the first point whose date is >= `date`. */
function lowerBound(points: readonly FinancialProjectionPoint[], date: ISODate): number {
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
 * Index of the point that hit the warning minimum: its `eventId` on
 * `warning.date`; else (a warning from another projection) the last point
 * on/before that date. -1 = the initial state ("initial" warning).
 */
function minimumIndex(points: readonly FinancialProjectionPoint[], warning: LiquidityWarning): number {
  const first = lowerBound(points, warning.date);
  for (let i = first; i < points.length && points[i]!.date === warning.date; i++) {
    if (points[i]!.eventId === warning.eventId) return i;
  }
  if (warning.eventId === "initial") return -1;
  let i = first;
  while (i < points.length && points[i]!.date === warning.date) i++;
  return i - 1;
}

/**
 * Why `warning` happened, read from `projection` (the projection the warning
 * was found on): the income point right before the episode's first point
 * below `doc.minimumCashReserve` (null when none, or when the episode starts
 * with the initial cash), every outflow after that income up to the point
 * that hit the minimum (one cause per occurrence, biggest first, at most 6),
 * the first income after the minimum, and the shortfall against the
 * reserve. O(log points + points scanned).
 */
export function explainValley(
  doc: FinancialDocument,
  projection: FinancialProjection,
  warning: LiquidityWarning,
): ValleyExplanation {
  const points = projection.points;
  const reserve = doc.minimumCashReserve;
  const minIdx = minimumIndex(points, warning);

  // First point of the episode (the drop). An episode opened by the initial
  // cash has no point before it.
  let dropIdx = 0;
  const initialEpisode = warning.startDate === projection.startDate && projection.initialCash < reserve;
  if (!initialEpisode) {
    dropIdx = lowerBound(points, warning.startDate);
    while (dropIdx < minIdx && points[dropIdx]!.cashAfter >= reserve) dropIdx++;
  }

  let inflowIdx = -1;
  for (let i = Math.min(dropIdx, minIdx + 1) - 1; i >= 0; i--) {
    const point = points[i]!;
    if (point.type === "income" && point.cashDelta > 0) {
      inflowIdx = i;
      break;
    }
  }

  const causes: ValleyCause[] = [];
  for (let i = inflowIdx + 1; i <= minIdx; i++) {
    const point = points[i]!;
    if (point.cashDelta >= 0) continue;
    causes.push({ itemId: point.itemId, name: point.name, date: point.date, amount: -point.cashDelta, type: point.type });
  }
  // Biggest first; ties keep chronological order (stable sort).
  causes.sort((a, b) => b.amount - a.amount);
  if (causes.length > MAX_CAUSES) causes.length = MAX_CAUSES;

  let nextInflow: ValleyExplanation["nextInflow"] = null;
  for (let i = minIdx + 1; i < points.length; i++) {
    const point = points[i]!;
    if (point.type === "income" && point.cashDelta > 0) {
      nextInflow = { date: point.date, name: point.name, amount: point.cashDelta };
      break;
    }
  }

  const inflow = inflowIdx >= 0 ? points[inflowIdx]! : null;
  const shortfall = roundMoney(reserve - warning.cash);
  return {
    warning,
    lastInflow: inflow ? { date: inflow.date, name: inflow.name, amount: inflow.cashDelta } : null,
    nextInflow,
    causes,
    shortfall: shortfall > 0 ? shortfall : 0,
  };
}

// ---------------------------------------------------------------------------
// Fixes.

/**
 * Lowest cash inside [from, to]: the cash carried into the window (end of the
 * day before `from`, the initial cash when nothing happened before) and every
 * point inside it.
 */
function windowMinimum(projection: FinancialProjection, from: ISODate, to: ISODate): { cash: number; date: ISODate } {
  const points = projection.points;
  let i = lowerBound(points, from);
  let cash = i > 0 ? points[i - 1]!.cashAfter : projection.initialCash;
  let date = from > projection.startDate ? from : projection.startDate;
  for (; i < points.length && points[i]!.date <= to; i++) {
    const point = points[i]!;
    if (point.cashAfter < cash) {
      cash = point.cashAfter;
      date = point.date;
    }
  }
  return { cash, date };
}

/** "30 nov"; "5 ene 2027" when the year differs from `baseYear`. */
function formatShortDate(date: ISODate, baseYear: number): string {
  const [y, m, d] = parseISODate(date);
  const label = `${d} ${MONTHS_ES[m - 1]!}`;
  return y === baseYear ? label : `${label} ${y}`;
}

/** "$1,500" / "$1,234.50". */
function formatPesos(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = cents % 100;
  return `${amount < 0 ? "-" : ""}$${whole}${frac === 0 ? "" : `.${frac < 10 ? "0" : ""}${frac}`}`;
}

/** `rec` moved by `days`: window and anchor together (the item's "move"). */
function shiftRecurrence(rec: FinancialRecurrence, days: number): FinancialRecurrence {
  const out: FinancialRecurrence = { ...rec, startDate: addDays(rec.startDate, days) };
  if (rec.endDate !== undefined) out.endDate = addDays(rec.endDate, days);
  if (rec.anchorDate !== undefined) out.anchorDate = addDays(rec.anchorDate, days);
  return out;
}

/** First occurrence of `rec` on/after `from` (recurring rules leave no gap above 31 days), or null. */
function firstOccurrenceFrom(rec: FinancialRecurrence, from: ISODate): ISODate | null {
  const lo = rec.startDate > from ? rec.startDate : from;
  const dates = expandRecurrence(rec, { from: lo, to: addDays(lo, 31) });
  return dates.length > 0 ? dates[0]! : null;
}

/** Last occurrence of `rec` on/before `to` and not before `from`, or null. */
function lastOccurrenceUpTo(rec: FinancialRecurrence, from: ISODate, to: ISODate): ISODate | null {
  const lo = addDays(to, -31);
  const dates = expandRecurrence(rec, { from: lo > from ? lo : from, to });
  return dates.length > 0 ? dates[dates.length - 1]! : null;
}

/**
 * A monthly rule moved to a new day of month so that its occurrence on
 * `valleyDate` lands on `targetDate` (k ≤ 20 days later, so in the same or
 * the next month). A month-end target means "the last day of every month"
 * (day 31, clamped), so a payment never lands a day before a month-end
 * payday. Every occurrence from the document start maps to the new day in
 * its own month (+1 when the target crossed into the next month), one to
 * one: the start moves to the first moved occurrence when the item starts
 * inside the projection or when the new day would add an occurrence before
 * it; the end stays unless the last occurrence would fall past it, then it
 * moves to that occurrence. Null when the count of occurrences up to the end
 * would change anyway.
 */
function moveMonthlyDay(
  rec: FinancialRecurrence,
  valleyDate: ISODate,
  targetDate: ISODate,
  docStart: ISODate,
): { recurrence: FinancialRecurrence; day: number } | null {
  const [ty, tm, td] = parseISODate(targetDate);
  const day = td === daysInMonth(ty, tm) ? 31 : td;
  const targetMonth = ty * 12 + (tm - 1);
  const offset = targetMonth - monthIndexOf(toDayNumber(valleyDate));
  const first = firstOccurrenceFrom(rec, docStart);
  if (first === null) return null;
  const firstMonth = monthIndexOf(toDayNumber(first));
  const movedFirst = monthDayNumber(firstMonth + offset, day);
  const docStartDay = toDayNumber(docStart);
  const startDate =
    rec.startDate >= docStart || monthDayNumber(firstMonth + offset - 1, day) >= docStartDay
      ? fromDayNumber(movedFirst)
      : rec.startDate;
  // The anchor only carries the day of month: a day-31 one for "month end".
  const anchorDate = day === 31 && td !== 31 ? fromDayNumber(monthDayNumber(targetMonth - 1, 31)) : targetDate;
  const recurrence: FinancialRecurrence = { ...rec, startDate, anchorDate };
  if (rec.endDate !== undefined) {
    const last = lastOccurrenceUpTo(rec, docStart, rec.endDate);
    if (last === null) return null;
    const movedLast = monthDayNumber(monthIndexOf(toDayNumber(last)) + offset, day);
    if (movedLast > toDayNumber(rec.endDate)) recurrence.endDate = fromDayNumber(movedLast);
    const before = countRecurrence(rec, { from: docStart, to: rec.endDate });
    if (countRecurrence(recurrence, { from: docStart, to: recurrence.endDate! }) !== before) return null;
  }
  return { recurrence, day };
}

/** Event type → item kind that emits it with a cash outflow. */
function kindOfOutflow(type: FinancialEventType): FinancialItem["kind"] | null {
  switch (type) {
    case "expense":
      return "expense";
    case "loan-payment":
      return "loan";
    case "credit-card-payment":
      return "credit-card";
    default:
      return null;
  }
}

/** The enabled item that emitted `cause` (first one with that id and a matching kind). */
function causeItem(doc: FinancialDocument, cause: ValleyCause): FinancialItem | null {
  const kind = kindOfOutflow(cause.type);
  if (kind === null) return null;
  for (const item of doc.items) {
    if (item.id === cause.itemId && item.kind === kind && item.enabled !== false) return item;
  }
  return null;
}

interface Candidate {
  id: string;
  title: string;
  item: FinancialItem;
  patch: FinancialItem;
  /** Days the payment moves (0 = not moved). */
  shift: number;
  /** Only worth suggesting when it resolves the valley or takes it out of the red. */
  strict: boolean;
}

/** Candidate patch for one cause, or null when no rule applies. */
function candidateFor(
  doc: FinancialDocument,
  item: FinancialItem,
  cause: ValleyCause,
  nextInflow: ValleyExplanation["nextInflow"],
  baseYear: number,
): Candidate | null {
  const rec = item.recurrence;
  const shift = nextInflow !== null ? diffDays(cause.date, nextInflow.date) : 0;

  // A one-off outflow: pay it with the incoming money. The same day works:
  // income is processed before any outflow of its day, so "the day after"
  // can never do better. (A card purchase moves no cash, so it is never a
  // cause; the card's payment is.)
  if (rec.frequency === "once" && (item.kind === "expense" || item.kind === "loan")) {
    if (nextInflow === null || shift <= 0) return null;
    const patch = { ...item, recurrence: shiftRecurrence(rec, shift) } as FinancialItem;
    return {
      id: `${item.id}:move:${nextInflow.date}`,
      title: `Mover ${item.name} al ${formatShortDate(nextInflow.date, baseYear)}`,
      item,
      patch,
      shift,
      strict: false,
    };
  }

  // A monthly expense or loan payment: move its day of month so the
  // occurrence inside the valley lands on the next payday.
  // (Plain monthly only: with "cada N meses" the anchor also carries the
  // month phase, which a move to the next payday would shift.)
  if (
    rec.frequency === "monthly" &&
    (rec.interval ?? 1) === 1 &&
    (item.kind === "expense" || item.kind === "loan")
  ) {
    if (nextInflow === null || shift <= 0 || shift > MAX_MONTHLY_SHIFT) return null;
    const moved = moveMonthlyDay(rec, cause.date, nextInflow.date, doc.startDate);
    if (moved === null) return null;
    return {
      id: `${item.id}:monthly:${moved.day}`,
      title:
        moved.day === 31
          ? `Mover ${item.name} al último día de cada mes`
          : `Mover ${item.name} al día ${moved.day} de cada mes`,
      item,
      patch: { ...item, recurrence: moved.recurrence } as FinancialItem,
      shift,
      strict: false,
    };
  }

  // A fixed-payment card paying more than its minimum inside the valley.
  if (item.kind === "credit-card" && cause.type === "credit-card-payment" && item.paymentMode !== "statement") {
    const minimum = positiveMoney(item.minimumPayment);
    const planned = positiveMoney(item.paymentAmount ?? item.minimumPayment);
    if (minimum <= 0 || planned <= minimum) return null;
    return {
      id: `${item.id}:minimum`,
      title: `Pagar el mínimo de ${item.name} (${formatPesos(minimum)})`,
      item,
      patch: { ...item, paymentAmount: minimum },
      shift: 0,
      strict: true,
    };
  }
  return null;
}

const OUTCOME_RANK: Readonly<Record<ValleyFix["outcome"], number>> = { resolves: 0, "exits-red": 1, improves: 2 };

/**
 * Concrete item patches that lift the valley of `warning` (a warning of
 * `projectFinancialDocument(doc)`), best first, at most `limit` (default 3).
 *
 * Candidates (one per enabled item among the valley's causes, biggest cause
 * first, at most 8 projected):
 * - one-off expense / card purchase / loan payment: moved to the day of the
 *   next income after the valley minimum (paid with the incoming money);
 * - monthly expense or loan payment whose occurrence in the valley is
 *   k ≤ 20 days before that income: its day of month moves so that
 *   occurrence lands on the income's day ("the last day" for a month-end
 *   payday); start / end only move when needed to keep the same number of
 *   occurrences (for a loan without balance, that number is its debt);
 * - fixed-payment card paying more than its minimum: pay the minimum (only
 *   when that resolves the valley or takes it out of the red).
 *
 * Each candidate is measured on the patched document's projection over the
 * window [warning.startDate − 31 d, warning.date + 31 d]: "resolves" when no
 * cash in it is below `doc.minimumCashReserve`, "exits-red" when its
 * minimum was negative and is now ≥ 0, "improves" when its minimum just goes
 * up; anything else is dropped, and so is any fix that lowers the minimum
 * cash of the whole projection. Ordered resolves > exits-red > improves,
 * then by `after` (higher first), then by the smaller date shift.
 */
export function suggestValleyFixes(
  doc: FinancialDocument,
  warning: LiquidityWarning,
  options?: { limit?: number },
): ValleyFix[] {
  const limitOption = options?.limit;
  const limit =
    limitOption === undefined || !Number.isFinite(limitOption) ? DEFAULT_LIMIT : Math.max(0, Math.floor(limitOption));
  if (limit === 0 || !isISODate(doc.startDate) || !isISODate(warning.startDate) || !isISODate(warning.date)) return [];

  const base = projectFinancialDocument(doc);
  const explanation = explainValley(doc, base, warning);
  const reserve = doc.minimumCashReserve;
  const from = addDays(warning.startDate, -WINDOW_DAYS);
  const to = addDays(warning.date, WINDOW_DAYS);
  const before = windowMinimum(base, from, to).cash;
  const baseYear = parseISODate(doc.startDate)[0];

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const cause of explanation.causes) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (seen.has(cause.itemId)) continue;
    seen.add(cause.itemId);
    const item = causeItem(doc, cause);
    if (item === null) continue;
    const candidate = candidateFor(doc, item, cause, explanation.nextInflow, baseYear);
    if (candidate !== null) candidates.push(candidate);
  }

  const fixes: { fix: ValleyFix; shift: number }[] = [];
  for (const candidate of candidates) {
    const items = doc.items.map((item) => (item === candidate.item ? candidate.patch : item));
    const projection = projectFinancialDocument({ ...doc, items });
    if (projection.minimumCash.cash < base.minimumCash.cash) continue;
    const after = windowMinimum(projection, from, to);
    if (after.cash <= before) continue;
    let outcome: ValleyFix["outcome"];
    if (after.cash >= reserve) outcome = "resolves";
    else if (before < 0 && after.cash >= 0) outcome = "exits-red";
    else if (candidate.strict) continue;
    else outcome = "improves";
    fixes.push({
      fix: {
        id: candidate.id,
        title: candidate.title,
        itemId: candidate.item.id,
        patch: candidate.patch,
        outcome,
        before,
        after: after.cash,
        afterDate: after.date,
      },
      shift: candidate.shift,
    });
  }

  fixes.sort(
    (a, b) =>
      OUTCOME_RANK[a.fix.outcome] - OUTCOME_RANK[b.fix.outcome] ||
      b.fix.after - a.fix.after ||
      a.shift - b.shift ||
      (a.fix.id < b.fix.id ? -1 : a.fix.id > b.fix.id ? 1 : 0),
  );
  const out: ValleyFix[] = [];
  for (let i = 0; i < fixes.length && i < limit; i++) out.push(fixes[i]!.fix);
  return out;
}
