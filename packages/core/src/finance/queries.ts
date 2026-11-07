// Read-only queries over a projection. Point lookups are O(log n).
import type {
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
      series = { dates: [], debts: [] };
      index.set(point.accountId, series);
    }
    series.dates.push(point.date);
    series.debts.push(point.accountDebtAfter);
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
