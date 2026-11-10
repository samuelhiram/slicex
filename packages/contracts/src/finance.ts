// Zod schemas of the financial model (@slicex/core FinancialItem /
// FinancialDocument): ONE source of truth for every place that takes a
// financial item from outside the engine — the editor and onboarding forms
// (apps/web, through Mantine Form's schemaResolver), the plan read back from
// localStorage, and the API once it is connected.
//
// Structural + money semantics only (types, finite non-negative amounts,
// calendar dates, day / installment ranges, end >= start). UX rules that are
// not about the data being valid (e.g. "ponle un nombre") are added by the
// forms on top. Messages are Spanish and per field: the UI shows them under
// the field it names. apps/web asserts z.infer ≡ the core types at compile
// time (finance/item-schema.ts).
import { z } from "zod";

const MAX_INTERVAL = 3660;

function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "YYYY-MM-DD", a real calendar date. */
export const ISODateSchema = z
  .string({ required_error: "Escribe una fecha", invalid_type_error: "Fecha inválida" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
  .refine(isCalendarDate, "Fecha inválida");

const number = (required = "Requerido") =>
  z.number({ required_error: required, invalid_type_error: "Escribe un número" });

/** A finite amount of money, >= 0. */
export const MoneySchema = number().finite("Escribe un número").nonnegative("No puede ser negativo");

/** Day of the month, 1–31. */
export const DayOfMonthSchema = number()
  .int("Debe ser un día entre 1 y 31")
  .min(1, "Debe ser un día entre 1 y 31")
  .max(31, "Debe ser un día entre 1 y 31");

export const RecurrenceFrequencySchema = z.enum([
  "once",
  "daily",
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
]);

export const FinancialRecurrenceSchema = z
  .object({
    frequency: RecurrenceFrequencySchema,
    startDate: ISODateSchema,
    endDate: ISODateSchema.optional(),
    anchorDate: ISODateSchema.optional(),
    interval: number()
      .int("Debe ser un entero")
      .min(1, "Debe ser 1 o más")
      .max(MAX_INTERVAL, "Demasiado grande")
      .optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.endDate !== undefined && rule.endDate < rule.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "No puede ser antes de que empiece",
      });
    }
  });

export const FinancialItemKindSchema = z.enum([
  "income",
  "expense",
  "loan",
  "credit-card",
  "card-purchase",
  "installment-plan",
]);

const base = {
  id: z.string().min(1),
  name: z.string(),
  enabled: z.boolean().optional(),
  color: z.string().optional(),
  recurrence: FinancialRecurrenceSchema,
};

export const IncomeItemSchema = z.object({ ...base, kind: z.literal("income"), amount: MoneySchema });
export const ExpenseItemSchema = z.object({ ...base, kind: z.literal("expense"), amount: MoneySchema });
export const LoanItemSchema = z.object({
  ...base,
  kind: z.literal("loan"),
  paymentAmount: MoneySchema,
  balance: MoneySchema.optional(),
  annualRate: MoneySchema.optional(),
});
export const CreditCardItemSchema = z.object({
  ...base,
  kind: z.literal("credit-card"),
  balance: MoneySchema,
  annualRate: MoneySchema,
  cutDay: DayOfMonthSchema,
  dueDay: DayOfMonthSchema,
  minimumPayment: MoneySchema,
  paymentAmount: MoneySchema.optional(),
  paymentMode: z.enum(["fixed", "statement"]).optional(),
});
export const CardPurchaseItemSchema = z.object({
  ...base,
  kind: z.literal("card-purchase"),
  cardId: z.string({ required_error: "Selecciona una tarjeta" }).min(1, "Selecciona una tarjeta"),
  amount: MoneySchema,
});
export const InstallmentPlanItemSchema = z
  .object({
    ...base,
    kind: z.literal("installment-plan"),
    cardId: z.string().optional(),
    originalAmount: MoneySchema,
    installmentsTotal: number().int("Debe ser un entero ≥ 1").min(1, "Debe ser un entero ≥ 1"),
    installmentsPaid: number().int("Debe ser un entero ≥ 0").min(0, "Debe ser un entero ≥ 0"),
  })
  .superRefine((item, ctx) => {
    if (item.installmentsPaid > item.installmentsTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installmentsPaid"],
        message: "No puede ser mayor que Meses",
      });
    }
  });

/** Any financial item (discriminated by `kind`). Unknown keys are stripped. */
export const FinancialItemSchema = z.discriminatedUnion("kind", [
  IncomeItemSchema,
  ExpenseItemSchema,
  LoanItemSchema,
  CreditCardItemSchema,
  CardPurchaseItemSchema,
  // discriminatedUnion needs plain objects: the refined installment schema
  // is checked by FinancialItemSchemaStrict below.
  InstallmentPlanItemSchema.innerType(),
]);

/** FinancialItemSchema + the cross-field rules of each kind. */
export const FinancialItemSchemaStrict = FinancialItemSchema.superRefine((item, ctx) => {
  if (item.kind !== "installment-plan") return;
  const result = InstallmentPlanItemSchema.safeParse(item);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue);
});

export const FinancialDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  startDate: ISODateSchema,
  initialCash: number().finite("Escribe un número"),
  minimumCashReserve: MoneySchema,
  horizonMonths: number().int().min(1).max(1200),
  items: z.array(z.unknown()),
});

export type FinancialItemDTO = z.infer<typeof FinancialItemSchema>;
export type FinancialRecurrenceDTO = z.infer<typeof FinancialRecurrenceSchema>;
