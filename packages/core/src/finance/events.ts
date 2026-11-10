// Item → dated events expansion.
//
// Incremental: every item's expansion is memoised (module-level WeakMap keyed
// by the item object) and reused while every input it reads is unchanged, so
// re-projecting a document after editing ONE item re-expands only that item.
// The per-item lists are merged with a counting sort over (day, type
// priority) buckets instead of a global O(E log E) sort; the order and the
// ids are byte-identical to the reference path (`expandFinancialEventsUncached`).
import { addMonths, dayNumberFromParts, isISODate, parseISODate, toDayNumber } from "./dates";
import {
  installmentAmount,
  installmentsPaidOf,
  isFutureInstallmentPlan,
  remainingInstallmentCount,
  remainingInstallmentDebt,
} from "./items";
import { positiveMoney } from "./money";
import { countMonthlyOnDay, expandMonthlyOnDay, expandRecurrence, intersectWindow } from "./recurrence";
import type {
  CreditCardItem,
  FinancialDocument,
  FinancialEvent,
  FinancialEventType,
  FinancialItem,
  ISODate,
} from "./types";

/** Same-day processing order (lower first). */
export const EVENT_TYPE_PRIORITY: Readonly<Record<FinancialEventType, number>> = {
  income: 0,
  "credit-card-interest": 1,
  "credit-card-purchase": 2,
  "debt-opening": 3,
  expense: 4,
  "loan-payment": 5,
  "installment-payment": 6,
  "credit-card-payment": 7,
};

/** Bucket key = day number × PRIORITY_SLOTS + type priority (priorities are 0..7). */
const PRIORITY_SLOTS = 8;

/** Internal: date asc, then same-day type priority. Stable sorts keep the rest. */
export function compareEventsByDateAndType(a: FinancialEvent, b: FinancialEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return EVENT_TYPE_PRIORITY[a.type] - EVENT_TYPE_PRIORITY[b.type];
}

/** [startDate, addMonths(startDate, horizonMonths)] (both inclusive). */
export function getProjectionRange(doc: FinancialDocument): { from: ISODate; to: ISODate } {
  return { from: doc.startDate, to: addMonths(doc.startDate, doc.horizonMonths) };
}

type Range = { from: ISODate; to: ISODate };

function pushDates(
  out: FinancialEvent[],
  dates: ISODate[],
  item: FinancialItem,
  type: FinancialEventType,
  amount: number,
  accountId: string | undefined,
): void {
  for (const date of dates) {
    const event: FinancialEvent = { id: "", itemId: item.id, type, date, amount, name: item.name };
    if (accountId !== undefined) event.accountId = accountId;
    out.push(event);
  }
}

/** First credit card per id (disabled ones included), the card an MSI plan pays on. */
function firstCards(doc: FinancialDocument): Map<string, CreditCardItem> {
  const cards = new Map<string, CreditCardItem>();
  for (const item of doc.items) {
    if (item.kind === "credit-card" && !cards.has(item.id)) cards.set(item.id, item);
  }
  return cards;
}

/**
 * Appends the events of ONE enabled item to `out`, in emission order (not
 * sorted, ids ""). Reads only the item's own fields, `range`, `docStartDate`
 * and — installment plans only — `card.dueDay`. Keep `ItemExpansion` /
 * `entryMatches` in sync with whatever this function reads.
 */
