// Real movements ("lo que sí pasó"): the journal of what the person spent or
// received, recorded the moment it happens ("gasté $500 en gasolina").
//
// Plan vs reality: the plan (FinancialDocument.items) is what WILL happen,
// projected from today; a movement is what DID happen. Every movement is a
// concept of its own — never matched against a planned item, even one with
// the same name: recording it moves today's cash (or a card's debt) at once,
// and the person judges whether they spent more or less than planned.
//
// The effect of a movement is booked on today's figures of the plan
// (`initialCash`, a card's `balance`), whatever its date: a movement dated
// last week that was not recorded yet is still missing from today's cash.
// So recording, editing and deleting are the same operation — the change of
// effect between the old and the new movement (`movementChangeEffect`) —
// and the journal is kept apart from the plan (one journal for every
// alternative future of the plan).
//
// Pure: no clock, no IO, no DOM. Amounts are POSITIVE magnitudes (the kind
// decides the sign) rounded to cents.
import { roundMoney } from "./money";
import type { FinancialDocument, FinancialItem, ISODate } from "./types";

export type MovementKind = "expense" | "income";

export interface Movement {
  id: string;
  kind: MovementKind;
  /** Positive magnitude; `kind` decides the sign. */
  amount: number;
  /** Day it happened. */
  date: ISODate;
  /** Local time it happened, "HH:MM" (24 h). Optional. */
  time?: string;
  /** What it was ("Gasolina", "Tacos con Ana"). */
  concept: string;
  /** Quick category (a preset like "Mandado" or the person's own). */
  category?: string;
  notes?: string;
  /**
   * The credit card it went through. An expense on a card adds to that
   * card's debt instead of leaving cash; an income on a card (a refund)
   * lowers its debt. Absent: cash / debit.
   */
  cardId?: string;
}

/** The fields filters and totals read: a Movement, or a row shaped like one. */
export type MovementLike = Pick<Movement, "kind" | "amount" | "date" | "concept"> &
  Partial<Pick<Movement, "time" | "category" | "notes" | "cardId">>;

/** Signed change a movement (or a change of movement) books on the plan's today. */
export interface MovementEffect {
  /** Signed change of today's cash. */
  cash: number;
  /** Signed change of card debts (one entry per card, never 0). */
  debts: Array<{ accountId: string; amount: number }>;
}

export const EMPTY_MOVEMENT_EFFECT: MovementEffect = Object.freeze({
  cash: 0,
  debts: [],
}) as MovementEffect;

/** Quick selectors of the capture, in the order they are offered (most common first). */
export const EXPENSE_CATEGORIES: readonly string[] = [
  "Mandado",
  "Comida",
  "Gasolina",
  "Transporte",
  "Gustito",
  "Servicios",
  "Farmacia",
  "Hogar",
];

export const INCOME_CATEGORIES: readonly string[] = ["Venta", "Cobro", "Extra", "Reembolso", "Regalo"];

function magnitude(amount: number): number {
  return Number.isFinite(amount) ? roundMoney(Math.abs(amount)) : 0;
}

/** What one movement books on today's cash / card debt. */
export function movementEffect(movement: MovementLike): MovementEffect {
  const amount = magnitude(movement.amount);
  if (amount === 0) return EMPTY_MOVEMENT_EFFECT;
  const sign = movement.kind === "income" ? 1 : -1;
  if (movement.cardId) {
    // On a card: an expense raises its debt, a refund lowers it; cash untouched.
    return { cash: 0, debts: [{ accountId: movement.cardId, amount: roundMoney(-sign * amount) }] };
  }
  return { cash: roundMoney(sign * amount), debts: [] };
}

/**
 * What changing `before` into `after` books (`after − before`): recording is
 * (null → new), deleting (old → null), editing (old → new). Debts merge per
 * card; a card whose change nets to 0 is left out.
 */
