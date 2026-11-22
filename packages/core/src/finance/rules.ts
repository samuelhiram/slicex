// Rule changes ("a partir de aquí") and one-occurrence edits ("solo este
// pago") of a recurring item. Pure: no IO, no clock.
//
// An item has ONE base rule — its recurrence and its amount — and stays one
// item when that rule changes from a date on: `ruleChanges` cut its window
// into SEGMENTS, each with the cadence and the amount in force there, and
// `occurrenceEdits` change the amount of single occurrences. Whoever needs
// "the amount" or "the cadence" of an item on some date asks this module
// (event expansion, payoff estimate, labels) instead of reading the item's
// fields.
//
// Semantics:
// - A change is in force from max(change.from, recurrence.startDate) to the
//   day before the next change, clipped to the item's window. Changes on or
//   before the start replace the base rule from the start; changes after the
//   end do nothing.
// - An amount-only change keeps the phase (paydays do not move). A cadence
//   change restarts the phase at `from`: its first occurrence is `from`.
// - An edit applies to the occurrence scheduled on its date, after the
//   segments; 0 means that one does not happen. The occurrence still exists
//   (the engine emits it with amount 0, the projection skips it).
// - A one-time item has no segments (changes and edits are ignored): its
//   own fields are its only occurrence.
// - Window loans (no balance) owe what their BASE rule schedules
//   (projection.ts `loanOpeningDebt`): changing payments changes when the
//   loan is paid off, not what is owed.
import { addDays, isISODate, toDayNumber } from "./dates";
import { positiveMoney } from "./money";
import { countRecurrence, expandMonthlyOnDay, expandRecurrence, intersectWindow } from "./recurrence";
import type {
  FinancialItem,
  FinancialOccurrenceEdit,
  FinancialRecurrence,
  FinancialRuleChange,
  ISODate,
  RecurrenceFrequency,
} from "./types";

/** One stretch of an item's window with a single cadence and amount. */
export interface RuleSegment {
  /** The cadence in force, its window clipped to the segment. */
  recurrence: FinancialRecurrence;
  /** Planned amount per occurrence in force (raw: positiveMoney at use). */
  amount: number | undefined;
  /** First day of the segment. */
  from: ISODate;
  /** Last day of the segment (inclusive); undefined = open-ended. */
  to: ISODate | undefined;
  /** The change that opened the segment; undefined for the base rule. */
  change: FinancialRuleChange | undefined;
}

const NO_CHANGES: readonly FinancialRuleChange[] = Object.freeze([]);

/**
 * The amount an occurrence of `item` plans, before changes and edits:
 * income / expense / card purchase `amount`; loan `paymentAmount`; credit
 * card in "fixed" mode `paymentAmount ?? minimumPayment`. Undefined for the
 * items whose occurrences have no editable amount: a "statement" card (it
 * pays the statement) and an MSI plan (its installments are fixed).
 */
export function itemRuleAmount(item: FinancialItem): number | undefined {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return item.amount;
    case "loan":
      return item.paymentAmount;
    case "credit-card":
      return item.paymentMode === "statement" ? undefined : (item.paymentAmount ?? item.minimumPayment);
    default:
      return undefined;
  }
}

/** True when the amount of the item's occurrences can be changed one by one or from a date on. */
export function canEditOccurrences(item: FinancialItem): boolean {
  return item.kind !== "installment-plan" && !(item.kind === "credit-card" && item.paymentMode === "statement");
}

/** True when the item's cadence can change from a date on (cards pay on their due day; MSI monthly). */
export function canChangeCadence(item: FinancialItem): boolean {
  return item.kind === "income" || item.kind === "expense" || item.kind === "card-purchase" || item.kind === "loan";
}

/** The item with its base planned amount set to `amount` (see `itemRuleAmount`). */
export function withRuleAmount<T extends FinancialItem>(item: T, amount: number): T {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return { ...item, amount };
    case "loan":
    case "credit-card":
      return { ...item, paymentAmount: amount };
    default:
      return item;
  }
}

function validChange(change: FinancialRuleChange | undefined): change is FinancialRuleChange {
  return change !== undefined && change !== null && typeof change === "object" && isISODate(change.from);
}

