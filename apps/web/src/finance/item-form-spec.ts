// The item editor's ONE form — its single source. Every kind (Ingreso, Gasto,
// Préstamo, Tarjeta, Compra con tarjeta, MSI) gets the SAME skeleton, in the
// same order:
//
//   Tipo · Nombre
//   Cuánto    the kind's amounts (one 2-column grid)
//   Cuándo    Se repite · first date [+ Día] · (card: corte / pago) · Termina
//   Detalles  what only this kind has (rate, card, "Calcular pago", the goal)
//   → readback + effect line → Guardar
//
// This table says, per kind, which fields fill each section, in order, with
// which control and width. The editor (FinancialEditorModal) renders from it,
// and the error summary follows the same order (item-schema.ts:
// firstErrorPath), so the first field you see wrong is the one it names.
// Labels are NOT here: they come from `fieldLabel` (item-schema.ts), the
// words the summary uses too. Pure data + predicates: no React, no IO.
import type { CreditCardItem, FinancialItem, FinancialItemKind, LoanItem } from "@slicex/core";
import { KIND_ORDER } from "./labels";

/** The editor's sections, top to bottom (the head has no title). */
export type FormSectionId = "head" | "amount" | "when" | "details";

export const FORM_SECTIONS: ReadonlyArray<{ readonly id: FormSectionId; readonly title: string | null }> = [
  { id: "head", title: null },
  { id: "amount", title: "Cuánto" },
  { id: "when", title: "Cuándo" },
  { id: "details", title: "Detalles" },
];

/** What a field is, which decides the control the editor draws. */
export type FormControl =
  /** Tipo: the six kinds (a switch keeps what was typed, UX-31). */
  | "kind"
  /** Nombre. */
  | "text"
  /** An amount of money ("8,000", "8 mil", "8k"). */
  | "money"
  /** A whole number (Meses, Pagados). */
  | "count"
  /** A rate, with "%". */
  | "percent"
  /** A read-only value computed from the others (Mensualidad). */
  | "computed"
  /** A card's payment: a fixed amount every month, or the whole statement. */
  | "payment-mode"
  /** The card a purchase / an MSI goes on (with "Nueva tarjeta…"). */
  | "card"
  /** "Se repite": the presets, or (card, MSI) its fixed monthly reading. */
  | "repeat"
  /** The first date (+ "Día" when it repeats monthly). */
  | "start"
  /** A day of the month (corte, pago). */
  | "day"
  /** "Termina": always here, always this word (see `KindFormSpec.end`). */
  | "end"
  /** "Calcular pago" (a loan's payment from balance, count and rate). */
  | "loan-calc"
  /** The debt's toned line (a loan's check with "Ajustar", a card's payoff). */
  | "debt-check"
  /** "Quiero liquidarla el …" (the canvas goal seek, without dragging). */
  | "payoff-goal";

/** Half a row (two fields side by side) or the whole row. */
export type FieldWidth = "half" | "wide";

type ItemPredicate = (item: FinancialItem) => boolean;

export interface FormFieldSpec {
  /**
   * Form path of the value: errors are keyed by it and the editor marks the
   * field with it (`data-field-path`). Read-only / action rows use a pseudo
   * path ("installment", "loanCalc", "debtCheck", "payoffGoal").
   */
  readonly path: string;
  /** Other error paths this field owns (they are summarised in its place). */
  readonly alsoPaths?: readonly string[];
  readonly control: FormControl;
  readonly width: FieldWidth;
  /** "(opcional)" after the label. */
  readonly optional?: boolean | ItemPredicate;
  /** Help under the field: examples, or what the value is used for. */
  readonly hint?: string | ((item: FinancialItem) => string | undefined);
  /** Kept but not used by the plan right now (a totalero's rate). */
  readonly muted?: ItemPredicate;
  /** Drawn only while this holds (e.g. the monthly payment, not for a totalero). */
  readonly shown?: ItemPredicate;
}

