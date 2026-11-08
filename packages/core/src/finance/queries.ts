// Read-only queries over a projection. Point lookups are O(log n).
import { roundMoney } from "./money";
import type {
  AccountActivity,
  FinancialProjection,
  FinancialProjectionPoint,
  FinancialSnapshot,
  ISODate,
  LiquidityWarning,
  UpcomingPayment,
} from "./types";

/** Index of the first point whose date is > `date` (points are chronological). */
function upperBound(points: FinancialProjectionPoint[], date: ISODate): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.date <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Cash and debt at the END of `date` (after that day's events). Before the
 * first point: initial state; after the last point: final state.
 */
export function snapshotAt(projection: FinancialProjection, date: ISODate): FinancialSnapshot {
  const idx = upperBound(projection.points, date) - 1;
  if (idx < 0) return { date, cash: projection.initialCash, debt: projection.initialDebt };
  const point = projection.points[idx]!;
  return { date, cash: point.cashAfter, debt: point.debtAfter };
}

/**
 * One warning per contiguous episode where cash stays below
 * `minimumCashReserve` (an initial cash below the reserve opens an episode
 * at startDate with the synthetic event "initial"). An episode closes only
 * when the END-OF-DAY cash (the last point of a date, `snapshotAt`
 * semantics) is back at the reserve: a payday that is spent the same day
 * does not split the episode. The episode minimum still sees every intraday
 * point. Severity "negative" when the episode minimum is below 0. O(n)
 * single pass.
 */
export function findLiquidityWarnings(
  projection: FinancialProjection,
  minimumCashReserve: number,
): LiquidityWarning[] {
  const warnings: LiquidityWarning[] = [];
  let open: LiquidityWarning | null = null;
  if (projection.initialCash < minimumCashReserve) {
    open = {
      date: projection.startDate,
      cash: projection.initialCash,
      startDate: projection.startDate,
      eventId: "initial",
      itemId: "",
      name: "Liquidez inicial",
      severity: "below-reserve",
    };
  }
  const points = projection.points;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const cash = point.cashAfter;
    if (cash < minimumCashReserve) {
      if (!open) {
        open = {
          date: point.date,
          cash,
          startDate: point.date,
          eventId: point.eventId,
          itemId: point.itemId,
          name: point.name,
          severity: "below-reserve",
        };
      } else if (cash < open.cash) {
        open.date = point.date;
        open.cash = cash;
        open.eventId = point.eventId;
        open.itemId = point.itemId;
        open.name = point.name;
      }
    } else if (open && (i + 1 >= points.length || points[i + 1]!.date !== point.date)) {
      open.severity = open.cash < 0 ? "negative" : "below-reserve";
      warnings.push(open);
      open = null;
    }
  }
  if (open) {
    open.severity = open.cash < 0 ? "negative" : "below-reserve";
    warnings.push(open);
  }
  return warnings;
}

/** First cash outflow strictly after `afterDate`, or null. */
export function nextPayment(projection: FinancialProjection, afterDate: ISODate): UpcomingPayment | null {
  const points = projection.points;
  for (let i = upperBound(points, afterDate); i < points.length; i++) {
    const point = points[i]!;
    if (point.cashDelta < 0) {
      return {
        date: point.date,
        itemId: point.itemId,
        name: point.name,
        amount: -point.cashDelta,
        type: point.type,
      };
    }
  }
  return null;
}

interface AccountDebtSeries {
  /** Chronological dates of the points that touched the account. */
  dates: ISODate[];
  /** `accountDebtAfter` of those points. */
  debts: number[];
  /**
   * Prefix sums (length dates.length + 1, cents): entry i covers the first
   * i points — posted interest, cash paid, charges (see `accountActivity`).
   */
  interest: number[];
  payments: number[];
  charges: number[];
}

// Built once per projection (projections are immutable), dropped with it.
const accountDebtIndex = new WeakMap<FinancialProjection, Map<string, AccountDebtSeries>>();