export function movementChangeEffect(
  before: MovementLike | null,
  after: MovementLike | null,
): MovementEffect {
  const out = after ? movementEffect(after) : EMPTY_MOVEMENT_EFFECT;
  const back = before ? movementEffect(before) : EMPTY_MOVEMENT_EFFECT;
  const cash = roundMoney(out.cash - back.cash);
  const byCard = new Map<string, number>();
  for (const debt of out.debts) byCard.set(debt.accountId, roundMoney((byCard.get(debt.accountId) ?? 0) + debt.amount));
  for (const debt of back.debts) byCard.set(debt.accountId, roundMoney((byCard.get(debt.accountId) ?? 0) - debt.amount));
  const debts: MovementEffect["debts"] = [];
  for (const [accountId, amount] of byCard) if (amount !== 0) debts.push({ accountId, amount });
  if (cash === 0 && debts.length === 0) return EMPTY_MOVEMENT_EFFECT;
  return { cash, debts };
}

export function isEmptyMovementEffect(effect: MovementEffect): boolean {
  return effect.cash === 0 && effect.debts.length === 0;
}

/** The opposite effect (what undoing it books). */
export function invertMovementEffect(effect: MovementEffect): MovementEffect {
  if (isEmptyMovementEffect(effect)) return EMPTY_MOVEMENT_EFFECT;
  return {
    cash: roundMoney(-effect.cash),
    debts: effect.debts.map((debt) => ({ accountId: debt.accountId, amount: roundMoney(-debt.amount) })),
  };
}

/**
 * The card item with `delta` added to its debt (never below 0: a refund
 * larger than the debt leaves it paid off). Any other item: unchanged.
 */
export function withCardDebtDelta(item: FinancialItem, delta: number): FinancialItem {
  if (item.kind !== "credit-card" || delta === 0) return item;
  const balance = Math.max(0, roundMoney(item.balance + delta));
  return balance === item.balance ? item : { ...item, balance };
}

/**
 * The plan with `effect` booked on today: `initialCash` moves by the cash
 * change; each card's `balance` by its debt change (cards the plan does not
 * have are skipped). Returns the SAME document when nothing changes.
 */
export function applyMovementEffect(doc: FinancialDocument, effect: MovementEffect): FinancialDocument {
  if (isEmptyMovementEffect(effect)) return doc;
  let items = doc.items;
  if (effect.debts.length > 0) {
    const deltas = new Map<string, number>();
    for (const debt of effect.debts) deltas.set(debt.accountId, roundMoney((deltas.get(debt.accountId) ?? 0) + debt.amount));
    let changed = false;
    const next = doc.items.map((item) => {
      const delta = deltas.get(item.id);
      if (delta === undefined) return item;
      const updated = withCardDebtDelta(item, delta);
      if (updated !== item) changed = true;
      return updated;
    });
    if (changed) items = next;
  }
  const initialCash = effect.cash === 0 ? doc.initialCash : roundMoney(doc.initialCash + effect.cash);
  if (items === doc.items && initialCash === doc.initialCash) return doc;
  return { ...doc, initialCash, items };
}

// ---------------------------------------------------------------------------
// Searching the journal.

/** Lower case, accents removed, spaces collapsed ("Café  Oxxo" → "cafe oxxo"). */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface MovementFilter {
  /**
   * Words to find (accent- and case-insensitive, every word must appear) in
   * the concept, category, notes or amount ("500", "$1,250.50").
   */
  query?: string;
  /** Only expenses or only income (absent / "all": both). */
  kind?: MovementKind | "all";
  /** First day (inclusive). */
  from?: ISODate;
  /** Last day (inclusive). */
  to?: ISODate;
  /** Exact category (case-insensitive). */
  category?: string;
  /** A card id, or "cash" for movements not on a card. */
  paidWith?: string;
}

function amountWords(amount: number): string {
  const value = magnitude(amount);
  const whole = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return whole;
}

/** The text a query is matched against (normalized). */
export function movementSearchText(movement: MovementLike): string {
  return normalizeSearchText(
    [movement.concept, movement.category ?? "", movement.notes ?? "", amountWords(movement.amount)].join(" "),
  );
}

function queryWords(query: string | undefined): string[] {
  if (!query) return [];
  // "$1,250.50" → "1250.50": money is matched as plain digits.
  const plain = normalizeSearchText(query).replace(/[$,]/g, "");
  return plain.split(" ").filter((word) => word.length > 0);
}

/** "HH:MM" sorts as text; newest first, a movement without time goes last in its day. */
function timeKey(time: string | undefined): string {
  return time ?? "";
}

/** Newest first: date, then time, then the later-recorded one (higher index) first. */
export function compareMovementsNewestFirst(a: MovementLike, b: MovementLike): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = timeKey(a.time);
  const tb = timeKey(b.time);
  if (ta !== tb) return ta < tb ? 1 : -1;
  return 0;
}

