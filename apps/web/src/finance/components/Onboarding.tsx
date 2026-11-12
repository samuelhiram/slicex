// "Tu año en 60 segundos": the first visit shows an example year with a
// banner; "Empezar" asks a few things (cash today, how you get paid, the
// cushion you want to keep, fixed expenses, cards and loans) and, before
// creating anything, shows the year it will build (UX-12): every object with
// its amount and date, the Mexican year's suggestions one by one (a box and
// an amount each), and how the year ends up ("tu punto más bajo…"). Nothing
// enters the plan without having been shown. No foreign demo left behind.
import * as React from "react";
import { schemaResolver, useForm } from "@mantine/form";
import { z } from "zod";
import { FinancialDocumentSchema, ISODateSchema } from "@slicex/contracts";
import {
  addDays,
  clampedDayOfMonth,
  createDefaultFinancialItem,
  daysInMonth,
  findLiquidityWarnings,
  loanPaymentCount,
  projectFinancialDocument,
  suggestMexicanYear,
  type CreditCardItem,
  type FinancialDocument,
  type FinancialItem,
  type ISODate,
  type LoanItem,
  type RecurrenceFrequency,
  type YearSuggestion,
} from "@slicex/core";
import { formatDateShort, formatMoney, formatMoneyWhole, parseNumberInput } from "../format";
import { cadenceText, frequencyParts, withFrequencyParts, withPaymentCount, type FrequencyUnit } from "../schedule-ui";
import { useOverlay } from "../../ui/use-overlay";
import { DateField } from "./DateField";
import {
  amountTextSchema,
  amountValue,
  bindField,
  DaySelect,
  FieldError,
  FieldErrorsContext,
  firstError,
  focusFirstInvalid,
  LAST_DAY_OF_MONTH,
} from "./form-kit";
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
// the item editor's "Cuándo" — a pay is never "una vez". Days of the month
// use THE day control (DaySelect), like the editor (UX-34).

interface FixedRow {
  name: string;
  amount: string;
  /** "" (not said) or "1".."31" (31 = último día). */
  day: string;
}

export type DebtKind = "card" | "card-statement" | "loan";

interface DebtRowText {
  kind: DebtKind;
  name: string;
  balance: string;
  payment: string;
  day: string;
}

const FIXED_ROW: FixedRow = { name: "", amount: "", day: "" };
const DEBT_ROW: DebtRowText = { kind: "card", name: "", balance: "", payment: "", day: "" };

const EMPTY_ROWS: FixedRow[] = [
  { name: "Renta", amount: "", day: "1" },
  { ...FIXED_ROW },
  { ...FIXED_ROW },
];

const MAX_ROWS = 12;

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

/** A 31st on or after `date`'s month: the anchor of "el último día del mes". */
function a31stFrom(date: ISODate): ISODate {
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7));
  while (daysInMonth(year, month) < 31) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return clampedDayOfMonth(year, month, 31);
}

/** A monthly rule on `day` from today (31 = every month's last day). */
function monthlyFrom(today: ISODate, day: number) {
  const startDate = nextDayOfMonth(today, day || 1);
  return day >= LAST_DAY_OF_MONTH
    ? { frequency: "monthly" as const, startDate, anchorDate: a31stFrom(startDate) }
    : { frequency: "monthly" as const, startDate };
}

export interface OnboardingDebt {
  kind: DebtKind;
  name: string;
  balance: number;
  /** Monthly payment (ignored by a "card-statement": it pays the whole statement). */
  payment: number;
  /** Payment day of the month (31 = último día). */
  day: number;
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
  /** Cards and loans (UX-24). */
  debts?: OnboardingDebt[];
  /** All the Mexican year's suggestions, as proposed (when `suggestions` is not given). */
  withSuggestions: boolean;
  /**
   * The suggestions chosen in the summary, with the amounts shown there
   * (UX-12). Given, it replaces `withSuggestions`.
   */
  suggestions?: ReadonlyArray<{ id: string; amount: number }>;
}

