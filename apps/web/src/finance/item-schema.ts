// The item editor's validation: the shared schema of @slicex/contracts plus
// the UX rules that are about the form, not about valid data (a name; a card
// that exists in this plan; a card with a debt that someone pays; a loan that
// ends; an MSI whose end does not cut installments). Used by Mantine Form
// (schemaResolver) and by the plain validateFinancialDraft the rest of the
// code calls.
//
// Errors are keyed by the form path ("amount", "recurrence.endDate", …) so
// each field shows its own message (aria-describedby); `firstFieldError`
// words the first one with the field's VISIBLE label for the summary line
// (`fieldLabel` is also what the editor prints above each field, UX-32), and
// picks it in the order the form shows the fields (item-form-spec.ts: the
// one form, its single source).
import { schemaResolver } from "@mantine/form";
import { FinancialItemSchemaStrict, type FinancialItemDTO } from "@slicex/contracts";
import { isISODate, type CreditCardItem, type FinancialItem, type ISODate } from "@slicex/core";
import { z } from "zod";
import { installmentSchedule } from "./editor-readback";
import { formatDateWeekday } from "./format";
import { FORM_PATH_ORDER, formPathOrder } from "./item-form-spec";

// Compile-time guard: the shared schema and the engine's types must not
// drift (a field added to one and not the other fails `pnpm typecheck`).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesCore: Exact<FinancialItemDTO, FinancialItem> = true;
void schemaMatchesCore;

export type ItemFormErrors = Record<string, string>;

/**
 * The form's values as an item: fields the form lets you leave empty that
 * the model requires get their meaning (a card's "Pago mínimo (opcional)"
 * empty = 0). Everything else is left as typed (an empty amount stays
 * undefined and is reported).
 */
export function itemFromForm(values: FinancialItem): FinancialItem {
  if (values.kind === "credit-card" && values.minimumPayment === undefined) {
    return { ...values, minimumPayment: 0 };
  }
  return values;
}

function isOnceRule(item: FinancialItem): boolean {
  return item.kind !== "credit-card" && item.kind !== "installment-plan" && item.recurrence.frequency === "once";
}

/** The visible label of the start date for this item (UX-33 / UX-34). */
export function startLabel(item: FinancialItem): string {
  switch (item.kind) {
    case "credit-card":
      return "Pagos desde";
    case "installment-plan":
      return item.installmentsPaid > 0 ? "Abonos desde" : "Fecha de compra";
    case "card-purchase":
      return isOnceRule(item) ? "Fecha de compra" : "Primer cargo";
    case "income":
      return isOnceRule(item) ? "Fecha" : "Primer cobro";
    default:
      return isOnceRule(item) ? "Fecha" : "Primer pago";
  }
}

/**
 * The visible label of the end: "Termina" for every kind, always in the same
 * place of the one form (a loan answers it with the payments you still owe,
 * an MSI derives it from its months).
 */
export function endLabel(_item: FinancialItem): string {
  return "Termina";
}

// Visible labels (the editor prints these; the summary names them).
const LABELS: Record<string, string> = {
  kind: "Tipo",
  name: "Nombre",
  amount: "Monto",
  balance: "¿Cuánto debes hoy?",
  annualRate: "Tasa anual",
  cutDay: "Día de corte",
  dueDay: "Día de pago",
  minimumPayment: "Pago mínimo",
  originalAmount: "Monto de la compra",
  installmentsTotal: "Meses",
  installmentsPaid: "Pagados",
  cardId: "Tarjeta",
  paymentMode: "Forma de pago",
  installment: "Mensualidad",
  "recurrence.frequency": "Se repite",
  "recurrence.interval": "Cada",
  "recurrence.anchorDate": "Día de pago",
};

export function fieldLabel(path: string, item: FinancialItem): string {
  if (path === "paymentAmount") return item.kind === "credit-card" ? "¿Cuánto pagas al mes?" : "¿Cuánto pagas?";
  if (path === "recurrence.startDate") return startLabel(item);
  if (path === "recurrence.endDate") return endLabel(item);
  if (path === "payoffGoal") return item.kind === "loan" ? "Quiero liquidarlo el" : "Quiero liquidarla el";
  return LABELS[path] ?? path;
}

/** The shared schema's message for a missing number (@slicex/contracts). */
const REQUIRED = "Requerido";

// What to write in an empty required field (instead of the schema's "Requerido").
const EMPTY: Record<string, string> = {
  amount: "Escribe el monto",
  paymentAmount: "Escribe cuánto pagas",
  balance: "Escribe cuánto debes hoy (puede ser 0)",
  annualRate: "Escribe la tasa anual",
  minimumPayment: "Escribe el pago mínimo (puede ser 0)",
  originalAmount: "Escribe el monto de la compra",
  installmentsTotal: "Escribe a cuántos meses",
  installmentsPaid: "Escribe cuántos llevas pagados (puede ser 0)",
  cutDay: "Elige el día de corte",
  dueDay: "Elige el día de pago",
  "recurrence.startDate": "Escribe una fecha",
};

