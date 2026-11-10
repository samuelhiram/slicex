// "Tu año en 60 segundos": the first visit shows an example year with a
// banner; "Empezar" asks three things (cash today, how you get paid, the
// cushion you want to keep) plus optional fixed expenses, and builds YOUR
// year — with the Mexican year's suggestions (aguinaldo, Buen Fin…) if
// wanted. No foreign demo left behind.
import * as React from "react";
import { schemaResolver, useForm } from "@mantine/form";
import { z } from "zod";
import { FinancialDocumentSchema, ISODateSchema } from "@slicex/contracts";
import {
  addDays,
  daysInMonth,
  suggestMexicanYear,
  type FinancialDocument,
  type FinancialItem,
  type ISODate,
  type RecurrenceFrequency,
} from "@slicex/core";
import { frequencyParts, withFrequencyParts, type FrequencyUnit } from "../schedule-ui";
import { DateField } from "./DateField";
import { amountTextSchema, amountValue, bindField, FieldErrorsContext, firstError } from "./form-kit";
import { SchedulePicker } from "./SchedulePicker";

export function WelcomeBanner({
  onStart,
  onDismiss,
}: {
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="fin-banner" aria-label="Bienvenida">
      <div className="fin-banner__text">
        <strong>Este es un año de ejemplo.</strong> ¿Armamos el tuyo? Toma 60 segundos.
      </div>
      <button type="button" className="fin-button fin-button--primary" onClick={onStart}>
        Empezar
      </button>
      <button
        type="button"
        className="fin-icon-button"
        aria-label="Seguir viendo el ejemplo"
        title="Seguir viendo el ejemplo"
        onClick={onDismiss}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 5l10 10M15 5 5 15" />
        </svg>
      </button>
    </section>
  );
}

// "¿Cada cuánto te pagan?" uses THE schedule control (SchedulePicker), like
// the item editor's "Cuándo" — a pay is never "una vez".

interface FixedRow {
  name: string;
  amount: string;
  day: string;
}

const EMPTY_ROWS: FixedRow[] = [
  { name: "Renta", amount: "", day: "1" },
  { name: "", amount: "", day: "" },
  { name: "", amount: "", day: "" },
];

