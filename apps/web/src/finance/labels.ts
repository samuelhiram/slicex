// Shared UI vocabulary for the financial layer (labels in Spanish, colours
// per item kind). Used by the bridge (clip colours / detail text) and by the
// React panels, so both always agree.
import type { FinancialItemKind, RecurrenceFrequency } from "@slicex/core";

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
  weekly: "Semanal",
  biweekly: "Cada 14 días",
  semimonthly: "Quincenal (15 y fin de mes)",
  monthly: "Mensual",
};

export const FREQUENCY_SHORT: Readonly<Record<RecurrenceFrequency, string>> = {
  once: "única",
  weekly: "/sem",
  biweekly: "/14d",
  semimonthly: "/quinc",
  monthly: "/mes",
};
