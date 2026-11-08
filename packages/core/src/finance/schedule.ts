// Lazy day-number schedules: the same dates as `expandRecurrence` /
// `expandMonthlyOnDay`, produced one at a time as UTC day numbers. No date
// string and no array is materialised, so a simulation that stops early (a
// debt paid off in month 23 of a 360-month window) only pays for the dates it
// actually visits. Each start jumps arithmetically to the first occurrence
// inside the window (performance canon §1.5 / §2.4).
import { isISODate, parseISODate, toDayNumber } from "./dates";
import { intersectWindow, monthDayNumber, monthIndexOf, sanitizeDayOfMonth } from "./recurrence";
import type { DayWindow } from "./recurrence";
import type { FinancialRecurrence, ISODate } from "./types";

const FIXED_STEP = 0;
const MONTHLY = 1;
const SEMIMONTHLY = 2;

/** Internal: forward-only cursor over a schedule's occurrence days. */
export class DayCursor {
  /** Current occurrence (UTC day number); +Infinity once exhausted. */
  day = Number.POSITIVE_INFINITY;
  private mode = FIXED_STEP;
  /** FIXED_STEP: days between occurrences (0 = single occurrence). */
  private step = 0;
  /** MONTHLY / SEMIMONTHLY: month index of `day`. */
  private month = 0;
  /** MONTHLY: sanitised day of month. */
  private dom = 1;
  /** SEMIMONTHLY: 0 = the 15th, 1 = the last day of the month. */
  private half = 0;
  /** Inclusive last day of the window. */
  private hi = 0;
  /** Occurrences still allowed, the current one included. */
  private left = 0;

  /** Every `step` days from `anchorDay` (k may be negative) inside `window`; step 0 = `anchorDay` once. */
  startFixedStep(anchorDay: number, step: number, window: DayWindow, limit = Number.POSITIVE_INFINITY): this {
    this.mode = FIXED_STEP;
    this.step = step;
    this.hi = window.hi;
    this.left = limit;
    if (step <= 0) {
      this.left = limit > 1 ? 1 : limit;
      this.set(anchorDay >= window.lo ? anchorDay : Number.POSITIVE_INFINITY);
    } else {
      this.set(anchorDay + Math.ceil((window.lo - anchorDay) / step) * step);
    }
    return this;
  }

  /** `dayOfMonth` (clamped to each month's length) every month inside `window`; at most `limit` dates. */
  startMonthly(dayOfMonth: number, window: DayWindow, limit = Number.POSITIVE_INFINITY): this {
    this.mode = MONTHLY;
    this.dom = sanitizeDayOfMonth(dayOfMonth);
    this.hi = window.hi;
    this.left = limit;
    this.month = monthIndexOf(window.lo);
    let day = monthDayNumber(this.month, this.dom);
    if (day < window.lo) day = monthDayNumber(++this.month, this.dom);
    this.set(day);
    return this;
  }

  /** The 15th and the last day of every month inside `window`. */
  startSemimonthly(window: DayWindow): this {
    this.mode = SEMIMONTHLY;
    this.hi = window.hi;
    this.left = Number.POSITIVE_INFINITY;
    this.month = monthIndexOf(window.lo);
    this.half = 0;
    let day = monthDayNumber(this.month, 15);
    if (day < window.lo) {
      // The month's last day is always >= window.lo (lo lies in that month).
      this.half = 1;
      day = monthDayNumber(this.month, 31);
    }
    this.set(day);
    return this;
  }

  /** Same dates as `expandRecurrence(rule, range)`. Malformed input → exhausted. */
  startRecurrence(rule: FinancialRecurrence, range: { from: ISODate; to: ISODate }): this {
    this.day = Number.POSITIVE_INFINITY;
    const window = intersectWindow(rule.startDate, rule.endDate, range);
    if (!window) return this;
    const anchor = rule.anchorDate ?? rule.startDate;
    if (!isISODate(anchor)) return this;
    switch (rule.frequency) {
      case "once":
        return this.startFixedStep(toDayNumber(anchor), 0, window, 1);
      case "weekly":
        return this.startFixedStep(toDayNumber(anchor), 7, window);
      case "biweekly":
        return this.startFixedStep(toDayNumber(anchor), 14, window);
      case "monthly":
        return this.startMonthly(parseISODate(anchor)[2], window);
      case "semimonthly":
        return this.startSemimonthly(window);
      default:
        return this;
    }
  }

  /** Moves to the next occurrence (no-op once exhausted). */
  advance(): void {
    if (this.day === Number.POSITIVE_INFINITY) return;
    this.left--;
    switch (this.mode) {
      case FIXED_STEP:
        this.set(this.step > 0 ? this.day + this.step : Number.POSITIVE_INFINITY);
        break;
      case MONTHLY:
        this.set(monthDayNumber(++this.month, this.dom));
        break;
      default:
        if (this.half === 0) {
          this.half = 1;
          this.set(monthDayNumber(this.month, 31));
        } else {
          this.half = 0;
          this.set(monthDayNumber(++this.month, 15));
        }
        break;
    }
  }

  private set(day: number): void {
    this.day = day <= this.hi && this.left > 0 ? day : Number.POSITIVE_INFINITY;
  }
}
