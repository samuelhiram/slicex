// What the header says first (UX-14 / UX-03): a verdict in words ("¿me
// alcanza?") and what is left out of the calculation. Pure functions of the
// plan and its projection: the header computes them ONCE per bridge revision
// (useMemo on the revision), never per frame.
import {
  addDays,
  buildProjectionAccounts,
  getProjectionRange,
  type FinancialDocument,
  type FinancialItem,
  type FinancialProjection,
  type ISODate,
  type LiquidityWarning,
} from "@slicex/core";
import { formatMoneyWhole } from "./format";

export type VerdictTone = "ok" | "low" | "negative";

export interface Verdict {
  tone: VerdictTone;
  /** The big line: whether it is enough (and until when). */
  title: string;
  /** The second line: the first day it is not, and how much is missing. */
  detail: string;
  /** The day a click on the verdict goes to. */
  date: ISODate;
}

/** First date the projected cash drops below zero (point by point), or null. */
export function firstNegativeDate(projection: FinancialProjection): ISODate | null {
  if (projection.initialCash < 0) return projection.startDate;
  for (const point of projection.points) {
    if (point.cashAfter < 0) return point.date;
  }
  return null;
}

/**
 * "¿Me alcanza?" in one sentence, from the projection:
 * - it goes red: "Te alcanza hasta el 26 nov" · "el 27 nov te faltan $1,292";
 * - it only dips below the reserve: "Te alcanza, justo" · "el 27 nov bajas de tu reserva";
 * - otherwise: "Te alcanza todo el año" · "lo más bajo: $6,208 el 15 mar".
 * `formatDate` formats a day (short inside the start year, long beyond).
 */
export function computeVerdict(
  projection: FinancialProjection,
  warnings: readonly LiquidityWarning[],
  horizonMonths: number,
  formatDate: (iso: ISODate) => string,
): Verdict {
  const minimum = projection.minimumCash;
  const red = firstNegativeDate(projection);
  if (red !== null) {
    const worst =
      minimum.date === red
        ? `te faltan ${formatMoneyWhole(-minimum.cash)}`
        : `entras en rojo · lo peor: ${formatMoneyWhole(minimum.cash)} el ${formatDate(minimum.date)}`;
    if (red === projection.startDate) {
      return { tone: "negative", title: "Hoy no te alcanza", detail: `Hoy ${worst}`, date: red };
    }
    return {
      tone: "negative",
      title: `Te alcanza hasta el ${formatDate(addDays(red, -1))}`,
      detail: `El ${formatDate(red)} ${worst}`,
      date: red,
    };
  }
  const first = warnings[0];
  if (first) {
    return {
      tone: "low",
      title: "Te alcanza, justo",
      detail:
        first.startDate === projection.startDate
          ? "Hoy ya estás bajo tu reserva"
          : `El ${formatDate(first.startDate)} bajas de tu reserva`,
      date: first.startDate,
    };
  }
  return {
    tone: "ok",
    title: horizonMonths === 12 ? "Te alcanza todo el año" : "Te alcanza todo tu plan",
    detail: `Lo más bajo: ${formatMoneyWhole(minimum.cash)} el ${formatDate(minimum.date)}`,
    date: minimum.date,
  };
}

/** Items left out of the calculation (muted, on a muted row, or outside a solo). */
export function excludedItems(doc: FinancialDocument): FinancialItem[] {
  return doc.items.filter((item) => item.enabled === false);
}

/**
 * What you owe today counting EVERY item, excluded ones too (UX-03: "Deuda
 * hoy" is a fact, not a simulation). Same rule as the projection's
 * `initialDebt` (sum of the opening debts of the accounts), on the plan with
 * nothing excluded. O(items).
 */
export function realInitialDebt(doc: FinancialDocument): number {
  const all = doc.items.map((item) => {
    if (item.enabled !== false) return item;
    const { enabled: _enabled, ...rest } = item;
    return rest as FinancialItem;
  });
  const accounts = buildProjectionAccounts({ ...doc, items: all }, getProjectionRange(doc));
  let total = 0;
  for (const account of accounts) total += account.openingDebt;
  return Math.round(total * 100) / 100;
}

/** "Nu" for one item, "2 objetos" for more. */
export function exclusionLabel(items: readonly FinancialItem[]): string {
  if (items.length === 1) return items[0]!.name;
  return `${items.length} objetos`;
}