/** Next date ≥ today whose day-of-month is `day` (clamped to the month). */
export function nextDayOfMonth(today: ISODate, day: number): ISODate {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 2; i += 1) {
    const clamped = Math.min(Math.max(1, Math.round(day)), daysInMonth(year, month));
    const date = `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
    if (date >= today) return date;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return today;
}

export interface OnboardingAnswers {
  cash: number;
  frequency: RecurrenceFrequency;
  /** "Cada N" of a daily / monthly pay (absent = 1). */
  interval?: number;
  pay: number;
  nextPay: ISODate;
  reserve: number;
  fixed: Array<{ name: string; amount: number; day: number }>;
  withSuggestions: boolean;
}

/** The plan built from the answers (pure; exported for tests). */
export function buildYear(today: ISODate, answers: OnboardingAnswers): FinancialDocument {
  const items: FinancialItem[] = [];
  if (answers.pay > 0) {
    items.push({
      id: "mi-sueldo",
      kind: "income",
      name: "Sueldo",
      amount: answers.pay,
      recurrence:
        answers.frequency === "semimonthly"
          ? { frequency: "semimonthly", startDate: today }
          : {
              frequency: answers.frequency,
              startDate: today,
              anchorDate: answers.nextPay,
              ...(answers.interval !== undefined && answers.interval > 1
                ? { interval: answers.interval }
                : {}),
            },
    });
  }
  answers.fixed.forEach((row, index) => {
    if (!row.name.trim() || !(row.amount > 0)) return;
    const first = nextDayOfMonth(today, row.day || 1);
    items.push({
      id: `mi-fijo-${index + 1}`,
      kind: "expense",
      name: row.name.trim(),
      amount: row.amount,
      recurrence: { frequency: "monthly", startDate: first },
    });
  });
  const doc: FinancialDocument = {
    id: "mi-ano",
    name: "Mi año",
    startDate: today,
    initialCash: answers.cash,
    minimumCashReserve: Math.max(0, answers.reserve),
    horizonMonths: 12,
    items,
  };
  if (answers.withSuggestions) {
    for (const suggestion of suggestMexicanYear(doc)) items.push(suggestion.item);
  }
  return doc;
}

// The onboarding's form: Mantine Form in UNCONTROLLED mode (nothing here
// derives from every keystroke but the reserve's placeholder and the next
// pay's date, watched) validated with a Zod schema of the TEXT as typed
// (es-MX amounts) on top of the shared schemas — errors land on their field.
// The schedule (SchedulePicker) is a custom control: plain state. The next
// pay is THE date field (DateField): it holds the ISO date ("" while the
// text is not a date, undefined when empty).
interface OnboardingValues {
  cash: string;
  pay: string;
  nextPay: string | undefined;
  reserve: string;
  fixed: FixedRow[];
  withSuggestions: boolean;
}

/** The onboarding's answers, as typed. Exported for tests. */
export function onboardingSchema() {
  return z.object({
    // A plan's cash may be negative (an overdraft), never empty.
    cash: amountTextSchema({
      number: FinancialDocumentSchema.shape.initialCash,
      required: true,
      message: "Escribe cuánto dinero tienes hoy (puede ser 0)",
    }),
    pay: amountTextSchema({ required: true, message: "Escribe cuánto te pagan cada vez" }),
    nextPay: ISODateSchema.optional(),
    reserve: amountTextSchema({ message: "Escribe un monto (o déjalo vacío)" }),
    fixed: z.array(
      z.object({
        name: z.string(),
        amount: amountTextSchema({ message: "Escribe un monto" }),
        day: z.string().refine((text) => {
          if (text.trim() === "") return true;
          const day = Number(text);
          return Number.isInteger(day) && day >= 1 && day <= 31;
        }, "Día entre 1 y 31"),
      }),
    ),
    withSuggestions: z.boolean(),
  });
}

export function OnboardingDialog({
  today,
  onCreate,
  onClose,
}: {
  today: ISODate;
  onCreate: (doc: FinancialDocument) => void;
  onClose: () => void;
}) {
  const form = useForm<OnboardingValues>({
    mode: "uncontrolled",
    initialValues: {
      cash: "",
      pay: "",
      nextPay: undefined,
      reserve: "",
      fixed: EMPTY_ROWS,
      withSuggestions: true,
    },
    validate: schemaResolver(onboardingSchema(), { sync: true }),
  });
  // How often you get paid: a unit + "cada N" (default: la quincena).
  const [payUnit, setPayUnit] = React.useState<FrequencyUnit>("semimonthly");
  const [payEvery, setPayEvery] = React.useState(1);
  const payRule = withFrequencyParts({ frequency: "monthly", startDate: today }, payUnit, payEvery);
  const frequency = payRule.frequency;
  // What follows the typing (uncontrolled: watched): the next pay's date
  // field and the reserve's placeholder.
  const [nextPay, setNextPay] = React.useState<string | undefined>(undefined);
  const [payText, setPayText] = React.useState("");
  form.watch("nextPay", ({ value }) => setNextPay(value));
  form.watch("pay", ({ value }) => setPayText(value));
  const firstRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A text input bound to the form: uncontrolled (key + defaultValue), its
  // error under it and tied to it.
  const text = (path: string) => bindField(form, path, "fin-onboarding");

  // The values passed the schema: every amount is a valid number or empty.
  const submit = form.onSubmit((values) => {
    const payValue = amountValue(values.pay) ?? 0;
    const fixed = values.fixed
      .map((row) => ({
        name: row.name,
        amount: amountValue(row.amount) ?? 0,
        day: Number(row.day) || 1,
      }))
      .filter((row) => row.name.trim() && row.amount > 0);
    onCreate(
      buildYear(today, {
        cash: amountValue(values.cash) ?? 0,
        frequency,
        interval: payRule.interval,
        pay: payValue,
        nextPay:
          values.nextPay ||
          addDays(
            today,
            frequencyParts(payRule).unit === "days" ? frequencyParts(payRule).every : 14,
          ),
        reserve: amountValue(values.reserve) ?? payValue,
        fixed,
        withSuggestions: values.withSuggestions,
      }),
    );
  });

  const cash = text("cash");
  const pay = text("pay");
  const reserve = text("reserve");

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        className="playlist-shell__modal fin-onboarding"
        role="dialog"
        aria-modal="true"
        aria-label="Tu año en 60 segundos"
        noValidate
        onSubmit={submit}
      >
        <header className="playlist-shell__modal-header">
          <strong className="fin-editor__title">Tu año en 60 segundos</strong>
          <button type="button" className="playlist-shell__modal-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-editor__body">
          <div className="fin-editor__grid">
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">¿Cuánto dinero tienes hoy?</span>
              <input
                key={cash.key}
                {...cash.input}
                ref={firstRef}
                type="text"
                inputMode="decimal"
                placeholder="$12,000"
              />
              {cash.error}
            </label>
            <div className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label" id="fin-onboarding-pay-repeat">
                ¿Cada cuánto te pagan?
              </span>
              <SchedulePicker
                labelledBy="fin-onboarding-pay-repeat"
                unit={payUnit}
                every={payEvery}
                allowOnce={false}
                onChange={(unit, every) => {
                  setPayUnit(unit);
                  setPayEvery(every);
                }}
              />
            </div>
            <label className="fin-editor__field">
              <span className="fin-editor__label">¿Cuánto cada vez?</span>
              <input key={pay.key}
                {...pay.input} type="text" inputMode="decimal" placeholder="$9,000" />
              {pay.error}
            </label>
            {frequency !== "semimonthly" ? (
              // "15 nov" is the NEXT 15 nov: the next pay is never behind you.
              <FieldErrorsContext.Provider value={form.errors}>
                <DateField
                  wide
                  optional
                  path="nextPay"
                  label="¿Cuándo es tu próximo pago?"
                  value={nextPay}
                  reference={today}
                  prefer="on-or-after"
                  min={today}
                  onChange={(iso) => form.setFieldValue("nextPay", iso, { forceUpdate: false })}
                />
              </FieldErrorsContext.Provider>
            ) : null}
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">
                ¿Cuánto quieres tener siempre de colchón?{" "}
                <em className="fin-editor__optional">(si lo dejas vacío: un pago)</em>
              </span>
              <input
                key={reserve.key}
                {...reserve.input}
                type="text"
                inputMode="decimal"
                placeholder={payText ? payText : "$5,000"}
              />
              {reserve.error}
            </label>
          </div>

          <p className="fin-onboarding__label">
            Gastos fijos <em className="fin-editor__optional">(opcional)</em>
          </p>
          <div className="fin-onboarding__rows">
            {EMPTY_ROWS.map((_, index) => {
              const name = text(`fixed.${index}.name`);
              const amount = text(`fixed.${index}.amount`);
              const day = text(`fixed.${index}.day`);
              return (
                <div key={index} className="fin-onboarding__row">
                  <input
                    key={name.key}
                {...name.input}
                    type="text"
                    aria-label={`Gasto fijo ${index + 1}`}
                    placeholder={index === 0 ? "Renta" : index === 1 ? "Internet" : "Colegiatura"}
                  />
                  <input
                    key={amount.key}
                {...amount.input}
                    type="text"
                    inputMode="decimal"
                    aria-label={`Monto del gasto ${index + 1}`}
                    placeholder="$0"
                  />
                  <input
                    key={day.key}
                {...day.input}
                    type="text"
                    inputMode="numeric"
                    aria-label={`Día del mes del gasto ${index + 1}`}
                    placeholder="día"
                  />
                  {amount.error}
                  {day.error}
                </div>
              );
            })}
          </div>

          <label className="fin-editor__check fin-onboarding__check">
            <input
              key={form.key("withSuggestions")}
              {...form.getInputProps("withSuggestions", { type: "checkbox" })}
              type="checkbox"
            />
            Agregar el año mexicano: aguinaldo, Buen Fin, predial, regreso a clases
          </label>

          <p className="fin-editor__error" role="alert">
            {firstError(form.errors)}
          </p>
          <div className="fin-editor__actions">
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Seguir con el ejemplo
            </button>
            <button type="submit" className="fin-editor__button fin-editor__button--primary">
              Crear mi año
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
