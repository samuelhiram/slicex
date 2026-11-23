// The plan's memory of its past (FinancialDocument.history): the cash it
// opened each past day with. The projection only looks forward from
// `startDate`; rolling the plan forward leaves each day behind HERE, so the
// day the person set their balance ("tengo $1,000" on 17 nov) is never
// forgotten. Pure: no IO, no clock.
import { addDays, isISODate } from "./dates";
import { roundMoney } from "./money";
import type { Movement } from "./movements";
import type { LedgerEntry } from "./rollforward";
import type { CashHistoryEntry, FinancialDocument, ISODate } from "./types";

/** Appends a day to an ascending history: a day that opened like the one before adds nothing. */
function pushDay(out: CashHistoryEntry[], date: ISODate, cash: number): void {
  const last = out[out.length - 1];
  if (last !== undefined && last.date === date) {
    last.cash = cash;
    if (out.length > 1 && out[out.length - 2]!.cash === cash) out.pop();
    return;
  }
  if (last !== undefined && last.cash === cash) return;
  out.push({ date, cash });
}

/** The well-formed entries of a history before `before`, ascending, copied. */
function pastEntries(history: readonly CashHistoryEntry[] | undefined, before: ISODate): CashHistoryEntry[] {
  const out: CashHistoryEntry[] = [];
  if (!Array.isArray(history)) return out;
  for (const entry of history) {
    if (!entry || !isISODate(entry.date) || entry.date >= before || !Number.isFinite(entry.cash)) continue;
    if (out.length > 0 && entry.date <= out[out.length - 1]!.date) continue;
    pushDay(out, entry.date, roundMoney(entry.cash));
  }
  return out;
}

/**
 * `doc.history` carried through the day before `newStart` (rollForward): the
 * day the plan leaves behind (`doc.startDate`, opened with
 * `doc.initialCash`), then every later day whose opening the cash effects
 * (`actual`) of the ledger entries before it changed. Entries outside
 * [doc.startDate, newStart) are ignored (a Rec adjustment dated `newStart`
 * belongs to today).
 */
export function extendHistory(
  doc: FinancialDocument,
  ledger: readonly LedgerEntry[],
  newStart: ISODate,
): CashHistoryEntry[] {
  const out = pastEntries(doc.history, doc.startDate);
  let cash = roundMoney(doc.initialCash);
  pushDay(out, doc.startDate, cash);
  const effects = new Map<ISODate, number>();
  for (const entry of ledger) {
    if (entry.date < doc.startDate || entry.date >= newStart || !entry.actual) continue;
    effects.set(entry.date, (effects.get(entry.date) ?? 0) + entry.actual);
  }
  for (const date of [...effects.keys()].sort()) {
    cash = roundMoney(cash + effects.get(date)!);
    const next = addDays(date, 1);
    if (next < newStart) pushDay(out, next, cash);
  }
  return out;
}

/**
 * The past of a plan saved before it had a memory, rebuilt BACKWARD from
 * today's cash: each day opened with the next day's opening minus that
 * day's cash effects — the ledger's (what Rec booked: planned, corrected or
 * an adjustment, which sets the opening of its own day) and the movements
 * paid in cash. Undefined when nothing happened before `startDate`. An
 * approximation: a balance typed on a past day without Rec left no trace.
 */
export function rebuildHistory(
  doc: FinancialDocument,
  ledger: readonly LedgerEntry[],
  movements: readonly Movement[] = [],
): CashHistoryEntry[] | undefined {
  const effects = new Map<ISODate, number>();
  const add = (date: ISODate, amount: number): void => {
    effects.set(date, roundMoney((effects.get(date) ?? 0) + amount));
  };
  for (const entry of ledger) {
    if (!entry || !isISODate(entry.date) || entry.date >= doc.startDate) continue;
    if (!Number.isFinite(entry.actual) || entry.actual === 0) continue;
    add(entry.status === "adjustment" ? addDays(entry.date, -1) : entry.date, entry.actual);
  }
  for (const movement of movements) {
    if (!movement || movement.cardId !== undefined || !isISODate(movement.date)) continue;
    if (movement.date >= doc.startDate || !Number.isFinite(movement.amount)) continue;
    add(movement.date, movement.kind === "income" ? movement.amount : -movement.amount);
  }
  const dates = [...effects.keys()].filter((date) => effects.get(date) !== 0).sort();
  if (dates.length === 0) return undefined;
  // Walk back from today: opening(d) = opening(d + 1) − effect(d).
  let cash = roundMoney(doc.initialCash);
  const backward: CashHistoryEntry[] = [];
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const date = dates[i]!;
    const next = addDays(date, 1);
    if (next < doc.startDate) backward.push({ date: next, cash });
    cash = roundMoney(cash - effects.get(date)!);
  }
  backward.push({ date: dates[0]!, cash });
  const out: CashHistoryEntry[] = [];
  for (let i = backward.length - 1; i >= 0; i -= 1) pushDay(out, backward[i]!.date, backward[i]!.cash);
  return out;
}

/** The first remembered day (null: the plan has no past). */
export function historyStart(doc: FinancialDocument): ISODate | null {
  const first = doc.history?.[0];
  return first !== undefined && isISODate(first.date) && first.date < doc.startDate ? first.date : null;
}

/**
 * The cash the plan opened `date` with: today's (`startDate`: initialCash),
 * a remembered day's (the last entry on or before it), or null — before the
 * memory starts, or after today (the projection's business).
 */
export function openingCashAt(doc: FinancialDocument, date: ISODate): number | null {
  if (date === doc.startDate) return doc.initialCash;
  if (date > doc.startDate) return null;
  const history = doc.history;
  if (!history || history.length === 0 || date < history[0]!.date) return null;
  let lo = 0;
  let hi = history.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (history[mid]!.date <= date) lo = mid;
    else hi = mid - 1;
  }
  return history[lo]!.cash;
}