/**
 * How "Termina" is answered:
 * - "choice":  ◉ Nunca ○ El [fecha] (○ Después de [N] pagos when it repeats);
 * - "count":   Después de [N] pagos — required (a loan always ends: the
 *              payments you still owe);
 * - "derived": read-only, from the months (MSI); an end that cuts
 *              installments shows here with its fix.
 */
export type EndMode = "choice" | "count" | "derived";

/** "Se repite": chosen (presets) or fixed every month (card, MSI). */
export type RepeatMode = "choose" | "monthly";

export interface KindFormSpec {
  readonly repeat: RepeatMode;
  readonly end: EndMode;
  /** The fields of each titled section, in order. */
  readonly amount: readonly FormFieldSpec[];
  readonly when: readonly FormFieldSpec[];
  readonly details: readonly FormFieldSpec[];
}

// --- predicates -------------------------------------------------------------

/** The kinds whose schedule is a frequency ("Se repite" presets). */
export function usesFrequency(kind: FinancialItemKind): boolean {
  return kind !== "credit-card" && kind !== "installment-plan";
}

/** A single occurrence (a "once" frequency): it has no "Termina". */
export function happensOnce(item: FinancialItem): boolean {
  return usesFrequency(item.kind) && item.recurrence.frequency === "once";
}

const repeats: ItemPredicate = (item) => !happensOnce(item);

function totalero(item: FinancialItem): boolean {
  return item.kind === "credit-card" && item.paymentMode === "statement";
}

const owes: ItemPredicate = (item) => {
  if (item.kind === "loan") return ((item as LoanItem).balance ?? 0) > 0;
  if (item.kind === "credit-card") return (item as CreditCardItem).balance > 0;
  return false;
};

// --- the shared rows --------------------------------------------------------

/** Tipo · Nombre: the head of every kind. */
export const HEAD_FIELDS: readonly FormFieldSpec[] = [
  { path: "kind", control: "kind", width: "half" },
  { path: "name", control: "text", width: "half" },
];

const REPEAT: FormFieldSpec = {
  path: "recurrence.frequency",
  alsoPaths: ["recurrence.interval"],
  control: "repeat",
  width: "wide",
};
const START: FormFieldSpec = {
  path: "recurrence.startDate",
  alsoPaths: ["recurrence.anchorDate"],
  control: "start",
  width: "half",
};
const END: FormFieldSpec = {
  path: "recurrence.endDate",
  control: "end",
  width: "wide",
  shown: repeats,
};
const AMOUNT_HINT = "ej. 8,000 · también «8 mil» o «8k»";

/** Income, expense: an amount and a schedule. */
const SIMPLE: KindFormSpec = {
  repeat: "choose",
  end: "choice",
  amount: [{ path: "amount", control: "money", width: "half", hint: AMOUNT_HINT }],
  when: [REPEAT, START, END],
  details: [],
};

