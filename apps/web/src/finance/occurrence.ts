// One payment of an item, as a CELL of the timeline: the stretch of its clip
// between that payment's mark and the next one. A quick click on a clip
// opens the cell under the pointer (OccurrenceCard); this module says which
// payment that is, what it plans and how to word a change to it.
//
// Pure (no React, no bridge state): the bridge calls `findOccurrence` with
// its document and projection.
import {
  canChangeCadence,
  canEditOccurrences,
  expandFinancialEvents,
  occurrenceAmount,
  occurrenceEditAmounts,
  ruleOccurrenceDates,
  ruleSegmentAt,
  ruleSegments,
  sortedRuleChanges,
  type FinancialDocument,
  type FinancialEventType,
  type FinancialItem,
  type FinancialProjection,
  type FinancialRecurrence,
  type ISODate,
  type OccurrenceEditRequest,
} from "@slicex/core";
import { formatDateShort, formatMoney, formatMoneyWhole } from "./format";
import { frequencyShort } from "./labels";

/** Event types that are an item's own payments / charges (its cells). */
const CELL_TYPES: ReadonlySet<FinancialEventType> = new Set<FinancialEventType>([
  "income",
  "expense",
  "loan-payment",
  "credit-card-payment",
  "credit-card-purchase",
  "installment-payment",
]);

export interface OccurrenceInfo {
  itemId: string;
  /** Scheduled date of the payment: the cell's left edge. */
  date: ISODate;
  /** The item's next payment (the cell's right edge), or null for its last one. */
  nextDate: ISODate | null;
  /** The item's payment before this one, or null for its first one. */
  prevDate: ISODate | null;
  /** 1-based position among the item's payments in the projection range. */
  index: number;
  /** The item's payments in the projection range. */
  count: number;
  /** What this payment plans (one-off edit applied), positive money. */
  amount: number;
  /** What the rule in force plans on that date (without the one-off edit). */
  ruleAmount: number;
  /** This payment has a one-off edit ("solo este pago"). */
  edited: boolean;
  /** A rule change ("a partir de aquí") starts on this date. */
  changeStartsHere: boolean;
  /** The cadence in force on that date. */
  rule: FinancialRecurrence;
  /** The item's first payment: a "from here" change edits its base rule. */
  first: boolean;
  /** The amount can be changed (false: a "statement" card, an MSI plan). */
  editable: boolean;
  /** The cadence can change from here (incomes, expenses, purchases, loans). */
  cadenceEditable: boolean;
  /** A one-time item (its only payment). */
  once: boolean;
  /** Cash direction of the payment: +1 money in, −1 money out. */
  direction: 1 | -1;
}

function itemPaymentDates(doc: FinancialDocument, item: FinancialItem): { date: ISODate; amount: number }[] {
  // A muted item is not expanded by the engine: expand it as if it counted.
  const source =
    item.enabled === false
      ? { ...doc, items: doc.items.map((candidate) => (candidate.id === item.id ? { ...item, enabled: true } : candidate)) }
      : doc;
  const out: { date: ISODate; amount: number }[] = [];
  let last = "";
  for (const event of expandFinancialEvents(source)) {
    if (event.itemId !== item.id || !CELL_TYPES.has(event.type)) continue;
    if (event.date === last) continue;
    last = event.date;
    out.push({ date: event.date, amount: event.amount });
  }
  return out;
}

/**
 * The payment of `item` whose cell holds `date`: the last payment on or
 * before it (or the first one, for a click before it). Null when the item
 * has no payment in the projection range.
 */