/** The card's cut ~20 days before its payment (a usual MX cycle; editable later). */
function cutDayFor(dueDay: number): number {
  const due = Math.min(dueDay, 30);
  return due > 20 ? due - 20 : due + 10;
}

/** The items a debt row stands for (pure; exported for tests). */
export function debtItem(today: ISODate, debt: OnboardingDebt, index: number): FinancialItem {
  if (debt.kind === "loan") {
    const count = loanPaymentCount(debt.balance, 0, debt.payment, 12) ?? 1;
    const loan: LoanItem = {
      id: `mi-prestamo-${index + 1}`,
      kind: "loan",
      name: debt.name.trim(),
      balance: debt.balance,
      paymentAmount: debt.payment,
      recurrence: withPaymentCount(monthlyFrom(today, debt.day), Math.max(1, count)),
    };
    return loan;
  }
  const base = createDefaultFinancialItem("credit-card", `mi-tarjeta-${index + 1}`, today) as CreditCardItem;
  const card: CreditCardItem = {
    ...base,
    name: debt.name.trim(),
    balance: debt.balance,
    dueDay: debt.day,
    cutDay: cutDayFor(debt.day),
    minimumPayment: 0,
  };
  if (debt.kind === "card-statement") card.paymentMode = "statement";
  else card.paymentAmount = debt.payment;
  return card;
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
    items.push({
      id: `mi-fijo-${index + 1}`,
      kind: "expense",
      name: row.name.trim(),
      amount: row.amount,
      recurrence: monthlyFrom(today, row.day || 1),
    });
  });
  (answers.debts ?? []).forEach((debt, index) => {
    if (!debt.name.trim() || !(debt.balance > 0)) return;
    items.push(debtItem(today, debt, index));
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
  if (answers.suggestions) {
    const chosen = new Map(answers.suggestions.map((choice) => [choice.id, choice.amount]));
    for (const suggestion of suggestMexicanYear(doc)) {
      const amount = chosen.get(suggestion.id);
      if (amount === undefined || !(amount > 0)) continue;
      items.push({ ...suggestion.item, amount } as FinancialItem);
    }
  } else if (answers.withSuggestions) {
    for (const suggestion of suggestMexicanYear(doc)) items.push(suggestion.item);
  }
  return doc;
}

/**
 * The cushion when the field is left empty: one pay — but never more than
 * the cash you have today (a default must not start the year below it).
 */
export function defaultReserve(cash: number, pay: number): number {
  return Math.max(0, Math.min(pay, cash));
}

/** Suggestions checked by default: the ones that hold for (almost) everyone. */
const CHECKED_BY_DEFAULT = /^sug-(aguinaldo|regalos-navidad)-/;

// The onboarding's form: Mantine Form (controlled: the summary and the
// cushion's hint follow the answers) validated with a Zod schema of the TEXT
// as typed (es-MX amounts) on top of the shared schemas — errors land on
// their field, on leaving it or on "Siguiente" (UX-32). The schedule
// (SchedulePicker) is a custom control: plain state. The next pay is THE
// date field (DateField): it holds the ISO date ("" while the text is not a
// date, undefined when empty).
interface OnboardingValues {
  cash: string;
  pay: string;
  nextPay: string | undefined;
  reserve: string;
  fixed: FixedRow[];
  debts: DebtRowText[];
  withSuggestions: boolean;
}

const dayText = z.string().refine((text) => {
  if (text.trim() === "") return true;
  const day = Number(text);
  return Number.isInteger(day) && day >= 1 && day <= 31;
}, "Día entre 1 y 31");

function isBlankDebt(row: DebtRowText): boolean {
  return row.name.trim() === "" && row.balance.trim() === "" && row.payment.trim() === "" && row.day === "";
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
        day: dayText,
      }),
    ),
    debts: z.array(
      z
        .object({
          kind: z.enum(["card", "card-statement", "loan"]),
          name: z.string(),
          balance: z.string(),
          payment: z.string(),
          day: dayText,
        })
        .superRefine((row, ctx) => {
          if (isBlankDebt(row)) return;
          const amount = (text: string) => {
            const value = parseNumberInput(text);
            return value !== null && Number.isFinite(value) && value > 0;
          };
          if (row.name.trim() === "") {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Ponle un nombre" });
          }
          if (!amount(row.balance)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["balance"], message: "Escribe cuánto debes" });
          }
          if (row.kind !== "card-statement" && !amount(row.payment)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["payment"],
              message: row.kind === "card" ? "Escribe cuánto pagas al mes (o elige «pago el total»)" : "Escribe cuánto pagas al mes",
            });
          }
          if (row.day === "") {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["day"], message: "Elige el día de pago" });
          }
        }),
    ),
    withSuggestions: z.boolean(),
  });
}