export const ITEM_FORM_SPEC: Readonly<Record<FinancialItemKind, KindFormSpec>> = {
  income: SIMPLE,
  expense: SIMPLE,
  "card-purchase": {
    repeat: "choose",
    end: "choice",
    amount: [{ path: "amount", control: "money", width: "half", hint: AMOUNT_HINT }],
    when: [REPEAT, START, END],
    details: [{ path: "cardId", control: "card", width: "half" }],
  },
  loan: {
    repeat: "choose",
    end: "count",
    // Ordered by the decision (UX-08): what you owe → what you pay.
    amount: [
      { path: "balance", control: "money", width: "half", optional: true },
      { path: "paymentAmount", control: "money", width: "half" },
    ],
    when: [REPEAT, START, END],
    details: [
      {
        path: "annualRate",
        control: "percent",
        width: "half",
        optional: true,
        hint: "Tu plan no le suma intereses al préstamo: tu pago ya los incluye. La tasa ordena tus deudas y sirve para «Calcular pago».",
      },
      { path: "loanCalc", control: "loan-calc", width: "wide", shown: repeats },
      { path: "debtCheck", control: "debt-check", width: "wide" },
      { path: "payoffGoal", control: "payoff-goal", width: "wide", shown: (item) => repeats(item) && owes(item) },
    ],
  },
  "credit-card": {
    repeat: "monthly",
    end: "choice",
    amount: [
      {
        path: "paymentMode",
        control: "payment-mode",
        width: "wide",
        hint: (item) =>
          totalero(item)
            ? "Cada fecha de pago liquidas lo que se cortó: nunca pagas intereses. Una compra después del corte se paga hasta el mes siguiente."
            : undefined,
      },
      { path: "balance", control: "money", width: "half" },
      {
        path: "paymentAmount",
        control: "money",
        width: "half",
        optional: (item) => !owes(item),
        shown: (item) => !totalero(item),
      },
      {
        path: "minimumPayment",
        control: "money",
        width: "half",
        optional: true,
        muted: totalero,
        hint: (item) => (totalero(item) ? "No se usa si pagas el total." : undefined),
      },
    ],
    when: [
      REPEAT,
      { path: "recurrence.startDate", control: "start", width: "half" },
      { path: "cutDay", control: "day", width: "half" },
      { path: "dueDay", control: "day", width: "half" },
      { path: "recurrence.endDate", control: "end", width: "wide" },
    ],
    details: [
      {
        path: "annualRate",
        control: "percent",
        width: "half",
        muted: totalero,
        hint: (item) => (totalero(item) ? "No se usa si pagas el total: nunca pagas intereses." : undefined),
      },
      { path: "debtCheck", control: "debt-check", width: "wide" },
      {
        path: "payoffGoal",
        control: "payoff-goal",
        width: "wide",
        shown: (item) => !totalero(item) && owes(item),
      },
    ],
  },
  "installment-plan": {
    repeat: "monthly",
    end: "derived",
    amount: [
      { path: "originalAmount", control: "money", width: "half" },
      { path: "installmentsTotal", control: "count", width: "half" },
      { path: "installmentsPaid", control: "count", width: "half" },
      { path: "installment", control: "computed", width: "half" },
    ],
    when: [
      REPEAT,
      { path: "recurrence.startDate", control: "start", width: "half" },
      { path: "recurrence.endDate", control: "end", width: "wide" },
    ],
    details: [{ path: "cardId", control: "card", width: "half", optional: true }],
  },
};

/** The section's fields drawn for this item (its `shown` rules applied). */
export function sectionFields(item: FinancialItem, section: FormSectionId): readonly FormFieldSpec[] {
  const fields = section === "head" ? HEAD_FIELDS : ITEM_FORM_SPEC[item.kind][section];
  return fields.filter((field) => field.shown === undefined || field.shown(item));
}

export function isOptional(field: FormFieldSpec, item: FinancialItem): boolean {
  return typeof field.optional === "function" ? field.optional(item) : field.optional === true;
}

export function fieldHint(field: FormFieldSpec, item: FinancialItem): string | undefined {
  return typeof field.hint === "function" ? field.hint(item) : field.hint;
}

function pathsOf(fields: readonly FormFieldSpec[]): string[] {
  return fields.flatMap((field) => [field.path, ...(field.alsoPaths ?? [])]);
}

/** Every form path of `kind`, in the order the form shows them (all sections). */
export function formPathOrder(kind: FinancialItemKind): readonly string[] {
  const spec = ITEM_FORM_SPEC[kind];
  return [...pathsOf(HEAD_FIELDS), ...pathsOf(spec.amount), ...pathsOf(spec.when), ...pathsOf(spec.details)];
}

/**
 * One order for when the kind is unknown: each kind's order in turn, a path
 * kept where it first appears.
 */
export const FORM_PATH_ORDER: readonly string[] = [
  ...new Set(KIND_ORDER.flatMap((kind) => formPathOrder(kind))),
];