function expandItem(
  item: FinancialItem,
  range: Range,
  docStartDate: ISODate,
  card: CreditCardItem | undefined,
  scratch: ISODate[],
  out: FinancialEvent[],
): void {
  const rec = item.recurrence;
  switch (item.kind) {
    case "income":
      pushDates(out, expandRecurrence(rec, range), item, "income", positiveMoney(item.amount), undefined);
      break;
    case "expense":
      pushDates(out, expandRecurrence(rec, range), item, "expense", positiveMoney(item.amount), undefined);
      break;
    case "loan":
      pushDates(out, expandRecurrence(rec, range), item, "loan-payment", positiveMoney(item.paymentAmount), item.id);
      break;
    case "credit-card": {
      // "statement" mode: the projection computes every payment (the pending
      // statement, closed at each cut) and charges no interest, so the payments
      // carry 0 and no interest event is emitted.
      const statement = item.paymentMode === "statement";
      const payWindow = intersectWindow(rec.startDate, rec.endDate, range);
      if (payWindow) {
        scratch.length = 0;
        expandMonthlyOnDay(item.dueDay, payWindow, scratch);
        const planned = statement ? 0 : positiveMoney(item.paymentAmount ?? item.minimumPayment);
        pushDates(out, scratch, item, "credit-card-payment", planned, item.id);
      }
      if (statement) break;
      const interestWindow = intersectWindow(range.from, undefined, range);
      if (interestWindow) {
        scratch.length = 0;
        expandMonthlyOnDay(item.cutDay, interestWindow, scratch);
        pushDates(out, scratch, item, "credit-card-interest", 0, item.id);
      }
      break;
    }
    case "card-purchase":
      pushDates(
        out,
        expandRecurrence(rec, range),
        item,
        "credit-card-purchase",
        positiveMoney(item.amount),
        item.cardId ? item.cardId : item.id,
      );
      break;
    case "installment-plan": {
      const remaining = remainingInstallmentCount(item);
      if (remaining <= 0) break;
      if (!isISODate(docStartDate)) break;
      // A future purchase books its debt (no cash) on its start date.
      const opensInRange = rec.startDate >= range.from && rec.startDate <= range.to;
      if (opensInRange && isFutureInstallmentPlan(item, docStartDate)) {
        pushDates(out, [rec.startDate], item, "debt-opening", remainingInstallmentDebt(item), item.id);
      }
      // The schedule counts from max(startDate, doc.startDate); `range` only clips it.
      const schedule = intersectWindow(rec.startDate, rec.endDate, { from: docStartDate, to: range.to });
      if (!schedule) break;
      const window = intersectWindow(rec.startDate, rec.endDate, range);
      if (!window) break;
      const lo = window.lo > schedule.lo ? window.lo : schedule.lo;
      if (lo > window.hi) break;
      let dayOfMonth: number;
      if (card) {
        dayOfMonth = card.dueDay;
      } else {
        const anchor = rec.anchorDate !== undefined && isISODate(rec.anchorDate) ? rec.anchorDate : rec.startDate;
        dayOfMonth = parseISODate(anchor)[2];
      }
      // Installments due in [schedule.lo, lo) were already paid by then (O(1) count).
      const consumed = lo > schedule.lo ? countMonthlyOnDay(dayOfMonth, { lo: schedule.lo, hi: lo - 1 }) : 0;
      const limit = remaining - consumed;
      if (limit <= 0) break;
      scratch.length = 0;
      expandMonthlyOnDay(dayOfMonth, { lo, hi: window.hi }, scratch, limit);
      // Installment number of scratch[0] (1-based); the last one absorbs the cents.
      const firstNumber = installmentsPaidOf(item) + consumed + 1;
      for (let i = 0; i < scratch.length; i++) {
        out.push({
          id: "",
          itemId: item.id,
          type: "installment-payment",
          date: scratch[i]!,
          amount: installmentAmount(item, firstNumber + i),
          name: item.name,
          accountId: item.id,
        });
      }
      break;
    }
    default:
      break;
  }
}

function isKnownKind(item: FinancialItem): boolean {
  switch (item.kind) {
    case "income":
    case "expense":
    case "loan":
    case "credit-card":
    case "card-purchase":
    case "installment-plan":
      return true;
    default:
      return false;
  }
}

/**
 * `${itemId}@${date}` plus "#n" for the n-th event (n ≥ 2) with that base on
 * a date, in list order. Duplicates can only share a date, so the counter map
 * is reset whenever the date changes. Mutates the events.
 */
function assignEventIds(events: FinancialEvent[]): void {
  const seen = new Map<string, number>();
  let currentDate = "";
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.date !== currentDate) {
      seen.clear();
      currentDate = event.date;
    }
    const base = `${event.itemId}@${event.date}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    event.id = n === 1 ? base : `${base}#${n}`;
  }
}

/**
 * Internal reference path: the plain algorithm (expand every enabled item,
 * one global stable sort by date → type priority → item order → id, ids
 * assigned after sorting). No memo. Tests compare the incremental path
 * against it; production code calls `expandFinancialEvents`.
 */