const DEBT_KIND_LABELS: Readonly<Record<DebtKind, string>> = {
  card: "Tarjeta: pago fijo",
  "card-statement": "Tarjeta: pago el total",
  loan: "Préstamo",
};

interface Picked {
  checked: boolean;
  amount: string;
}

function dayWords(day: number): string {
  return day >= LAST_DAY_OF_MONTH ? "el último día" : `el día ${day}`;
}

export function OnboardingDialog({
  today,
  onCreate,
  onClose,
  returnFocusFallback,
}: {
  today: ISODate;
  onCreate: (doc: FinancialDocument) => void;
  onClose: () => void;
  /** Where the focus goes on close when the opener is gone (the canvas host). */
  returnFocusFallback?: () => HTMLElement | null;
}) {
  const titleId = React.useId();
  const form = useForm<OnboardingValues>({
    mode: "controlled",
    initialValues: {
      cash: "",
      pay: "",
      nextPay: undefined,
      reserve: "",
      fixed: EMPTY_ROWS,
      debts: [{ ...DEBT_ROW }],
      withSuggestions: true,
    },
    validate: schemaResolver(onboardingSchema(), { sync: true }),
    validateInputOnBlur: true,
  });
  const values = form.getValues();
  // How often you get paid: a unit + "cada N" (default: la quincena).
  const [payUnit, setPayUnit] = React.useState<FrequencyUnit>("semimonthly");
  const [payEvery, setPayEvery] = React.useState(1);
  const payRule = withFrequencyParts({ frequency: "monthly", startDate: today }, payUnit, payEvery);
  const frequency = payRule.frequency;
  const [step, setStep] = React.useState<"answers" | "review">("answers");
  const [picked, setPicked] = React.useState<Record<string, Picked>>({});
  const [reviewTried, setReviewTried] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const firstRef = React.useRef<HTMLInputElement | null>(null);
  const reviewTitleRef = React.useRef<HTMLHeadingElement | null>(null);
  const [failures, setFailures] = React.useState(0);

  // The open / close contract (UX-27): Escape closes, the focus comes back.
  useOverlay({
    open: true,
    onClose,
    kind: "modal",
    containerRef: formRef,
    initialFocusRef: firstRef,
    fallbackFocus: returnFocusFallback,
  });

  // After a failed "Siguiente" / "Crear mi año": the first field to fix.
  React.useEffect(() => {
    if (failures > 0) focusFirstInvalid(formRef.current);
  }, [failures]);
  // Each step lands the focus on its start.
  const stepRef = React.useRef(step);
  React.useEffect(() => {
    if (stepRef.current === step) return;
    stepRef.current = step;
    // From the top: the sticky header must not cover the step's title.
    if (formRef.current) formRef.current.scrollTop = 0;
    if (step === "review") reviewTitleRef.current?.focus({ preventScroll: true });
    else firstRef.current?.focus({ preventScroll: true });
  }, [step]);

  // A text input bound to the form, its error under it and tied to it.
  const text = (path: string) => bindField(form, path, "fin-onboarding");

  const cashValue = amountValue(values.cash) ?? 0;
  const payValue = amountValue(values.pay) ?? 0;
  const reserveDefault = defaultReserve(cashValue, payValue);
  const nextPay =
    values.nextPay ||
    addDays(today, frequencyParts(payRule).unit === "days" ? frequencyParts(payRule).every : 14);

  /** The answers as numbers (the schema already passed). */
  const answers = (withPicked: boolean): OnboardingAnswers => ({
    cash: cashValue,
    frequency,
    interval: payRule.interval,
    pay: payValue,
    nextPay,
    reserve: amountValue(values.reserve) ?? reserveDefault,
    fixed: values.fixed
      .map((row) => ({ name: row.name, amount: amountValue(row.amount) ?? 0, day: Number(row.day) || 1 }))
      .filter((row) => row.name.trim() && row.amount > 0),
    debts: values.debts
      .filter((row) => !isBlankDebt(row))
      .map((row) => ({
        kind: row.kind,
        name: row.name,
        balance: amountValue(row.balance) ?? 0,
        payment: amountValue(row.payment) ?? 0,
        day: Number(row.day) || 1,
      })),
    withSuggestions: false,
    suggestions: withPicked
      ? Object.entries(picked)
          .filter(([, choice]) => choice.checked)
          .map(([id, choice]) => ({ id, amount: amountValue(choice.amount) ?? Number.NaN }))
      : [],
  });

  // The Mexican year proposed for THESE answers (salary → aguinaldo).
  const answersKey = JSON.stringify({ values, payUnit, payEvery });
  const suggestions = React.useMemo<YearSuggestion[]>(
    () => (step === "review" ? suggestMexicanYear(buildYear(today, answers(false))) : []),
    // `answers` reads the values `answersKey` stands for.
    [answersKey, step, today],
  );
  const pickedError = (id: string): string | undefined => {
    const choice = picked[id];
    if (!reviewTried || !choice?.checked) return undefined;
    const amount = parseNumberInput(choice.amount);
    return amount !== null && Number.isFinite(amount) && amount > 0 ? undefined : "Escribe un monto (o desmárcala)";
  };

  // How the year ends up, before creating it ("ningún valle sin aviso").
  const verdict = React.useMemo(() => {
    if (step !== "review") return null;
    const doc = buildYear(today, answers(true));
    const projection = projectFinancialDocument(doc);
    const warning = findLiquidityWarnings(projection, doc.minimumCashReserve)[0] ?? null;
    return { doc, low: projection.minimumCash, warning };
  }, [answersKey, picked, step, today]);

  const goToReview = () => {
    // Suggestions as proposed: the sure ones checked, the rest shown unchecked.
    const proposed = suggestMexicanYear(buildYear(today, answers(false)));
    setPicked((previous) => {
      const next: Record<string, Picked> = {};
      for (const suggestion of proposed) {
        const amount = suggestion.item.kind === "income" || suggestion.item.kind === "expense" ? suggestion.item.amount : 0;
        next[suggestion.id] = previous[suggestion.id] ?? {
          checked: CHECKED_BY_DEFAULT.test(suggestion.id),
          amount: String(amount),
        };
      }
      return next;
    });
    // The cushion, now said: the default fills the field (editable).
    if (values.reserve.trim() === "") form.setFieldValue("reserve", String(reserveDefault));
    setReviewTried(false);
    setStep("review");
  };

  const submit = form.onSubmit(
    () => {
      if (step === "answers") {
        goToReview();
        return;
      }
      setReviewTried(true);
      const bad = Object.values(picked).some((choice) => {
        if (!choice.checked) return false;
        const amount = parseNumberInput(choice.amount);
        return !(amount !== null && Number.isFinite(amount) && amount > 0);
      });
      if (bad) {
        setFailures((count) => count + 1);
        return;
      }
      onCreate(buildYear(today, answers(true)));
    },
    () => setFailures((count) => count + 1),
  );

  const cash = text("cash");
  const pay = text("pay");
  const reserve = text("reserve");
  const reserveNumber = amountValue(values.reserve);
  const reserveAboveCash = reserveNumber !== undefined && Number.isFinite(reserveNumber) && reserveNumber > cashValue;

  const fixedRows = values.fixed.map((row, index) => {
    const name = text(`fixed.${index}.name`);
    const amount = text(`fixed.${index}.amount`);
    const dayError = form.errors[`fixed.${index}.day`];
    return (
      <div key={index} className="fin-onboarding__row">
        <input
          key={name.key}
          {...name.input}
          type="text"
          className="fin-onboarding__name"
          aria-label={`Gasto fijo ${index + 1}`}
          placeholder={index === 1 ? "ej. Internet" : index === 2 ? "ej. Colegiatura" : "ej. Luz"}
        />
        <input
          key={amount.key}
          {...amount.input}
          type="text"
          inputMode="decimal"
          aria-label={`Monto del gasto ${index + 1}`}
          placeholder="ej. 500"
        />
        <DaySelect
          allowEmpty
          emptyLabel="Día"
          aria-label={`Día del mes del gasto ${index + 1}`}
          value={row.day === "" ? undefined : Number(row.day)}
          onChange={(day) => form.setFieldValue(`fixed.${index}.day`, day === undefined ? "" : String(day))}
          {...(dayError ? { "aria-invalid": true as const } : {})}
        />
        {amount.error}
        {dayError ? <FieldError id={`fin-onboarding-fixed-${index}-day-error`} message={dayError} /> : null}
      </div>
    );
  });

  const debtRows = values.debts.map((row, index) => {
    const name = text(`debts.${index}.name`);
    const balance = text(`debts.${index}.balance`);
    const payment = text(`debts.${index}.payment`);
    const dayError = form.errors[`debts.${index}.day`];
    return (
      <div key={index} className="fin-onboarding__debt">
        <select
          aria-label={`Tipo de la deuda ${index + 1}`}
          value={row.kind}
          onChange={(event) => form.setFieldValue(`debts.${index}.kind`, event.target.value as DebtKind)}
        >
          {(Object.keys(DEBT_KIND_LABELS) as DebtKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {DEBT_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <input
          key={name.key}
          {...name.input}
          type="text"
          aria-label={`Nombre de la deuda ${index + 1}`}
          placeholder="ej. Nu, Coppel"
        />
        <input
          key={balance.key}
          {...balance.input}
          type="text"
          inputMode="decimal"
          aria-label={`Cuánto debes (deuda ${index + 1})`}
          placeholder="Debes, ej. 20 mil"
        />
        {row.kind === "card-statement" ? (
          <span className="fin-onboarding__debt-note">Pagas el total</span>
        ) : (
          <input
            key={payment.key}
            {...payment.input}
            type="text"
            inputMode="decimal"
            aria-label={`Cuánto pagas al mes (deuda ${index + 1})`}
            placeholder="Al mes, ej. 2,000"
          />
        )}
        <DaySelect
          allowEmpty
          emptyLabel="Día de pago"
          aria-label={`Día de pago (deuda ${index + 1})`}
          value={row.day === "" ? undefined : Number(row.day)}
          onChange={(day) => form.setFieldValue(`debts.${index}.day`, day === undefined ? "" : String(day))}
          {...(dayError ? { "aria-invalid": true as const } : {})}
        />
        {name.error}
        {balance.error}
        {row.kind === "card-statement" ? null : payment.error}
        {dayError ? <FieldError id={`fin-onboarding-debts-${index}-day-error`} message={dayError} /> : null}
      </div>
    );
  });

  const payRuleShown = frequency === "semimonthly" ? payRule : { ...payRule, startDate: nextPay, anchorDate: nextPay };
  const shownAnswers = step === "review" ? answers(true) : null;

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        ref={formRef}
        className="playlist-shell__modal fin-onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onSubmit={submit}
      >
        <header className="playlist-shell__modal-header fin-onboarding__header">
          <h2 className="fin-editor__title" id={titleId}>
            Tu año en 60 segundos
          </h2>
          <button type="button" className="playlist-shell__modal-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-editor__body">
          {step === "answers" ? (
            <>
              <div className="fin-editor__grid">
                <label className="fin-editor__field fin-editor__field--wide">
                  <span className="fin-editor__label">¿Cuánto dinero tienes hoy?</span>
                  <input
                    key={cash.key}
                    {...cash.input}
                    ref={firstRef}
                    type="text"
                    inputMode="decimal"
                    placeholder="ej. 12,000 o «12 mil»"
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
                  <input key={pay.key} {...pay.input} type="text" inputMode="decimal" placeholder="ej. 9,000" />
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
                      value={values.nextPay}
                      reference={today}
                      today={today}
                      prefer="on-or-after"
                      min={today}
                      onChange={(iso) => form.setFieldValue("nextPay", iso)}
                    />
                  </FieldErrorsContext.Provider>
                ) : null}
                <label className="fin-editor__field fin-editor__field--wide">
                  <span className="fin-editor__label">
                    ¿Cuánto quieres tener siempre de colchón? <em className="fin-editor__optional">(opcional)</em>
                  </span>
                  <input key={reserve.key} {...reserve.input} type="text" inputMode="decimal" />
                  <span className="fin-editor__hint">
                    {payValue > 0
                      ? `Si lo dejas vacío: ${formatMoney(reserveDefault)} (un pago, o lo que tienes hoy si es menos).`
                      : "Si lo dejas vacío: un pago, o lo que tienes hoy si es menos."}
                  </span>
                  {reserve.error}
                </label>
              </div>

              <p className="fin-onboarding__label">
                Gastos fijos de cada mes <em className="fin-editor__optional">(opcional)</em>
              </p>
              <div className="fin-onboarding__rows">{fixedRows}</div>
              {values.fixed.length < MAX_ROWS ? (
                <button
                  type="button"
                  className="fin-editor__link fin-onboarding__more"
                  onClick={() => form.insertListItem("fixed", { ...FIXED_ROW })}
                >
                  + otra fila
                </button>
              ) : null}

              <p className="fin-onboarding__label">
                ¿Tienes tarjetas o préstamos? <em className="fin-editor__optional">(opcional)</em>
              </p>
              <div className="fin-onboarding__rows">{debtRows}</div>
              {values.debts.length < MAX_ROWS ? (
                <button
                  type="button"
                  className="fin-editor__link fin-onboarding__more"
                  onClick={() => form.insertListItem("debts", { ...DEBT_ROW })}
                >
                  + otra deuda
                </button>
              ) : null}
            </>
          ) : (
            <div className="fin-onboarding__review">
              <h3 className="fin-onboarding__review-title" ref={reviewTitleRef} tabIndex={-1}>
                Revisa tu año antes de crearlo
              </h3>
              <ul className="fin-onboarding__summary">
                <li>
                  Hoy tienes <strong>{formatMoney(cashValue)}</strong>.
                </li>
                <li>
                  Cobras <strong>{formatMoney(payValue)}</strong> {cadenceText(payRuleShown)}
                  {frequency !== "semimonthly" ? `, desde el ${formatDateShort(nextPay)}` : ""}.
                </li>
                {shownAnswers?.fixed.map((row) => (
                  <li key={`f-${row.name}`}>
                    {row.name}: <strong>−{formatMoney(row.amount)}</strong> cada mes, {dayWords(row.day)}.
                  </li>
                ))}
                {shownAnswers?.debts?.map((debt) => (
                  <li key={`d-${debt.name}`}>
                    {debt.name}: debes <strong>{formatMoney(debt.balance)}</strong>
                    {debt.kind === "card-statement"
                      ? `; pagas el total de cada estado de cuenta ${dayWords(debt.day)}.`
                      : debt.kind === "loan"
                        ? `; pagas ${formatMoney(debt.payment)} ${dayWords(debt.day)} de cada mes hasta liquidarlo.`
                        : `; pagas ${formatMoney(debt.payment)} ${dayWords(debt.day)} de cada mes (tasa supuesta: 60 % anual; ajústala después).`}
                  </li>
                ))}
              </ul>

              <label className="fin-editor__field fin-onboarding__reserve">
                <span className="fin-editor__label">Tu colchón</span>
                <input key={reserve.key} {...reserve.input} type="text" inputMode="decimal" />
                {reserveAboveCash ? (
                  <span className="fin-editor__hint fin-onboarding__warn">
                    ⚠ Es más de lo que tienes hoy: empezarías el año por debajo de tu colchón.
                  </span>
                ) : null}
                {reserve.error}
              </label>

              {suggestions.length > 0 ? (
                <fieldset className="fin-onboarding__suggestions">
                  <legend className="fin-onboarding__label">El año mexicano: marca lo que aplica y ajusta el monto</legend>
                  {suggestions.map((suggestion) => {
                    const choice = picked[suggestion.id] ?? { checked: false, amount: "" };
                    const error = pickedError(suggestion.id);
                    const errorId = `fin-onboarding-${suggestion.id}-error`;
                    const sign = suggestion.category === "income" ? "+" : "−";
                    return (
                      <div key={suggestion.id} className="fin-onboarding__suggestion">
                        <label className="fin-editor__check">
                          <input
                            type="checkbox"
                            checked={choice.checked}
                            onChange={(event) =>
                              setPicked((prev) => ({
                                ...prev,
                                [suggestion.id]: { ...choice, checked: event.target.checked },
                              }))
                            }
                          />
                          <span>
                            {suggestion.title} · {formatDateShort(suggestion.item.recurrence.startDate)}
                          </span>
                        </label>
                        <span className="fin-onboarding__amount">
                          <span aria-hidden="true">{sign}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Monto de ${suggestion.title}`}
                            value={choice.amount}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? errorId : undefined}
                            onChange={(event) =>
                              setPicked((prev) => ({
                                ...prev,
                                [suggestion.id]: { ...choice, amount: event.target.value },
                              }))
                            }
                          />
                        </span>
                        <span className="fin-editor__hint fin-onboarding__why">{suggestion.why}</span>
                        <FieldError id={errorId} message={error} />
                      </div>
                    );
                  })}
                </fieldset>
              ) : null}

              {verdict ? (
                <p className="fin-onboarding__verdict" data-tone={verdict.warning ? "warning" : "positive"}>
                  Así queda tu año: tu punto más bajo es <strong>{formatMoneyWhole(verdict.low.cash)}</strong> el{" "}
                  {formatDateShort(verdict.low.date)}.{" "}
                  {verdict.warning
                    ? `⚠ Bajas de tu colchón de ${formatMoneyWhole(verdict.doc.minimumCashReserve)} el ${formatDateShort(
                        verdict.warning.startDate,
                      )} (lo cava «${verdict.warning.name}»). Puedes ajustar arriba o arreglarlo después.`
                    : "Nunca bajas de tu colchón."}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <footer className="fin-editor__actions fin-onboarding__actions">
          <p className="fin-editor__error" role="alert">
            {firstError(form.errors) ||
              (reviewTried && Object.keys(picked).some((id) => pickedError(id))
                ? "Escribe el monto de cada sugerencia marcada (o desmárcala)"
                : "")}
          </p>
          <div className="fin-editor__buttons">
            {step === "review" ? (
              <button type="button" className="fin-editor__button" onClick={() => setStep("answers")}>
                Volver
              </button>
            ) : null}
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Seguir con el ejemplo
            </button>
            <button type="submit" className="fin-editor__button fin-editor__button--primary">
              {step === "answers" ? "Siguiente: revisar" : "Crear mi año"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
