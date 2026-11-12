// Loan maths for the editor: "Calcular pago" and the live check that a
// loan's balance, payment and number of payments agree.
//
// Standard (French) amortization: a fixed payment per period that pays the
// interest of the period and the rest goes to the principal, so the last
// payment leaves the balance at 0. The projection itself accrues no loan
// interest (LoanItem.annualRate is informative): these functions only help
// the person pick a payment that already INCLUDES the interest, which is what
// the plan then takes out of the cash every period.
//
// Pure: no IO, no clock. Money in pesos, results in cents.
import { recurrenceInterval } from "./recurrence";
import type { FinancialRecurrence } from "./types";

/** Days per year used for "cada N días" schedules (same as the MX year helpers). */
const DAYS_PER_YEAR = 365;

/**
 * Payments per year of a schedule: monthly 12 (12 / N for "cada N meses"),
 * semimonthly 24, biweekly 26, weekly 52, daily 365 / N. A one-off schedule
 * is 1 (a single payment).
 */
export function periodsPerYear(rule: Pick<FinancialRecurrence, "frequency" | "interval">): number {
  const every = recurrenceInterval(rule);
  switch (rule.frequency) {
    case "monthly":
      return 12 / every;
    case "semimonthly":
      return 24;
    case "biweekly":
      return 26;
    case "weekly":
      return 52;
    case "daily":
      return DAYS_PER_YEAR / every;
    default:
      return 1;
  }
}

/** Interest rate of one period: annual % / periods per year (0 when not a positive finite rate). */
function periodRate(annualRatePct: number | undefined, perYear: number): number {
  if (annualRatePct === undefined || !Number.isFinite(annualRatePct) || annualRatePct <= 0) return 0;
  if (!Number.isFinite(perYear) || perYear <= 0) return 0;
  return annualRatePct / 100 / perYear;
}

/**
 * "Calcular pago": the fixed payment that pays `principal` off in exactly
 * `count` payments at `annualRatePct` (% per year, compounded per period),
 * rounded UP to cents (so the last payment never falls short). Without a
 * rate it is principal / count. 0 when there is nothing to pay or no
 * payment to spread it over.
 *
 * @example amortizedPayment(10_000, 0, 4, 12) === 2500
 * @example amortizedPayment(100_000, 12, 12, 12) === 8884.88
 */
export function amortizedPayment(
  principal: number,
  annualRatePct: number | undefined,
  count: number,
  perYear: number,
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1) return 0;
  const r = periodRate(annualRatePct, perYear);
  const raw = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
  // Up to the cent, with a hair of tolerance for floating-point noise
  // (2500.0000000001 is 2500, not 2500.01).
  return Math.ceil(raw * 100 - 1e-6) / 100;
}

/**
 * How many payments of `payment` pay `principal` off at `annualRatePct`
 * (the last one may be smaller). 0 when nothing is owed; null when the
 * payment never pays it off (0, or not more than one period's interest).
 * The inverse of `amortizedPayment`: loanPaymentCount(P, r, amortizedPayment(P, r, n, k), k) === n.
 *
 * @example loanPaymentCount(10_000, 0, 1_500, 12) === 7
 */
export function loanPaymentCount(
  principal: number,
  annualRatePct: number | undefined,
  payment: number,
  perYear: number,
): number | null {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(payment) || payment <= 0) return null;
  const r = periodRate(annualRatePct, perYear);
  if (r === 0) return Math.max(1, Math.ceil(principal / payment - 1e-9));
  const left = 1 - (r * principal) / payment;
  // A payment equal to the interest (to floating-point noise) never pays it off.
  if (left <= 1e-9) return null;
  const n = -Math.log(left) / Math.log(1 + r);
  return Math.max(1, Math.ceil(n - 1e-6));
}
