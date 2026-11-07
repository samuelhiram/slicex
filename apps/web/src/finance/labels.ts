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

export const KIND_COLORS: Readonly<Record<FinancialItemKind, string>> = {
  income: "#3fb37f",
  expense: "#e0645c",
  loan: "#b07ad9",
  "credit-card": "#4f8fe0",
  "card-purchase": "#e39b3d",
  "installment-plan": "#43b5c4",
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
