// ISO calendar-date arithmetic on UTC day numbers.
//
// Pure integer arithmetic (Howard Hinnant's civil-from-days algorithms),
// equivalent to `Date.UTC(...) / 86_400_000` but without allocating Date
// objects and without the Date.UTC quirk that maps years 0..99 to 19xx.
// No local-time API is ever used, so DST can never shift a date.
import type { ISODate } from "./types";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Internal: [year, month 1..12, day 1..31]. */
export type DateParts = [number, number, number];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in `month` (1..12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** Strict `YYYY-MM-DD` that names a real calendar date. */
export function isISODate(value: string): boolean {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** Internal: parse a valid ISO date. Throws RangeError on malformed input. */
export function parseISODate(date: ISODate): DateParts {
  if (!isISODate(date)) {
    throw new RangeError(`Invalid ISO date "${String(date)}" (expected YYYY-MM-DD)`);
  }
  return [
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
  ];
}

/** Internal: days since 1970-01-01 for a (valid) y/m/d. */
export function dayNumberFromParts(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Internal: inverse of `dayNumberFromParts`. */
export function partsFromDayNumber(dayNumber: number): DateParts {
  const z = Math.floor(dayNumber) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return [y, m, d];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  if (n >= 1000) return String(n);
  if (n >= 100) return `0${n}`;
  if (n >= 10) return `00${n}`;
  return `000${n}`;
}

/** Internal: format a (valid) y/m/d as `YYYY-MM-DD`. */
export function formatISODate(year: number, month: number, day: number): ISODate {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Days since 1970-01-01 (UTC). Throws RangeError on malformed input. */
export function toDayNumber(date: ISODate): number {
  const [y, m, d] = parseISODate(date);
  return dayNumberFromParts(y, m, d);
}

/** Inverse of `toDayNumber` (non-integers are floored). */
export function fromDayNumber(day: number): ISODate {
  const [y, m, d] = partsFromDayNumber(day);
  return formatISODate(y, m, d);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + Math.trunc(days));
}

/** `to − from` in whole days. */
export function diffDays(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** `month` 1..12; `day` clamped to [1, month length]. */
export function clampedDayOfMonth(year: number, month: number, day: number): ISODate {
  const dim = daysInMonth(year, month);
  const d = day < 1 ? 1 : day > dim ? dim : Math.floor(day);
  return formatISODate(year, month, d);
}

/** Adds calendar months; the day is clamped to the target month length (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = parseISODate(date);
  const total = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return clampedDayOfMonth(ny, nm, d);
}

/** Negative / 0 / positive like a sort comparator (valid ISO dates compare lexicographically). */
export function compareISODate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