export function expandFinancialEventsUncached(
  doc: FinancialDocument,
  range: Range = getProjectionRange(doc),
): FinancialEvent[] {
  const cards = firstCards(doc);
  const drafts: { event: FinancialEvent; order: number }[] = [];
  const scratch: ISODate[] = [];
  const local: FinancialEvent[] = [];
  for (let order = 0; order < doc.items.length; order++) {
    const item = doc.items[order]!;
    if (item.enabled === false) continue;
    const card = item.kind === "installment-plan" && item.cardId ? cards.get(item.cardId) : undefined;
    local.length = 0;
    expandItem(item, range, doc.startDate, card, scratch, local);
    for (const event of local) drafts.push({ event, order });
  }
  drafts.sort((a, b) => {
    const byDate = compareEventsByDateAndType(a.event, b.event);
    if (byDate !== 0) return byDate;
    if (a.order !== b.order) return a.order - b.order;
    const ia = a.event.itemId;
    const ib = b.event.itemId;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  const events = drafts.map((d) => d.event);
  assignEventIds(events);
  return events;
}

// ---------------------------------------------------------------------------
// Memo.

/** `ItemExpansion.cardDay` of an item that does not pay on a document card. */
const NO_CARD = null;

/**
 * One item's expansion plus a value snapshot of EVERY input `expandItem`
 * reads. A hit requires all of them to be equal (Object.is), so an item
 * mutated in place (same object) is re-expanded too.
 */
interface ItemExpansion {
  from: ISODate;
  to: ISODate;
  docStartDate: ISODate;
  kind: FinancialItem["kind"];
  id: string;
  name: string;
  frequency: unknown;
  interval: unknown;
  startDate: unknown;
  endDate: unknown;
  anchorDate: unknown;
  /** Kind-specific fields, see `kindFieldsMatch`. */
  f1: unknown;
  f2: unknown;
  f3: unknown;
  f4: unknown;
  f5: unknown;
  /** installment-plan: dueDay of `cards.get(cardId)`; NO_CARD when there is no such card. */
  cardDay: unknown;
  /** Frozen events (frozen list), sorted by date → type priority (stable), local ids. */
  events: readonly FinancialEvent[];
  /** `events[i]` day number × PRIORITY_SLOTS + type priority. */
  keys: Int32Array;
}

const expansionCache = new WeakMap<FinancialItem, ItemExpansion>();

function kindFieldsMatch(e: ItemExpansion, item: FinancialItem): boolean {
  switch (item.kind) {
    case "income":
    case "expense":
      return Object.is(e.f1, item.amount);
    case "loan":
      return Object.is(e.f1, item.paymentAmount);
    case "credit-card":
      return (
        Object.is(e.f1, item.dueDay) &&
        Object.is(e.f2, item.cutDay) &&
        Object.is(e.f3, item.paymentAmount) &&
        Object.is(e.f4, item.minimumPayment) &&
        e.f5 === item.paymentMode
      );
    case "card-purchase":
      return Object.is(e.f1, item.amount) && e.f2 === item.cardId;
    case "installment-plan":
      return (
        e.f1 === item.cardId &&
        Object.is(e.f2, item.originalAmount) &&
        Object.is(e.f3, item.installmentsTotal) &&
        Object.is(e.f4, item.installmentsPaid)
      );
    default:
      return false;
  }
}

function setKindFields(e: ItemExpansion, item: FinancialItem): void {
  switch (item.kind) {
    case "income":
    case "expense":
      e.f1 = item.amount;
      break;
    case "loan":
      e.f1 = item.paymentAmount;
      break;
    case "credit-card":
      e.f1 = item.dueDay;
      e.f2 = item.cutDay;
      e.f3 = item.paymentAmount;
      e.f4 = item.minimumPayment;
      e.f5 = item.paymentMode;
      break;
    case "card-purchase":
      e.f1 = item.amount;
      e.f2 = item.cardId;
      break;
    case "installment-plan":
      e.f1 = item.cardId;
      e.f2 = item.originalAmount;
      e.f3 = item.installmentsTotal;
      e.f4 = item.installmentsPaid;
      break;
    default:
      break;
  }
}

function entryMatches(e: ItemExpansion, item: FinancialItem, range: Range, docStartDate: ISODate, cardDay: unknown): boolean {
  // Optional chaining: a plan with no installment left never reads its recurrence.
  const rec = item.recurrence as FinancialItem["recurrence"] | undefined;
  return (
    e.from === range.from &&
    e.to === range.to &&
    e.docStartDate === docStartDate &&
    e.kind === item.kind &&
    e.id === item.id &&
    e.name === item.name &&
    e.frequency === rec?.frequency &&
    e.interval === rec?.interval &&
    e.startDate === rec?.startDate &&
    e.endDate === rec?.endDate &&
    e.anchorDate === rec?.anchorDate &&
    Object.is(e.cardDay, cardDay) &&
    kindFieldsMatch(e, item)
  );
}

/** Day number of a date that is known to be a valid "YYYY-MM-DD" (every emitted date is). */
function validDateDayNumber(date: ISODate): number {
  const y =
    (date.charCodeAt(0) - 48) * 1000 +
    (date.charCodeAt(1) - 48) * 100 +
    (date.charCodeAt(2) - 48) * 10 +
    (date.charCodeAt(3) - 48);
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return dayNumberFromParts(y, m, d);
}

/** Internal: true when `events` already follow `compareEventsByDateAndType`. O(n). */
export function isSortedByDateAndType(events: readonly FinancialEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    if (compareEventsByDateAndType(events[i - 1]!, events[i]!) > 0) return false;
  }
  return true;
}

function buildEntry(
  item: FinancialItem,
  range: Range,
  docStartDate: ISODate,
  card: CreditCardItem | undefined,
  cardDay: unknown,
  scratch: ISODate[],
): ItemExpansion {
  const rec = item.recurrence as FinancialItem["recurrence"] | undefined;
  const events: FinancialEvent[] = [];
  expandItem(item, range, docStartDate, card, scratch, events);
  // Restricted to one item, the global order is date → type priority → emission
  // order (the item order / id tie-breaks are constant), i.e. this stable sort.
  if (!isSortedByDateAndType(events)) events.sort(compareEventsByDateAndType);
  // Ids only collide within one item id, so local ids equal the global ones
  // unless two contributing items share an id (handled in the merge).
  assignEventIds(events);
  const keys = new Int32Array(events.length);
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    keys[i] = validDateDayNumber(event.date) * PRIORITY_SLOTS + EVENT_TYPE_PRIORITY[event.type];
    Object.freeze(event);
  }
  const entry: ItemExpansion = {
    from: range.from,
    to: range.to,
    docStartDate,
    kind: item.kind,
    id: item.id,
    name: item.name,
    frequency: rec?.frequency,
    interval: rec?.interval,
    startDate: rec?.startDate,
    endDate: rec?.endDate,
    anchorDate: rec?.anchorDate,
    f1: undefined,
    f2: undefined,
    f3: undefined,
    f4: undefined,
    f5: undefined,
    cardDay,
    events: Object.freeze(events),
    keys,
  };
  setKindFields(entry, item);
  return entry;
}