export function findOccurrence(
  doc: FinancialDocument,
  projection: FinancialProjection,
  item: FinancialItem,
  date: ISODate,
): OccurrenceInfo | null {
  const payments = itemPaymentDates(doc, item);
  if (payments.length === 0) return null;
  let index = 0;
  for (let i = 0; i < payments.length; i++) {
    if (payments[i]!.date <= date) index = i;
    else break;
  }
  const payment = payments[index]!;
  const editable = canEditOccurrences(item);
  const once = item.recurrence.frequency === "once";
  let amount: number;
  let ruleAmount: number;
  if (editable) {
    amount = occurrenceAmount(item, payment.date);
    ruleAmount = once ? amount : occurrenceAmount({ ...item, occurrenceEdits: undefined } as FinancialItem, payment.date);
  } else {
    // A statement card pays what the projection says; an MSI its installment.
    const point = projection.points.find(
      (candidate) => candidate.itemId === item.id && candidate.date === payment.date && candidate.cashDelta < 0,
    );
    amount = point ? -point.cashDelta : payment.amount;
    ruleAmount = amount;
  }
  const direction: 1 | -1 = item.kind === "income" ? 1 : -1;
  return {
    itemId: item.id,
    date: payment.date,
    nextDate: payments[index + 1]?.date ?? null,
    prevDate: index > 0 ? payments[index - 1]!.date : null,
    index: index + 1,
    count: payments.length,
    amount,
    ruleAmount,
    edited: !once && (occurrenceEditAmounts(item)?.has(payment.date) ?? false),
    changeStartsHere: !once && sortedRuleChanges(item).some((change) => change.from === payment.date),
    rule: ruleSegmentAt(item, payment.date).recurrence,
    // Every payment since the item's start is inside the range when it starts on or after it.
    first: index === 0 && item.recurrence.startDate >= doc.startDate,
    editable,
    cadenceEditable: canChangeCadence(item),
    once,
    direction,
  };
}

/**
 * What changes an item's payments from `today` on, in words, for lists and
 * the form: "Desde 23 dic: −$300 /semana · 9 dic: −$700 · 16 dic: sin pago".
 * Rule changes first (the rule they set), then the one-off payments, in date
 * order; at most `limit` pieces, then "+N más". Null when nothing changes.
 */
export function ruleEditsSummary(item: FinancialItem, today: ISODate, limit = 3): string | null {
  if (item.recurrence.frequency === "once" || !canEditOccurrences(item)) return null;
  const sign = item.kind === "income" ? "+" : "−";
  const pieces: string[] = [];
  for (const segment of ruleSegments(item)) {
    if (segment.change === undefined || segment.from <= today) continue;
    const amount = formatMoneyWhole(segment.amount ?? 0);
    const cadence = item.kind === "credit-card" ? "" : ` ${frequencyShort(segment.recurrence)}`;
    pieces.push(`Desde ${formatDateShort(segment.from)}: ${sign}${amount}${cadence}`);
  }
  const edits = occurrenceEditAmounts(item);
  if (edits !== null) {
    const dates = [...edits.keys()].filter((date) => date >= today).sort();
    for (const date of dates) {
      // Only payments that are still scheduled (a moved cadence can orphan one).
      if (item.kind !== "credit-card" && ruleOccurrenceDates(item, { from: date, to: date }).length === 0) continue;
      const amount = edits.get(date)!;
      pieces.push(amount === 0 ? `${formatDateShort(date)}: sin pago` : `${formatDateShort(date)}: ${sign}${formatMoneyWhole(amount)}`);
    }
  }
  if (pieces.length === 0) return null;
  if (pieces.length <= limit) return pieces.join(" · ");
  return `${pieces.slice(0, limit).join(" · ")} · +${pieces.length - limit} más`;
}

/** Signed money for the card: "+$9,000" / "−$800". */
export function signedAmount(direction: 1 | -1, amount: number): string {
  return `${direction > 0 ? "+" : "−"}${formatMoney(amount)}`;
}

/**
 * What a change to a payment did, in words, for the announcer:
 * "Gas: −$400 solo el 5 dic" / "Sueldo: +$12,000 /quincena desde el 12 dic".
 */
export function describeOccurrenceEdit(
  item: FinancialItem,
  info: OccurrenceInfo,
  request: OccurrenceEditRequest,
  rule: FinancialRecurrence,
): string {
  const amount = request.amount ?? info.amount;
  if (info.once) return `${item.name}: ${signedAmount(info.direction, amount)}`;
  if (request.scope === "this") {
    return amount === 0
      ? `${item.name}: sin pago el ${formatDateShort(info.date)}`
      : `${item.name}: ${signedAmount(info.direction, amount)} solo el ${formatDateShort(info.date)}`;
  }
  return `${item.name}: ${signedAmount(info.direction, amount)} ${frequencyShort(rule)} desde el ${formatDateShort(info.date)}`;
}
