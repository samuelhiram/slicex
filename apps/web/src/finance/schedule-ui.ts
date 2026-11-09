// The editor's view of a recurring schedule, in the terms people use:
//   - monthly: "el día 16" or "el último día del mes" (the engine already
//     keeps the anchor's day-of-month every month, clamped without drift;
//     an anchor on a 31st IS "the last day": 31 / 30 / 28-29);
//   - the end as a NUMBER OF PAYMENTS ("6 pagos · último: jue 16 abr 2027")
//     instead of a free end date that could fall between paydays
//     (start on the 16th, "end" on the 15th).
// Pure; no React.
import {
  addDays,
  clampedDayOfMonth,
  daysInMonth,
  expandRecurrence,
  isISODate,
  type FinancialRecurrence,
  type ISODate,
} from "@slicex/core";

/** "Último día del mes": an anchor on a 31st clamps to every month's last day. */
export const LAST_DAY = 31;

export function isRecurring(rule: FinancialRecurrence): boolean {
  return rule.frequency !== "once";
}

function parts(date: ISODate): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** The monthly payday: 1..30, or LAST_DAY (31) for the last day of the month. */
export function monthlyDay(rule: FinancialRecurrence): number {
  const anchor = rule.anchorDate ?? rule.startDate;
  return isISODate(anchor) ? parts(anchor)[2] : 1;
}

/** A date on the 31st on or after `from`'s month (anchor for "último día"). */
function a31stFrom(from: ISODate): ISODate {
  let [y, m] = parts(from);
  while (daysInMonth(y, m) < 31) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return clampedDayOfMonth(y, m, 31);
}

/**
 * Pays on `day` (1..30, or LAST_DAY) every month. The first payment moves
 * within the same month as the current one (clamped); the end, given as a
 * number of payments, keeps that number.
 */
export function withMonthlyDay(rule: FinancialRecurrence, day: number): FinancialRecurrence {
  if (!isISODate(rule.startDate)) return rule;
  const [y, m] = parts(rule.startDate);
  const startDate = clampedDayOfMonth(y, m, day);
  const next: FinancialRecurrence = {
    ...rule,
    startDate,
    anchorDate: day >= LAST_DAY ? a31stFrom(startDate) : startDate,
  };
  const count = paymentCount(rule);
  return count === null ? next : withPaymentCount(next, count);
}

/**
 * A new first-payment date typed in the "Fecha" field. A schedule on the
 * last day of the month stays there when the new date is a month's last
 * day too (30 abr must not become "every 30th").
 */
export function withStartDate(rule: FinancialRecurrence, startDate: ISODate): FinancialRecurrence {
  const lastDay =
    rule.frequency === "monthly" && monthlyDay(rule) === LAST_DAY && isISODate(startDate);
  const [y, m, d] = isISODate(startDate) ? parts(startDate) : [0, 0, 0];
  const anchorDate =
    lastDay && d === daysInMonth(y, m) ? a31stFrom(startDate) : startDate;
  return { ...rule, startDate, anchorDate };
}

/** Payments from the start up to the window end (null = indefinite). */
export function paymentCount(rule: FinancialRecurrence): number | null {
  if (rule.endDate === undefined) return null;
  if (!isISODate(rule.startDate) || !isISODate(rule.endDate)) return 0;
  return expandRecurrence(rule, { from: rule.startDate, to: rule.endDate }).length;
}

/** Date of the n-th payment (1-based) from the start, or null. */
export function nthPayment(rule: FinancialRecurrence, n: number): ISODate | null {
  if (!isISODate(rule.startDate) || !(n >= 1)) return null;
  const open: FinancialRecurrence = { ...rule };
  delete open.endDate;
  // Generous range: the widest step (a month) + slack, per payment.
  const to = addDays(rule.startDate, Math.ceil(n) * 32 + 32);
  const dates = expandRecurrence(open, { from: rule.startDate, to });
  return dates[Math.ceil(n) - 1] ?? null;
}

/** Ends on the date of the n-th payment (the last one that happens). */
export function withPaymentCount(rule: FinancialRecurrence, n: number): FinancialRecurrence {
  const last = nthPayment(rule, Math.max(1, Math.floor(n)));
  return last ? { ...rule, endDate: last } : rule;
}

/** The last payment inside the window, or null (indefinite / none). */
export function lastPayment(rule: FinancialRecurrence): ISODate | null {
  const count = paymentCount(rule);
  return count ? nthPayment(rule, count) : null;
}

/**
 * Saved windows end ON their last payment: an end between paydays (start
 * 16, end 15) changes no money but reads as a different schedule.
 */
export function snapEndToLastPayment(rule: FinancialRecurrence): FinancialRecurrence {
  if (!isRecurring(rule) || rule.endDate === undefined) return rule;
  const last = lastPayment(rule);
  return last && last !== rule.endDate ? { ...rule, endDate: last } : rule;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function weekdayOf(date: ISODate): string {
  const [y, m, d] = parts(date);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** One line under "Frecuencia": when it pays. */
export function scheduleSummary(rule: FinancialRecurrence): string {
  const anchor = rule.anchorDate ?? rule.startDate;
  if (!isISODate(anchor)) return "";
  switch (rule.frequency) {
    case "weekly":
      return `Cada ${weekdayOf(anchor)}`;
    case "biweekly":
      return `Cada 2 semanas, en ${weekdayOf(anchor)}`;
    case "semimonthly":
      return "Los días 15 y último de cada mes";
    case "monthly": {
      const day = monthlyDay(rule);
      return day === LAST_DAY ? "El último día de cada mes" : `El día ${day} de cada mes`;
    }
    default:
      return "";
  }
}