/**
 * The movements that match `filter`, newest first (same day and time: the
 * one recorded later first). Never mutates the input.
 */
export function filterMovements<T extends MovementLike>(list: readonly T[], filter: MovementFilter = {}): T[] {
  const words = queryWords(filter.query);
  const kind = filter.kind && filter.kind !== "all" ? filter.kind : null;
  const category = filter.category ? normalizeSearchText(filter.category) : null;
  const paidWith = filter.paidWith ?? null;
  const matched: Array<{ movement: T; index: number }> = [];
  list.forEach((movement, index) => {
    if (kind !== null && movement.kind !== kind) return;
    if (filter.from !== undefined && movement.date < filter.from) return;
    if (filter.to !== undefined && movement.date > filter.to) return;
    if (category !== null && normalizeSearchText(movement.category ?? "") !== category) return;
    if (paidWith !== null) {
      if (paidWith === "cash" ? Boolean(movement.cardId) : movement.cardId !== paidWith) return;
    }
    if (words.length > 0) {
      const text = movementSearchText(movement);
      for (const word of words) if (!text.includes(word)) return;
    }
    matched.push({ movement, index });
  });
  matched.sort((a, b) => compareMovementsNewestFirst(a.movement, b.movement) || b.index - a.index);
  return matched.map((entry) => entry.movement);
}

export interface MovementTotals {
  count: number;
  /** Sum of the expenses (positive magnitude). */
  expenses: number;
  /** Sum of the income (positive magnitude). */
  income: number;
  /** income − expenses. */
  net: number;
}

export function summarizeMovements(list: readonly MovementLike[]): MovementTotals {
  let expenses = 0;
  let income = 0;
  for (const movement of list) {
    const amount = magnitude(movement.amount);
    if (movement.kind === "income") income += amount;
    else expenses += amount;
  }
  expenses = roundMoney(expenses);
  income = roundMoney(income);
  return { count: list.length, expenses, income, net: roundMoney(income - expenses) };
}

export interface CategoryTotal {
  /** The category as first written ("Sin categoría" when none). */
  category: string;
  kind: MovementKind;
  total: number;
  count: number;
}

export const UNCATEGORIZED = "Sin categoría";

/** Totals per category and kind, largest first (ties: alphabetical). */
export function totalsByCategory(list: readonly MovementLike[]): CategoryTotal[] {
  const groups = new Map<string, CategoryTotal>();
  for (const movement of list) {
    const label = movement.category?.trim() || UNCATEGORIZED;
    const key = `${movement.kind}:${normalizeSearchText(label)}`;
    const group = groups.get(key);
    if (group) {
      group.total = roundMoney(group.total + magnitude(movement.amount));
      group.count += 1;
    } else {
      groups.set(key, { category: label, kind: movement.kind, total: magnitude(movement.amount), count: 1 });
    }
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.total - a.total || a.category.localeCompare(b.category, "es"),
  );
}

/**
 * The quick selectors for `kind`: the presets plus the person's own
 * categories, the most used first (ties keep the preset order, then the
 * most recent own category). At most `limit`.
 */
export function quickCategories(list: readonly MovementLike[], kind: MovementKind, limit = 10): string[] {
  const presets = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const uses = new Map<string, { label: string; count: number; order: number }>();
  presets.forEach((label, index) => uses.set(normalizeSearchText(label), { label, count: 0, order: index }));
  // Own categories rank after the presets on a tie, the latest used first.
  let ownOrder = presets.length + list.length;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const movement = list[i]!;
    if (movement.kind !== kind) continue;
    const label = movement.category?.trim();
    if (!label) continue;
    const key = normalizeSearchText(label);
    const entry = uses.get(key);
    if (entry) entry.count += 1;
    else uses.set(key, { label, count: 1, order: ownOrder++ });
  }
  return Array.from(uses.values())
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.label);
}

/** Distinct categories used in `list` (as first written), alphabetical. */
export function usedCategories(list: readonly MovementLike[]): string[] {
  const seen = new Map<string, string>();
  for (const movement of list) {
    const label = movement.category?.trim();
    if (!label) continue;
    const key = normalizeSearchText(label);
    if (!seen.has(key)) seen.set(key, label);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "es"));
}
