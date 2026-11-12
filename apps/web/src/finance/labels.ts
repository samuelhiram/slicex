// Shared UI vocabulary for the financial layer (labels in Spanish, colours
// per item kind). Used by the bridge (clip colours / detail text) and by the
// React panels, so both always agree.
import { recurrenceInterval } from "@slicex/core";
import type { FinancialItemKind, FinancialRecurrence, RecurrenceFrequency } from "@slicex/core";

export const KIND_LABELS: Readonly<Record<FinancialItemKind, string>> = {
  income: "Ingreso",
  expense: "Gasto",
  loan: "Préstamo",
  "credit-card": "Tarjeta",
  "card-purchase": "Compra con tarjeta",
  "installment-plan": "MSI",
};

// Mid-luminance hues that read on both the light and the dark theme: the
// canvas tints clip cards with them and uses them at full strength for the
// accent bar, the content and the track dot. Each one is ≥ 3:1 against its
// own card fill and the canvas in BOTH themes (ux-canvas.spec.ts checks it
// from palette.ts). MSI is in its card's blue family: it used to share the
// income's green (1.001:1 fills — two incomes at a glance).
export const KIND_COLORS: Readonly<Record<FinancialItemKind, string>> = {
  income: "#18864a",
  expense: "#d93d42",
  loan: "#8e4ec6",
  "credit-card": "#3e63dd",
  "card-purchase": "#c2520a",
  "installment-plan": "#2f74b5",
};

// Shape of the accent bar per kind: with the "+" / "−" of every amount,
// kinds tell apart without colour (grayscale, colour blindness).
export const KIND_ACCENT: Readonly<Record<FinancialItemKind, "solid" | "dashed" | "dotted">> = {
  income: "solid",
  expense: "solid",
  loan: "solid",
  "credit-card": "solid",
  "card-purchase": "dotted",
  "installment-plan": "dashed",
};

export const KIND_ORDER: ReadonlyArray<FinancialItemKind> = [
  "income",
  "expense",
  "loan",
  "credit-card",
  "card-purchase",
  "installment-plan",
];

export const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = {
  once: "Una vez",
  daily: "Cada N días",
  weekly: "Semanal",
  biweekly: "Cada 14 días",
  semimonthly: "Quincenal (15 y fin de mes)",
  monthly: "Mensual",
};

// Every number keeps its unit: no made-up abbreviations ("/quinc", "/14d").
export const FREQUENCY_SHORT: Readonly<Record<RecurrenceFrequency, string>> = {
  once: "única",
  daily: "/día",
  weekly: "/semana",
  biweekly: "/14 días",
  semimonthly: "/quincena",
  monthly: "/mes",
};

/**
 * Short "per" suffix of a rule ("/mes", "/quinc", "/3 días", "/2 meses"):
 * FREQUENCY_SHORT plus the "cada N" of daily / monthly rules.
 */
export function frequencyShort(rule: FinancialRecurrence): string {
  const every = recurrenceInterval(rule);
  if (rule.frequency === "daily" && every > 1) return `/${every} días`;
  if (rule.frequency === "monthly" && every > 1) return `/${every} meses`;
  return FREQUENCY_SHORT[rule.frequency];
}

// The playlist's rows are "líneas de evento" for the person ("slots" in
// English product language). A row the person never named has an
// automatic name that follows what it holds: "Línea de evento" (empty or
// one event), "Línea de eventos" (two or more). The engine leaves such rows
// with an empty label or its own "Track N"; a name the person gives (menu
// "Renombrar…") is kept as is, and clearing it brings the automatic one back.
export const ROW_NAME_ONE = "Línea de evento";
export const ROW_NAME_MANY = "Línea de eventos";

const ENGINE_ROW_LABEL = /^Track \d+$/;

/** True for a row the person never named (its name is automatic). */
export function isAutoRowLabel(label: string): boolean {
  return label.trim() === "" || ENGINE_ROW_LABEL.test(label);
}

/** Name shown for a row label (automatic rows: the singular name). */
export function displayRowLabel(label: string): string {
  return isAutoRowLabel(label) ? ROW_NAME_ONE : label;
}

/** Automatic name of a row holding `events` events. */
export function autoRowName(events: number): string {
  return events >= 2 ? ROW_NAME_MANY : ROW_NAME_ONE;
}

/**
 * Title of a row the person never named, DERIVED LIVE from what it holds
 * (never stored): its main item, "+N" for the others ("Sueldo", "Pago
 * Tarjeta Plata +1"). Empty rows keep the automatic "Línea de evento".
 */
export function derivedRowTitle(names: readonly string[]): string | null {
  const first = names.find((name) => name.trim() !== "");
  if (first === undefined) return null;
  return names.length > 1 ? `${first.trim()} +${names.length - 1}` : first.trim();
}
