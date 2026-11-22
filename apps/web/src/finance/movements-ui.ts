// What the "Registrar" capture and the records panel share, without React:
// the history rows (movements recorded by hand + what the plan assumed
// happened, from Rec's ledger), the period presets, the wording of an
// effect ("Liquidez hoy $8,000 → $7,500") and the plan objects per tab.
//
// Pure: no clock (today / now come from the caller), no DOM.
import type { MovementDTO } from "@slicex/contracts";
import {
  addDays,
  addMonths,
  applyMovementEffect,
  isEmptyMovementEffect,
  ruleSegmentAt,
  withAmountInForce,
  type CreditCardItem,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
  type FinancialProjection,
  type ISODate,
  type LedgerEntry,
  type Movement,
  type MovementEffect,
  type MovementKind,
  type MovementLike,
} from "@slicex/core";
import {
  formatDateLong,
  formatDateShort,
  formatDateWeekday,
  formatMoneyWhole,
  formatSignedMoneyWhole,
} from "./format";

// Compile-time guard: the shared schema and the engine's type must not drift.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesCore: Exact<MovementDTO, Movement> = true;
void schemaMatchesCore;

// ---------------------------------------------------------------------------
// History rows ("Lo que pasó").

export type HistorySource = "registered" | "plan" | "adjustment";

export interface HistoryRow extends MovementLike {
  key: string;
  source: HistorySource;
  /** The movement behind a "registered" row (editable); absent otherwise. */
  movement?: Movement;
}

/** Ledger event types that are not something the person did (estimates, bookkeeping). */
const NOT_A_MOVEMENT = new Set<LedgerEntry["type"]>(["credit-card-interest", "debt-opening"]);

/**
 * One row per movement recorded by hand, plus one per past event of the
 * plan that really moved money (Rec's ledger: as planned, edited, or the
 * cash adjustment). Skipped events, interest and debt openings are left out.
 */
