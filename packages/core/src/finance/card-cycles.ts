// Credit-card cycle calendar: cut dates, due dates and which due date pays a
// purchase in "statement" mode. Pure day-number arithmetic with the engine's
// clamping (a day of month past the month length falls on the month's last
// day, without drifting: cutDay 31 → Feb 28, then Mar 31), stepping one month
// at a time, never one day at a time.
import { fromDayNumber, isISODate, toDayNumber } from "./dates";
import { expandMonthlyOnDay, monthDayNumber, monthIndexOf, sanitizeDayOfMonth } from "./recurrence";
import type { CreditCardItem, ISODate } from "./types";

/** Day number of the first `dayOfMonth` (sanitised, clamped to the month length) on or after `day`. O(1). */
function monthlyOnOrAfter(dayOfMonth: number, day: number): number {
  const dom = sanitizeDayOfMonth(dayOfMonth);
  const month = monthIndexOf(day);
  const inMonth = monthDayNumber(month, dom);
  return inMonth >= day ? inMonth : monthDayNumber(month + 1, dom);
}

/**
 * Every cut date (`cutDay`) and every due date (`dueDay`) of `card` in
 * [from, to] (inclusive), ascending, with the engine's clamping. Calendar
 * only: the card's recurrence window (the months it actually pays) is not
 * applied. Empty lists when `from > to` or a date is malformed (never
 * throws). O(months in range).
 */
export function cardCycleDates(
  card: CreditCardItem,
  from: ISODate,
  to: ISODate,
): { cuts: ISODate[]; dues: ISODate[] } {
  const cuts: ISODate[] = [];
  const dues: ISODate[] = [];
  if (!isISODate(from) || !isISODate(to)) return { cuts, dues };
  const window = { lo: toDayNumber(from), hi: toDayNumber(to) };
  if (window.lo > window.hi) return { cuts, dues };
  expandMonthlyOnDay(card.cutDay, window, cuts);
  expandMonthlyOnDay(card.dueDay, window, dues);
  return { cuts, dues };
}

/** First cut date of `card` on or after `date` (a cut on `date` itself counts). Throws RangeError on a malformed date. O(1). */
export function nextCutDate(card: CreditCardItem, date: ISODate): ISODate {
  return fromDayNumber(monthlyOnOrAfter(card.cutDay, toDayNumber(date)));
}

/**
 * "statement" mode: the due date that pays a purchase made on
 * `purchaseDate` — the first due date strictly after the first cut on or
 * after `purchaseDate` (a purchase on the cut day belongs to that cut's
 * statement; a due date on the cut day itself pays the previous statement).
 * Calendar only: assumes the card pays on that due date (inside its
 * recurrence window). Throws RangeError on a malformed date. O(1).
 */
export function statementDueDate(card: CreditCardItem, purchaseDate: ISODate): ISODate {
  const cut = monthlyOnOrAfter(card.cutDay, toDayNumber(purchaseDate));
  return fromDayNumber(monthlyOnOrAfter(card.dueDay, cut + 1));
}
