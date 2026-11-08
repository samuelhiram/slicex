// Recurrence expansion. Every schedule jumps ARITHMETICALLY to its first
// candidate inside the requested window (performance canon §1.5 / §2.4):
// the cost is O(occurrences in range), never O(distance to the anchor).
import {
  dayNumberFromParts,
  daysInMonth,
  formatISODate,
  fromDayNumber,
  isISODate,
  parseISODate,
  partsFromDayNumber,
  toDayNumber,
} from "./dates";
import type { FinancialRecurrence, ISODate } from "./types";

export interface DayWindow {
  /** Inclusive day number. */
  lo: number;
  /** Inclusive day number. */
  hi: number;
}

/**
 * Internal: [rule window] ∩ [range] as day numbers, or null when empty /
 * when any date is malformed.
 */
export function intersectWindow(
  startDate: ISODate,
  endDate: ISODate | undefined,
  range: { from: ISODate; to: ISODate },
): DayWindow | null {
  if (!isISODate(startDate) || !isISODate(range.from) || !isISODate(range.to)) return null;
  if (endDate !== undefined && !isISODate(endDate)) return null;
  const startDay = toDayNumber(startDate);
  const fromDay = toDayNumber(range.from);
  const toDay = toDayNumber(range.to);
  const lo = startDay > fromDay ? startDay : fromDay;
  let hi = toDay;
  if (endDate !== undefined) {
    const endDay = toDayNumber(endDate);
    if (endDay < hi) hi = endDay;
  }
  return lo <= hi ? { lo, hi } : null;
}

/** Internal: sanitise a day-of-month to an integer in 1..31. */
export function sanitizeDayOfMonth(day: number): number {
  if (!Number.isFinite(day)) return 1;
  const d = Math.round(day);
  return d < 1 ? 1 : d > 31 ? 31 : d;
}

/**
 * Internal: `dayOfMonth` (clamped to each month's length) for every month
 * that intersects [lo, hi]; at most `limit` dates. Appends to `out`.
 */
export function expandMonthlyOnDay(
  dayOfMonth: number,
  window: DayWindow,
  out: ISODate[],
  limit = Number.POSITIVE_INFINITY,
): ISODate[] {
  if (limit <= 0) return out;
  const dom = sanitizeDayOfMonth(dayOfMonth);
  const [ly, lm] = partsFromDayNumber(window.lo);
  const [hy, hm] = partsFromDayNumber(window.hi);
  const firstMonth = ly * 12 + (lm - 1);
  const lastMonth = hy * 12 + (hm - 1);
  let emitted = 0;
  for (let mi = firstMonth; mi <= lastMonth; mi++) {
    const y = Math.floor(mi / 12);
    const m = mi - y * 12 + 1;
    const dim = daysInMonth(y, m);
    const d = dom > dim ? dim : dom;
    const dn = dayNumberFromParts(y, m, d);
    if (dn < window.lo) continue;
    if (dn > window.hi) break;
    out.push(formatISODate(y, m, d));
    emitted++;
    if (emitted >= limit) break;
  }
  return out;
}

/** Internal: day number of `dayOfMonth` (clamped to the month length) in month index `mi` (= year × 12 + month − 1). */
export function monthDayNumber(mi: number, dom: number): number {
  const y = Math.floor(mi / 12);
  const m = mi - y * 12 + 1;
  const dim = daysInMonth(y, m);
  return dayNumberFromParts(y, m, dom > dim ? dim : dom);
}

/** Internal: month index (year × 12 + month − 1) of a day number. */
export function monthIndexOf(dayNumber: number): number {
  const [y, m] = partsFromDayNumber(dayNumber);
  return y * 12 + (m - 1);
}

/**
 * Internal: how many dates `expandMonthlyOnDay(dayOfMonth, window, …)` would
 * emit (no limit). O(1): month arithmetic, only the two edge months are
 * inspected.
 */
export function countMonthlyOnDay(dayOfMonth: number, window: DayWindow): number {
  if (window.lo > window.hi) return 0;
  const dom = sanitizeDayOfMonth(dayOfMonth);
  const firstMonth = monthIndexOf(window.lo);
  const lastMonth = monthIndexOf(window.hi);
  let count = lastMonth - firstMonth + 1;
  // Each month contributes exactly one date; only the edge months can fall outside.
  if (monthDayNumber(firstMonth, dom) < window.lo) count--;
  if (monthDayNumber(lastMonth, dom) > window.hi) count--;
  return count > 0 ? count : 0;
}

