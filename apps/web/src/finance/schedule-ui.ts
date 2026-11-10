// The editor's view of a recurring schedule, in the terms people use:
//   - monthly: "el día 16" or "el último día del mes" (the engine already
//     keeps the anchor's day-of-month every month, clamped without drift;
//     an anchor on a 31st IS "the last day": 31 / 30 / 28-29);
//   - the frequency as "cada [N] [días | meses]" (plus "una vez" and the
//     MX "quincena": the 15th and the month's end), see frequencyParts;
//   - the end as a DATE, previewed as its payments ("6 pagos · el último,
//     jue 16 abr 2027") and saved ON the last payment (an end between
//     paydays — start on the 16th, "end" on the 15th — changes no money).
// Pure; no React.
import {
  addDays,
  clampedDayOfMonth,
  daysInMonth,
  expandRecurrence,
  isISODate,
  recurrenceInterval,
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
  // Generous range: the widest step of this rule + slack, per payment
  // (a month, N months, or N days).
  const every = recurrenceInterval(rule);
  const stepDays =
    rule.frequency === "monthly" ? 32 * every : rule.frequency === "daily" ? every : 32;
  const to = addDays(rule.startDate, Math.ceil(n) * stepDays + 32);
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
      const every = recurrenceInterval(rule);
      const when = day === LAST_DAY ? "El último día" : `El día ${day}`;
      return every > 1 ? `${when} cada ${every} meses` : `${when} de cada mes`;
    }
    case "daily": {
      const every = recurrenceInterval(rule);
      return every > 1 ? `Cada ${every} días` : "Todos los días";
    }
    default:
      return "";
  }
}

// --- "Cada [N] [días | meses]": the two controls of the frequency --------
//
// The editor shows a frequency as a unit plus "cada N"; the model keeps its
// named schedules where they mean something (weekly = cada 7 días with "Cada
// miércoles", biweekly = 14, semimonthly = the 15th and the month's end).
export type FrequencyUnit = "once" | "days" | "months" | "semimonthly";

export interface FrequencyParts {
  unit: FrequencyUnit;
  /** "Cada N" (>= 1); 1 for "once" / "semimonthly". */
  every: number;
}

export function frequencyParts(rule: FinancialRecurrence): FrequencyParts {
  switch (rule.frequency) {
    case "once":
      return { unit: "once", every: 1 };
    case "daily":
      return { unit: "days", every: recurrenceInterval(rule) };
    case "weekly":
      return { unit: "days", every: 7 };
    case "biweekly":
      return { unit: "days", every: 14 };
    case "semimonthly":
      return { unit: "semimonthly", every: 1 };
    default:
      return { unit: "months", every: recurrenceInterval(rule) };
  }
}

/** `rule` with the frequency the two controls describe (window kept). */
export function withFrequencyParts(
  rule: FinancialRecurrence,
  unit: FrequencyUnit,
  every: number,
): FinancialRecurrence {
  const n = recurrenceInterval({ interval: every });
  const next: FinancialRecurrence = { ...rule };
  delete next.interval;
  if (unit === "once") next.frequency = "once";
  else if (unit === "semimonthly") next.frequency = "semimonthly";
  else if (unit === "months") {
    next.frequency = "monthly";
    if (n > 1) next.interval = n;
  } else if (n === 7) next.frequency = "weekly";
  else if (n === 14) next.frequency = "biweekly";
  else {
    next.frequency = "daily";
    if (n > 1) next.interval = n;
  }
  return next;
}

/** Payments a new end covers by default: about a year. */
export function defaultPaymentCount(rule: FinancialRecurrence): number {
  const every = recurrenceInterval(rule);
  switch (rule.frequency) {
    case "once":
      return 1;
    case "daily":
      return Math.max(1, Math.ceil(365 / every));
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    default:
      return Math.max(1, Math.ceil(12 / every));
  }
}

// --- Presets: the common schedules, one click each -------------------------

export interface SchedulePreset {
  id: string;
  label: string;
  unit: FrequencyUnit;
  every: number;
}

/** The schedules people pick most, as one-click choices ("Personalizado…" opens "Cada [N] [unidad]"). */
export const SCHEDULE_PRESETS: ReadonlyArray<SchedulePreset> = [
  { id: "once", label: "Una vez", unit: "once", every: 1 },
  { id: "week", label: "Cada semana", unit: "days", every: 7 },
  { id: "quincena", label: "Cada quincena", unit: "semimonthly", every: 1 },
  { id: "month", label: "Cada mes", unit: "months", every: 1 },
  { id: "year", label: "Cada año", unit: "months", every: 12 },
];

/** The preset that IS `parts`, or null (a custom "cada N"). */
export function presetOf(parts: FrequencyParts): SchedulePreset | null {
  return (
    SCHEDULE_PRESETS.find((preset) => preset.unit === parts.unit && preset.every === parts.every) ??
    null
  );
}

/**
 * The first `count` occurrences from the start (inside the window), for the
 * "Próximos" preview. Expands at most ~`count` steps of the rule.
 */
export function upcomingPayments(rule: FinancialRecurrence, count: number): ISODate[] {
  if (!isISODate(rule.startDate) || count <= 0) return [];
  const every = recurrenceInterval(rule);
  const stepDays =
    rule.frequency === "monthly"
      ? 32 * every
      : rule.frequency === "daily"
        ? every
        : rule.frequency === "once"
          ? 1
          : 32;
  const reach = addDays(rule.startDate, (count + 1) * stepDays + 32);
  const to = rule.endDate !== undefined && isISODate(rule.endDate) && rule.endDate < reach ? rule.endDate : reach;
  return expandRecurrence(rule, { from: rule.startDate, to }).slice(0, count);
}

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "cada 6 meses, el día 15" / "cada quincena (15 y fin de mes)" / "cada 10 días" … */
export function cadenceText(rule: FinancialRecurrence): string {
  const every = recurrenceInterval(rule);
  switch (rule.frequency) {
    case "once":
      return "una sola vez";
    case "daily":
      return every > 1 ? `cada ${every} días` : "todos los días";
    case "weekly":
      return "cada semana";
    case "biweekly":
      return "cada 14 días";
    case "semimonthly":
      return "cada quincena (el 15 y el último día del mes)";
    default: {
      const day = monthlyDay(rule);
      const when = day === LAST_DAY ? "el último día del mes" : `el día ${day}`;
      if (every === 12) {
        const anchor = rule.anchorDate ?? rule.startDate;
        const month = isISODate(anchor) ? MONTH_NAMES[Number(anchor.slice(5, 7)) - 1] : undefined;
        if (month === undefined) return `cada año, ${when}`;
        return day === LAST_DAY ? `cada año, el último día de ${month}` : `cada año, el ${day} de ${month}`;
      }
      return every > 1 ? `cada ${every} meses, ${when}` : `cada mes, ${when}`;
    }
  }
}
