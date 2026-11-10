// The item editor's validation: the shared schema of @slicex/contracts plus
// the UX rules that are about the form, not about valid data (a name; a card
// that exists in this plan). Used by Mantine Form (schemaResolver) and by the
// plain validateFinancialDraft the rest of the code calls.
//
// Errors are keyed by the form path ("amount", "recurrence.endDate", …) so
// each field shows its own message (aria-describedby); `firstFieldError`
// words the first one with its field's label for the summary line.
import { schemaResolver } from "@mantine/form";
import { FinancialItemSchemaStrict, type FinancialItemDTO } from "@slicex/contracts";
import type { CreditCardItem, FinancialItem } from "@slicex/core";
import { z } from "zod";

// Compile-time guard: the shared schema and the engine's types must not
// drift (a field added to one and not the other fails `pnpm typecheck`).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesCore: Exact<FinancialItemDTO, FinancialItem> = true;
void schemaMatchesCore;

export type ItemFormErrors = Record<string, string>;

/** The editor's schema for the cards of this plan. */
export function itemFormSchema(cards: ReadonlyArray<CreditCardItem>) {
  const known = new Set(cards.map((card) => card.id));
  return FinancialItemSchemaStrict.superRefine((item, ctx) => {
    if (item.name.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Ponle un nombre" });
    }
    if (item.kind === "card-purchase" && item.cardId !== "" && !known.has(item.cardId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cardId"], message: "Selecciona una tarjeta" });
    }
    if (item.kind === "installment-plan" && item.cardId !== undefined && !known.has(item.cardId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cardId"], message: "La tarjeta ya no existe" });
    }
  });
}

/** Field errors of `values` (empty object = valid). Sync, cheap: per render. */
export function itemFormErrors(
  values: FinancialItem,
  cards: ReadonlyArray<CreditCardItem>,
): ItemFormErrors {
  const errors = schemaResolver(itemFormSchema(cards), { sync: true })(values);
  const out: ItemFormErrors = {};
  for (const [path, message] of Object.entries(errors)) {
    if (typeof message === "string") out[path] = message;
  }
  return out;
}

// Field labels for the summary line ("Monto: No puede ser negativo").
const LABELS: Record<string, string> = {
  name: "Nombre",
  amount: "Monto",
  balance: "Saldo",
  annualRate: "Tasa anual",
  cutDay: "Día de corte",
  dueDay: "Día de pago",
  minimumPayment: "Pago mínimo",
  originalAmount: "Monto original",
  installmentsTotal: "Meses",
  installmentsPaid: "Pagados",
  cardId: "Tarjeta",
  "recurrence.startDate": "Empieza",
  "recurrence.endDate": "Termina",
  "recurrence.interval": "Cada",
};

// Order the summary follows: the form's order, top to bottom.
const ORDER = [
  "name",
  "amount",
  "paymentAmount",
  "balance",
  "annualRate",
  "cutDay",
  "dueDay",
  "minimumPayment",
  "originalAmount",
  "installmentsTotal",
  "installmentsPaid",
  "cardId",
  "recurrence.interval",
  "recurrence.startDate",
  "recurrence.endDate",
];

export function fieldLabel(path: string, item: FinancialItem): string {
  if (path === "paymentAmount") return item.kind === "credit-card" ? "Pago planeado" : "Pago";
  return LABELS[path] ?? path;
}

/** "Label: message." of the first error in form order, or null. */
export function firstFieldError(errors: ItemFormErrors, item: FinancialItem): string | null {
  const paths = Object.keys(errors);
  if (paths.length === 0) return null;
  paths.sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib);
  });
  const path = paths[0]!;
  // In the summary the message follows its label: "Monto: no puede ser negativo."
  const message = errors[path]!;
  return `${fieldLabel(path, item)}: ${message.charAt(0).toLowerCase()}${message.slice(1)}.`;
}

/** The saved form of the item: exactly the schema's keys (stale ones from a kind switch dropped). */
export function cleanItem(item: FinancialItem): FinancialItem {
  const result = FinancialItemSchemaStrict.safeParse(item);
  return result.success ? (result.data as FinancialItem) : item;
}