function countSemimonthlyInMonth(mi: number, window: DayWindow): number {
  let n = 0;
  const mid = monthDayNumber(mi, 15);
  if (mid >= window.lo && mid <= window.hi) n++;
  const end = monthDayNumber(mi, 31);
  if (end >= window.lo && end <= window.hi) n++;
  return n;
}

function countSemimonthly(window: DayWindow): number {
  const firstMonth = monthIndexOf(window.lo);
  const lastMonth = monthIndexOf(window.hi);
  if (firstMonth === lastMonth) return countSemimonthlyInMonth(firstMonth, window);
  return (
    countSemimonthlyInMonth(firstMonth, window) +
    countSemimonthlyInMonth(lastMonth, window) +
    2 * (lastMonth - firstMonth - 1)
  );
}

function countFixedStep(anchorDay: number, step: number, window: DayWindow): number {
  const k = Math.ceil((window.lo - anchorDay) / step);
  const first = anchorDay + k * step;
  return first > window.hi ? 0 : Math.floor((window.hi - first) / step) + 1;
}

function expandSemimonthly(window: DayWindow, out: ISODate[]): ISODate[] {
  const [ly, lm] = partsFromDayNumber(window.lo);
  const [hy, hm] = partsFromDayNumber(window.hi);
  const firstMonth = ly * 12 + (lm - 1);
  const lastMonth = hy * 12 + (hm - 1);
  for (let mi = firstMonth; mi <= lastMonth; mi++) {
    const y = Math.floor(mi / 12);
    const m = mi - y * 12 + 1;
    const mid = dayNumberFromParts(y, m, 15);
    if (mid >= window.lo && mid <= window.hi) out.push(formatISODate(y, m, 15));
    const dim = daysInMonth(y, m);
    const end = dayNumberFromParts(y, m, dim);
    if (end >= window.lo && end <= window.hi) out.push(formatISODate(y, m, dim));
  }
  return out;
}

function expandFixedStep(anchorDay: number, step: number, window: DayWindow, out: ISODate[]): ISODate[] {
  // Arithmetic skip to the first anchor + k*step >= lo (k may be negative).
  const k = Math.ceil((window.lo - anchorDay) / step);
  for (let d = anchorDay + k * step; d <= window.hi; d += step) {
    out.push(fromDayNumber(d));
  }
  return out;
}

/**
 * Occurrence dates of `rule` inside [rule.startDate, rule.endDate ?? +∞] ∩
 * [range.from, range.to], ascending, without duplicates. Malformed dates or
 * an unknown frequency yield `[]` (never throws).
 */
export function expandRecurrence(
  rule: FinancialRecurrence,
  range: { from: ISODate; to: ISODate },
): ISODate[] {
  const window = intersectWindow(rule.startDate, rule.endDate, range);
  if (!window) return [];
  const anchor = rule.anchorDate ?? rule.startDate;
  if (!isISODate(anchor)) return [];
  const out: ISODate[] = [];
  switch (rule.frequency) {
    case "once": {
      const a = toDayNumber(anchor);
      if (a >= window.lo && a <= window.hi) out.push(anchor);
      return out;
    }
    case "weekly":
      return expandFixedStep(toDayNumber(anchor), 7, window, out);
    case "biweekly":
      return expandFixedStep(toDayNumber(anchor), 14, window, out);
    case "monthly":
      return expandMonthlyOnDay(parseISODate(anchor)[2], window, out);
    case "semimonthly":
      return expandSemimonthly(window, out);
    default:
      return out;
  }
}

/**
 * `expandRecurrence(rule, range).length` without materialising the dates:
 * O(1) for every frequency (arithmetic skip, month arithmetic), so a
 * schedule spanning decades costs the same as one spanning a week.
 */
export function countRecurrence(
  rule: FinancialRecurrence,
  range: { from: ISODate; to: ISODate },
): number {
  const window = intersectWindow(rule.startDate, rule.endDate, range);
  if (!window) return 0;
  const anchor = rule.anchorDate ?? rule.startDate;
  if (!isISODate(anchor)) return 0;
  switch (rule.frequency) {
    case "once": {
      const a = toDayNumber(anchor);
      return a >= window.lo && a <= window.hi ? 1 : 0;
    }
    case "weekly":
      return countFixedStep(toDayNumber(anchor), 7, window);
    case "biweekly":
      return countFixedStep(toDayNumber(anchor), 14, window);
    case "monthly":
      return countMonthlyOnDay(parseISODate(anchor)[2], window);
    case "semimonthly":
      return countSemimonthly(window);
    default:
      return 0;
  }
}