/**
 * Counting sort of the per-item lists over (day, type priority) buckets.
 * Parts are visited in item order and each list in its own order, so every
 * bucket ends up in item order → emission order: exactly the reference
 * comparator. O(events + buckets). Null when the range is not a valid,
 * reasonably sized date range (the caller falls back to a comparison sort).
 */
function bucketMerge(parts: ItemExpansion[], total: number, range: Range): FinancialEvent[] | null {
  if (!isISODate(range.from) || !isISODate(range.to)) return null;
  const fromDay = toDayNumber(range.from);
  const span = (toDayNumber(range.to) - fromDay + 1) * PRIORITY_SLOTS;
  if (span <= 0 || span > total * 16 + 65536) return null;
  const base = fromDay * PRIORITY_SLOTS;
  // next[b] = next free slot of bucket b (after the prefix sum).
  const next = new Int32Array(span + 1);
  for (let p = 0; p < parts.length; p++) {
    const keys = parts[p]!.keys;
    for (let i = 0; i < keys.length; i++) {
      const b = keys[i]! - base;
      if (b < 0 || b >= span) return null;
      next[b + 1]!++;
    }
  }
  for (let b = 1; b <= span; b++) next[b]! += next[b - 1]!;
  const out = new Array<FinancialEvent>(total);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]!;
    const keys = part.keys;
    const events = part.events;
    for (let i = 0; i < keys.length; i++) out[next[keys[i]! - base]!++] = events[i]!;
  }
  return out;
}

