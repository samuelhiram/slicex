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
// accent bar, the content and the track dot.
export const KIND_COLORS: Readonly<Record<FinancialItemKind, string>> = {
  income: "#1f9d55",
  expense: "#e5484d",
  loan: "#8e4ec6",
  "credit-card": "#3e63dd",
  "card-purchase": "#f76b15",
  "installment-plan": "#0d9b8a",
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

export const FREQUENCY_SHORT: Readonly<Record<RecurrenceFrequency, string>> = {
  once: "única",
  daily: "/día",
  weekly: "/sem",
  biweekly: "/14d",
  semimonthly: "/quinc",
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