export function historyRows(movements: readonly Movement[], ledger: readonly LedgerEntry[]): HistoryRow[] {
  const rows: HistoryRow[] = movements.map((movement) => ({
    key: movement.id,
    source: "registered",
    kind: movement.kind,
    amount: movement.amount,
    date: movement.date,
    concept: movement.concept,
    ...(movement.time !== undefined ? { time: movement.time } : {}),
    ...(movement.category !== undefined ? { category: movement.category } : {}),
    ...(movement.notes !== undefined ? { notes: movement.notes } : {}),
    ...(movement.cardId !== undefined ? { cardId: movement.cardId } : {}),
    movement,
  }));
  for (const entry of ledger) {
    if (NOT_A_MOVEMENT.has(entry.type)) continue;
    const source: HistorySource = entry.status === "adjustment" ? "adjustment" : "plan";
    if (entry.actual !== 0) {
      rows.push({
        key: `ledger:${entry.eventId}`,
        source,
        kind: entry.actual > 0 ? "income" : "expense",
        amount: Math.abs(entry.actual),
        date: entry.date,
        concept: entry.name,
      });
    } else if (entry.type === "credit-card-purchase" && entry.actualDebt > 0 && entry.accountId) {
      rows.push({
        key: `ledger:${entry.eventId}`,
        source,
        kind: "expense",
        amount: entry.actualDebt,
        date: entry.date,
        concept: entry.name,
        cardId: entry.accountId,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Periods.

/**
 * What dates a view covers. "day": one day, walked day by day (its date in
 * SearchView.from; absent = today). "range": SearchView.from..to, picked in
 * a calendar. "today" is the old name of a "day" on today (stored views).
 */
export type PeriodPreset =
  | "all"
  | "today"
  | "day"
  | "7d"
  | "30d"
  | "month"
  | "last-month"
  | "year"
  | "range";

/** The period selector's choices ("today" is shown as "Día a día"). */
export const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodPreset; label: string }> = [
  { value: "all", label: "Todas las fechas" },
  { value: "day", label: "Día a día" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "month", label: "Este mes" },
  { value: "last-month", label: "Mes pasado" },
  { value: "year", label: "Este año" },
  { value: "range", label: "Elegir fechas…" },
];

/** [from, to] of a preset around `today` (both undefined = no bound). */
export function periodRange(preset: PeriodPreset, today: ISODate): { from?: ISODate; to?: ISODate } {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: monthStart, to: addDays(addMonths(monthStart, 1), -1) };
    case "last-month": {
      const from = addMonths(monthStart, -1);
      return { from, to: addDays(monthStart, -1) };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return {};
  }
}

/** The day a "day" view shows (its date, or today). */
export function viewDay(view: { period: PeriodPreset; from?: ISODate }, today: ISODate): ISODate {
  return view.period === "day" && view.from !== undefined ? view.from : today;
}

/**
 * [from, to] a view covers: the presets around `today`, one day ("day" /
 * "today"), or the picked range (ordered; this month so far when unset).
 */
export function viewRange(
  view: { period: PeriodPreset; from?: ISODate; to?: ISODate },
  today: ISODate,
): { from?: ISODate; to?: ISODate } {
  if (view.period === "day" || view.period === "today") {
    const day = viewDay(view, today);
    return { from: day, to: day };
  }
  if (view.period === "range") {
    const from = view.from ?? `${today.slice(0, 7)}-01`;
    const to = view.to ?? today;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return periodRange(view.period, today);
}

// ---------------------------------------------------------------------------
// Wording.

/** "lun 16 nov · 14:32" / "16 nov 2025" (another year) — the day a movement happened. */
export function formatWhen(date: ISODate, time: string | undefined, today: ISODate): string {
  const day = date.slice(0, 4) === today.slice(0, 4) ? formatDateShort(date) : `${formatDateShort(date)} ${date.slice(0, 4)}`;
  const label = date === today ? "Hoy" : date === addDays(today, -1) ? "Ayer" : day;
  return time ? `${label} · ${time}` : label;
}

/** The card's name, or "Efectivo / débito" without a card. */
export function paidWithLabel(cardId: string | undefined, doc: FinancialDocument): string {
  if (!cardId) return "Efectivo / débito";
  const card = doc.items.find((item) => item.id === cardId);
  return card ? card.name : "Tarjeta borrada";
}

/** The credit cards of the plan, in document order. */
export function planCards(doc: FinancialDocument): CreditCardItem[] {
  return doc.items.filter((item): item is CreditCardItem => item.kind === "credit-card");
}

/**
 * What booking `effect` does to today's figures, in words:
 * "Liquidez hoy $8,000 → $7,500" · "Deuda de Nu $3,000 → $3,500".
 */
export function describeEffect(doc: FinancialDocument, effect: MovementEffect): string {
  if (isEmptyMovementEffect(effect)) return "Tu liquidez de hoy no cambia";
  const after = applyMovementEffect(doc, effect);
  const parts: string[] = [];
  if (effect.cash !== 0) {
    parts.push(`Liquidez hoy ${formatMoneyWhole(doc.initialCash)} → ${formatMoneyWhole(after.initialCash)}`);
  }
  for (const debt of effect.debts) {
    const before = doc.items.find((item) => item.id === debt.accountId);
    const next = after.items.find((item) => item.id === debt.accountId);
    if (before?.kind === "credit-card" && next?.kind === "credit-card") {
      parts.push(`Deuda de ${before.name} ${formatMoneyWhole(before.balance)} → ${formatMoneyWhole(next.balance)}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "Tu liquidez de hoy no cambia";
}

/** "−$500 Gasolina" / "+$1,200 Venta". */
export function movementHeadline(movement: MovementLike): string {
  const signed = movement.kind === "income" ? movement.amount : -movement.amount;
  return `${formatSignedMoneyWhole(signed)} ${movement.concept}`;
}

export const MOVEMENT_KIND_LABELS: Readonly<Record<MovementKind, string>> = {
  expense: "Gasto",
  income: "Ingreso",
};

/**
 * The choices of a time field: "Sin hora", then every 15 minutes of the
 * day, with `current` (e.g. 14:32, the time it was opened) in its place
 * when it is not on the grid. Values "HH:MM" ("" = no time).
 */
export function timeOptions(current: string): Array<{ value: string; label: string }> {
  const slots: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(current) && !slots.includes(current)) {
    slots.push(current);
    slots.sort();
  }
  return [{ value: "", label: "Sin hora" }, ...slots.map((slot) => ({ value: slot, label: slot }))];
}

/** "HH:MM" of a Date in local time. */
export function localTimeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// A capture dated after today is a plan item (it has not happened yet).

/**
 * The one-time plan item a FUTURE capture becomes: an expense (or a card
 * purchase when it goes on a card), or an income, on `date`. `draft` is the
 * bridge's draft of that kind (fresh id, defaults).
 */
export function plannedFromCapture(
  draft: FinancialItem,
  capture: { kind: MovementKind; amount: number; date: ISODate; concept: string; cardId?: string },
): FinancialItem {
  const recurrence = { frequency: "once" as const, startDate: capture.date, endDate: capture.date };
  if (capture.kind === "income") {
    return { id: draft.id, kind: "income", name: capture.concept, amount: capture.amount, recurrence };
  }
  if (capture.cardId) {
    return {
      id: draft.id,
      kind: "card-purchase",
      name: capture.concept,
      cardId: capture.cardId,
      amount: capture.amount,
      recurrence,
    };
  }
  return { id: draft.id, kind: "expense", name: capture.concept, amount: capture.amount, recurrence };
}

/** The draft kind a future capture asks the bridge for. */
export function plannedKindOf(capture: { kind: MovementKind; cardId?: string }): FinancialItemKind {
  if (capture.kind === "income") return "income";
  return capture.cardId ? "card-purchase" : "expense";
}

// ---------------------------------------------------------------------------
// Plan objects per tab ("En tu plan").

export type PlanTab = "income" | "expense" | "loan" | "card" | "msi";

/**
 * What the listed plan items move over the projection (absolute; excluded
 * items move nothing): the figure over "En tu plan" — the same sum as each
 * line's "/año" — so both sections show a figure and a caption, and
 * switching between them moves nothing below.
 */
export function planTotal(items: readonly FinancialItem[], projection: FinancialProjection): number {
  const ids = new Set<string>();
  for (const item of items) if (item.enabled !== false) ids.add(item.id);
  let sum = 0;
  for (const point of projection.points) if (ids.has(point.itemId)) sum += point.cashDelta;
  return Math.abs(sum);
}

/** The span that figure covers: "en el año" or "en 18 meses". */
export function horizonPhrase(months: number): string {
  return months === 12 ? "en el año" : `en ${months} meses`;
}

export const PLAN_TABS: ReadonlyArray<{ id: PlanTab; label: string; kinds: readonly FinancialItemKind[] }> = [
  { id: "income", label: "Ingresos", kinds: ["income"] },
  { id: "expense", label: "Gastos", kinds: ["expense"] },
  { id: "loan", label: "Préstamos", kinds: ["loan"] },
  { id: "card", label: "Tarjetas", kinds: ["credit-card", "card-purchase"] },
  { id: "msi", label: "MSI", kinds: ["installment-plan"] },
];

/**
 * The amount a plan row shows and edits in place (null: not editable
 * inline): with `today`, the payment of the rule in force that day (a rule
 * change from a past date is today's amount).
 */
export function planAmountOf(item: FinancialItem, today?: ISODate): number | null {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
    case "loan":
      if (today !== undefined && item.recurrence.frequency !== "once") {
        const amount = ruleSegmentAt(item, today).amount;
        if (amount !== undefined) return amount;
      }
      return item.kind === "loan" ? item.paymentAmount : item.amount;
    case "credit-card":
      return item.balance;
    default:
      return null;
  }
}

/** The item with its inline amount set (see planAmountOf; `today`: the rule in force then). */
export function withPlanAmount(item: FinancialItem, amount: number, today?: ISODate): FinancialItem {
  if (today !== undefined && item.kind !== "credit-card" && item.kind !== "installment-plan" && item.recurrence.frequency !== "once") {
    return withAmountInForce(item, today, amount);
  }
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return { ...item, amount };
    case "loan":
      return { ...item, paymentAmount: amount };
    case "credit-card":
      return { ...item, balance: amount };
    default:
      return item;
  }
}

/**
 * Per item id, the first date on or after `from` where it moves cash or
 * debt in the projection (items without one are absent). One pass.
 */
export function nextDates(projection: FinancialProjection, from: ISODate): Map<string, ISODate> {
  const next = new Map<string, ISODate>();
  for (const point of projection.points) {
    if (point.date < from || next.has(point.itemId)) continue;
    next.set(point.itemId, point.date);
  }
  return next;
}

// ---------------------------------------------------------------------------
// The records panel (right of the timeline): what it shows, its title and
// the day groups of "Lo que pasó".

export type SearchTab = "history" | PlanTab;

/** What the panel shows; kept across reloads (records-panel-state.ts). */
export interface SearchView {
  tab: SearchTab;
  query: string;
  kind: MovementKind | "all";
  period: PeriodPreset;
  /** "day": the day (absent = today); "range": its first day. */
  from?: ISODate;
  /** "range": its last day. */
  to?: ISODate;
  category: string;
  paidWith: string;
}

/** What the panel opens on: "Gastos del mes". */
export const DEFAULT_SEARCH_VIEW: SearchView = {
  tab: "history",
  query: "",
  kind: "expense",
  period: "month",
  category: "",
  paidWith: "",
};

const SEARCH_TABS: ReadonlySet<string> = new Set(["history", ...PLAN_TABS.map((tab) => tab.id)]);
const PERIODS: ReadonlySet<string> = new Set([...PERIOD_OPTIONS.map((option) => option.value), "today"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The view on another period: `from` / `to` set only when given (a "day"
 * on today and the presets carry none).
 */
export function withPeriod(
  view: SearchView,
  period: PeriodPreset,
  from?: ISODate,
  to?: ISODate,
): SearchView {
  const { from: _from, to: _to, ...rest } = view;
  return {
    ...rest,
    period,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/** A stored view, checked field by field (null: not a view). "today" becomes a "day" on today. */
export function parseSearchView(value: unknown): SearchView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { tab, query, kind, period, category, paidWith, from, to } = value as Record<string, unknown>;
  if (typeof tab !== "string" || !SEARCH_TABS.has(tab)) return null;
  if (kind !== "all" && kind !== "expense" && kind !== "income") return null;
  if (typeof period !== "string" || !PERIODS.has(period)) return null;
  if (typeof query !== "string" || typeof category !== "string" || typeof paidWith !== "string") return null;
  const day = (date: unknown) => (typeof date === "string" && ISO_DAY.test(date) ? date : undefined);
  const view: SearchView = { tab: tab as SearchTab, query, kind, period: "all", category, paidWith };
  if (period === "today") return withPeriod(view, "day");
  if (period === "day") return withPeriod(view, "day", day(from));
  if (period === "range") {
    const start = day(from);
    const end = day(to);
    if (!start || !end) return null;
    return withPeriod(view, "range", start, end);
  }
  return withPeriod(view, period as PeriodPreset);
}

const PERIOD_TITLES: Readonly<Record<PeriodPreset, string>> = {
  all: "",
  today: "de hoy",
  day: "del día",
  range: "del periodo",
  "7d": "de los últimos 7 días",
  "30d": "de los últimos 30 días",
  month: "del mes",
  "last-month": "del mes pasado",
  year: "del año",
};

/** "de hoy" / "de ayer" / "del lun 16 nov" / "del sáb 15 nov 2025". */
function dayWhen(day: ISODate, today: ISODate): string {
  if (day === today) return "de hoy";
  if (day === addDays(today, -1)) return "de ayer";
  return `del ${dayLabel(day, today)}`;
}

/** The two ends of a range, as short as they stay clear: "1" + "15 nov", "28 oct" + "3 nov", with years when not this one. */
function rangeEnds(from: ISODate, to: ISODate, today: ISODate): [string, string] {
  const year = today.slice(0, 4);
  const end = to.slice(0, 4) === year && from.slice(0, 4) === year ? formatDateShort(to) : formatDateLong(to);
  if (from.slice(0, 7) === to.slice(0, 7)) return [String(Number(from.slice(8, 10))), end];
  const start = from.slice(0, 4) === to.slice(0, 4) ? formatDateShort(from) : formatDateLong(from);
  return [start, end];
}

/** "1 – 15 nov" / "28 oct – 3 nov" / "28 dic 2025 – 3 ene 2026": the range button's text. */
export function rangeLabel(from: ISODate, to: ISODate, today: ISODate): string {
  if (from === to) return dayLabel(from, today);
  const [start, end] = rangeEnds(from, to, today);
  return `${start} – ${end}`;
}

/**
 * The panel's title says what is on screen: "Gastos del mes", "Ingresos de
 * hoy", "Gastos de ayer", "Gastos del 1 al 15 nov", "Movimientos del año",
 * "Todo lo que pasó", "Préstamos de tu plan".
 */
export function recordsTitle(
  view: Pick<SearchView, "tab" | "kind" | "period" | "from" | "to">,
  today?: ISODate,
): string {
  if (view.tab !== "history") {
    const tab = PLAN_TABS.find((entry) => entry.id === view.tab);
    return `${tab ? tab.label : "Objetos"} de tu plan`;
  }
  let when = PERIOD_TITLES[view.period];
  if (today !== undefined && (view.period === "day" || view.period === "today")) {
    when = dayWhen(viewDay(view, today), today);
  } else if (today !== undefined && view.period === "range") {
    const range = viewRange(view, today);
    const [start, end] = rangeEnds(range.from!, range.to!, today);
    when = range.from === range.to ? dayWhen(range.from!, today) : `del ${start} al ${end}`;
  }
  if (!when) {
    if (view.kind === "expense") return "Todos tus gastos";
    if (view.kind === "income") return "Todos tus ingresos";
    return "Todo lo que pasó";
  }
  const noun = view.kind === "expense" ? "Gastos" : view.kind === "income" ? "Ingresos" : "Movimientos";
  return `${noun} ${when}`;
}

/** "En tu plan" from "Lo que pasó" lands on the same kind: your planned expenses / income. */
export function planTabFor(kind: SearchView["kind"]): PlanTab {
  return kind === "income" ? "income" : "expense";
}

/** "Hoy" / "Ayer" / "lun 16 nov" / "lun 16 nov 2025" (another year). */
export function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return "Hoy";
  if (date === addDays(today, -1)) return "Ayer";
  const full = formatDateWeekday(date);
  return date.slice(0, 4) === today.slice(0, 4) ? full.replace(/ \d{4}$/, "") : full;
}

export interface DayGroup<T> {
  date: ISODate;
  rows: T[];
  /** income − expenses of the day. */
  net: number;
}

/** Runs of rows of the same day, in the order given (newest first), with each day's net. */
export function groupByDay<T extends MovementLike>(rows: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  let current: DayGroup<T> | null = null;
  for (const row of rows) {
    if (!current || current.date !== row.date) {
      current = { date: row.date, rows: [], net: 0 };
      groups.push(current);
    }
    current.rows.push(row);
    current.net += row.kind === "income" ? row.amount : -row.amount;
  }
  return groups;
}