function accountDebtSeries(projection: FinancialProjection): Map<string, AccountDebtSeries> {
  let index = accountDebtIndex.get(projection);
  if (index) return index;
  index = new Map();
  for (const point of projection.points) {
    if (point.accountId === undefined || point.accountDebtAfter === undefined) continue;
    let series = index.get(point.accountId);
    if (!series) {
      series = { dates: [], debts: [], interest: [0], payments: [0], charges: [0] };
      index.set(point.accountId, series);
    }
    series.dates.push(point.date);
    series.debts.push(point.accountDebtAfter);
    let interest = 0;
    let payment = 0;
    let charge = 0;
    switch (point.type) {
      case "credit-card-interest":
        interest = point.debtDelta > 0 ? point.debtDelta : 0;
        break;
      case "credit-card-purchase":
      case "debt-opening":
        charge = point.debtDelta > 0 ? point.debtDelta : 0;
        break;
      case "credit-card-payment":
      case "loan-payment":
      case "installment-payment":
        payment = point.cashDelta < 0 ? -point.cashDelta : 0;
        break;
      default:
        break;
    }
    const n = series.dates.length - 1;
    series.interest.push(roundMoney(series.interest[n]! + interest));
    series.payments.push(roundMoney(series.payments[n]! + payment));
    series.charges.push(roundMoney(series.charges[n]! + charge));
  }
  accountDebtIndex.set(projection, index);
  return index;
}

/** Index of the first date > `date` in an ascending array. */
function upperBoundDate(dates: ISODate[], date: ISODate): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid]! <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first date >= `date` in an ascending array. */
function lowerBoundDate(dates: ISODate[], date: ISODate): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid]! < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Debt of every account of `projection.accounts` at the END of `date`
 * (after that day's events), floored at 0; the account's openingDebt when
 * none of its points is on/before `date`. Keys follow `projection.accounts`
 * order. O(accounts · log points) per call: the per-account series are built
 * once per projection object (lazily, held in a WeakMap).
 */
export function debtByAccountAt(projection: FinancialProjection, date: ISODate): Map<string, number> {
  const index = accountDebtSeries(projection);
  const out = new Map<string, number>();
  for (const account of projection.accounts) {
    let debt = account.openingDebt;
    const series = index.get(account.id);
    if (series) {
      const i = upperBoundDate(series.dates, date) - 1;
      if (i >= 0) debt = series.debts[i]!;
    }
    out.set(account.id, debt > 0 ? debt : 0);
  }
  return out;
}

/**
 * Movements of account `accountId` over the points with
 * `from <= date <= to` (inclusive), as positive magnitudes:
 * - interest: card interest posted to the account;
 * - payments: cash paid to the account (card, loan and MSI payments; a loan
 *   payment counts in full even past the remaining debt);
 * - charges: purchases charged / debts opened on the account.
 * Zeros for an unknown account or `from > to`. O(log points): two binary
 * searches over per-account prefix sums built once per projection (lazily,
 * in the WeakMap shared with `debtByAccountAt`). Pass `out` to write the
 * result into an existing object (no allocation per call); it is returned.
 */
export function accountActivity(
  projection: FinancialProjection,
  accountId: string,
  from: ISODate,
  to: ISODate,
  out?: AccountActivity,
): AccountActivity {
  const result = out ?? { interest: 0, payments: 0, charges: 0 };
  result.interest = 0;
  result.payments = 0;
  result.charges = 0;
  if (from > to) return result;
  const series = accountDebtSeries(projection).get(accountId);
  if (!series) return result;
  const lo = lowerBoundDate(series.dates, from);
  const hi = upperBoundDate(series.dates, to);
  if (hi <= lo) return result;
  result.interest = roundMoney(series.interest[hi]! - series.interest[lo]!);
  result.payments = roundMoney(series.payments[hi]! - series.payments[lo]!);
  result.charges = roundMoney(series.charges[hi]! - series.charges[lo]!);
  return result;
}

const itemImpactCache = new WeakMap<FinancialProjection, Map<string, number>>();

/**
 * Signed sum of `cashDelta` per itemId over the whole projection (cents);
 * every item with at least one point has an entry (a card purchase: 0).
 * Cached per projection object: repeated calls return the SAME map, so treat
 * it as read-only. O(points) once, O(1) after.
 */
export function annualItemImpact(projection: FinancialProjection): Map<string, number> {
  let impact = itemImpactCache.get(projection);
  if (impact) return impact;
  impact = new Map();
  for (const point of projection.points) {
    const sum = impact.get(point.itemId);
    impact.set(point.itemId, sum === undefined ? point.cashDelta : roundMoney(sum + point.cashDelta));
  }
  itemImpactCache.set(projection, impact);
  return impact;
}