function sortMerge(parts: ItemExpansion[]): FinancialEvent[] {
  const drafts: { event: FinancialEvent; order: number }[] = [];
  for (let p = 0; p < parts.length; p++) {
    for (const event of parts[p]!.events) drafts.push({ event, order: p });
  }
  // Same comparator as the reference path (`order` = rank among the parts,
  // which preserves the item order).
  drafts.sort((a, b) => {
    const byDate = compareEventsByDateAndType(a.event, b.event);
    if (byDate !== 0) return byDate;
    if (a.order !== b.order) return a.order - b.order;
    const ia = a.event.itemId;
    const ib = b.event.itemId;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  return drafts.map((d) => d.event);
}

/**
 * Two contributing items share an id: recount the "#n" suffixes over the
 * merged list (reference rule). Events whose id changes are replaced by a
 * frozen copy (same key order); the cached events are never mutated.
 */
function reassignSharedIds(events: FinancialEvent[]): void {
  const seen = new Map<string, number>();
  let currentDate = "";
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.date !== currentDate) {
      seen.clear();
      currentDate = event.date;
    }
    const base = `${event.itemId}@${event.date}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}#${n}`;
    if (event.id !== id) events[i] = Object.freeze({ ...event, id });
  }
}

/**
 * Dated events of every enabled item inside `range` (default: the
 * projection range), sorted by date → type priority → item order → id.
 *
 * The returned array is new on every call, but the event objects are
 * FROZEN and shared with later calls (per-item memo): copy one before
 * changing it. An item is re-expanded only when one of the inputs it reads
 * changed (its own fields, `range`, the document start and, for an MSI plan,
 * its card's dueDay); unchanged items reuse their events.
 *
 * Credit cards emit a "credit-card-payment" on every due date inside their
 * window and, in "fixed" mode, a 0-amount "credit-card-interest" on every cut
 * of the range. In "statement" mode the payments carry 0 (the projection pays
 * the pending statement) and no interest event is emitted (see
 * CreditCardItem).
 *
 * Card purchases are ALWAYS emitted with `accountId = cardId` (or the
 * purchase's own id when `cardId` is empty). When that card is missing or
 * disabled the projection books the purchase on an auto-created zero-rate
 * account, so the debt is never silently dropped.
 *
 * Installment plans: the remaining installments are counted from
 * max(startDate, doc.startDate) whatever `range` is (installments before the
 * document start are the `installmentsPaid` ones), and the last installment
 * carries the cent remainder. A future plan (see InstallmentPlanItem) also
 * emits a "debt-opening" event on its startDate.
 */
export function expandFinancialEvents(
  doc: FinancialDocument,
  range: Range = getProjectionRange(doc),
): FinancialEvent[] {
  const cards = firstCards(doc);
  const docStartDate = doc.startDate;
  const items = doc.items;
  const parts: ItemExpansion[] = [];
  const contributingIds = new Set<string>();
  let sharedIds = false;
  let total = 0;
  let scratch: ISODate[] | undefined;
  for (let order = 0; order < items.length; order++) {
    const item = items[order]!;
    if (item.enabled === false || !isKnownKind(item)) continue;
    let card: CreditCardItem | undefined;
    let cardDay: unknown = NO_CARD;
    if (item.kind === "installment-plan" && item.cardId) {
      card = cards.get(item.cardId);
      if (card) cardDay = card.dueDay;
    }
    let entry = expansionCache.get(item);
    if (entry === undefined || !entryMatches(entry, item, range, docStartDate, cardDay)) {
      entry = buildEntry(item, range, docStartDate, card, cardDay, (scratch ??= []));
      expansionCache.set(item, entry);
    }
    const count = entry.events.length;
    if (count === 0) continue;
    if (contributingIds.has(entry.id)) sharedIds = true;
    else contributingIds.add(entry.id);
    parts.push(entry);
    total += count;
  }
  if (total === 0) return [];
  const events = bucketMerge(parts, total, range) ?? sortMerge(parts);
  if (sharedIds) reassignSharedIds(events);
  return events;
}