/**
 * The item's rule changes with a valid date, sorted by `from`, one per date
 * (the last one listed for a date wins). The same frozen empty list when
 * there are none.
 */
export function sortedRuleChanges(item: FinancialItem): readonly FinancialRuleChange[] {
  const changes = item.ruleChanges;
  if (!Array.isArray(changes) || changes.length === 0) return NO_CHANGES;
  const byDate = new Map<ISODate, FinancialRuleChange>();
  for (const change of changes) if (validChange(change)) byDate.set(change.from, change);
  if (byDate.size === 0) return NO_CHANGES;
  return Array.from(byDate.values()).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** The item's one-occurrence edits (valid date, finite amount ≥ 0) by date, or null when it has none. */
export function occurrenceEditAmounts(item: FinancialItem): ReadonlyMap<ISODate, number> | null {
  const edits = item.occurrenceEdits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  let out: Map<ISODate, number> | null = null;
  for (const edit of edits) {
    if (!edit || !isISODate(edit.date) || typeof edit.amount !== "number" || !Number.isFinite(edit.amount)) continue;
    if (edit.amount < 0) continue;
    (out ??= new Map()).set(edit.date, edit.amount);
  }
  return out;
}

/** True when the item has rule changes or occurrence edits that the engine reads. */
export function hasRuleEdits(item: FinancialItem): boolean {
  if (item.recurrence.frequency === "once") return false;
  return sortedRuleChanges(item).length > 0 || occurrenceEditAmounts(item) !== null;
}

function segmentRule(
  base: FinancialRecurrence,
  frequency: RecurrenceFrequency,
  interval: number | undefined,
  anchor: ISODate,
  from: ISODate,
  to: ISODate | undefined,
): FinancialRecurrence {
  const rule: FinancialRecurrence = { frequency, startDate: from };
  if (to !== undefined) rule.endDate = to;
  if (anchor !== from) rule.anchorDate = anchor;
  if (interval !== undefined) rule.interval = interval;
  if (base.flexibleDay === true) rule.flexibleDay = true;
  return rule;
}

/**
 * The item's window cut by its rule changes, in date order. Without changes
 * (or for a one-time item) a single segment whose `recurrence` IS the item's
 * (same object). Segments never overlap; an empty stretch (a change on or
 * before the start, two changes … ) yields no segment.
 */
export function ruleSegments(item: FinancialItem): RuleSegment[] {
  const rec = item.recurrence;
  const amount0 = itemRuleAmount(item);
  const changes = rec.frequency === "once" ? NO_CHANGES : sortedRuleChanges(item);
  if (changes.length === 0 || !isISODate(rec.startDate)) {
    return [{ recurrence: rec, amount: amount0, from: rec.startDate, to: rec.endDate, change: undefined }];
  }
  const end = rec.endDate !== undefined && isISODate(rec.endDate) ? rec.endDate : undefined;
  const cadence = canChangeCadence(item);
  let frequency = rec.frequency;
  let interval = rec.interval;
  let anchor = rec.anchorDate !== undefined && isISODate(rec.anchorDate) ? rec.anchorDate : rec.startDate;
  let amount = amount0;
  let opened: FinancialRuleChange | undefined;
  let from = rec.startDate;
  // Whether the stretch [from, …] still follows the item's own rule object.
  let pristine = true;
  const out: RuleSegment[] = [];
  for (const change of changes) {
    if (end !== undefined && change.from > end) break;
    if (change.from > from) {
      const to = addDays(change.from, -1);
      out.push({
        recurrence: segmentRule(rec, frequency, interval, anchor, from, to),
        amount,
        from,
        to,
        change: opened,
      });
      from = change.from;
    }
    pristine = false;
    if (change.amount !== undefined && Number.isFinite(change.amount)) amount = change.amount;
    if (cadence && change.frequency !== undefined) {
      frequency = change.frequency;
      interval = change.interval;
      anchor = change.from;
    }
    opened = change;
  }
  out.push({
    recurrence: pristine ? rec : segmentRule(rec, frequency, interval, anchor, from, end),
    amount,
    from,
    to: end,
    change: opened,
  });
  return out;
}

/**
 * The segment in force on `date`: the one containing it, the first one
 * before the window, the last one after it.
 */
export function ruleSegmentAt(item: FinancialItem, date: ISODate): RuleSegment {
  const segments = ruleSegments(item);
  for (let i = segments.length - 1; i > 0; i--) {
    if (date >= segments[i]!.from) return segments[i]!;
  }
  return segments[0]!;
}

/**
 * Planned amount (positive money) of the occurrence of `item` scheduled on
 * `date`: the segment's, or the edit's when that occurrence was edited.
 * Does not check that `date` IS an occurrence.
 */
export function occurrenceAmount(item: FinancialItem, date: ISODate): number {
  const edited = item.recurrence.frequency === "once" ? undefined : occurrenceEditAmounts(item)?.get(date);
  if (edited !== undefined) return positiveMoney(edited);
  return positiveMoney(ruleSegmentAt(item, date).amount);
}

/**
 * Scheduled dates of an income / expense / card purchase / loan inside
 * `range`, segments applied (an edited occurrence keeps its date, even at
 * 0). Ascending. `[]` for the other kinds (their dates depend on a card's
 * days: use the engine's events).
 */
export function ruleOccurrenceDates(item: FinancialItem, range: { from: ISODate; to: ISODate }): ISODate[] {
  if (!canChangeCadence(item)) return [];
  const segments = ruleSegments(item);
  if (segments.length === 1) return expandRecurrence(segments[0]!.recurrence, range);
  const out: ISODate[] = [];
  for (const segment of segments) {
    for (const date of expandRecurrence(segment.recurrence, range)) out.push(date);
  }
  return out;
}

/**
 * True when `item` (segments applied) has an occurrence scheduled on `date`:
 * a credit card on its due day inside its window, the other editable kinds
 * on their cadence.
 */
export function isScheduledOn(item: FinancialItem, date: ISODate): boolean {
  return isISODate(date) && hasOccurrenceIn(item, { from: date, to: date });
}

function hasOccurrenceIn(item: FinancialItem, range: { from: ISODate; to: ISODate }): boolean {
  if (range.from > range.to) return false;
  if (item.kind === "credit-card") {
    const window = intersectWindow(item.recurrence.startDate, item.recurrence.endDate, range);
    if (!window) return false;
    const out: ISODate[] = [];
    expandMonthlyOnDay(item.dueDay, window, out);
    return out.length > 0;
  }
  return ruleOccurrenceDates(item, range).length > 0;
}

/**
 * The rule change whose FIRST occurrence is the one on `date` (usually dated
 * that same day; an item moved in time can leave it a few days before), or
 * undefined: "este y los siguientes" was applied on that occurrence.
 */
export function ruleChangeStartingAt(item: FinancialItem, date: ISODate): FinancialRuleChange | undefined {
  if (!isISODate(date) || item.recurrence.frequency === "once") return undefined;
  const segment = ruleSegmentAt(item, date);
  const change = segment.change;
  if (change === undefined || date < segment.from) return undefined;
  if (date > segment.from && hasOccurrenceIn(item, { from: segment.from, to: addDays(date, -1) })) return undefined;
  return change;
}

/**
 * The item without the rule change that starts on the occurrence of `date`:
 * what that occurrence and the following ones go back to. Undefined when no
 * change starts there, or when the occurrence exists only because of it (a
 * cadence that the rule before it does not have on that day).
 */
export function withoutRuleChangeAt<T extends FinancialItem>(item: T, date: ISODate): T | undefined {
  const change = ruleChangeStartingAt(item, date);
  if (change === undefined) return undefined;
  const without = removeRuleChange(item, change.from);
  return isScheduledOn(without, date) ? without : undefined;
}

/** True when the schedule of `item` (segments applied) has an occurrence before `date`. */
function hasOccurrenceBefore(item: FinancialItem, date: ISODate): boolean {
  const rec = item.recurrence;
  if (!isISODate(rec.startDate) || !isISODate(date) || date <= rec.startDate) return false;
  const range = { from: rec.startDate, to: addDays(date, -1) };
  for (const segment of ruleSegments(item)) {
    if (segment.from > range.to) break;
    if (countRecurrence(segment.recurrence, range) > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Editing.

export type OccurrenceScope = "this" | "following";

/** What the person changed on one occurrence (a cell of the timeline). */
export interface OccurrenceEditRequest {
  /** The occurrence's scheduled date. */
  date: ISODate;
  /** "this" = only that occurrence; "following" = that one and every later one. */
  scope: OccurrenceScope;
  /** New amount (≥ 0). Absent: unchanged. */
  amount?: number;
  /** New cadence ("following" only; ignored when the kind cannot change it). */
  frequency?: RecurrenceFrequency;
  /** "Cada N" of the new cadence. */
  interval?: number;
}

function sameInterval(a: number | undefined, b: number | undefined): boolean {
  return (a ?? 1) === (b ?? 1);
}

function sameChange(a: FinancialRuleChange, b: FinancialRuleChange): boolean {
  return (
    a.from === b.from &&
    a.amount === b.amount &&
    a.frequency === b.frequency &&
    (a.frequency === undefined || sameInterval(a.interval, b.interval))
  );
}

function withEdits<T extends FinancialItem>(item: T, edits: FinancialOccurrenceEdit[]): T {
  const next = { ...item };
  if (edits.length === 0) delete next.occurrenceEdits;
  else next.occurrenceEdits = edits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return next;
}

function withChanges<T extends FinancialItem>(item: T, changes: FinancialRuleChange[]): T {
  const next = { ...item };
  if (changes.length === 0) delete next.ruleChanges;
  else next.ruleChanges = changes.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return next;
}

function editsWithout(item: FinancialItem, date: ISODate): FinancialOccurrenceEdit[] {
  return (item.occurrenceEdits ?? []).filter((edit) => edit && edit.date !== date);
}

/** The item without the edit of the occurrence on `date` (same item when it has none). */
export function clearOccurrenceEdit<T extends FinancialItem>(item: T, date: ISODate): T {
  if (!item.occurrenceEdits?.some((edit) => edit && edit.date === date)) return item;
  return withEdits(item, editsWithout(item, date));
}

/** The item without its rule change starting on `from` (same item when it has none). */
export function removeRuleChange<T extends FinancialItem>(item: T, from: ISODate): T {
  if (!item.ruleChanges?.some((change) => change && change.from === from)) return item;
  return withChanges(
    item,
    item.ruleChanges.filter((change) => change && change.from !== from),
  );
}

/**
 * Applies what the person changed on the occurrence of `item` on
 * `request.date`, keeping it ONE item:
 * - one-time item: its own amount (and, with a cadence, it starts repeating
 *   from that date, open-ended);
 * - "this": an occurrence edit (none when the amount is the rule's). On an
 *   occurrence where a rule change starts (and with no edit of its own) it
 *   NARROWS that change to the occurrence: the change goes, the following
 *   ones are back to the rule before it ("following" is reversible);
 * - "following" on the first occurrence: the base rule itself (and changes
 *   dated on or before it go: the new base replaces them);
 * - "following" later: a rule change from that date (merged with one already
 *   there; none when it changes nothing). The edit of that occurrence goes
 *   (the new rule defines it); later changes and edits stay.
 * A new cadence restarts the phase at `request.date`. Returns the same item
 * when nothing changes.
 */
export function editItemOccurrence<T extends FinancialItem>(item: T, request: OccurrenceEditRequest): T {
  if (!canEditOccurrences(item) || !isISODate(request.date)) return item;
  const amount =
    request.amount !== undefined && Number.isFinite(request.amount) && request.amount >= 0
      ? request.amount
      : undefined;
  const cadence =
    request.frequency !== undefined && canChangeCadence(item) ? request.frequency : undefined;
  const rec = item.recurrence;

  if (rec.frequency === "once") {
    let next = amount !== undefined && amount !== itemRuleAmount(item) ? withRuleAmount(item, amount) : item;
    if (cadence !== undefined && cadence !== "once") {
      const recurrence: FinancialRecurrence = { frequency: cadence, startDate: request.date };
      if (request.interval !== undefined && !sameInterval(request.interval, 1)) recurrence.interval = request.interval;
      next = { ...next, recurrence };
    }
    return next;
  }

  if (request.scope === "this") {
    if (amount === undefined || !isScheduledOn(item, request.date)) return item;
    const edited = occurrenceEditAmounts(item)?.has(request.date) ?? false;
    const base = (edited ? undefined : withoutRuleChangeAt(item, request.date)) ?? item;
    const ruled = positiveMoney(ruleSegmentAt(base, request.date).amount);
    const edits = editsWithout(base, request.date);
    if (positiveMoney(amount) !== ruled) edits.push({ date: request.date, amount });
    const before = item.occurrenceEdits ?? [];
    const same =
      base === item &&
      edits.length === before.length &&
      edits.every((edit) => before.some((old) => old && old.date === edit.date && old.amount === edit.amount));
    return same ? item : withEdits(base, edits);
  }

  // "following"
  const segment = ruleSegmentAt(item, request.date);
  const rule = segment.recurrence;
  const newCadence =
    cadence !== undefined && (cadence !== rule.frequency || !sameInterval(request.interval, rule.interval));
  const newAmount = amount !== undefined && positiveMoney(amount) !== positiveMoney(segment.amount);

  if (!hasOccurrenceBefore(item, request.date)) {
    // The first occurrence: the base rule itself changes.
    let next: T = clearOccurrenceEdit(item, request.date);
    const remaining = sortedRuleChanges(next).filter((change) => change.from > request.date);
    if (remaining.length !== (next.ruleChanges?.length ?? 0)) next = withChanges(next, remaining.slice());
    if (newAmount) next = withRuleAmount(next, amount!);
    if (newCadence) {
      const recurrence: FinancialRecurrence = { ...rec, frequency: cadence! };
      delete recurrence.interval;
      if (request.interval !== undefined && !sameInterval(request.interval, 1)) recurrence.interval = request.interval;
      if (request.date === rec.startDate) delete recurrence.anchorDate;
      else recurrence.anchorDate = request.date;
      next = { ...next, recurrence };
    }
    return next;
  }

  let next: T = clearOccurrenceEdit(item, request.date);
  // The change that already starts on this occurrence, if any: it is replaced.
  const existing = ruleChangeStartingAt(next, request.date);
  const changes = (next.ruleChanges ?? []).filter(
    (change) => change && change.from !== request.date && change.from !== existing?.from,
  );
  // The rule in force the day before: what a change on this date is compared with.
  const prior = ruleSegmentAt(withChanges(next, changes.slice()), addDays(request.date, -1));
  const merged: FinancialRuleChange = { from: request.date };
  const mergedAmount = newAmount ? amount! : existing?.amount;
  if (mergedAmount !== undefined && positiveMoney(mergedAmount) !== positiveMoney(prior.amount)) {
    merged.amount = mergedAmount;
  }
  let frequency = existing?.frequency;
  let interval = existing?.interval;
  if (newCadence) {
    frequency = cadence;
    interval = request.interval !== undefined && !sameInterval(request.interval, 1) ? request.interval : undefined;
  }
  // Back to the cadence in force before: no cadence change (the old phase goes on).
  if (
    frequency !== undefined &&
    frequency === prior.recurrence.frequency &&
    sameInterval(interval, prior.recurrence.interval)
  ) {
    frequency = undefined;
    interval = undefined;
  }
  if (frequency !== undefined && canChangeCadence(item)) {
    merged.frequency = frequency;
    if (interval !== undefined) merged.interval = interval;
  }
  if (merged.amount !== undefined || merged.frequency !== undefined) changes.push(merged);
  const before = next.ruleChanges ?? [];
  const same =
    changes.length === before.length &&
    changes.every((change) => before.some((old) => old && sameChange(old, change)));
  if (!same) next = withChanges(next, changes);
  return next;
}

/**
 * The item with the amount of the rule in force on `date` set to `amount`:
 * the change that opened that segment when it set an amount, else the base
 * rule (an inline "how much" edit of today's rule). Same item when nothing
 * changes.
 */
export function withAmountInForce<T extends FinancialItem>(item: T, date: ISODate, amount: number): T {
  if (!Number.isFinite(amount) || amount < 0) return item;
  const segment = ruleSegmentAt(item, date);
  const change = segment.change;
  if (change !== undefined && change.amount !== undefined && item.ruleChanges) {
    if (change.amount === amount) return item;
    return {
      ...item,
      ruleChanges: item.ruleChanges.map((candidate) =>
        candidate && candidate.from === change.from ? { ...candidate, amount } : candidate,
      ),
    };
  }
  return itemRuleAmount(item) === amount ? item : withRuleAmount(item, amount);
}

/**
 * The item with every rule change and occurrence edit moved by `days` days
 * (the item itself was moved in time: its exceptions follow it). Same item
 * when `days` is 0 or it has none.
 */
export function shiftItemRules<T extends FinancialItem>(item: T, days: number): T {
  const shift = Math.trunc(days);
  if (shift === 0) return item;
  const changes = item.ruleChanges;
  const edits = item.occurrenceEdits;
  if ((!changes || changes.length === 0) && (!edits || edits.length === 0)) return item;
  const next = { ...item };
  if (changes && changes.length > 0) {
    next.ruleChanges = changes.map((change) =>
      validChange(change) ? { ...change, from: addDays(change.from, shift) } : change,
    );
  }
  if (edits && edits.length > 0) {
    next.occurrenceEdits = edits.map((edit) =>
      edit && isISODate(edit.date) ? { ...edit, date: addDays(edit.date, shift) } : edit,
    );
  }
  return next;
}

// ---------------------------------------------------------------------------
// Engine helpers (events.ts, payoff.ts).

/**
 * Pushes the planned amount of each date of `dates` (ascending, all inside
 * one segment of planned amount `amount`) into `amounts`, edits applied.
 */
export function plannedAmounts(
  dates: readonly ISODate[],
  amount: number,
  edits: ReadonlyMap<ISODate, number> | null,
  amounts: number[],
): void {
  for (const date of dates) {
    const edited = edits?.get(date);
    amounts.push(edited !== undefined ? positiveMoney(edited) : amount);
  }
}

/**
 * Day windows of a credit card's payments by segment: [payWindow] cut at
 * each rule change, with the amount in force. Cards pay on their due day,
 * so only the windows and amounts matter.
 */
export function cardPaymentWindows(
  item: FinancialItem,
  range: { from: ISODate; to: ISODate },
): { lo: number; hi: number; amount: number }[] {
  const out: { lo: number; hi: number; amount: number }[] = [];
  for (const segment of ruleSegments(item)) {
    const window = intersectWindow(segment.from, segment.to, range);
    if (!window) continue;
    out.push({ lo: window.lo, hi: window.hi, amount: positiveMoney(segment.amount) });
  }
  return out;
}

/**
 * Sum of the planned amounts of an income / expense / loan / card purchase
 * inside `range` (segments and edits applied), counted arithmetically per
 * segment (O(segments + edits), never expanding the schedule).
 */
export function scheduledTotal(item: FinancialItem, range: { from: ISODate; to: ISODate }): number {
  let total = 0;
  const segments = ruleSegments(item);
  for (const segment of segments) {
    total += positiveMoney(segment.amount) * countRecurrence(segment.recurrence, range);
  }
  const edits = item.recurrence.frequency === "once" ? null : occurrenceEditAmounts(item);
  if (edits) {
    for (const [date, amount] of edits) {
      if (date < range.from || date > range.to) continue;
      const segment = ruleSegmentAt(item, date);
      if (countRecurrence(segment.recurrence, { from: date, to: date }) === 0) continue;
      total += positiveMoney(amount) - positiveMoney(segment.amount);
    }
  }
  return total;
}

/** Edits by day number (payoff cursors walk day numbers), or null. */
export function occurrenceEditDays(item: FinancialItem): ReadonlyMap<number, number> | null {
  if (item.recurrence.frequency === "once") return null;
  const edits = occurrenceEditAmounts(item);
  if (!edits) return null;
  const out = new Map<number, number>();
  for (const [date, amount] of edits) out.set(toDayNumber(date), positiveMoney(amount));
  return out;
}