function valueAt(values: unknown, path: string): unknown {
  let current: unknown = values;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export interface ItemFormContext {
  /** The plan's start: an MSI's installments are counted from it. */
  docStartDate?: ISODate;
}

/** The editor's schema for the cards of this plan. */
export function itemFormSchema(cards: ReadonlyArray<CreditCardItem>, context: ItemFormContext = {}) {
  const known = new Set(cards.map((card) => card.id));
  return FinancialItemSchemaStrict.superRefine((item, ctx) => {
    if (item.name.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Ponle un nombre" });
    }
    if (item.kind === "card-purchase" && item.cardId !== "" && !known.has(item.cardId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cardId"], message: "Selecciona una tarjeta" });
    }
    if (item.kind === "installment-plan" && item.cardId !== undefined) {
      if (item.cardId === "") {
        // Several cards and none picked yet (UX-30: no preselection).
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cardId"],
          message: "Elige la tarjeta (o «Sin tarjeta»)",
        });
      } else if (!known.has(item.cardId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cardId"], message: "La tarjeta ya no existe" });
      }
    }
    // UX-01: a card that owes money must be paid by someone — a monthly
    // payment, the bank's minimum, or the whole statement (totalero). A
    // typed 0 is an explicit answer (the live line says it never ends).
    if (
      item.kind === "credit-card" &&
      item.paymentMode !== "statement" &&
      item.balance > 0 &&
      item.paymentAmount === undefined &&
      !(item.minimumPayment > 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentAmount"],
        message: "Escribe cuánto pagas al mes (o elige totalero)",
      });
    }
    // UX-08: a repeating loan ends — after the payments you still owe.
    if (item.kind === "loan" && item.recurrence.frequency !== "once" && item.recurrence.endDate === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrence", "endDate"],
        message: "Escribe cuántos pagos te faltan",
      });
    }
    // UX-07: an MSI's end never cuts installments.
    if (
      item.kind === "installment-plan" &&
      item.recurrence.endDate !== undefined &&
      context.docStartDate !== undefined &&
      isISODate(context.docStartDate)
    ) {
      const schedule = installmentSchedule(item as FinancialItem & { kind: "installment-plan" }, cards, context.docStartDate);
      if (schedule && schedule.kept.length < schedule.all.length) {
        const cut = schedule.all.length - schedule.kept.length;
        const last = schedule.all[schedule.all.length - 1]!;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recurrence", "endDate"],
          message: `Deja fuera ${cut} ${cut === 1 ? "abono" : "abonos"}: el último es el ${formatDateWeekday(last)}`,
        });
      }
    }
  });
}

/** Field errors of `values` (empty object = valid). Sync, cheap: per render. */
export function itemFormErrors(
  values: FinancialItem,
  cards: ReadonlyArray<CreditCardItem>,
  context: ItemFormContext = {},
): ItemFormErrors {
  const item = itemFromForm(values);
  const errors = schemaResolver(itemFormSchema(cards, context), { sync: true })(item);
  const out: ItemFormErrors = {};
  for (const [path, message] of Object.entries(errors)) {
    if (typeof message !== "string") continue;
    // An empty field says what to write (UX-32), not the schema's "Requerido"
    // (the editor's own rules already speak plainly).
    const empty = message === REQUIRED && valueAt(item, path) === undefined ? EMPTY[path] : undefined;
    out[path] = empty ?? message;
  }
  // The name is checked even when another field already fails (the schema's
  // own refinements only run on otherwise valid data).
  if (typeof item.name === "string" && item.name.trim() === "" && out.name === undefined) {
    out.name = "Ponle un nombre";
  }
  return out;
}

/** "Label: message." of the first error in form order, or null. */
export function firstFieldError(errors: ItemFormErrors, item: FinancialItem): string | null {
  const path = firstErrorPath(errors, item.kind);
  if (path === null) return null;
  // In the summary the message follows its label: "Monto: no puede ser negativo."
  const message = errors[path]!;
  return `${fieldLabel(path, item)}: ${message.charAt(0).toLowerCase()}${message.slice(1)}.`;
}

/**
 * Path of the first error in the order the form shows the fields of `kind`
 * (item-form-spec.ts — the summary and the screen read the same way), or
 * null. Without a kind: the spec's shared order.
 */
export function firstErrorPath(errors: ItemFormErrors, kind?: FinancialItem["kind"]): string | null {
  const paths = Object.keys(errors);
  if (paths.length === 0) return null;
  const order = kind ? formPathOrder(kind) : FORM_PATH_ORDER;
  paths.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });
  return paths[0]!;
}

/** The saved form of the item: exactly the schema's keys (stale ones from a kind switch dropped). */
export function cleanItem(item: FinancialItem): FinancialItem {
  const result = FinancialItemSchemaStrict.safeParse(itemFromForm(item));
  return result.success ? (result.data as FinancialItem) : item;
}
